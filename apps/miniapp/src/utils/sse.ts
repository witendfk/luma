import { parseStreamEvent, type StreamEvent } from '@luma/shared';
import { API_BASE } from '@/config';
import { clearToken, getToken } from './token';

/**
 * 一轮对话的流式接收（设计文档 §10）。
 * 微信端通过 wx.request 的 enableChunked + onChunkReceived 接收 text/event-stream，
 * 需处理跨块的 UTF-8 多字节字符与半条事件。
 * TODO(第一周真机验证)：首段到达、停止生成、断线恢复（设计文档 §5）。
 */

/** 增量 UTF-8 解码：不完整的字节序列留待下一块拼接 */
class Utf8StreamDecoder {
  private pending: number[] = [];

  get incomplete(): boolean { return this.pending.length > 0; }

  decode(chunk: Uint8Array): string {
    const buf = [...this.pending, ...chunk];
    const out: number[] = [];
    let i = 0;
    while (i < buf.length) {
      const b0 = buf[i] as number;
      let len: number;
      if (b0 < 0x80) len = 1;
      else if ((b0 & 0xe0) === 0xc0) len = 2;
      else if ((b0 & 0xf0) === 0xe0) len = 3;
      else if ((b0 & 0xf8) === 0xf0) len = 4;
      else len = 1; // 非法起始字节：按单字节跳过
      if (i + len > buf.length) break; // 半个多字节字符，留待下一块
      for (let k = 0; k < len; k++) out.push(buf[(i + k) as number] as number);
      i += len;
    }
    this.pending = buf.slice(i);
    return bytesToUtf8(out);
  }
}

function bytesToUtf8(bytes: number[]): string {
  if (bytes.length === 0) return '';
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
  // 低版本基础库无 TextDecoder：逐字节拼串后借 decodeURIComponent 还原 UTF-8
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b & 0xff);
  try {
    return decodeURIComponent(escape(raw));
  } catch {
    return raw; // 解码失败按原样展示，不阻断流
  }
}

/** SSE 帧解析：按空行分帧，取 data: 行拼接后解析为事件 */
class SseFrameBuffer {
  private buffer = '';

  feed(text: string, onEvent: (event: StreamEvent) => void): void {
    this.buffer = (this.buffer + text).replace(/\r\n/g, '\n');
    let idx = this.buffer.indexOf('\n\n');
    while (idx >= 0) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.emit(frame, onEvent);
      idx = this.buffer.indexOf('\n\n');
    }
  }

  get incomplete(): boolean { return this.buffer.trim().length > 0; }

  private emit(frame: string, onEvent: (event: StreamEvent) => void): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return;
    onEvent(parseStreamEvent(data));
  }
}

export interface TurnStreamOptions {
  conversationId: string;
  body: Record<string, unknown>;
  onEvent: (event: StreamEvent) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface TurnStreamHandle {
  abort(): void;
}

interface ChunkedTask {
  onChunkReceived(cb: (res: { data: ArrayBuffer | string }) => void): void;
  onHeadersReceived?(cb: (res: { statusCode: number }) => void): void;
  abort(): void;
}

export function openTurnStream(opts: TurnStreamOptions): TurnStreamHandle {
  if (getToken() === 'luma-ui-preview-only') { clearToken(); opts.onError('请重新登录正式账号'); return { abort() {} }; }
  let aborted = false;
  let settled = false;
  let terminal = false;
  let receivedChunk = false;
  let status: number | undefined;
  let errorText = '';
  let task: { abort(): void } | null = null;
  const token = getToken();
  const decoder = new Utf8StreamDecoder();
  const frames = new SseFrameBuffer();
  const header = {
    'content-type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  function active(): boolean {
    if (aborted || settled) return false;
    if (token !== getToken()) {
      aborted = true;
      task?.abort();
      return false;
    }
    return true;
  }

  function fail(message: string, unauthenticated = false): void {
    if (!active()) return;
    settled = true;
    task?.abort();
    if (unauthenticated && token === getToken()) clearToken();
    opts.onError(message);
  }

  function feed(text: string): void {
    frames.feed(text, (event) => {
      if (!active() || terminal) return;
      terminal = ['run.completed', 'run.failed', 'run.cancelled', 'run.waiting'].includes(event.type);
      opts.onEvent(event);
    });
  }

  function asText(data: unknown): string {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return bytesToUtf8(Array.from(new Uint8Array(data)));
    return data == null ? '' : JSON.stringify(data);
  }

  function finish(res: { statusCode: number; data?: unknown }): void {
    if (!active()) return;
    status = res.statusCode;
    if (status < 200 || status >= 300) {
      let message = `请求失败（HTTP ${status}）`;
      let unauthenticated = status === 401;
      try {
        const body = JSON.parse(asText(res.data) || errorText);
        if (typeof body?.error?.message === 'string') message = body.error.message;
        unauthenticated ||= body?.error?.code === 'UNAUTHENTICATED';
      } catch { /* 非 JSON 错误响应仍保留 HTTP 状态说明。 */ }
      fail(message, unauthenticated);
      return;
    }
    try {
      if (!receivedChunk) feed(asText(res.data));
      if (!terminal || decoder.incomplete || frames.incomplete) {
        fail('回复未完整接收，请重新进入对话查看结果或重试');
        return;
      }
    } catch {
      fail('服务响应格式异常，请重试');
      return;
    }
    if (!active()) return;
    settled = true;
    opts.onDone();
  }

  const handle: TurnStreamHandle = {
    abort() {
      if (aborted || settled) return;
      aborted = true;
      task?.abort();
    },
  };

  // #ifdef MP-WEIXIN
  const chunkedTask = wx.request({
    url: `${API_BASE}/api/conversations/${opts.conversationId}/turns`,
    method: 'POST',
    data: opts.body,
    header,
    enableChunked: true,
    responseType: 'arraybuffer',
    success: finish,
    fail: (err: { errMsg?: string }) => {
      fail(err.errMsg ?? '连接中断');
    },
  } as Record<string, unknown>) as unknown as ChunkedTask;

  task = chunkedTask;
  chunkedTask.onHeadersReceived?.((res) => { status = res.statusCode; });
  chunkedTask.onChunkReceived((res) => {
    if (!active()) return;
    receivedChunk = true;
    try {
      const text = typeof res.data === 'string' ? res.data : decoder.decode(new Uint8Array(res.data));
      if (status === undefined || status < 200 || status >= 300) {
        errorText = (errorText + text).slice(0, 16_384);
      }
      if (status === undefined || (status >= 200 && status < 300)) feed(text);
    } catch {
      fail('服务响应格式异常，请重试');
    }
  });

  return handle;
  // #endif

  // #ifndef MP-WEIXIN
  // 非微信端（H5/浏览器调试）：一次性返回后整段解析
  task = uni.request({
    url: `${API_BASE}/api/conversations/${opts.conversationId}/turns`,
    method: 'POST',
    data: opts.body as Record<string, unknown>,
    header,
    success: finish,
    fail: (err) => fail(err.errMsg ?? '连接中断'),
  });
  return handle;
  // #endif
}
