import assert from 'node:assert/strict';
import test from 'node:test';
import { miniappSandbox, storageMock } from './helpers/miniapp';

test('启动清除旧预览记录和缓存，保留真实身份、输入与阅读位置', () => {
  const storage = storageMock();
  for (const key of ['luma_ui_preview:workspace:v1', 'luma_ui_preview:token', 'luma_ui_draft:home', 'luma_draft:study-preview:v1:s']) storage.setStorageSync(key, 'old');
  storage.setStorageSync('luma_token', 'real-account');
  storage.setStorageSync('luma_draft:home', '自己的问题');
  storage.setStorageSync('luma_draft:reader:real:3', 's2');
  const sandbox = miniappSandbox({}, { uni: storage });
  const clean = sandbox.load('@/utils/legacy-preview').clearLegacyPreviewStorage;
  clean(); clean();
  assert.deepEqual([...storage.values.keys()].sort(), ['luma_draft:home', 'luma_draft:reader:real:3', 'luma_token']);
  assert.equal(storage.getStorageSync('luma_token'), 'real-account');
  storage.setStorageSync('luma_token', 'luma-ui-preview-only'); clean();
  assert.equal(storage.getStorageSync('luma_token'), undefined);
  const retired = sandbox.load('@/mocks/workspace');
  assert.equal(retired.previewRecords().length, 0);
  assert.equal(storage.getStorageSync('luma_ui_preview:workspace:v1'), undefined);
});

test('请求层即便收到旧mock配置也只使用真实传输，不返回示例结果', async () => {
  const storage = storageMock();
  let requests = 0;
  const sandbox = miniappSandbox({ '@/config': { UI_MOCK: true, API_BASE: 'http://test.invalid' } }, { uni: {
    ...storage, request(options: any) { requests++; options.success({ statusCode: 200, data: { ok: true, data: { items: [] } } }); },
  } });
  const transport = sandbox.load('@/utils/request');
  assert.deepEqual(JSON.parse(JSON.stringify(await transport.request({ method: 'GET', path: '/api/conversations' }))), { items: [] });
  assert.equal(requests, 1);
  storage.setStorageSync('luma_token', 'luma-ui-preview-only');
  await assert.rejects(transport.request({ method: 'GET', path: '/api/conversations' }), /重新登录/);
  assert.equal(requests, 1);
});

test('后台重试成功后刷新消息和材料，清除旧失败提示', async () => {
  const sandbox = miniappSandbox({ '@/api/conversations': {
    getConversation: async () => ({ conversation: { id: 'c', title: '原题', activeSubjectId: 's' }, subjects: [], artifacts: [{ id: 'v3' }], latestRun: { id: 'retry', status: 'completed' } }),
    listMessages: async () => ({ items: [{ id: 'answer', role: 'assistant', content: { blocks: [{ type: 'text', text: '概念一节已更新' }] } }] }),
  } }, { uni: storageMock() });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'c'; chat.error = '超过上下文预算'; chat.retryRunId = 'failed';
  await chat.refresh();
  assert.equal(chat.error, ''); assert.equal(chat.retryRunId, null);
  assert.equal(chat.messages[0].text, '概念一节已更新'); assert.equal(chat.artifacts[0].id, 'v3');
  chat.$dispose();
});

test('切题先保存草稿；保存失败保留原题，生成中不切换', async () => {
  let focuses = 0;
  const sandbox = miniappSandbox({ '@/api/conversations': {
    saveProgress: async () => { throw new Error('草稿保存失败'); },
    focusSubject: async () => { focuses += 1; },
  } }, { uni: storageMock(), Error });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'c'; chat.activeSubjectId = 'first';
  chat.subject = { id: 'r1', version: 1 }; chat.progress = { version: 0, draft: '' };
  await assert.rejects(chat.switchSubject('second', '未保存思路'), /草稿保存失败/);
  assert.equal(chat.activeSubjectId, 'first'); assert.equal(focuses, 0);
  assert.equal(chat.switchingSubject, false);
  chat.waitingJob = true;
  await chat.switchSubject('second', '');
  assert.equal(focuses, 0);
  chat.$dispose();
});

