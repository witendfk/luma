import { Tiktoken } from 'js-tiktoken/lite';
import o200k from 'js-tiktoken/ranks/o200k_base';

let tokenizer: Tiktoken | undefined;

/** GPT-compatible encoding, with margin for provider framing/alias differences; never byte = token. */
export function estimateTokens(value: unknown): number {
  tokenizer ??= new Tiktoken(o200k);
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  const count = tokenizer.encode(text, [], []).length;
  return Math.ceil(count * 1.1) + 16;
}
