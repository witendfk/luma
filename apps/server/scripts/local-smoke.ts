import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { miniappSandbox, storageMock } from '../tests/helpers/miniapp';

// 使用实际小程序 API、Pinia store 与 SSE 解码器连接本地服务；模拟的仅为 wx/uni 网络宿主。
// 前置：开发模式服务端、PostgreSQL、worker 均已启动，服务端允许 dev: 身份。
const base = process.env.LUMA_TEST_BASE ?? 'http://localhost:4000';
const identity = `dev:smoke-${randomUUID().slice(0, 8)}`;
const storage = storageMock();
const uni = {
  ...storage,
  request(options: any) {
    const controller = new AbortController();
    void fetch(options.url, { method: options.method, headers: options.header,
      body: options.data === undefined || options.method === 'GET' ? undefined : JSON.stringify(options.data), signal: controller.signal,
    }).then(async (response) => options.success({ statusCode: response.status, data: await response.json() }))
      .catch((err) => options.fail({ errMsg: err.message }));
    return { abort: () => controller.abort() };
  },
};
const wx = {
  request(options: any) {
    let chunk: (value: any) => void = () => {}, headers: (value: any) => void = () => {};
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(options.url, { method: options.method, headers: options.header, body: JSON.stringify(options.data), signal: controller.signal });
        headers({ statusCode: response.status });
        for await (const data of response.body as any) {
          chunk({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
        }
        options.success({ statusCode: response.status });
      } catch (err) { options.fail({ errMsg: (err as Error).message }); }
    })();
    return { onChunkReceived(cb: any) { chunk = cb; }, onHeadersReceived(cb: any) { headers = cb; }, abort() { controller.abort(); } };
  },
};
const sandbox = miniappSandbox({ '@/config': { API_BASE: base } }, { uni, wx });
const pinia = sandbox.require('pinia');
pinia.setActivePinia(pinia.createPinia());
const auth = sandbox.load('@/stores/auth').useAuthStore();
const chat = sandbox.load('@/stores/conversation').useConversationStore();
async function until(check: () => boolean, label: string, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (chat.error) throw new Error(`${label}: ${chat.error}`);
    assert.ok(Date.now() < deadline, `${label}超时`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`PASS ${label}`);
}
async function main() {
  await auth.loginWithCode(identity);
  assert.equal(auth.loggedIn, true);
  console.log('PASS 小程序登录 store → 本地登录接口 → 真库会话');
  await chat.send('已知 f(x)=x²-2x+3，求最小值。');
  await until(() => !chat.generating && Boolean(chat.subject) && chat.messages.length === 2, '首题发送、SSE 完整回复、核对对象落库');
  assert.equal(chat.subject.confirmedAt, null);
  const originalVersion = chat.subject.version;
  await chat.editSubject({ content: { ...chat.subject.content, text: '已知 f(x)=x²-2x+5。（1）求最小值；（2）说明对称轴。' },
    tags: ['二次函数', '最值'], subquestions: ['求最小值', '说明对称轴'], subquestionIndex: 1, expectedRevision: originalVersion });
  assert.equal(chat.subject.version, originalVersion + 1);
  assert.equal(chat.subject.activeSubquestionIndex, 1);
  assert.equal(chat.subject.confirmedAt, null);
  const stale = chat.editSubject({ content: { text: '旧页面误改' }, tags: [], subquestions: [], expectedRevision: originalVersion });
  await assert.rejects(stale, /已更新/);
  console.log('PASS 题干编辑及标签/小问接口落库，旧版本更新被拒绝（标签非学生填写）');
  await chat.confirm();
  await until(() => !chat.generating && chat.messages.length === 4, '核对确认 → 引导回复');
  assert.ok(chat.subject.confirmedAt);
  await chat.send('为什么先考虑配方？');
  await until(() => !chat.generating && chat.messages.length === 6, '第二轮追问');
  const id = chat.currentId;
  await chat.open(id);
  assert.equal(chat.messages.length, 6);
  assert.equal(chat.subject.activeSubquestionIndex, 1);
  assert.deepEqual(Array.from(chat.subject.tags), ['二次函数', '最值']);
  console.log('PASS 重新进入会话恢复标题、题目、完整历史');
  await chat.send('生成两道同类练习', 'generate_practice');
  await until(() => !chat.generating, '长工具释放前台 SSE');
  await until(() => !chat.waitingJob && chat.artifacts.some((a: any) => a.type === 'exercise_set'), 'worker 发布 → 恢复 Agent → 小程序轮询同步结果');
  const token = sandbox.load('@/utils/token').getToken();
  const response = await fetch(`${base}/api/conversations/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  await chat.open(id);
  await chat.editSubject({ content: { ...chat.subject.content, text: '改为 f(x)=x²-2x+6，求最小值。' }, tags: ['二次函数'], subquestions: [], expectedRevision: chat.subject.version });
  assert.equal(chat.subject.confirmedAt, null);
  assert.equal(chat.subject.activeSubquestionIndex, null);
  assert.ok(chat.artifacts.every((a: any) => a.subjectRevisionId !== chat.subject.id));
  await chat.send('先给提示');
  await until(() => !chat.generating, '修改后重新进入待核对，不沿用旧确认');
  assert.equal(chat.subject.confirmedAt, null);
  await chat.open(id);
  assert.match(chat.subject.content.text, /x²-2x\+6/);
  console.log('PASS 已确认题目修改后重置确认、旧材料保留原版本，离开重进恢复修改');
  const transport = sandbox.load('@/utils/request');
  const firstId = chat.activeSubjectId;
  const firstRevision = chat.subject.id;
  const firstMessages = chat.messages.length;
  const second = await transport.request({ method: 'POST', path: `/api/conversations/${id}/subjects`, data: { type: 'knowledge', content: { text: '交集为什么表示并且', intent: 'knowledge' } } });
  await chat.refresh();
  await chat.switchSubject(second.subject.subjectId, '第一题还没发出的思路');
  assert.equal(chat.subject.id, second.subject.id);
  assert.equal(chat.messages.length, 0);
  assert.equal(chat.progress.draft, '');
  await chat.switchSubject(firstId, '第二题的草稿');
  assert.equal(chat.subject.id, firstRevision);
  assert.equal(chat.messages.length, firstMessages);
  assert.equal(chat.progress.draft, '第一题还没发出的思路');
  await chat.open(id);
  assert.equal(chat.activeSubjectId, firstId);
  assert.equal(chat.progress.draft, '第一题还没发出的思路');
  await chat.switchSubject(second.subject.subjectId, chat.progress.draft);
  assert.equal(chat.progress.draft, '第二题的草稿');
  console.log('PASS 真实小程序 store 经焦点/进度接口切题，逐题草稿/对话与重进恢复正确');

  chat.reset();
  await chat.send('集合的交集与并集', undefined, 'knowledge', 'practice');
  await until(() => !chat.generating && Boolean(chat.subject), '练习意图持久化');
  await chat.open(chat.currentId);
  assert.equal(chat.subject.content.intent, 'practice');
  await chat.confirm();
  await until(() => !chat.generating, '范围确认后直接生成题组');
  await until(() => !chat.waitingJob && chat.artifacts.some((a: any) => a.type === 'exercise_set'), '直接练习意图生成成果');
  await auth.logout();
  assert.equal(chat.currentId, null);
  assert.equal(chat.messages.length, 0);
  console.log('PASS 退出清空账号数据');
  console.log('本地前后端逻辑层联通通过；模型模式以服务端运行记录为准，微信渲染与真机另行验收。');
}
main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { chat.$dispose(); auth.$dispose(); });
