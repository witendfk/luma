import { notImplemented } from '../lib/errors';

/** Agent 运行控制（设计文档 §10）：取消本轮及其关联未完成任务 */
export const runService = {
  async cancel(_userId: string, _runId: string) {
    throw notImplemented('取消本轮生成');
  },
};
