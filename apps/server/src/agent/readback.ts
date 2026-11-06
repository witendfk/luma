import type { TaskFrame } from './types';

export function initialReadback(text: string, messageId: string): TaskFrame['readback'] {
  return /(?:前面|之前|先前|早先|上次|刚才).{0,24}(方法|条件|要求|例子|讲法|说|讲|提到|讨论|改|没懂|不懂)|(?:按照|根据|延续).{0,8}(?:之前|前面|刚才)|第[一二三123]种方法/u.test(text)
    ? { reason: 'history_reference', status: 'pending', triggerMessageId: messageId, sourceMessageIds: [], candidateMessageIds: [], ranges: {} } : undefined;
}

export function observeReadback(frame: TaskFrame, results: Array<{ toolName: string; value: unknown }>): void {
  const requirement = frame.readback;
  if (!requirement || requirement.status !== 'pending') return;
  for (const result of results) {
    if (result.toolName !== 'readLearningContext') continue;
    const value = result.value as { ok?: boolean; mode?: string; hits?: Array<{id: string}>; messages?: Array<{id: string; offset?: number; text: string; complete?: boolean}> };
    if (!value.ok) continue;
    if (value.mode === 'search') {
      requirement.candidateMessageIds = [...new Set([...requirement.candidateMessageIds, ...(value.hits ?? []).map((m) => m.id)])].slice(0, 30);
      continue;
    }
    for (const message of value.messages ?? []) {
      if (message.id === requirement.triggerMessageId || (requirement.candidateMessageIds.length && !requirement.candidateMessageIds.includes(message.id))) continue;
      const offset = message.offset ?? 0;
      if (offset !== (requirement.ranges[message.id] ?? 0)) continue;
      requirement.ranges[message.id] = offset + message.text.length;
      if (message.complete !== false && message.text) requirement.sourceMessageIds.push(message.id);
    }
    requirement.sourceMessageIds = [...new Set(requirement.sourceMessageIds)];
    if (requirement.sourceMessageIds.length) requirement.status = 'read';
  }
}
export interface Clarification { reason: 'history_ambiguous' | 'subject_correction'; question: string }
export function validateReadback(frame: TaskFrame, reply: { disposition: string; text: string; clarification?: Clarification }): { ok: false; message: string } | null {
  const required = frame.conditionCorrection ? 'subject_correction' : frame.readback?.status === 'pending' ? 'history_ambiguous' : null;
  if (!required) return null;
  if (reply.disposition === 'wait_user' && reply.clarification?.reason === required && reply.text.includes(reply.clarification.question)) {
    if (frame.readback) frame.readback.status = 'clarified';
    return null;
  }
  return { ok: false, message: required === 'subject_correction'
    ? '题干条件疑似更正：只能wait_user并在content明确引导修改/重新确认题干，同时填写clarification(reason=subject_correction,question=实际展示的问题)，不能继续计算或生成材料'
    : '历史指代尚无原文依据：先搜索并完整回读命中轮次；无结果或不明确时用wait_user向学生澄清，在clarification填写history_ambiguous及实际展示的问题，不能猜测历史内容' };
}
