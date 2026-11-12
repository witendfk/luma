import type { RichNode } from '@luma/shared';

/** 单行标题只作索引；复杂公式留在正文完整排版，不泄漏LaTeX命令。 */
export function studyPreview(text: string): string {
  const sub = '₀₁₂₃₄₅₆₇₈₉', sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const formula = (value: string): string => {
    const readable = value
      .replace(/_\{?(\d+)\}?/g, (_, n: string) => Array.from(n, (c) => sub[Number(c)]).join(''))
      .replace(/\^\{?(\d+)\}?/g, (_, n: string) => Array.from(n, (c) => sup[Number(c)]).join(''))
      .replace(/\\(?:times|cdot)\b/g, '×').replace(/\\leq?\b/g, '≤').replace(/\\geq?\b/g, '≥')
      .replace(/\\neq\b/g, '≠').replace(/\\pi\b/g, 'π');
    return /\\|[{}_^]/.test(readable) ? '〔公式〕' : readable;
  };
  return text.replace(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\$([^$\n]*)\$|\\\(([^\n]*?)\\\)/g,
    (_, ...parts: unknown[]) => formula(parts.slice(0, 4).find((p) => typeof p === 'string') as string ?? ''))
    .replace(/\*\*|#{1,4}\s+/g, '').replace(/\s+/g, ' ').trim();
}

/** 流式/排版故障时仍保留正文，公式用明确占位，绝不展示半截LaTeX。 */
export function pendingContentNodes(text: string, failed = false): RichNode[] {
  const label = failed ? '〔公式暂未排版〕' : '〔公式排版中…〕';
  const safe = text.replace(/\$\$[\s\S]*?(?:\$\$|$)|\\\[[\s\S]*?(?:\\\]|$)|\$[^\n$]*(?:\$|(?=\n|$))|\\\([^\n]*?(?:\\\)|(?=\n|$))/g, label);
  return safe.split(/\n\s*\n/).filter(Boolean).map((paragraph) => ({
    name: 'p', attrs: { style: 'margin:0 0 14px;white-space:pre-wrap;word-break:break-word;' },
    children: paragraph.replace(/^#{1,4}\s+/gm, '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) =>
      part.startsWith('**') && part.endsWith('**')
        ? { name: 'strong', attrs: { style: 'font-weight:600;color:#40543e;' }, children: [{ type: 'text', text: part.slice(2, -2) }] }
        : { type: 'text', text: part.replace(/\*\*/g, '') }),
  }));
}
