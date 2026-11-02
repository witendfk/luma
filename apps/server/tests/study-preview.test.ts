import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';

function fixture(storage = storageMock()) {
  const sandbox = miniappSandbox({}, { uni: storage });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const study = sandbox.load('@/stores/study-preview').useStudyPreviewStore();
  study.restore();
  return { study, storage, tokens: sandbox.load('@/utils/token') };
}

test('前端演示保留章节、草稿与题号，重进不提交、不创建新轮次', () => {
  const first = fixture();
  first.study.selectSection('steps'); first.study.start(); first.study.answer('平方项为零'); first.study.jump(1);
  const id = first.study.round.id;
  first.study.$dispose();
  const second = fixture(first.storage);
  assert.equal(second.study.sectionId, 'steps');
  assert.equal(second.study.round.id, id);
  assert.equal(second.study.round.index, 1);
  assert.equal(second.study.round.phase, 'doing');
  assert.equal(second.study.round.answers.e1.text, '平方项为零');
  second.study.$dispose();
});

test('自评未完成不能结束，重做只选巩固题并保留历史快照', () => {
  const { study } = fixture();
  study.start(); study.answer('x=3，最小值为4'); study.submit();
  assert.equal(study.finish(), false);
  study.rate('e1', 'independent'); study.rate('e2', 'stuck');
  assert.equal(study.finish(), true);
  const id = study.round.id;
  study.restart(true);
  assert.notEqual(study.round.id, id);
  assert.equal(study.round.ids.join(','), 'e2');
  assert.equal(study.round.answers.e2.text, '');
  study.answer('重新尝试');
  assert.equal(study.history[0].answers.e1.text, 'x=3，最小值为4');
  assert.equal(study.history[0].answers.e2.text, '');
  study.$dispose();
});

test('段落与练习追问隔离，结束焦点、退出账号不残留演示内容', () => {
  const { study, tokens, storage } = fixture();
  study.ask({ kind: 'section', id: 'steps', heading: '配方', question: '没懂' });
  study.send('换个例子');
  assert.match(study.messages[1].text, /x² − 4x/);
  study.discussionDraft('这一步为什么成立？');
  study.ask({ kind: 'exercise', id: 'e1', heading: '练习一', question: '提示', roundId: study.round.id });
  assert.equal(study.messages.length, 0);
  study.send('提示'); assert.match(study.messages[1].text, /平方项/);
  study.endFocus(); study.send('普通消息');
  assert.equal(study.messages.length, 0);
  study.ask({ kind: 'section', id: 'steps', heading: '配方', question: '没懂' });
  assert.equal(study.pendingQuestion, '这一步为什么成立？');
  assert.equal(study.messages.length, 2);
  study.start(); study.answer('不应跨账号恢复');
  tokens.clearToken();
  assert.equal(study.focus, null);
  assert.equal(study.round.phase, 'intro');
  assert.equal(storage.values.has('luma_draft:study-preview:v1'), false);
  study.$dispose();
});
