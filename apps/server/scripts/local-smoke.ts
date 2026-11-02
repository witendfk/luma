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
async function until(check: () => boolean, label: string, timeout = 30_000) {
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
  await chat.confirm();
  await until(() => !chat.generating && chat.messages.length === 4, '核对确认 → 引导回复');
  assert.ok(chat.subject.confirmedAt);
  await chat.send('为什么先考虑配方？');
  await until(() => !chat.generating && chat.messages.length === 6, '第二轮追问');
  const id = chat.currentId;
  await chat.open(id);
  assert.equal(chat.messages.length, 6);
  console.log('PASS 重新进入会话恢复标题、题目、完整历史');
  await chat.send('生成两道同类练习', 'generate_practice');
  await until(() => !chat.generating, '长工具释放前台 SSE');
  await until(() => !chat.waitingJob && chat.artifacts.some((a: any) => a.type === 'exercise_set'), 'worker 发布 → 恢复 Agent → 小程序轮询同步结果');
  const token = sandbox.load('@/utils/token').getToken();
  const response = await fetch(`${base}/api/conversations/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  await auth.logout();
  assert.equal(chat.currentId, null);
  assert.equal(chat.messages.length, 0);
  console.log('PASS 退出清空账号数据');
  console.log('本地前后端逻辑层联通通过；GPT 为模拟模型，微信渲染与真机另行验收。');
}
main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { chat.$dispose(); auth.$dispose(); });
