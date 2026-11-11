import { env } from '../lib/env';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../lib/errors';
import { ErrorCode } from '@luma/shared';

export interface ModelReservation {
  purpose: string;
  input: number;
  output: number;
  status: 'pending' | 'unknown' | 'settled';
}
export class ModelBudgetError extends ApiError {
  constructor() { super(ErrorCode.RATE_LIMITED, '本轮模型请求或累计用量已达保护上限，请缩小本次任务范围', 429, false); }
}

/**
 * 分项资源计数（设计文档 §4.7）：决策步骤、工具往返、工具执行、各类模型请求、
 * 用量与无进展检测分别记录，不混用一个"四次"上限。
 * 保护上限可配置且必须存在；正式默认值待真实链路测量后调整。
 */

export interface RunCounters {
  /** 主 Agent 决策步骤 */
  decisions: number;
  /** 工具往返批次 */
  toolRounds: number;
  /** 工具执行次数（含批次内多项） */
  toolExecutions: number;
  /** 各类模型请求：agent | recognize | lesson_body | lesson_review | practice | practice_review | image */
  modelRequests: Record<string, number>;
  /** 协议校正次数 */
  corrections: number;
  unknownUsageCalls: number;
  background?: { requests: number; input: number; output: number; unknown: number; cachedInput?: number; reservedInput?: number; reservedOutput?: number };
  modelReservations: Record<string, ModelReservation>;
  calls: Array<{ purpose: string; model: string; attempt: number; durationMs: number; inputTokens: number | null; outputTokens: number | null; cachedInputTokens?: number | null; error?: string }>;

  tokens: { input: number; output: number; cachedInput?: number };
  /** 无进展检测：相同工具+相同参数的失败连续出现即停止 */
  lastFailureKey: string | null;
  sameFailureCount: number;
}

export function initialCounters(): RunCounters {
  return {
    decisions: 0,
    toolRounds: 0,
    toolExecutions: 0,
    modelRequests: {},
    corrections: 0,
    calls: [],
    modelReservations: {},
    unknownUsageCalls: 0,
    tokens: { input: 0, output: 0 },
    lastFailureKey: null,
    sameFailureCount: 0,
  };
}

export function countersFrom(json: unknown): RunCounters {
  if (!json || typeof json !== 'object') return initialCounters();
  const base = initialCounters();
  const src = json as Partial<RunCounters>;
  const restored = {
    ...base,
    ...src,
    modelRequests: { ...base.modelRequests, ...(src.modelRequests ?? {}) },
    tokens: { ...base.tokens, ...(src.tokens ?? {}) },
    modelReservations: { ...(src.modelReservations ?? {}) },
  };
  // Old checkpoints did not reserve tokens. Missing/unknown requests must not become free on recovery.
  if (!src.modelReservations) {
    const missing = Math.max(0, Object.values(restored.modelRequests).reduce((sum, n) => sum + n, 0) - restored.calls.length);
    const unknown = Math.max(restored.unknownUsageCalls, missing);
    if (unknown) restored.modelReservations.legacy = { purpose: 'legacy_unknown', status: 'unknown',
      input: unknown * Math.max(env().CONTEXT_INPUT_TOKENS, env().LONG_TASK_CONTEXT_INPUT_TOKENS), output: unknown * env().MODEL_OUTPUT_TOKENS };
  }
  return restored;
}

export function recordModelRequest(counters: RunCounters, purpose: string): void {
  counters.modelRequests[purpose] = (counters.modelRequests[purpose] ?? 0) + 1;
}

export function recordUsage(counters: RunCounters, usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }): void {
  if (usage?.inputTokens === undefined || usage?.outputTokens === undefined) counters.unknownUsageCalls += 1;
  counters.tokens.input += usage?.inputTokens ?? 0;
  counters.tokens.output += usage?.outputTokens ?? 0;
  // Cached input is a subset of input, never subtracted from window or safety budgets.
  counters.tokens.cachedInput = (counters.tokens.cachedInput ?? 0) + (usage?.cachedInputTokens ?? 0);
}

