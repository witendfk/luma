import type { StreamEvent } from '@luma/shared';

export type EventEmitter = (event: StreamEvent) => void;

/**
 * text/event-stream 响应（设计文档 §10）。
 * - X-Accel-Buffering: no 关闭反向代理缓冲，保证首段 5 秒内到达；
 * - 微信端用 wx.request enableChunked + onChunkReceived 分块接收，
 *   小程序侧负责跨块 UTF-8 解码与半条事件拼接。
 * produce 约定：自行保证终止事件（run.completed / run.waiting / run.failed / run.cancelled），
 * 本函数不代发兜底事件，避免伪造状态。
 */
export function sseResponse(
  produce: (emit: EventEmitter, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit: EventEmitter = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await produce(emit, signal);
      } catch (err) {
        console.error('[sse] 流式产出异常中断', err);
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // 流已被客户端断开
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
