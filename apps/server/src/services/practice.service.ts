import { notImplemented } from '../lib/errors';

/**
 * 练习闭环（FR-06/07/08 / 设计文档 §3.3）。
 */
export const practiceService = {
  /** 开始或重做：重做创建新轮次（全部题或需巩固题），沿用原题 */
  async start(_userId: string, _input: { artifactId: string; exerciseIds?: string[] }) {
    throw notImplemented('开始练习');
  },

  /** 读取题目（题干侧投影，不含答案）、进度与本人作答 */
  async get(_userId: string, _attemptId: string) {
    throw notImplemented('练习详情');
  },

  /**
   * 草稿/照片/暂不会/提示/自评保存：按 (attemptId, exerciseId) 定位，
   * 请求携带递增 draftVersion，拒绝旧草稿覆盖新草稿（设计文档 §10）。
   */
  async saveAnswer(
    _userId: string,
    _attemptId: string,
    _exerciseId: string,
    _input: {
      textDraft?: string;
      photoIds?: string[];
      markedUnknown?: boolean;
      hintsUsed?: number;
      solutionViewedAt?: string;
      selfEval?: 'independent' | 'partial' | 'stuck';
      draftVersion: number;
    },
  ) {
    throw notImplemented('作答保存');
  },

  /** 提交：未作答题提醒后允许按未完成提交，进入 review 返回参考解析 */
  async submit(_userId: string, _attemptId: string) {
    throw notImplemented('提交作答');
  },

  /** 自评齐全校验并完成本轮，形成反馈与记录（FR-08） */
  async complete(_userId: string, _attemptId: string) {
    throw notImplemented('完成自评');
  },
};
