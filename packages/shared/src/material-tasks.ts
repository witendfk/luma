import type { MaterialTaskView } from './api';

/** Anchor to this run's last assistant reply, otherwise to its originating student message. Never the newest unrelated reply. */
export function materialTaskAnchors(messages: Array<{ id: string; role: string; runId?: string | null }>, tasks: MaterialTaskView[]): Record<string, MaterialTaskView[]> {
  const anchors: Record<string, MaterialTaskView[]> = {};
  for (const task of tasks) {
    const reply = task.runId ? [...messages].reverse().find((m) => m.role === 'assistant' && m.runId === task.runId) : undefined;
    const user = messages.find((m) => m.id === task.userMessageId)
      ?? (task.runId ? messages.find((m) => m.role === 'user' && m.runId === task.runId) : undefined);
    const anchor = reply ?? user;
    if (anchor) (anchors[anchor.id] ??= []).push(task);
  }
  return anchors;
}
