import { createOpenAI } from '@ai-sdk/openai';
import { experimental_generateImage } from 'ai';
import { ErrorCode } from '@luma/shared';
import { env } from './env';
import { ApiError } from './errors';
import { accountJobModel, type JobModelTrace } from './model-accounting';

export async function generateTeachingImage(input: { prompt: string; trace: JobModelTrace; signal: AbortSignal }): Promise<Uint8Array> {
  const e = env(), started = Date.now();
  await accountJobModel(input.trace, 'image');
  let error: string | undefined;
  try {
    const openai = createOpenAI({ apiKey: e.OPENAI_API_KEY, ...(e.OPENAI_BASE_URL ? { baseURL: e.OPENAI_BASE_URL } : {}) });
    const result = await experimental_generateImage({ model: openai.imageModel(e.LUMA_IMAGE_MODEL_ID),
      prompt: input.prompt, n: 1, size: '1024x1024', maxRetries: 0,
      providerOptions: { openai: { quality: 'low' } },
      abortSignal: AbortSignal.any([input.signal, AbortSignal.timeout(e.IMAGE_REQUEST_MS)]),
    });
    return result.image.uint8Array;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    let providerCode = '';
    try { providerCode = JSON.parse((err as { responseBody?: string }).responseBody ?? '{}').error?.code ?? ''; } catch { /* Never expose raw provider responses. */ }
    const unavailable = status === 404 || providerCode === 'model_not_found';
    const name = (err as { name?: string }).name ?? '';
    const timeout = input.signal.aborted || /Timeout|Abort/.test(name);
    error = status === 401 || status === 403 ? 'IMAGE_AUTH' : unavailable ? 'IMAGE_MODEL_UNAVAILABLE' : `IMAGE_${status ?? (timeout ? 'TIMEOUT' : 'UNAVAILABLE')}`;
    throw new ApiError(ErrorCode.MODEL_UNAVAILABLE,
      unavailable ? '当前图片服务暂不可用，讲解正文已保留' : status === 401 || status === 403 ? '当前图片服务暂不可用，讲解正文已保留' : timeout ? '教学配图生成超时，正文已保留，可稍后重试' : status ? '图片服务暂时未能生成配图，正文已保留' : '教学配图请求未能完成，正文已保留，可稍后重试', 502, !unavailable && (!status || status >= 429));
  } finally {
    // Image usage is not exposed by this SDK version: unknown, never a fabricated zero-cost call.
    await accountJobModel(input.trace, 'image', { durationMs: Date.now() - started, model: e.LUMA_IMAGE_MODEL_ID, error });
  }
}
