/** Decode only the top-level respond.text string. Never emit JSON, refs or other tool arguments. */
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
  let i = 0, disposition: string | undefined;
  const whitespace = () => { while (/\s/.test(raw[i] ?? '') && i < raw.length) i++; };
  whitespace(); if (raw[i++] !== '{') return null;
  for (;;) {
    whitespace(); const key = stringAt(raw, i);
    if (!key?.complete) return null;
    i = key.end; whitespace(); if (raw[i++] !== ':') return null; whitespace();
    const value = stringAt(raw, i);
    if (!value) return null; // conservative fallback for a different field order/shape
    if (key.value === 'text') return disposition === 'finish' || disposition === 'wait_user' ? value.value : null;
    if (key.value !== 'disposition' || !value.complete) return null;
    disposition = value.value; i = value.end; whitespace(); if (raw[i++] !== ',') return null;
  }
}
