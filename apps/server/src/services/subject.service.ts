import { notImplemented } from '../lib/errors';

/**
 * 学习对象版本与过程转写（FR-03 / 设计文档 §3.1）。
 */
export const subjectService = {
  /**
   * POST /conversations/:id/subjects —— 修改或确认题干/知识点：
   * 生成新版本 SubjectRevision、提示旧材料需更新、旧结果标记 superseded。
   */
  async update(
    _userId: string,
    _conversationId: string,
    _input: {
      /** 传 confirmed=true 表示学生对照原图确认（FR-03：确认前不按未核实条件生成解答） */
      action: 'update' | 'confirm';
      content?: unknown;
      tags?: string[];
      subquestionIndex?: number;
      expectedRevision?: number;
    },
  ) {
    throw notImplemented('学习对象更新与确认');
  },

  /** FR-04/AC-07：解题过程转写的逐步确认或修正 */
  async confirmTranscript(
    _userId: string,
    _conversationId: string,
    _transcriptId: string,
    _input: { confirmedSteps?: unknown },
  ) {
    throw notImplemented('解题过程确认');
  },
};
