import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';

function streamFixture() {
  const storage = storageMock();
  let request: any, chunk: any, headers: any, aborts = 0;
  const callbacks: string[] = [];
  const events: any[] = [];
  const sandbox = miniappSandbox({ '@/config': { API_BASE: 'https://test.invalid' } }, {
    uni: storage,
    wx: { request(options: any) {
      request = options;
      return {
        onChunkReceived(cb: any) { chunk = cb; },
        onHeadersReceived(cb: any) { headers = cb; },
        abort() { aborts += 1; request.fail({ errMsg: 'abort' }); },
      };
    } },
  });
  const tokens = sandbox.load('@/utils/token');
  tokens.setToken('account-A');
  const handle = sandbox.load('@/utils/sse').openTurnStream({
    conversationId: 'conversation-A', body: { text: '题目', requestId: 'request-123' },
    onEvent: (event: any) => events.push(event),
    onDone: () => callbacks.push('done'),
    onError: (message: string) => callbacks.push(message),
  });
  return { callbacks, events, tokens, handle, get aborts() { return aborts; },
    headers: (statusCode: number) => headers({ statusCode }),
    send: (data: string | Uint8Array) => chunk({ data: typeof data === 'string' ? data : data.buffer }),
    finish: (statusCode: number, data?: unknown) => request.success({ statusCode, data }),
  };
}

test('流式 401 触发错误及清理登录态，不误报正常结束', () => {
  const f = streamFixture();
  f.headers(401);
  f.send(JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED', message: '登录过期' } }));
  f.finish(401);
  assert.deepEqual(f.callbacks, ['登录过期']);
  assert.equal(f.tokens.getToken(), null);
});

test('流式 500 返回 HTTP 错误；200 提前结束提示接收不完整', () => {
  const failed = streamFixture();
  failed.finish(500, 'upstream failed');
  assert.deepEqual(failed.callbacks, ['请求失败（HTTP 500）']);
  const truncated = streamFixture();
  truncated.send('data: {"type":"text.delta","runId":"r","delta":"部分回复"}\n\n');
  truncated.finish(200);
  assert.equal(truncated.callbacks.length, 1);
  assert.match(truncated.callbacks[0], /未完整接收/);
});

test('没有 TextDecoder 时逐字节接收中文、emoji 和 CRLF 帧，正常完成一次', () => {
  const f = streamFixture();
  f.headers(200);
  const body = 'data: {"type":"text.delta","runId":"r","delta":"思路📖"}\r\n\r\n' +
    'data: {"type":"run.completed","runId":"r"}\r\n\r\n';
  for (const byte of new TextEncoder().encode(body)) f.send(new Uint8Array([byte]));
  f.finish(200);
  assert.equal(f.events[0].delta, '思路📖');
  assert.deepEqual(f.callbacks, ['done']);
});

test('等待学生或后台任务均为本次 SSE 的正常结束，不误报截断', () => {
  for (const waiting of ['user', 'job']) {
    const f = streamFixture();
    f.headers(200);
    f.send(`data: ${JSON.stringify({ type: 'run.waiting', runId: 'r', waiting, jobIds: waiting === 'job' ? ['j'] : [] })}\n\n`);
    f.finish(200);
    assert.deepEqual(f.callbacks, ['done']);
  }
});

test('停止、账号切换与损坏帧后不再消费迟到事件', () => {
  for (const action of ['abort', 'switch', 'malformed']) {
    const f = streamFixture();
    if (action === 'abort') f.handle.abort();
    if (action === 'switch') f.tokens.setToken('account-B');
    if (action === 'malformed') f.send('data: {broken}\n\n');
    f.send('data: {"type":"text.delta","runId":"r","delta":"旧账号内容"}\n\n');
    f.finish(200);
    assert.equal(f.events.length, 0);
    assert.equal(f.callbacks.length, action === 'malformed' ? 1 : 0);
  }
});

test('列表客户端不依赖 URLSearchParams，正确编码中文、空格及特殊游标', async () => {
  const paths: string[] = [];
  const sandbox = miniappSandbox({ '@/utils/request': { request: async (opts: any) => { paths.push(opts.path); } } });
  await sandbox.load('@/api/conversations').listConversations(false, 'a+b&c');
  await sandbox.load('@/api/collections').listCollections({ keyword: '二次 函数', limit: 20 });
  assert.match(paths[0], /archived=0&cursor=a%2Bb%26c/);
  assert.match(paths[1], /keyword=%E4%BA%8C%E6%AC%A1%20%E5%87%BD%E6%95%B0&limit=20/);
});

test('退出立即清空账号数据、中止流、清理草稿，旧响应不能恢复内容', async () => {
  const storage = storageMock();
  let revoke!: () => void, resolveConversation!: (value: any) => void, aborts = 0;
  const sandbox = miniappSandbox({
    '@/api/auth': { logout: () => new Promise<void>((resolve) => { revoke = resolve; }) },
    '@/api/conversations': {
      getConversation: () => new Promise((resolve) => { resolveConversation = resolve; }),
      listMessages: async () => ({ items: [], nextCursor: null }),
    },
  }, { uni: storage });
  const pinia = sandbox.require('pinia');
  const instance = pinia.createPinia();
  pinia.setActivePinia(instance);
  const tokens = sandbox.load('@/utils/token');
  tokens.setToken('account-A');
  storage.setStorageSync('luma_draft:account-A:question', 'private draft');
  const conversation = sandbox.load('@/stores/conversation').useConversationStore();
  const auth = sandbox.load('@/stores/auth').useAuthStore();
  conversation.currentId = 'account-A-conversation';
  conversation.appendLocalMessage({ role: 'user', text: 'account-A-message' });
  const opening = conversation.refresh();
  conversation.setStream({ abort() { aborts += 1; } });
  const logout = auth.logout();
  assert.equal(conversation.currentId, null);
  assert.equal(conversation.messages.length, 0);
  assert.equal(aborts, 1);
  assert.equal(storage.values.has('luma_draft:account-A:question'), false);
  tokens.setToken('account-B');
  resolveConversation({ id: 'old-conversation', title: 'old-title' });
  revoke();
  await Promise.all([opening, logout]);
  assert.equal(conversation.currentId, null);
  assert.equal(tokens.getToken(), 'account-B');
  conversation.$dispose();
  auth.$dispose();
});

test('退出后迟到的登录结果不写入凭据，也不报告登录成功', async () => {
  const storage = storageMock();
  let finishLogin!: (value: any) => void;
  const sandbox = miniappSandbox({ '@/api/auth': {
    login: () => new Promise((resolve) => { finishLogin = resolve; }),
    logout: async () => undefined,
  } }, { uni: storage });
  const pinia = sandbox.require('pinia');
  pinia.setActivePinia(pinia.createPinia());
  const auth = sandbox.load('@/stores/auth').useAuthStore();
  const login = auth.loginWithCode('old-code');
  const rejected = assert.rejects(login, /登录状态已变化/);
  await auth.logout();
  finishLogin({ token: 'old-token' });
  await rejected;
  assert.equal(sandbox.load('@/utils/token').getToken(), null);
  assert.equal(auth.loggedIn, false);
  auth.$dispose();
});
