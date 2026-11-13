import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';

test('实际练习store保留失败照片、逐题恢复、同步photoIds，提交后保留只读且选图不调用模型', async () => {
  const storage = storageMock();
  let networkFailure = true, selections = 0;
  const saved = { id: 'round', artifactId: 'set', conversationId: 'conversation', subjectId: 'subject', subjectRevisionId: 'revision',
    stage: 'doing', currentExerciseId: 'q1', submittedAt: null, completedAt: null, answersHidden: true,
    exercises: ['q1', 'q2'].map((id, order) => ({ id, order, stem: '题目', topic: '数学', difficulty: 'basic', purpose: '练习', myAnswer: null as any })) };
  const clone = () => JSON.parse(JSON.stringify(saved));
  const writes: any[] = [];
  const sandbox = miniappSandbox({
    '@/utils/request': { request: async () => ({ id: 'set', type: 'exercise_set', publishStatus: 'published', version: 1,
      conversationId: 'conversation', subjectId: 'subject', subjectRevisionId: 'revision', subjectVersion: 1, attemptId: 'round', exercises: saved.exercises }) },
    '@/api/conversations': { getConversation: async () => ({ subjects: [] }) },
    '@/api/practice': {
      getAttempt: async () => clone(),
      listAttempts: async () => [{ id: saved.id, stage: saved.stage, exerciseCount: 2 }],
      savePosition: async (_round: string, id: string) => { saved.currentExerciseId = id; },
      saveAnswer: async (round: string, id: string, input: any) => {
        assert.equal(round, 'round'); writes.push({ id, ...input });
        const ex = saved.exercises.find((ex) => ex.id === id)!;
        ex.myAnswer = { ...ex.myAnswer, ...JSON.parse(JSON.stringify(input)) };
        return { draftVersion: input.draftVersion };
      },
      submitAttempt: async () => { saved.stage = 'review'; return clone(); },
    },
    '@/utils/attachments': { chooseAttachments: async () => { selections++; return [{ id: 'local', path: '/tmp/answer.png', name: '作答照片' }]; } },
    '@/api/uploads': { uploadAttachments: async (_images: unknown, purpose: string, scope: unknown) => {
      assert.equal(purpose, 'answer_photo');
      assert.equal(JSON.stringify(scope), JSON.stringify({ conversationId: 'conversation', subjectRevisionId: 'revision', attemptId: 'round', exerciseId: 'q1' }));
      if (networkFailure) throw new Error('上传中断');
      return ['photo-1'];
    } },
  }, { uni: storage });
  const { createPinia, setActivePinia } = sandbox.require('pinia');
  const { effectScope } = sandbox.require('vue');
  setActivePinia(createPinia());
  const scope = effectScope();
  const store = scope.run(() => sandbox.load('@/stores/practice').usePracticeStore());
  try {
    await store.open('set');
    await assert.rejects(store.addPhotos(), /上传中断/);
    assert.equal(store.busy, false); assert.equal(store.pendingPhotos.length, 1); assert.equal(store.answered, 0);
    await assert.rejects(store.submit(), /待上传照片/);
    await store.jump(1); assert.equal(store.pendingPhotos.length, 0);
    await store.jump(0); assert.equal(store.pendingPhotos.length, 1);
    await store.open('set', 'round'); assert.equal(store.pendingPhotos.length, 1);
    networkFailure = false; await store.addPhotos(true);
    assert.equal(store.pendingPhotos.length, 0); assert.equal(store.answered, 1);
    assert.equal(JSON.stringify(store.current.myAnswer.photoIds), '["photo-1"]');
    store.edit({ textDraft: '我先数间隔' }); await store.flush();
    await store.applyTranscript('a5=4+5*3=19', 'append', 'q1');
    assert.equal(store.current.myAnswer.textDraft, '我先数间隔\na5=4+5*3=19', '保留原错误且不覆盖原输入');
    await store.applyTranscript('a5=4+5*3=19', 'append', 'q1');
    assert.equal(store.current.myAnswer.textDraft, '我先数间隔\na5=4+5*3=19', '重复应用不重复追加');
    await assert.rejects(store.applyTranscript('其他题', 'replace', 'q2'), /当前题目/);
    await store.applyTranscript('自己核对后的步骤', 'replace', 'q1');
    assert.equal(store.current.myAnswer.textDraft, '自己核对后的步骤');
    assert.equal(JSON.stringify(store.current.myAnswer.photoIds), '["photo-1"]', '填文字保留原图');
    assert.equal(writes[0].id, 'q1'); assert.equal(JSON.stringify(writes[0].photoIds), '["photo-1"]');
    await store.jump(1); assert.equal(store.current.myAnswer, null);
    await store.jump(0); await store.resume();
    assert.equal(JSON.stringify(store.current.myAnswer.photoIds), '["photo-1"]');
    await store.submit(); assert.equal(store.stage, 'review');
    await assert.rejects(store.applyTranscript('迟到内容', 'replace', 'q1'), /状态/);
    await store.addPhotos(); assert.equal(selections, 1);
    assert.equal(JSON.stringify(store.attempt.exercises[0].myAnswer.photoIds), '["photo-1"]');
  } finally { scope.stop(); }
});