export function spendDecision(counters: RunCounters): boolean {
  if (counters.decisions >= env().MAX_DECISIONS) return false;
  counters.decisions += 1;
  return true;
}

export function spendToolRound(counters: RunCounters): boolean {
  if (counters.toolRounds >= env().MAX_TOOL_ROUNDS) return false;
  counters.toolRounds += 1;
  return true;
}

export function spendToolExecution(counters: RunCounters): boolean {
  if (counters.toolExecutions >= env().MAX_TOOL_EXECUTIONS) return false;
  counters.toolExecutions += 1;
  return true;
}

export function correctionAllowed(counters: RunCounters): boolean {
  return counters.corrections < env().MODEL_MAX_CORRECTIONS;
}

export function recordCorrection(counters: RunCounters): void {
  counters.corrections += 1;
}

/** 相同失败重复检测：连续两次相同 (工具, 参数, 错误) 即停止自动尝试（§4.7 / §6.1） */
export function recordFailure(counters: RunCounters, failureKey: string): boolean {
  if (counters.lastFailureKey === failureKey) {
    counters.sameFailureCount += 1;
  } else {
    counters.lastFailureKey = failureKey;
    counters.sameFailureCount = 1;
  }
  return counters.sameFailureCount >= 2;
}

export function clearFailure(counters: RunCounters): void {
  counters.lastFailureKey = null;
  counters.sameFailureCount = 0;
}

export function modelBudgetAvailable(counters: RunCounters): boolean {
  const totals = modelBudgetTotals(counters);
  return totals.requests < env().MAX_MODEL_REQUESTS && totals.tokens < env().MAX_RUN_TOKENS;
}

export function reservedTokens(counters: RunCounters) {
  return Object.values(counters.modelReservations).reduce((sum, r) => ({ input: sum.input + r.input, output: sum.output + r.output }), { input: 0, output: 0 });
}

export function modelBudgetTotals(counters: RunCounters) {
  const reserved = reservedTokens(counters), b = counters.background;
  return { requests: Object.values(counters.modelRequests).reduce((sum, n) => sum + n, 0) + (b?.requests ?? 0),
    tokens: counters.tokens.input + counters.tokens.output + reserved.input + reserved.output +
      (b?.input ?? 0) + (b?.output ?? 0) + (b?.reservedInput ?? 0) + (b?.reservedOutput ?? 0) };
}

/** Reserve the full next request BEFORE network I/O; persist this ledger before calling the provider. */
export function reserveModelRequest(counters: RunCounters, purpose: string, input: number, output: number,
  limits = { requests: env().MAX_MODEL_REQUESTS, tokens: env().MAX_RUN_TOKENS }): string {
  if (![input, output].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('模型预留额度无效');
  const totals = modelBudgetTotals(counters);
  if (totals.requests + 1 > limits.requests || totals.tokens + input + output > limits.tokens) throw new ModelBudgetError();
  const callId = randomUUID();
  counters.modelReservations[callId] = { purpose, input, output, status: 'pending' };
  recordModelRequest(counters, purpose);
  return callId;
}

/** Settle only once. Unknown components keep their reservation, including across process recovery. */
export function settleModelRequest(counters: RunCounters, callId: string,
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }): boolean {
  const reservation = counters.modelReservations[callId];
  if (!reservation || reservation.status !== 'pending') return false;
  const valid = (n: number | undefined) => n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
  const normalized = { inputTokens: valid(usage?.inputTokens), outputTokens: valid(usage?.outputTokens), cachedInputTokens: valid(usage?.cachedInputTokens) };
  recordUsage(counters, normalized);
  if (normalized.inputTokens !== undefined) reservation.input = 0;
  if (normalized.outputTokens !== undefined) reservation.output = 0;
  reservation.status = normalized.inputTokens === undefined || normalized.outputTokens === undefined ? 'unknown' : 'settled';
  return true;
}
