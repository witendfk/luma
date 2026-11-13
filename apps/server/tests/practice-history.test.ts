import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';

test('练习实际store：历史只读、切换失败保留当前、草稿照片恢复、重做响应丢失幂等重试', async () => {
  const storage = storageMock();
  const answer = { textDraft: '旧轮原作答', photoIds: ['old-photo'], markedUnknown: false, hintsUsed: 1, solutionViewedAt: null, selfEval: 'stuck', draftVersion: 1 };
  const old: any = { id: 'old', artifactId: 'set', conversationId: 'c', subjectId: 's', subjectRevisionId: 'r', stage: 'summary', currentExerciseId: 'q',
    answersHidden: false, exercises: [{ id: 'q', order: 1, stem: '原题', myAnswer: answer, answer: '解析答案' }] };
  const current: any = { ...old, id: 'current', stage: 'doing', answersHidden: true, exercises: [{ id: 'q', order: 1, stem: '原题', myAnswer: null }] };
  const rounds = [current, old];
  const clone = (v: any) => JSON.parse(JSON.stringify(v));
  let readFailure = false, loseRedoResponse = true, created = 0;
  const positions: string[] = [], requestIds: string[] = [];
  const sandbox = miniappSandbox({
    '@/utils/request': { request: async () => ({ id: 'set', type: 'exercise_set', publishStatus: 'published', version: 1, conversationId: 'c', subjectId: 's', subjectRevisionId: 'r', subjectVersion: 1, exercises: old.exercises }) },
    '@/api/conversations': { getConversation: async () => ({ subjects: [] }) },
    '@/api/practice': {
      listAttempts: async () => rounds.map((r) => ({ id: r.id, stage: r.stage, exerciseCount: 1 })),
      getAttempt: async (id: string) => { if (readFailure) throw new Error('读取失败'); return clone(rounds.find((r) => r.id === id)); },
      savePosition: async (id: string) => { positions.push(id); },
      saveAnswer: async (id: string, _exercise: string, input: any) => { assert.equal(id, 'current'); current.exercises[0].myAnswer = { ...answer, ...input }; return { draftVersion: input.draftVersion }; },
      redoAttempt: async (_id: string, _mode: string, requestId: string) => {
        requestIds.push(requestId);
        if (!created) { created++; rounds.unshift({ ...current, id: 'redo', exercises: [{ ...current.exercises[0], myAnswer: null }] }); }
        if (loseRedoResponse) throw new Error('响应丢失');
        return clone(rounds[0]);
      },
    },
    '@/utils/attachments': { chooseAttachments: async () => [{ id: 'pending', path: '/tmp/local.png' }] },
    '@/api/uploads': { uploadAttachments: async () => { throw new Error('照片待重试'); } },
  }, { uni: storage });
  const { createPinia, setActivePinia } = sandbox.require('pinia');
  const { effectScope } = sandbox.require('vue');
  setActivePinia(createPinia()); const scope = effectScope();
  const store = scope.run(() => sandbox.load('@/stores/practice').usePracticeStore());
  try {
    await store.open('set'); assert.equal(store.attempt.id, 'current');
    store.edit({ textDraft: '当前草稿' }); await store.flush();
    await assert.rejects(store.addPhotos(), /照片待重试/);
    readFailure = true;
    await assert.rejects(store.switchAttempt('old'), /读取失败/);
    assert.equal(store.attempt.id, 'current'); assert.equal(store.current.myAnswer.textDraft, '当前草稿');
    assert.equal(store.pendingPhotos.length, 1); assert.equal(store.busy, false);
    readFailure = false; await store.switchAttempt('old');
    assert.equal(store.isHistorical, true); assert.equal(store.current.myAnswer.textDraft, '旧轮原作答');
    store.edit({ textDraft: '不应覆盖' }); store.rate('q', 'independent'); await store.remember();
    await store.redo('all'); await store.submit();
    assert.equal(store.current.myAnswer.textDraft, '旧轮原作答'); assert.equal(store.current.myAnswer.selfEval, 'stuck');
    assert.equal(positions.length, 0, '读历史不回写位置');
    await store.switchAttempt('current'); assert.equal(store.isHistorical, false);
    assert.equal(store.current.myAnswer.textDraft, '当前草稿'); assert.equal(store.pendingPhotos.length, 1);
    // A completed latest round may start a new one. A lost response keeps the id on disk.
    current.stage = 'summary'; await store.resume();
    await assert.rejects(store.redo('all'), /响应丢失/);
    assert.equal(store.attempt.id, 'current'); assert.equal(store.busy, false);
    loseRedoResponse = false; await store.redo('all');
    assert.equal(requestIds[0], requestIds[1]); assert.equal(created, 1);
    assert.equal(store.attempt.id, 'redo'); assert.equal(store.current.myAnswer, null);
    assert.equal(store.pendingPhotos.length, 0); assert.equal(store.history.length, 3);
    assert.equal(old.exercises[0].myAnswer.textDraft, '旧轮原作答');
  } finally { scope.stop(); }
});
