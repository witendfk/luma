import type { ModelMessage } from 'ai';
import type { ToolCall } from '../lib/model';

/**
 * 工具协议消息（设计文档 §4.13）：原生 tool-call / tool-result 的配对保存在
 * run.protocol（ModelMessage[]），不能把工具结果降级为普通 assistant 文字。
 */

export function userTextMessage(text: string, imageAttachmentIds: string[] = []): ModelMessage {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];
  if (text) content.push({ type: 'text', text });
  for (const id of imageAttachmentIds) {
    // 图片以附件标识进入协议；恢复时按需重签访问地址（§4.13）
    content.push({ type: 'image', image: `attachment:${id}` });
  }
  if (content.length === 0) content.push({ type: 'text', text: '（学生上传了图片）' });
  return { role: 'user', content };
}

export function assistantToolCallsMessage(calls: ToolCall[]): ModelMessage {
  return {
    role: 'assistant',
    content: calls.map((c) => ({ type: 'tool-call', toolCallId: c.toolCallId, toolName: c.toolName, input: c.input })),
  } as ModelMessage;
}

export interface ToolResultForProtocol {
  toolCallId: string;
  toolName: string;
  /** 工具统一返回：成功数据或 { ok:false, code, message, retryable }（§6.1） */
  value: unknown;
}

export function toolResultsMessage(results: ToolResultForProtocol[]): ModelMessage {
  return {
    role: 'tool',
    content: results.map((r) => ({
      type: 'tool-result',
      toolCallId: r.toolCallId,
      toolName: r.toolName,
      output: { type: 'json', value: r.value },
    })),
  } as ModelMessage;
}

export function correctionMessage(text: string): ModelMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: `【系统校正】${text} 请按协议重新给出本步。` }],
  } as ModelMessage;
}
