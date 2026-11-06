import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLessonPatch } from '../src/jobs/lesson-revision';
import { mergeTeachingNotes, visibleTeachingState } from '../src/agent/teaching-state';
import type { TurnPolicy } from '../src/agent/policy';
import type { Lesson } from '@luma/shared';
import { miniappSandbox, storageMock } from './helpers/miniapp';

export const sampleLesson: Lesson = {
  title: '二次函数与最小值',
  sections: [{ id: 's1', heading: '概念', body: '开口向上' }, { id: 's2', heading: '看图', body: '观察对称轴' }, { id: 's3', heading: '辨析', body: '区分横纵坐标' }],
  diagrams: [{ sectionId: 's2', content: { title: '图形', graphic: { kind: 'quadratic', a: 1, b: -4, c: 7, bounds: { xMin: -2, xMax: 6, yMin: -2, yMax: 20 }, revealValues: false, caption: '看顶点' }, steps: [{ label: '看', detail: '观察曲线' }, { label: '想', detail: '顶点的位置' }] } }],
};
test('局部修订只替换指定段落，模型不能覆盖其他正文/图解或改变段落ID', () => {
  const source = { artifactId: 'a', artifactVersion: 2, sectionId: 's1', lesson: structuredClone(sampleLesson) };
  const result = applyLessonPatch(source, JSON.stringify({ section: { id: 's1', heading: '换个例子', body: '新的概念例子' }, sections: [{ id: 's3', body: '恶意覆盖' }] }));
  assert.equal(result.sections[0]!.body, '新的概念例子');
  assert.deepEqual(result.sections.slice(1), sampleLesson.sections.slice(1));
  assert.deepEqual(result.diagrams, sampleLesson.diagrams); assert.deepEqual(source.lesson, sampleLesson);
  assert.deepEqual(applyLessonPatch(source, JSON.stringify({ section: result.sections[0], diagram: null })), result);
  assert.throws(() => applyLessonPatch(source, JSON.stringify({ section: { id: 's2', heading: '换', body: '错段落' } })), /指定段落/);
  assert.throws(() => applyLessonPatch(source, JSON.stringify({ section: result.sections[0], diagram: sampleLesson.diagrams[0]!.content })), /其他段落/);
});

test('记忆保留证据并按练习题/段落和解析权限投影，新版本空状态不继承', () => {
  const base: TurnPolicy = { subjectId: 's', subjectRevisionId: 'r', stage: 'guiding', subjectConfirmed: true, allowedTools: [], allowSolution: false, answerPermission: false, focus: {} };
  let state = mergeTeachingNotes(null, [{ kind: 'difficulty', text: '对称轴的含义', source: 'model_inference', messageId: 'm', userMessageId: 'u', focus: {}, containsSolution: false },
    { kind: 'method', text: '旧题的答案', source: 'model_inference', messageId: 'answer', focus: { attemptId: 'p', exerciseId: 'e1' }, containsSolution: true }]);
  assert.equal(visibleTeachingState(state, base).notes.length, 1);
  assert.equal(visibleTeachingState(state, { ...base, focus: { attemptId: 'p', exerciseId: 'e2' }, allowSolution: true }).notes.length, 0);
  assert.equal(visibleTeachingState(state, { ...base, focus: { attemptId: 'p', exerciseId: 'e1' }, allowSolution: true }).notes[0]!.messageId, 'answer');
  state = mergeTeachingNotes(state, [{ kind: 'difficulty', text: '已转到另一卡点', source: 'model_inference', messageId: 'new', focus: {}, containsSolution: false }]);
  assert.equal(state.notes.filter((n) => n.kind === 'difficulty').length, 1); assert.equal(state.version, 2);
  assert.deepEqual(visibleTeachingState(null, base).notes, []);
  const cleared = mergeTeachingNotes(state, [], { kinds: ['difficulty'], focus: {} });
  assert.ok(!cleared.notes.some((n) => n.kind === 'difficulty'));
  assert.ok(cleared.notes.some((n) => n.messageId === 'answer'));
});

test('阅读位置保存串行合并滚动，冲突后保留草稿且仅重试一次', async () => {
  let version = 1, active = true, conflicts = 1;
  const calls: any[] = [];
  const sandbox = miniappSandbox({ '@/api/conversations': {
    saveProgress: async (_c: string, _s: string, body: any) => {
      calls.push(body);
      if (conflicts > 0) { conflicts--; throw { failure: { code: 'REVISION_CONFLICT' } }; }
      assert.equal(body.expectedVersion, version); version++;
      return { version, currentSectionId: body.sectionId };
    },
    getConversation: async () => ({ subjects: [{ id: 's', revision: { id: 'r' }, progress: { version, draft: '不能丢失的草稿' } }] }),
  } }, { uni: storageMock() });
  const position = sandbox.load('@/utils/reading-progress').readingProgress({ conversationId: 'c', subjectId: 's', revisionId: 'r', revision: 1, artifactId: 'a', initial: { version: 0 }, isCurrent: () => active });
  position.remember('s1'); const first = position.flush(); position.remember('s3'); await first;
  assert.equal(calls.at(-1).sectionId, 's3'); assert.ok(calls.every((c) => c.draft === undefined));
  const before = calls.length; active = false; position.remember('s2'); await position.flush(); assert.equal(calls.length, before);
});
