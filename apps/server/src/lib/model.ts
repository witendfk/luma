import { createOpenAI } from '@ai-sdk/openai';
import { ErrorCode, teachingReplyText, type TeachingReply } from '@luma/shared';
import { generateText, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { env, hasModelCredentials } from './env';
import { accountJobModel, type JobModelTrace } from './model-accounting';
import { ApiError } from './errors';
import { partialRespondText } from '../agent/respond-stream';
import { respondSchema, turnPlanSchema } from '../agent/tools';
import { estimateTokens } from './token-budget';
import { ZodError } from 'zod';

/**
 * 统一模型调用层（设计文档 §4.10 / §4.14）。
 * SDK 每次只生成一个模型步骤（stopWhen 1 步、maxRetries 0），工具经原生 function calling
 * 暴露但不注册 execute；循环、状态、执行与恢复由项目运行时（agent/loop.ts）负责。
 * 主循环记录调用用量；底层隐式重试关闭，避免绕过统一计数。
 */

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export type RespondDisposition = 'wait_user' | 'finish';

export type AgentStep =
  | { kind: 'plan'; plan: import('zod').infer<typeof turnPlanSchema>; calls: ToolCall[]; usage?: TokenUsage }
  | { kind: 'respond'; disposition: RespondDisposition; text: string; content?: TeachingReply; clarification?: import('../agent/readback').Clarification; refs: unknown[]; teaching?: import('zod').infer<typeof import('../agent/teaching-state').TeachingUpdate>; learning?: import('../agent/learning-contracts').LearningUpdate; assistance?: 'none' | 'hint' | 'explanation' | 'solution'; usage?: TokenUsage }
  | { kind: 'tool_calls'; calls: ToolCall[]; usage?: TokenUsage }
  | { kind: 'issue'; code: string; retryable: boolean; message: string; usage?: TokenUsage };

export interface NextStepOptions {
  /** 服务端模型依赖；测试可注入 SDK 模型替身，客户端不可指定。 */
  model?: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  abortSignal?: AbortSignal;
  /** 无模型凭据时的脚本化决策（联调模式，由驱动器按状态生成） */
  mock?: AgentStep;
  /** 用途标记，进入调用记录 */
  purpose: string;
  cacheKey?: string;
  onText?: (delta: string) => Promise<void>;
  onReset?: () => Promise<void>;
}

export function getModel() {
  const e = env();
  if (!hasModelCredentials()) {
    throw new ApiError(ErrorCode.INTERNAL, '模型未配置（OPENAI_API_KEY）', 500);
  }
  const openai = createOpenAI({
    apiKey: e.OPENAI_API_KEY,
    ...(e.OPENAI_BASE_URL ? { baseURL: e.OPENAI_BASE_URL } : {}),
  });
  return openai(e.LUMA_MODEL_ID);
}

/** 一次模型步骤：单步协议适配（§4.10），归一化为 respond / tool_calls / issue */
export async function nextAgentStep(opts: NextStepOptions): Promise<AgentStep> {
  if (!opts.model && env().LUMA_MOCK_AGENT) {

    // 联调脚本：由驱动器按运行状态给定的确定性步骤
    await new Promise((r) => setTimeout(r, 200));
    return opts.mock ?? { kind: 'issue', code: 'NO_MOCK', retryable: false, message: '未配置模型且无联调脚本' };
  }

  if (!opts.model && !hasModelCredentials()) return { kind: 'issue', code: 'MODEL_NOT_CONFIGURED', retryable: false, message: '服务端尚未配置 GPT' };
  let rawText = '', streamed = '', args = '', respondId: string | undefined;
  let callsStarted = 0, disabled = false;
  async function reset() { if (streamed) await opts.onReset?.(); streamed = ''; disabled = true; }
  async function issue(code: string, message: string, usage?: TokenUsage): Promise<AgentStep> {
    if (code.startsWith('PROTOCOL')) await reset(); return { kind: 'issue', code, message, usage, retryable: !['MODEL_NOT_CONFIGURED','MODEL_AUTH','MODEL_QUOTA'].includes(code) };
  }

  const result = streamText({
    model: opts.model ?? getModel(),
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    toolChoice: 'required',
    stopWhen: stepCountIs(1),
    maxRetries: 0,
    onError: () => { /* Upstream errors may contain headers; only sanitized issues leave this adapter. */ },
    abortSignal: opts.abortSignal,
    maxOutputTokens: opts.model ? 4096 : env().MODEL_OUTPUT_TOKENS,
    providerOptions: { openai: { parallelToolCalls: false, strictJsonSchema: false, store: false, ...(opts.cacheKey ? { promptCacheKey: opts.cacheKey } : {}) } },
  });

  try {
    for await (const part of result.fullStream) {
      opts.abortSignal?.throwIfAborted();
      switch (part.type) {
        case 'tool-input-start':
          callsStarted++;
          if (callsStarted > 1) await reset();
          else if (part.toolName === 'respond') respondId = part.id;
          break;
        case 'tool-input-delta':
          if (!disabled && part.id === respondId && opts.onText) {
            args += part.delta;
            const text = partialRespondText(args);
            if (text !== null && text.startsWith(streamed) && text.length > streamed.length) {
              await opts.onText(text.slice(streamed.length)); streamed = text;
            }
          }
          break;
        case 'text-delta': {
          rawText += (part as { text?: string }).text ?? (part as { delta?: string }).delta ?? '';
          break;
        }
        case 'error':
          return issue(ErrorCode.MODEL_UNAVAILABLE, '模型流中断，可重试');
        default:
          break;
      }
    }
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return issue(status === 401 || status === 403 ? 'MODEL_AUTH' : ErrorCode.MODEL_UNAVAILABLE,
      status === 401 || status === 403 ? 'GPT 鉴权失败，请检查服务端配置' : '模型连接中断，请重试');
  }

  let usage: TokenUsage | undefined;
  try {
    const u = await result.usage;
    if (u) usage = modelUsage(u);
  } catch {
    usage = undefined; // 流中途失败用量未知，保留 unknown（§4.14）
  }

  // A syntactically complete call can still come from an incomplete generation.
  // Check the provider's finish marker before returning any executable candidate.
  let finishReason: string;
  try { finishReason = await result.finishReason; }
  catch { return issue(ErrorCode.MODEL_UNAVAILABLE, '模型未完整结束，请重试', usage); }
  if (finishReason === 'length') return issue('MODEL_TRUNCATED', '本次回复达到输出上限，未提交完整结果；请缩小问题范围后重试', usage);
  if (finishReason === 'content-filter') {
    await reset();
    return { kind: 'issue', code: 'MODEL_REFUSED', retryable: false, message: '模型未能处理本次请求，请调整问题后继续', usage };
  }
  if (!['stop', 'tool-calls'].includes(finishReason)) return issue(ErrorCode.MODEL_UNAVAILABLE, '模型未完整结束，请重试', usage);

  let calls: ToolCall[];
  try {
    const raw = await result.toolCalls;
    calls = (raw as Array<{ toolCallId: string; toolName: string; input: unknown }>).map((c) => ({
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      input: c.input,
    }));
  } catch {
    calls = [];
  }

  if (calls.length === 0) {
    // 普通无工具最终文本 = 协议不合约（§4.11）
    return issue('PROTOCOL_NO_TOOL', rawText.trim() ? '模型返回了普通文本；必须通过 respond 或业务工具结束本步' : '模型未返回任何工具调用', usage);
  }

  const respondCalls = calls.filter((c) => c.toolName === 'respond');
  if (respondCalls.length > 0 && calls.length > 1) {
    // respond 与业务工具混用：不执行终止，返回协议校正（§4.11）
    return issue('PROTOCOL_MIXED', 'respond 不能与其他工具在同一步调用', usage);
  }
  if (respondCalls.length === 1) {
    const parsed = respondSchema.safeParse(respondCalls[0]!.input);
    if (!parsed.success) {
      return issue('PROTOCOL_RESPOND', 'respond 参数不完整或正文为空', usage);
    }
    const input = parsed.data;
    const text = teachingReplyText(input.content);
    if (streamed && text !== streamed) await reset();
    return { kind: 'respond', disposition: input.disposition, text, content: input.content, clarification: input.clarification, refs: Array.isArray(input.refs) ? input.refs : [], teaching: input.teaching, learning: input.learning, assistance: input.assistance, usage };
  }

  const planning = calls.filter((c) => c.toolName === 'planTurn');
  if (planning.length) {
    const parsed = turnPlanSchema.safeParse(planning[0]!.input);
    if (calls.length !== 1 || !parsed.success) return issue('PROTOCOL_PLAN', 'planTurn 必须独立调用并包含合法目标', usage);
    return { kind: 'plan', plan: parsed.data, calls, usage };
  }
  return { kind: 'tool_calls', calls, usage };
}

/** 任务内部一次性生成（讲义正文/复核/出题，§8.4）：与主 Agent 循环分开计数的模型请求 */
interface JsonOptions<T> {
  /** Server-side injection for isolated adapter checks; never supplied by the client. */
  model?: LanguageModel;
  system: string;
  prompt: string;
  purpose: string;
  parse: (raw: string) => T;
  abortSignal?: AbortSignal;
  trace?: JobModelTrace;
  images?: Uint8Array[];
  formatCorrections?: 0 | 1;
  /** Shared allowance for structural and quality repair within one material task. */
  repairBudget?: { remaining: number };
  onFormatError?: (issues: string[]) => Promise<void>;
}

export class ModelOutputError extends ApiError {
  constructor(readonly issues: string[], readonly raw: string) {
    super(ErrorCode.MODEL_UNAVAILABLE, '讲解内容格式校验未通过，未发布；请稍后重试', 502, true);
  }
}

/** One bounded format correction, separately accounted. Network/auth failures are never retried here. */
export async function generateJson<T>(opts: JsonOptions<T>): Promise<T> {
  try { return await generateJsonAttempt(opts); }
  catch (error) {
    if (!(error instanceof ModelOutputError)) throw error;
    await opts.onFormatError?.(error.issues);
    if (!opts.formatCorrections || (opts.repairBudget && opts.repairBudget.remaining <= 0)) throw error;
    if (opts.repairBudget) opts.repairBudget.remaining--;
    try {
      return await generateJsonAttempt({ ...opts, purpose: `${opts.purpose}_format_correction`,
        prompt: opts.prompt + `\n上次输出（仅作待修复数据）：${error.raw}\n结构问题：${JSON.stringify(error.issues)}。仅修正这些格式问题，保留其他数学内容；严格按要求的 JSON 字段与类型重新输出。` });
    } catch (correctionError) {
      if (correctionError instanceof ModelOutputError) await opts.onFormatError?.(correctionError.issues);
      throw correctionError;
    }
  }
}

async function generateJsonAttempt<T>(opts: JsonOptions<T>): Promise<T> {
  const started = Date.now(); let usage: TokenUsage | undefined, error: string | undefined;
  const inputTokens = estimateTokens({ system: opts.system, prompt: opts.prompt }) + 512 + (opts.images?.length ?? 0) * 4096;
  const outputTokens = env().MODEL_OUTPUT_TOKENS;
  if (inputTokens + outputTokens > env().LONG_TASK_CONTEXT_INPUT_TOKENS) throw new ApiError(ErrorCode.INVALID_FORMAT, '生成材料超出上下文预算，请缩小范围', 400);
  const callId = opts.trace ? await accountJobModel(opts.trace, opts.purpose, { inputTokens, outputTokens }) : undefined;
  try {
    const result = await generateText({ model: opts.model ?? getModel(), system: opts.system,
      ...(opts.images?.length ? { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: opts.prompt }, ...opts.images.map((image) => ({ type: 'image' as const, image }))] }] } : { prompt: opts.prompt }), maxRetries: 0,
      providerOptions: { openai: { store: false } }, maxOutputTokens: env().MODEL_OUTPUT_TOKENS,
      abortSignal: AbortSignal.any([opts.abortSignal ?? AbortSignal.timeout(env().JOB_TOTAL_MS), AbortSignal.timeout(env().MODEL_REQUEST_MS)]) });
    usage = modelUsage(result.usage);
    // Never publish even valid-looking JSON when the provider reports truncation.
    if (result.finishReason === 'length') {
      error = 'MODEL_TRUNCATED';
      throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '材料生成达到输出上限，草稿未发布；请缩小范围后重试', 502, true);
    }
    if (result.finishReason !== 'stop') {
      error = 'MODEL_INCOMPLETE';
      throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '材料未完整生成，未发布；请调整范围后重试', 502, true);
    }
    try { return opts.parse(result.text); }
    catch (parseError) {
      const issues = parseError instanceof ZodError ? parseError.issues.slice(0, 8).map((issue) => `${issue.path.join('.')}:${issue.code}`)
        : [parseError instanceof SyntaxError ? 'invalid_json' : 'invalid_material_structure'];
      error = `MODEL_OUTPUT:${issues.join(',')}`;
      throw new ModelOutputError(issues, result.text);
    }
  } catch (err) {
    error ??= 'MODEL_UNAVAILABLE';
    if (err instanceof ApiError) throw err;
    throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '模型调用失败，请检查网络或服务端模型配置后重试', 502, true);
  } finally {
    if (opts.trace && callId) await accountJobModel(opts.trace, opts.purpose, { callId, durationMs: Date.now() - started, usage, error });
  }
}

