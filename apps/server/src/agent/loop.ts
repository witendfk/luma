import { randomUUID } from 'node:crypto';
import type { StreamEvent } from '@luma/shared';
import { hasModelCredentials } from '../lib/env';
import { toApiError, notImplemented } from '../lib/errors';
import { assembleContext } from './context';
import { createBudget } from './limits';
import type { TurnContext } from './types';

/**
 * 教学 Agent 每轮执行循环（设计文档 §4.2）。
 * 以 AsyncGenerator 产出流式事件；保证终止事件（completed/failed/cancelled）。
 *
 * 骨架顺序与文档一一对应，开发时逐步替换 TODO：
 *  1. 校验账号、会话、请求标识及当前学习对象版本（路由层已完成归属校验）
 *  2. 保存用户消息，或按 requestId 幂等复用
 *  3. 根据阶段、明确操作和文字确定意图（明确操作优先）
 *  4. 装配上下文，选择本轮允许的工具及答案展示权限
 *  5. 调用 GPT 流式输出，或处理工具调用
 *  6. 校验工具参数、执行工具，结果交回模型
 *  7. 长生成工具 → 返回任务引用并结束本轮
 *  8. 完成/等待学生/取消/达到限制时停止，保存消息与运行结果
 */
export async function* runTurn(ctx: TurnContext): AsyncGenerator<StreamEvent> {
  yield { type: 'run.started', runId: ctx.runId };

  try {
    const context = await assembleContext(ctx);
    createBudget(); // 每轮预算；模型调用接入后逐步扣减

    if (!hasModelCredentials()) {
      yield {
        type: 'text.delta',
        runId: ctx.runId,
        delta:
          '（框架联调提示）服务端尚未配置 GPT 凭据（OPENAI_API_KEY），当前为骨架回显。' +
          '配置凭据后，这里将按教学阶段输出识别核对、方向提示或完整解析。',
      };
      yield { type: 'run.completed', runId: ctx.runId, stage: context.stage };
      return;
    }

    // TODO(第一周)：Vercel AI SDK 流式调用 + 工具循环（教学工具见 ./tools.ts）
    throw notImplemented('Agent 模型调用（AI SDK 接入）');
  } catch (err) {
    const apiErr = toApiError(err);
    yield {
      type: 'run.failed',
      runId: ctx.runId,
      error: { code: apiErr.code, message: apiErr.message, retryable: apiErr.retryable },
    };
  }
}

export function newRunId(): string {
  return `run_${randomUUID()}`;
}