test('切题响应迟到时不能覆盖同一会话重新打开后的状态', async () => {
  let finish!: (value: any) => void;
  const sandbox = miniappSandbox({ '@/api/conversations': {
    focusSubject: () => new Promise((resolve) => { finish = resolve; }),
  } }, { uni: storageMock() });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'c'; chat.activeSubjectId = 'first';
  const switching = chat.switchSubject('second', '');
  await Promise.resolve();
  chat.reset(); chat.currentId = 'c'; chat.activeSubjectId = 'reopened';
  finish({ conversation: { activeSubjectId: 'second' }, subject: { id: 'late' }, subjects: [], artifacts: [] });
  await switching;
  assert.equal(chat.activeSubjectId, 'reopened'); assert.equal(chat.subject, null);
  chat.$dispose();
});

test('修改题目期间禁止发送；旧刷新不能覆盖新版本，失败保留原对象', async () => {
  let resolveDetail!: (value: any) => void, resolveEdit!: (value: any) => void;
  let fail = false;
  const sandbox = miniappSandbox({ '@/api/conversations': {
    getConversation: () => new Promise((resolve) => { resolveDetail = resolve; }),
    updateSubject: () => fail ? Promise.reject(new Error('网络断开')) : new Promise((resolve) => { resolveEdit = resolve; }),
    listMessages: async () => ({ items: [] }),
  } }, { uni: storageMock() });
  const pinia = sandbox.require('pinia');
  pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'c';
  chat.subject = { id: 'v1', version: 1, content: { text: '原题' }, tags: [], confirmedAt: 'today' };
  const refreshing = chat.refresh(false);
  const saving = chat.editSubject({ content: { text: '新题' }, tags: [], subquestions: [], expectedRevision: 1 });
  await chat.send('不应发送');
  assert.equal(chat.messages.length, 0);
  resolveEdit({ subject: { id: 'v2', version: 2, content: { text: '新题' }, tags: [], confirmedAt: null } });
  assert.equal(await saving, true);
  resolveDetail({ conversation: { title: '旧标题' }, subject: { id: 'v1' }, artifacts: [] });
  await refreshing;
  assert.equal(chat.subject.id, 'v2');
  assert.equal(chat.subject.confirmedAt, null);
  fail = true;
  await assert.rejects(chat.editSubject({ expectedRevision: 2 }), /网络断开/);
  assert.equal(chat.subject.id, 'v2');
  assert.equal(chat.editingSubject, false);
  chat.$dispose();
});

test('确认保留教学/练习意图，重复点击不重复请求；切换账号后迟到修改不写入', async () => {
  for (const intent of ['question', 'knowledge', 'practice']) {
    let confirms = 0, requestBody: any;
    const subject = { id: 's', version: 1, type: intent === 'question' ? 'question' : 'knowledge', content: { text: '集合', intent }, tags: [], confirmedAt: null as string | null };
    const sandbox = miniappSandbox({
      '@/api/conversations': {
        confirmSubject: async () => { confirms += 1; subject.confirmedAt = 'today'; },
        getConversation: async () => ({ conversation: { title: '集合' }, subject, progress: { stage: 'guiding' }, artifacts: [] }),
      },
      '@/utils/sse': { openTurnStream: (options: any) => { requestBody = options.body; return { abort() {} }; } },
    }, { uni: storageMock() });
    const pinia = sandbox.require('pinia');
    pinia.setActivePinia(pinia.createPinia());
    const chat = sandbox.load('@/stores/conversation').useConversationStore();
    chat.currentId = 'c'; chat.subject = subject;
    await Promise.all([chat.confirm(), chat.confirm()]);
    assert.equal(confirms, 1);
    assert.equal(requestBody.action, intent === 'practice' ? 'generate_practice' : intent === 'knowledge' ? 'generate_lesson' : undefined);
    chat.$dispose();
  }
  let resolveEdit!: (value: any) => void;
  const sandbox = miniappSandbox({ '@/api/conversations': { updateSubject: () => new Promise((resolve) => { resolveEdit = resolve; }) } }, { uni: storageMock() });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'old';
  const saving = chat.editSubject({ expectedRevision: 1 });
  chat.reset();
  resolveEdit({ subject: { id: 'private-old-subject' } });
  assert.equal(await saving, false);
  assert.equal(chat.subject, null);
  chat.$dispose();
});

