/** 自动标题保留短题完整内容；超出标题上限时明确标记省略。 */
export function createConversationTitle(text: string): string {
  const characters = Array.from(text.trim().replace(/\s+/g, ' '));
  if (!characters.length) return '新对话';
  return characters.length > 60 ? `${characters.slice(0, 59).join('')}…` : characters.join('');
}

/** 兼容旧版直接取前 24 字的自动标题；仅在与首版原文吻合时恢复。 */
export function restoreLegacyTitle(title: string, initialContent: unknown): string {
  const text = (initialContent as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') return title;
  const original = text.trim();
  return original.length > 24 && title === original.slice(0, 24)
    ? createConversationTitle(original)
    : title;
}
