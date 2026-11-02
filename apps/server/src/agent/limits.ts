import { env } from '../lib/env';

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
  tokens: { input: number; output: number };
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
    tokens: { input: 0, output: 0 },
    lastFailureKey: null,
    sameFailureCount: 0,
  };
}

export function countersFrom(json: unknown): RunCounters {
  if (!json || typeof json !== 'object') return initialCounters();
  const base = initialCounters();
  const src = json as Partial<RunCounters>;
  return {
    ...base,
    ...src,
    modelRequests: { ...base.modelRequests, ...(src.modelRequests ?? {}) },
    tokens: { ...base.tokens, ...(src.tokens ?? {}) },
  };
}

export function recordModelRequest(counters: RunCounters, purpose: string): void {
  counters.modelRequests[purpose] = (counters.modelRequests[purpose] ?? 0) + 1;
}

export function recordUsage(counters: RunCounters, usage?: { inputTokens?: number; outputTokens?: number }): void {
  counters.tokens.input += usage?.inputTokens ?? 0;
  counters.tokens.output += usage?.outputTokens ?? 0;
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
