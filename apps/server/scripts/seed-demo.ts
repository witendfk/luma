/** Explicit local-only fixture for WeChat DevTools acceptance. Never runs at app startup. */
const base = 'http://localhost:4000';
async function main() {
  let token = '';
  async function api(path: string, method = 'GET', data?: unknown) {
    const response = await fetch(`${base}/api${path}`, { method, headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: data ? JSON.stringify(data) : undefined });
    const body = await response.json();
    if (!body.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    return body.data;
  }
  token = (await api('/auth/wechat/login', 'POST', { code: 'dev:local-student' })).token;
  try {
    const conversation = await api('/conversations', 'POST', {
      title: 'B01 联调 · 两道题独立学习', initialText: '已知 f(x)=x²−2x+3，求 f(x) 的最小值。',
    });
    await api(`/conversations/${conversation.id}/subjects`, 'POST', {
      type: 'knowledge', content: { text: '集合的交集为什么对应“并且”？', intent: 'knowledge' },
    });
    console.log(`已在开发账号生成双对象联调记录：${conversation.id}；请在开发者工具最近学习中打开。`);
  } finally { await api('/auth/logout', 'POST'); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
