import { createHash } from 'node:crypto';
import type { RunCounters } from './limits';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Three consecutive tool batches with no new input/result evidence stop the run.
 * New offsets, changed results and material versions are progress. A recovered batch
 * is observed once; state is committed with its paired protocol results.
 */
export function observeToolProgress(counters: RunCounters, batchId: string,
  items: Array<{ toolCallId: string; toolName: string; input: unknown }>,
  results: Array<{ toolCallId: string; toolName: string; value: unknown }>): boolean {
  const progress = counters.progress ??= { seen: [], repeated: 0, lastBatchId: '' };
  if (progress.lastBatchId === batchId) return progress.repeated >= 3;
  const hashes = results.map((r) => createHash('sha256').update(canonical({ tool: r.toolName,
    input: items.find((i) => i.toolCallId === r.toolCallId)?.input, result: r.value })).digest('hex'));
  const advanced = hashes.some((h) => !progress.seen.includes(h));
  progress.repeated = advanced ? 0 : progress.repeated + 1;
  progress.seen = [...new Set([...progress.seen, ...hashes])].slice(-128);
  progress.lastBatchId = batchId;
  return progress.repeated >= 3;
}
