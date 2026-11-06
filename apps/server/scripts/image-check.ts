import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
async function main() {
  const { env } = await import('../src/lib/env');
  const { createOpenAI } = await import('@ai-sdk/openai');
  const { experimental_generateImage } = await import('ai');
  const e = env();
  if (process.argv.includes('--list')) {
    const response = await fetch(`${(e.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${e.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) { console.log(JSON.stringify({ status: response.status })); return; }
    const body = await response.json() as { data?: Array<{ id: string }> };
    console.log(JSON.stringify({ imageModels: body.data?.map((m) => m.id).filter((id) => /^gpt-image-[a-zA-Z0-9_.-]+$/.test(id)) ?? [] }));
    return;
  }
  const started = Date.now();
  try {
    const result = await experimental_generateImage({
      model: createOpenAI({ apiKey: e.OPENAI_API_KEY, ...(e.OPENAI_BASE_URL ? { baseURL: e.OPENAI_BASE_URL } : {}) }).imageModel(e.LUMA_IMAGE_MODEL_ID),
      prompt: 'A clean green parabola on a warm white background, vertex labeled (0,0). No decoration.',
      n: 1, size: '1024x1024', maxRetries: 0, providerOptions: { openai: { quality: 'low' } }, abortSignal: AbortSignal.timeout(60000),
    });
    console.log(JSON.stringify({ ok: true, model: e.LUMA_IMAGE_MODEL_ID, bytes: result.image.uint8Array.byteLength, elapsedMs: Date.now() - started }));
  } catch (err) {
    const value = err as { name?: string; statusCode?: number; responseBody?: string; cause?: { code?: string } };
    let code: unknown;
    try { const body = JSON.parse(value.responseBody ?? '{}'); code = body.error?.code ?? body.code; } catch { /* Never log raw gateway body, headers or URL. */ }
    console.log(JSON.stringify({ ok: false, name: value.name, status: value.statusCode, code: typeof code === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(code) ? code : undefined, cause: value.cause?.code, elapsedMs: Date.now() - started }));
    process.exitCode = 1;
  }
}
void main();
