import { env } from '../lib/env';

/** 每轮执行预算（设计文档 §4.2：默认 4 次模型决策、4 次工具调用，含子任务消耗） */
export interface TurnBudget {
  readonly modelCalls: number;
  readonly toolCalls: number;
  trySpendModelCall(): boolean;
  trySpendToolCall(): boolean;
}

export function createBudget(): TurnBudget {
  const e = env();
  let modelCalls = 0;
  let toolCalls = 0;

  return {
    get modelCalls() {
      return modelCalls;
    },
    get toolCalls() {
      return toolCalls;
    },
    trySpendModelCall() {
      if (modelCalls >= e.TURN_MAX_MODEL_CALLS) return false;
      modelCalls += 1;
      return true;
    },
    trySpendToolCall() {
      if (toolCalls >= e.TURN_MAX_TOOL_CALLS) return false;
      toolCalls += 1;
      return true;
    },
  };
}
