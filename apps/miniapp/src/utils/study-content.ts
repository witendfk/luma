import type { RichNode } from '@luma/shared';

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
