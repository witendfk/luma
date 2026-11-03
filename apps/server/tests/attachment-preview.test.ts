import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';

function fixture() {
  const storage = storageMock();
  const sandbox = miniappSandbox({ '@/config': { UI_MOCK: true } }, { uni: { ...storage, showToast() {} } });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  sandbox.load('@/utils/token').setToken('luma-ui-preview-only');
  const mock = sandbox.load('@/mocks/workspace');
  const id = mock.createAttachmentPreview([{ id: 'image', path: '/static/preview/question-sheet.svg', name: '示例' }], '这些都想学', 'question');
  return { sandbox, storage, mock, id };
}
const confirm = (mock: any, id: string) => mock.mockRequest({ method: 'POST', path: `/api/conversations/${id}/subjects`, data: { action: 'confirm', expectedRevision: 1 } });
function turn(mock: any, id: string, action?: string): Promise<void> {
  return new Promise((resolve, reject) => mock.mockTurn({ conversationId: id, body: { text: '继续', action }, onEvent() {}, onDone: resolve, onError: reject }));
}

test('一次附件只建一个会话，多题分别核对，切换不自动生成材料或丢草稿', async () => {
  const { mock, id } = fixture();
  assert.equal((await mock.mockRequest({ method: 'GET', path: `/api/conversations/${id}` })).subject, null);
  mock.recognizeAttachments(id);
  const first = mock.previewRoot(id).topics[0];
  const second = mock.previewRoot(id).topics[1];
  mock.saveTopicDraft(first.id, '先把式子配方');
  await confirm(mock, id);
  mock.selectPreviewTopic(id, second.id);
  const detail = await mock.mockRequest({ method: 'GET', path: `/api/conversations/${id}` });
  assert.equal(detail.subject.confirmedAt, null); assert.equal(detail.artifacts.length, 0);
  assert.equal(detail.subject.content.text.includes('A ='), true);
  mock.selectPreviewTopic(id, first.id);
  assert.ok((await mock.mockRequest({ method: 'GET', path: `/api/conversations/${id}` })).subject.confirmedAt);
  assert.equal(mock.previewRoot(id).topics[0].draft, '先把式子配方');
  const list = await mock.mockRequest({ method: 'GET', path: '/api/conversations?archived=0' });
  assert.equal(list.items.filter((row: any) => row.id.startsWith(id)).length, 1);
});

test('当前题生成和收藏独立，归档父对话不改变子题收藏，重试不抹掉进度', async () => {
  const { mock, id } = fixture(); mock.recognizeAttachments(id);
  const [first, second] = mock.previewRoot(id).topics;
  await confirm(mock, id); await turn(mock, id, 'generate_lesson');
  await mock.mockRequest({ method: 'PUT', path: `/api/collections/${first.id}`, data: { note: '第一题笔记' } });
  mock.selectPreviewTopic(id, second.id); await confirm(mock, id); await turn(mock, id, 'generate_practice');
  await mock.mockRequest({ method: 'PUT', path: `/api/conversations/${id}`, data: { archived: true } });
  mock.setRecognition(id, 'failed'); mock.setRecognition(id, 'reading'); mock.recognizeAttachments(id);
  const root = mock.previewRoot(id);
  assert.ok(root.archivedAt); assert.equal(root.topics[0].collected, true); assert.equal(root.topics[0].note, '第一题笔记');
  assert.equal(root.topics[0].lesson, true); assert.equal(root.topics[0].practice, false);
  assert.equal(root.topics[1].lesson, false); assert.equal(root.topics[1].practice, true);
  assert.equal(mock.previewRoot(first.id).id, id);
});

test('跨题图文和练习按题目恢复，题目变化后不能借用原样例材料', async () => {
  const { sandbox, mock, id } = fixture(); mock.recognizeAttachments(id);
  const [first, second] = mock.previewRoot(id).topics;
  const study = sandbox.load('@/stores/study-preview').useStudyPreviewStore();
  study.restore(first.id, 'quadratic'); study.start(); study.answer('平方项为零'); study.selectSection('steps');
  const roundId = study.round.id;
  study.restore(second.id, 'sets'); assert.match(study.currentExercise.stem, /A =/); assert.equal(study.currentAnswer.text, '');
  study.start(); study.answer('交集包含共同的元素');
  study.restore(first.id, 'quadratic');
  assert.equal(study.round.id, roundId); assert.equal(study.currentAnswer.text, '平方项为零'); assert.equal(study.sectionId, 'steps');
  await mock.mockRequest({ method: 'POST', path: `/api/conversations/${id}/subjects`, data: { action: 'update', expectedRevision: 1, content: { text: '新的题目内容' } } });
  await mock.mockRequest({ method: 'POST', path: `/api/conversations/${id}/subjects`, data: { action: 'confirm', expectedRevision: 2 } });
  await turn(mock, id, 'generate_lesson');
  assert.equal(mock.previewRoot(id).topics[0].lesson, false);
  study.$dispose();
});

test('取消识别不生成题目，换题取消中的迟到回复不会串入另一题', async () => {
  const { mock, id } = fixture();
  mock.setRecognition(id, 'cancelled'); mock.recognizeAttachments(id); assert.equal(mock.previewRoot(id).topics.length, 0);
  mock.setRecognition(id, 'reading'); mock.recognizeAttachments(id);
  const second = mock.previewRoot(id).topics[1];
  const handle = mock.mockTurn({ conversationId: id, body: { text: '没懂' }, onEvent() { throw new Error('不应消费已取消回复'); }, onDone() {}, onError() { throw new Error('不应恢复'); } });
  handle.abort(); mock.selectPreviewTopic(id, second.id);
  assert.equal(mock.previewRoot(id).topics[0].messages.length, 0); assert.equal(mock.previewRoot(id).topics[1].messages.length, 0);
});
