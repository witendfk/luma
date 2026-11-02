import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationTitle, restoreLegacyTitle } from '../src/lib/conversation-title';

test('短题标题保留原文，长标题省略并保持 emoji 完整', () => {
  const question = '已知 f(x)=x²-2x+3，求 f(x) 的最小值。';
  assert.equal(createConversationTitle(question), question);
  assert.equal(createConversationTitle('📚'.repeat(61)), '📚'.repeat(59) + '…');
  assert.equal(createConversationTitle('  '), '新对话');
});

test('旧截断标题从原题恢复，其他标题及缺失原文保持原样', () => {
  const text = '已知 f(x)=x²-2x+3，求 f(x) 的最小值。';
  assert.equal(restoreLegacyTitle(text.slice(0, 24), { text }), text);
  assert.equal(restoreLegacyTitle('二次函数最值', { text }), '二次函数最值');
  assert.equal(restoreLegacyTitle('手动标题', null), '手动标题');
  assert.equal(restoreLegacyTitle('手动标题', { text: 123 }), '手动标题');
});
