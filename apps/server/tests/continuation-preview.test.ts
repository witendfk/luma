import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';
function fixture() {
  const storage = storageMock();
  const sandbox = miniappSandbox({ '@/config': { UI_MOCK: true } }, { uni: { ...storage, showToast() {} } });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  sandbox.load('@/utils/token').setToken('luma-ui-preview-only');
  return { sandbox, storage, mock: sandbox.load('@/mocks/workspace'), study: sandbox.load('@/stores/study-preview').useStudyPreviewStore(), continuation: sandbox.load('@/utils/continuation').previewContinuation };
}
test('续学只读取位置，恢复章节及作答阶段，不创建轮次、揭示答案或改变草稿', async () => {
  const { mock, study, continuation } = fixture();
  study.restore(); study.selectSection('steps'); mock.rememberPreviewLocation('preview-quadratic', 'reader');
  assert.match(continuation('preview-quadratic').label, /平方/);
  assert.match(continuation('preview-quadratic').url, /reader/);
  const latest = mock.previewRoot('preview-quadratic').lastActiveAt;
  await mock.mockRequest({ method: 'PUT', path: '/api/conversations/preview-sets', data: { title: '集合笔记' } });
  const history = await mock.mockRequest({ method: 'GET', path: '/api/conversations?archived=0' });
  assert.equal(history.items[0].id, 'preview-quadratic');
  assert.equal(mock.previewRoot('preview-quadratic').lastActiveAt, latest);
  study.start(); study.jump(1); study.answer('原来的答案'); const id = study.round.id;
  mock.rememberPreviewLocation('preview-quadratic', 'practice');
  assert.match(continuation('preview-quadratic').label, /第 2 \/ 2 题/);
  assert.equal(study.round.id, id); assert.equal(study.round.phase, 'doing'); assert.equal(study.currentAnswer.text, '原来的答案');
  study.submit(); assert.match(continuation('preview-quadratic').label, /自评/);
  study.rate('e1', 'independent'); study.rate('e2', 'stuck'); study.finish();
  assert.match(continuation('preview-quadratic').label, /反馈/);
  study.$dispose();
});
test('多题续学绑定子题；材料变更、损坏草稿和归档目标均回安全对话入口', async () => {
  const { mock, study, continuation, storage } = fixture();
  const id = mock.createAttachmentPreview([{ id: 'a', path: '/a.png', name: '图片' }], '', 'question');
  mock.recognizeAttachments(id); const second = mock.previewRoot(id).topics[1];
  mock.selectPreviewTopic(id, second.id);
  await mock.mockRequest({ method: 'POST', path: `/api/conversations/${id}/subjects`, data: { action: 'confirm', expectedRevision: 1 } });
  await new Promise<void>((resolve, reject) => mock.mockTurn({ conversationId: id, body: { text: '练习', action: 'generate_practice' }, onEvent() {}, onDone: resolve, onError: reject }));
  study.restore(second.id, 'sets'); study.start(); study.answer('3 和 5'); mock.rememberPreviewLocation(second.id, 'practice');
  assert.match(continuation(id).url, new RegExp(`scope=${second.id}`));
  assert.equal(mock.previewRoot(id).activeTopicId, second.id);
  const key = `luma_ui_draft:study-preview:v1:${second.id}`;
  const saved = storage.values.get(key); storage.values.set(key, '{broken');
  assert.match(continuation(id).url, /chat/); assert.ok(continuation(id).notice);
  storage.values.set(key, saved);
  await mock.mockRequest({ method: 'POST', path: `/api/conversations/${id}/subjects`, data: { action: 'update', expectedRevision: 1, content: { text: '改题' } } });
  assert.match(continuation(id).url, /chat/); assert.ok(continuation(id).notice);
  await mock.mockRequest({ method: 'PUT', path: `/api/conversations/${id}`, data: { archived: true } });
  assert.match(continuation(id).url, /chat/); study.$dispose();
});
test('照片草稿按题与轮次保留，历史只读快照不随重做清空，过程核对按题干版本保存', () => {
  const { mock, study } = fixture(); study.restore(); study.start();
  const images = [{ id: 'photo', name: '我的作答', path: '/local/photo.png' }];
  study.answerImages(images); study.jump(1); assert.equal(study.currentAnswer.images, undefined);
  study.jump(0); assert.equal(study.currentAnswer.images[0].path, images[0]!.path);
  study.submit(); study.rate('e1', 'partial'); study.rate('e2', 'stuck'); study.finish(); study.restart(false);
  assert.equal(study.currentAnswer.images, undefined); assert.equal(study.history[0].answers.e1.images.length, 1);
  mock.savePreviewProcess('preview-quadratic', images, '已核对步骤', true);
  const row = mock.previewRecords().find((item: any) => item.id === 'preview-quadratic');
  assert.equal(row.processes['1'].confirmed, true); assert.equal(row.processes['1'].text, '已核对步骤'); study.$dispose();
});
