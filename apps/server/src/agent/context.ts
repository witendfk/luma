import type { TurnRequest } from '@luma/shared';
import type { TurnContext } from './types';

export interface AssembledContext {
  /** 当前教学阶段（§3.2），供事件与运行记录使用 */
  stage: string;
  /** 装配结果：指令 / 题干 / 当前材料 / 近期消息（§7.1 顺序） */
  blocks: string[];
}

/**
 * 上下文装配（设计文档 §7.1）。骨架阶段返回占位。
 *
 * TODO(第一周) 按序装配：
 *  1. 公共指令、本轮任务规则、允许的工具与答案展示权限
 *  2. 当前版本题干或知识范围、确认状态、当前小问 —— 必须完整保留，不静默截断
 *  3. 当前讲义段落、练习题、作答及追问对象（按明确操作加载）
 *  4. 近期消息：从近到远按预算加载，最多 12 条，工具调用与结果成对保留
 *  5. 其他材料仅在明确引用或工具请求时读取
 * 预算超限时提示缩小材料/新建对话，不静默丢弃题干。
 */
export async function assembleContext(_ctx: TurnContext, _input?: TurnRequest): Promise<AssembledContext> {
  return { stage: 'clarifying', blocks: [] };
}