function streamFixture(globals: Record<string, unknown> = {}) {
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
    ...globals,
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

test('查看归档不恢复；发送不预先修改归档，恢复由服务端消息事务负责', async () => {
  const calls: string[] = [];
  const row = { id: 'archived', title: '函数', archivedAt: '2026-11-01', lastActiveAt: '2026-11-01' };
  const sandbox = miniappSandbox({
    '@/api/conversations': {
      getConversation: async () => ({ conversation: row, artifacts: [], subject: null }),
      listMessages: async () => ({ items: [] }),
      updateConversation: async () => { calls.push('unexpected-restore'); },
    },
    '@/utils/sse': { openTurnStream: () => { calls.push('stream'); return { abort() {} }; } },
  }, { uni: { ...storageMock(), showToast() {} }, Error });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  await chat.open(row.id);
  assert.deepEqual(calls, []);
  assert.equal(chat.archivedAt, row.archivedAt);
  await chat.send('为什么？');
  assert.deepEqual(calls, ['stream']);
  assert.equal(chat.archivedAt, row.archivedAt); // client never claims success before server confirmation
  chat.$dispose();
});

test('创建会话期间切换页面，迟到结果不覆盖新会话或继续发送', async () => {
  let finish!: (value: any) => void, streams = 0;
  const sandbox = miniappSandbox({
    '@/api/conversations': { createConversation: () => new Promise((resolve) => { finish = resolve; }) },
    '@/utils/sse': { openTurnStream: () => { streams += 1; return { abort() {} }; } },
  }, { uni: { ...storageMock(), showToast() {} }, Error });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  const sending = chat.send('旧会话问题');
  chat.reset(); chat.currentId = 'new'; chat.title = '新会话';
  finish({ id: 'old', title: '旧标题', archivedAt: null });
  await sending;
  assert.equal(chat.currentId, 'new');
  assert.equal(chat.title, '新会话');
  assert.equal(streams, 0);
  chat.$dispose();
});

test('归档分页失败保留已有记录；恢复防重复并同步最近列表，退出拒绝迟到数据', async () => {
  const row = { id: 'c', title: '函数', archivedAt: '2026-11-01', lastActiveAt: '2026-11-01' };
  let failList = false, finishRestore!: (value: any) => void, writes = 0;
  const sandbox = miniappSandbox({ '@/api/conversations': {
    listConversations: async (archived: boolean) => { assert.equal(archived, true); if (failList) throw new Error('网络断开'); return { items: [row], nextCursor: 'next' }; },
    updateConversation: () => { writes += 1; return new Promise((resolve) => { finishRestore = resolve; }); },
  } }, { uni: storageMock(), Error });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const tokens = sandbox.load('@/utils/token'); tokens.setToken('A');
  const archive = sandbox.load('@/stores/archived').useArchivedStore();
  const history = sandbox.load('@/stores/history').useHistoryStore();
  await archive.load();
  failList = true;
  await archive.load(true);
  assert.equal(archive.items.length, 1);
  assert.match(archive.error, /网络断开/);
  const restoring = archive.restore('c');
  assert.equal(await archive.restore('c'), false);
  assert.equal(writes, 1);
  finishRestore({ ...row, archivedAt: null, lastActiveAt: '2026-11-02' });
  assert.equal(await restoring, true);
  assert.equal(archive.items.length, 0);
  assert.equal(history.latest.id, 'c');
  const late = archive.restore('other');
  tokens.setToken('B');
  finishRestore({ ...row, id: 'other', archivedAt: null });
  assert.equal(await late, false);
  assert.equal(archive.items.length, 0);
  assert.equal(history.items.length, 0);
  archive.$dispose(); history.$dispose();
});

test('重试不重复添加学生消息；新运行分块不拼进已停止的旧回复，reset 只撤回本轮', async () => {
  let options: any;
  const sandbox = miniappSandbox({ '@/utils/sse': { openTurnStream: (opts: any) => { options = opts; return { abort() {} }; } } }, { uni: storageMock() });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'c'; chat.retryRunId = 'old';
  chat.messages = [{ id: 'u', role: 'user', text: '原始提问' }, { id: 'a', role: 'assistant', runId: 'old', text: '停在这里', incomplete: true }];
  await chat.retry();
  assert.equal(options.body.retryOfRunId, 'old'); assert.equal(chat.messages.length, 2);
  options.onEvent({ type: 'run.started', runId: 'new' });
  options.onEvent({ type: 'text.delta', runId: 'new', delta: '新的回复' });
  assert.equal(chat.messages.length, 3); assert.equal(chat.messages[1].text, '停在这里');
  options.onEvent({ type: 'text.reset', runId: 'new' });
  assert.equal(chat.messages.length, 2); assert.equal(chat.messages[1].text, '停在这里');
  chat.$dispose();
});

test('流式及排版故障的显示占位不泄漏完整或半截公式源码', () => {
  const { pendingContentNodes } = miniappSandbox().load('@/utils/study-content');
  for (const text of ['因此，**$f(x)$ 的最小值为 $3$**。', '公式 $\\frac{1}{', '先观察\\(x^2', '$$x^2+3']) {
    const nodes = JSON.stringify(pendingContentNodes(text));
    assert.doesNotMatch(nodes, /\$|frac|\\\\\(/);
    assert.match(nodes, /公式排版中/);
  }
  assert.match(JSON.stringify(pendingContentNodes('先想 $x$', true)), /公式暂未排版/);
});

test('停止期间禁止重复发送/取消，旧流和旧刷新不复活已停止回复', async () => {
  let stream: any, finishCancel!: () => void, finishOld!: (value: any) => void;
  let cancels = 0, reads = 0;
  const stopped = { conversation: { id: 'c', title: '原对话' }, artifacts: [], materialTasks: [],
    latestRun: { id: 'run', status: 'cancelled' } };
  const sandbox = miniappSandbox({
    '@/utils/sse': { openTurnStream: (opts: any) => { stream = opts; return { abort() {} }; } },
    '@/api/conversations': {
      cancelRun: () => { cancels++; return new Promise<void>((resolve) => { finishCancel = resolve; }); },
      getConversation: () => ++reads === 1 ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve(stopped),
      listMessages: async () => ({ items: [{ id: 'partial', role: 'assistant', runId: 'run', status: 'incomplete', content: { blocks: [{ type: 'text', text: '已收到的内容' }] } }] }),
    },
  }, { uni: storageMock() });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore(); chat.currentId = 'c';
  await chat.send('问题'); stream.onEvent({ type: 'run.started', runId: 'run' });
  const old = chat.refresh(false), stopping = chat.stop();
  assert.equal(chat.stopping, true);
  await chat.stop(); await chat.send('不应该发送');
  assert.equal(cancels, 1);
  stream.onEvent({ type: 'text.delta', runId: 'run', delta: '迟到内容' });
  stream.onEvent({ type: 'run.waiting', runId: 'run', waiting: 'job', jobIds: ['j'] });
  finishOld({ ...stopped, activeRun: { id: 'run', status: 'running' } }); await old;
  assert.equal(chat.waitingJob, false); assert.equal(chat.currentRunId, null);
  finishCancel(); await stopping;
  assert.equal(chat.stopping, false); assert.equal(chat.generating, false);
  assert.equal(chat.messages[0].text, '已收到的内容');
  assert.doesNotMatch(chat.messages.map((m: any) => m.text).join(''), /迟到/);
  chat.$dispose();
});

test('取消响应丢失先只读对账；切换会话后迟到取消不能刷新新会话', async () => {
  let failCancel!: (e: Error) => void, reads = 0;
  const sandbox = miniappSandbox({ '@/api/conversations': {
    cancelRun: () => new Promise<void>((_, reject) => { failCancel = reject; }),
    getConversation: async () => { reads++; return { conversation: { id: 'c', title: '原对话' }, artifacts: [], latestRun: { id: 'run', status: 'cancelled' } }; },
    listMessages: async () => ({ items: [] }),
  } }, { uni: storageMock(), Error });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore(); chat.currentId = 'c'; chat.currentRunId = 'run';
  const stopping = chat.stop(); failCancel(new Error('连接断开'));
  await assert.rejects(stopping, /连接断开/); assert.equal(reads, 1); assert.equal(chat.waitingJob, false);
  chat.currentRunId = 'run'; const late = chat.stop();
  chat.reset(); chat.currentId = 'new'; chat.title = '新会话';
  failCancel(new Error('迟到取消')); await late;
  assert.equal(reads, 1); assert.equal(chat.title, '新会话'); assert.equal(chat.stopping, false);
  chat.$dispose();
});

test('伴学路线完整事件更新、暂停不触发模型，旧版本/旧对象状态不能覆盖当前页面', async () => {
  let stream: any, calls = 0, controls = 0;
  const route = { id: 'route', version: 1, goal: '理解变化率', status: 'active', subjectRevisionId: 'revision',
    contentProfileId: 'math', contentProfileVersion: '1', createdAt: '2026-11-10T01:00:00.000Z', currentNodeId: null, nodes: [] };
  const sandbox = miniappSandbox({
    '@/api/conversations': { updateLearningRoute: async (_id: string, _subject: string, input: any) => { controls++; assert.equal(input.expectedVersion, 2); return { ...route, version: 3, status: 'paused' }; } },
    '@/utils/sse': { openTurnStream: (input: any) => { stream = input; calls++; return { abort() {} }; } },
  }, { uni: storageMock() });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'c'; chat.activeSubjectId = 'subject'; chat.subject = { id: 'revision', version: 1, confirmedAt: 'now' };
  chat.learningRoute = route;
  await chat.send('继续');
  stream.onEvent({ type: 'route.updated', runId: 'run', route: { ...route, version: 2 } });
  stream.onEvent({ type: 'route.updated', runId: 'run', route });
  stream.onEvent({ type: 'route.updated', runId: 'run', route: { ...route, id: 'other', version: 9, subjectRevisionId: 'other-revision' } });
  assert.equal(chat.learningRoute.version, 2);
  stream.onEvent({ type: 'run.completed', runId: 'run' });
  await chat.actOnRoute('pause');
  assert.equal(chat.learningRoute.status, 'paused'); assert.equal(controls, 1); assert.equal(calls, 1);
  chat.reset();
  stream.onEvent({ type: 'route.updated', runId: 'run', route });
  assert.equal(chat.learningRoute, null);
});

test('跳过节点回访保留明确焦点，控制操作不发送教学请求且生成中不可重复回访', async () => {
  let controls = 0;
  const route = { id: 'route', version: 4, goal: '理解变化关系', status: 'active', subjectRevisionId: 'r',
    contentProfileId: 'math', contentProfileVersion: '1', createdAt: '2026-11-11T01:00:00.000Z', currentNodeId: null,
    nodes: [{ id: 'n', status: 'skipped' }] };
  const sandbox = miniappSandbox({
    '@/api/conversations': { updateLearningRoute: async (_id: string, _subject: string, input: any) => {
      controls++; assert.equal(input.action, 'revisit'); assert.equal(input.nodeId, 'n'); assert.equal(input.expectedVersion, 4);
      return { ...route, version: 5, currentNodeId: 'n', nodes: [{ id: 'n', status: 'learning' }] };
    } },
    '@/utils/sse': { openTurnStream: () => { throw new Error('回访不应调用模型'); } },
  }, { uni: storageMock() });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore();
  chat.currentId = 'c'; chat.activeSubjectId = 's'; chat.subject = { id: 'r', version: 1, confirmedAt: 'now' }; chat.learningRoute = route;
  chat.generating = true;
  await chat.actOnRoute('revisit', 'n'); assert.equal(controls, 0);
  chat.generating = false;
  await chat.actOnRoute('revisit', 'n');
  assert.equal(controls, 1); assert.equal(chat.learningRoute.currentNodeId, 'n'); assert.equal(chat.learningRoute.version, 5);
  assert.equal(chat.updatingRoute, false); chat.$dispose();
});


test('注释心跳重置静默计时；真正静默只结束一次，终态后不受迟到断线影响', () => {
  const timers = new Map<number, () => void>(); let next = 0;
  const f = streamFixture({ setTimeout: (fn: () => void) => { timers.set(++next, fn); return next; }, clearTimeout: (id: number) => timers.delete(id) });
  const first = next;
  f.headers(200); f.send(': heartbeat\n\n');
  assert.equal(timers.has(first), false); assert.equal(f.events.length, 0);
  timers.get(next)!();
  assert.equal(f.callbacks.length, 1); assert.match(f.callbacks[0], /核对已保存/);
  assert.equal(f.aborts, 1); assert.equal(timers.size, 0);
  f.finish(200); assert.equal(f.callbacks.length, 1);
  const completed = streamFixture();
  completed.send('data: {"type":"run.completed","runId":"r"}\n\n');
  assert.deepEqual(completed.callbacks, ['done']);
  completed.finish(500); assert.deepEqual(completed.callbacks, ['done']);
});

function reconnectFixture() {
  let requests = 0, reads = 0, disconnected = false;
  let resolveDetail: ((value: any) => void) | undefined;
  const streams: any[] = [];
  const snapshot = () => ({ conversation: { id: 'c', title: '已有对话', activeSubjectId: 's' }, subjects: [], artifacts: [],
    activeRun: null, latestRun: { id: 'r', status: 'completed' } });
  const timers = new Map<number, () => void>(); let timerId = 0;
  const sandbox = miniappSandbox({
    '@/api/conversations': {
      getConversation: async () => { reads++; if (disconnected) throw new Error('offline'); return resolveDetail === undefined ? snapshot() : new Promise((resolve) => { resolveDetail = resolve; }); },
      listMessages: async () => ({ items: [{ id: 'saved', runId: 'r', role: 'assistant', status: 'complete', content: { blocks: [{ type: 'text', text: '服务端已保存的完整回复' }] } }] }),
      getRun: async () => ({ status: 'running' }),
    },
    '@/utils/sse': { openTurnStream: (opts: any) => { requests++; streams.push(opts); return { abort() {} }; } },
  }, { uni: storageMock(),
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id: number) => timers.delete(id) });
  const pinia = sandbox.require('pinia'); pinia.setActivePinia(pinia.createPinia());
  const chat = sandbox.load('@/stores/conversation').useConversationStore(); chat.currentId = 'c';
  return { chat, streams, timers, snapshot, get requests() { return requests; }, get reads() { return reads; },
    offline: () => { disconnected = true; }, online: () => { disconnected = false; },
    delay: () => { resolveDetail = () => {}; }, resolve: (value: any) => resolveDetail!(value) };
}

async function flushReconnection(chat: any) {
  for (let i = 0; i < 20 && chat.reconnecting; i++) await Promise.resolve();
}

test('断流后只读回查完整回复，不重新请求模型；回查失败保留内容并禁止重复发送', async () => {
  const f = reconnectFixture();
  await f.chat.send('原问题');
  f.streams[0].onEvent({ type: 'run.started', runId: 'r' });
  f.streams[0].onEvent({ type: 'text.delta', runId: 'r', delta: '已收到的部分' });
  f.offline(); f.streams[0].onError('断流');
  await flushReconnection(f.chat);
  assert.equal(f.chat.needsReconnect, true); assert.equal(f.chat.messages.at(-1).text, '已收到的部分');
  await f.chat.send('不能重复发送'); assert.equal(f.requests, 1);
  f.online(); await f.chat.reconnect();
  assert.equal(f.chat.needsReconnect, false); assert.equal(f.chat.error, '');
  assert.equal(f.chat.messages.length, 1); assert.equal(f.chat.messages[0].id, 'saved');
  assert.equal(f.chat.messages[0].incomplete, false); assert.equal(f.requests, 1);
  f.chat.$dispose();
});

test('对账发现仍在运行则只轮询，旧轮次迟到事件不能污染新轮次或新会话', async () => {
  const f = reconnectFixture();
  await f.chat.send('第一问');
  f.streams[0].onEvent({ type: 'run.completed', runId: 'r' });
  await f.chat.send('第二问');
  f.streams[0].onError('旧连接失败');
  f.streams[0].onDone();
  assert.equal(f.chat.generating, true); assert.equal(f.reads, 0);
  f.delay(); f.streams[1].onError('断流');
  f.resolve({ ...f.snapshot(), activeRun: { id: 'r2', status: 'running' } });
  await flushReconnection(f.chat);
  assert.equal(f.chat.waitingJob, true); assert.equal(f.timers.size, 1);
  await f.chat.send('阻止新的生成'); assert.equal(f.requests, 2);
  f.delay(); const reconnecting = f.chat.reconnect();
  f.chat.reset(); f.chat.currentId = 'other'; f.chat.title = '新会话';
  f.resolve(f.snapshot()); await reconnecting;
  assert.equal(f.chat.title, '新会话'); assert.equal(f.chat.messages.length, 0);
  f.chat.$dispose();
});
