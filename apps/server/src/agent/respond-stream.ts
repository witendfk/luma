/** 只解码白名单教学内容块；半截JSON、内部记录及引用不能流到界面。 */
function stringAt(raw: string, start: number): { value: string; end: number; complete: boolean } | null {
  if (raw[start] !== '"') return null;
  let value = '';
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') return { value, end: i + 1, complete: true };
    if (ch.charCodeAt(0) < 32) return null;
    if (ch !== '\\') { value += ch; continue; }
    const escape = raw[++i];
    if (escape === undefined) break;
    const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    if (escape in simple) value += simple[escape];
    else if (escape === 'u') {
      const hex = raw.slice(i + 1, i + 5);
      if (hex.length < 4) break;
      if (!/^[a-f\d]{4}$/i.test(hex)) return null;
      value += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else return null;
  }
  if (value.length && /[\uD800-\uDBFF]/.test(value[value.length - 1]!)) value = value.slice(0, -1);
  return { value, end: raw.length, complete: false };
}

export function partialRespondText(raw: string): string | null {
  let i = 0;
  const ws = () => { while (i < raw.length && /\s/.test(raw[i]!)) i++; };
  const take = (char: string) => { ws(); return raw[i++] === char; };
  const str = () => { ws(); const value = stringAt(raw, i); if (value) i = value.end; return value; };
  if (!take('{')) return null;
  const key = str(); if (!key?.complete || key.value !== 'disposition' || !take(':')) return null;
  const disposition = str();
  if (!disposition?.complete || !['finish', 'wait_user'].includes(disposition.value) || !take(',')) return null;
  const content = str(); if (!content?.complete || content.value !== 'content' || !take(':') || !take('[')) return null;
  const parts: string[] = [];
  for (;;) {
    ws(); if (raw[i] === ']') return parts.join('\n\n');
    if (!take('{')) return parts.length ? parts.join('\n\n') : null;
    const typeKey = str(); if (!typeKey?.complete || typeKey.value !== 'type' || !take(':')) return parts.join('\n\n');
    const type = str(); if (!type?.complete || !['paragraph', 'heading', 'formula'].includes(type.value) || !take(',')) return parts.join('\n\n');
    const textKey = str(); if (!textKey?.complete || textKey.value !== 'text' || !take(':')) return parts.join('\n\n');
    const text = str(); if (!text) return parts.join('\n\n');
    parts.push(type.value === 'formula' ? `$$${text.value}${text.complete ? '$$' : ''}` : type.value === 'heading' ? `### ${text.value}` : text.value);
    if (!text.complete || !take('}')) return parts.join('\n\n');
    ws(); if (raw[i] !== ',') return parts.join('\n\n');
    i++;
  }
}
