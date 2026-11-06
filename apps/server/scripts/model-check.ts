import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();

async function main() {
  const { env } = await import('../src/lib/env');
  if (env().LUMA_MOCK_AGENT) throw new Error('请先关闭 LUMA_MOCK_AGENT；本脚本只验证真实模型');
  const { nextAgentStep } = await import('../src/lib/model');
  const { nativeToolSet } = await import('../src/agent/tools');
  const tools = nativeToolSet();
  const started = Date.now(); let chunks = 0, text = '';
  const step = await nextAgentStep({ purpose: 'connectivity',
    system: '你是数学学习助手。本次仅调用 respond，disposition=wait_user，text=你好，我们从你的思路开始。不要调用其他工具。参数顺序先 disposition，再 text。',
    messages: [{ role: 'user', content: '你好' }], tools: { respond: tools.respond! },
    abortSignal: AbortSignal.timeout(45000),
    onText: async (delta) => { chunks++; text += delta; }, onReset: async () => { text = ''; },
  });
  console.log(JSON.stringify({ model: env().LUMA_MODEL_ID, kind: step.kind, elapsedMs: Date.now() - started, chunks,
    ...(step.kind === 'respond' ? { text: step.text, incrementalMatches: !text || text === step.text, usage: step.usage } : step.kind === 'issue' ? { code: step.code, message: step.message } : {}) }));
  if (step.kind !== 'respond') process.exitCode = 1;
}
main().catch(() => { console.error('模型探针失败：请检查服务端配置及网络（不输出凭据或原始上游响应）'); process.exitCode = 1; });
