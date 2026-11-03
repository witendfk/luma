import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';

function fixture(storage = storageMock()) {
  const sandbox = miniappSandbox({ '@/config': { UI_MOCK: true, API_BASE: 'must-not-connect' } }, { uni: storage });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const tokens = sandbox.load('@/utils/token'); tokens.setToken('luma-ui-preview-only');
  const workspace = sandbox.load('@/mocks/workspace');
  const notebook = sandbox.load('@/stores/notebook-preview').useNotebookPreviewStore(); notebook.refresh();
  return { sandbox, workspace, notebook, tokens, storage };
}

test('mock 收藏幂等、归档与移除独立，重新收藏保留笔记及复习状态', async () => {
  const { workspace, notebook } = fixture();
  await workspace.mockRequest({ method: 'PUT', path: '/api/conversations/preview-quadratic', data: { archived: true } });
  await workspace.mockRequest({ method: 'PUT', path: '/api/collections/preview-quadratic', data: {} });
  await workspace.mockRequest({ method: 'PUT', path: '/api/collections/preview-quadratic', data: {} });
  notebook.refresh(); assert.equal(notebook.collected.length, 2);
  notebook.update('preview-quadratic', { note: '我自己的理解', reviewStatus: 'reviewed', collected: false });
  notebook.update('preview-quadratic', { collected: true });
  const row = notebook.records.find((r: any) => r.id === 'preview-quadratic');
  assert.equal(row.note, '我自己的理解'); assert.equal(row.reviewStatus, 'reviewed'); assert.ok(row.archivedAt);
  const detail = await workspace.mockRequest({ method: 'GET', path: '/api/conversations/preview-quadratic' });
  assert.equal(detail.artifacts.length, 2);
  notebook.$dispose();
});

test('搜索及三种视角筛选，笔记跨启动恢复；退出清理当前内存与隔离草稿', () => {
  const first = fixture();
  first.notebook.keyword = '配方法'; assert.equal(first.notebook.visible.length, 1);
  first.notebook.keyword = ''; first.notebook.view = 'practice'; assert.equal(first.notebook.visible.length, 1);
  first.notebook.view = 'question'; first.notebook.status = 'reviewed'; assert.equal(first.notebook.visible[0].id, 'preview-sets');
  first.notebook.update('preview-quadratic', { note: '跨启动保留', reviewStatus: 'reviewed' });
  const second = fixture(first.storage);
  assert.equal(second.notebook.records[0].note, '跨启动保留');
  first.storage.setStorageSync('luma_ui_draft:note:x', '未保存');
  first.storage.setStorageSync('luma_draft:real-account', '正式草稿');
  first.tokens.clearToken();
  assert.equal(first.notebook.records.length, 0);
  assert.equal(first.storage.values.has('luma_ui_draft:note:x'), false);
  assert.equal(first.storage.values.get('luma_draft:real-account'), '正式草稿');
  first.notebook.$dispose(); second.notebook.$dispose();
});

test('UI mock 不发网络请求，未知操作不回退；保存失败不报成功', async () => {
  const f = fixture();
  const request = f.sandbox.load('@/utils/request').request;
  const list = await request({ method: 'GET', path: '/api/conversations?archived=0' });
  assert.equal(list.items.length, 2);
  await assert.rejects(request({ method: 'GET', path: '/unknown' }), /未调用真实服务/);
  f.storage.setStorageSync = () => { throw new Error('storage full'); };
  assert.throws(() => f.notebook.update('preview-quadratic', { note: '不应保存' }), /保存失败/);
  assert.notEqual(f.workspace.previewRecords()[0].note, '不应保存');
  f.notebook.$dispose();
});

test('示例材料仅属于原题，新对话不复制讲义、笔记或已确认状态', async () => {
  const { workspace, notebook } = fixture();
  const created = await workspace.mockRequest({ method: 'POST', path: '/api/conversations', data: { initialText: '集合新问题', subjectType: 'knowledge' } });
  const detail = await workspace.mockRequest({ method: 'GET', path: `/api/conversations/${created.id}` });
  assert.equal(detail.subject.confirmedAt, null); assert.equal(detail.artifacts.length, 0);
  await workspace.mockRequest({ method: 'POST', path: `/api/conversations/${created.id}/subjects`, data: { action: 'confirm', expectedRevision: 1 } });
  const confirmed = await workspace.mockRequest({ method: 'GET', path: `/api/conversations/${created.id}` });
  assert.ok(confirmed.subject.confirmedAt);
  notebook.$dispose();
});

test('微信空缓存不会覆盖已有笔记，刻意清空的草稿可恢复，改回原文清除旧草稿', () => {
  const storage = storageMock();
  const sandbox = miniappSandbox({}, { uni: { ...storage, getStorageSync: (key: string) => storage.values.get(key) ?? '' } });
  const notes = sandbox.load('@/utils/note-draft');
  assert.equal(notes.readNoteDraft('x', '已保存笔记'), '已保存笔记');
  notes.rememberNoteDraft('x', '', '已保存笔记');
  assert.equal(notes.readNoteDraft('x', '已保存笔记'), '');
  notes.rememberNoteDraft('x', '已保存笔记', '已保存笔记');
  assert.equal(notes.readNoteDraft('x', '已保存笔记'), '已保存笔记');
});