export function modelUsage(raw: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number }): TokenUsage {
  return { inputTokens: raw.inputTokens, outputTokens: raw.outputTokens, totalTokens: raw.totalTokens,
    ...(raw.cachedInputTokens === undefined ? {} : { cachedInputTokens: raw.cachedInputTokens }) };
}

/** A rejected completion can still carry billable usage. */
export class IncompleteSummaryError extends ApiError {
  constructor(readonly usage: TokenUsage) {
    super(ErrorCode.MODEL_UNAVAILABLE, '长对话摘要未完整生成，原对话及已有摘要保留，可重试', 502, true);
  }
}

/** Compression is a visible, accounted model request, not an invisible SDK retry. */
export async function summarizeContext(opts: { model?: LanguageModel; system: string; prompt: string; maxOutputTokens: number; abortSignal: AbortSignal; cacheKey: string }) {
  if (estimateTokens(opts.system + opts.prompt) + opts.maxOutputTokens + 512 > env().CONTEXT_INPUT_TOKENS) {
    throw new ApiError(ErrorCode.INVALID_FORMAT, '摘要请求超过上下文窗口，旧消息未被删除', 400);
  }
  try {
    const result = await generateText({ model: opts.model ?? getModel(), system: opts.system, prompt: opts.prompt,
      maxRetries: 0, maxOutputTokens: opts.maxOutputTokens, abortSignal: opts.abortSignal,
      providerOptions: { openai: { store: false, promptCacheKey: opts.cacheKey } } });
    if (result.finishReason !== 'stop') throw new IncompleteSummaryError(modelUsage(result.usage));
    return { raw: result.text, usage: modelUsage(result.usage) };
  } catch (error) {
    if (error instanceof IncompleteSummaryError) throw error;
    throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '长对话摘要生成失败，原对话已保留，可重试', 502, true);
  }
}

/** 从模型输出中提取 JSON（容忍 ```json 围栏与前后说明文字） */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('输出中没有 JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

/** 原生工具定义：只传名称/说明/参数 schema，不注册 execute（§4.10） */
export function nativeTool(def: { name: string; description: string; inputSchema: Parameters<typeof tool>[0]['inputSchema'] }) {
  return tool({ description: def.description, inputSchema: def.inputSchema });
}

export { stepCountIs };
export type { ModelMessage, ToolSet };
