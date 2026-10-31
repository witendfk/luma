import { notImplemented } from '../lib/errors';

/**
 * 成果材料读取（FR-05 / FR-06 / 设计文档 §10）。
 * 按权限与当前阶段返回：作答阶段不下发参考答案（§8.2 题目侧/答案侧分离投影）。
 */
export const artifactService = {
  async get(_userId: string, _artifactId: string) {
    throw notImplemented('材料读取');
  },
};
