/**
 * 消息结构化内容块（设计文档 §9 Message.content / §5.2 输出类型）。
 * 前端按 block.type 渲染；原始工具结果不透传。
 */

export type UserBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentIds: string[] };

export type AssistantBlock =
  | { type: 'text'; text: string }
  /** 待核对的题干/知识点（核对卡） */
  | { type: 'clarification'; subjectRevisionId: string; version: number; text: string; tags: string[] }
  /** 成果材料引用（入口区分 generating/published/failed） */
  | { type: 'artifact'; artifactId: string; artifactType: 'lesson' | 'exercise_set'; status: string }
  /** 主动查看的完整解析（单独区域渲染） */
  | { type: 'solution'; text: string };

export type MessageBlock = UserBlock | AssistantBlock;

export interface MessageContent {
  blocks: MessageBlock[];
}

/** 取消息中的纯文本（装配上下文用） */
export function textOf(content: unknown): string {
  const blocks = (content as MessageContent | null)?.blocks ?? [];
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
