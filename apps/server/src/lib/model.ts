import { createOpenAI } from '@ai-sdk/openai';
import { ErrorCode } from '@luma/shared';
import { generateText, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { env, hasModelCredentials } from './env';
import { ApiError } from './errors';
import { respondSchema } from '../agent/tools';

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
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export type RespondDisposition = 'wait_user' | 'finish';

export type AgentStep =
  | { kind: 'respond'; disposition: RespondDisposition; text: string; refs: unknown[]; usage?: TokenUsage }
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
  if (!opts.model && !hasModelCredentials()) {
    if (!env().LUMA_MOCK_AGENT) return { kind: 'issue', code: 'MODEL_NOT_CONFIGURED', retryable: false, message: '服务端尚未配置 GPT' };
    // 联调脚本：由驱动器按运行状态给定的确定性步骤
    await new Promise((r) => setTimeout(r, 200));
    return opts.mock ?? { kind: 'issue', code: 'NO_MOCK', retryable: false, message: '未配置模型且无联调脚本' };
  }

  let rawText = '';

  const result = streamText({
    model: opts.model ?? getModel(),
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    toolChoice: 'required',
    stopWhen: stepCountIs(1),
    maxRetries: 0,
    abortSignal: opts.abortSignal,
    maxOutputTokens: 4096,
  });

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          rawText += (part as { text?: string }).text ?? (part as { delta?: string }).delta ?? '';
          break;
        }
        case 'error':
          return { kind: 'issue', code: ErrorCode.MODEL_UNAVAILABLE, retryable: true, message: '模型流中断，可重试' };
        default:
          break;
      }
    }
  } catch (err) {
    return {
      kind: 'issue',
      code: ErrorCode.MODEL_UNAVAILABLE,
      retryable: true,
      message: `模型流中断：${err instanceof Error ? err.message : '未知错误'}`,
    };
  }

  let usage: TokenUsage | undefined;
  try {
    const u = await result.usage;
    if (u) usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens };
  } catch {
    usage = undefined; // 流中途失败用量未知，保留 unknown（§4.14）
  }

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
    return {
      kind: 'issue',
      code: 'PROTOCOL_NO_TOOL',
      retryable: true,
      message: rawText.trim()
        ? '模型返回了普通文本；必须通过 respond 工具或业务工具结束本步'
        : '模型未返回任何工具调用',
      usage,
    };
  }

  const respondCalls = calls.filter((c) => c.toolName === 'respond');
  if (respondCalls.length > 0 && calls.length > 1) {
    // respond 与业务工具混用：不执行终止，返回协议校正（§4.11）
    return { kind: 'issue', code: 'PROTOCOL_MIXED', retryable: true, message: 'respond 不能与其他工具在同一步调用', usage };
  }
  if (respondCalls.length === 1) {
    const parsed = respondSchema.safeParse(respondCalls[0]!.input);
    if (!parsed.success || !parsed.data.text.trim()) {
      return { kind: 'issue', code: 'PROTOCOL_RESPOND', retryable: true, message: 'respond 参数不完整或正文为空', usage };
    }
    const input = parsed.data;
    return { kind: 'respond', disposition: input.disposition, text: input.text, refs: Array.isArray(input.refs) ? input.refs : [], usage };
  }

  return { kind: 'tool_calls', calls, usage };
}

/** 任务内部一次性生成（讲义正文/复核/出题，§8.4）：与主 Agent 循环分开计数的模型请求 */
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  purpose: string;
  parse: (raw: string) => T;
  abortSignal?: AbortSignal;
}): Promise<T> {
  let raw: string;
  try {
    const result = await generateText({ model: getModel(), system: opts.system, prompt: opts.prompt, maxRetries: 0, maxOutputTokens: 8192, abortSignal: opts.abortSignal ?? AbortSignal.timeout(env().JOB_TOTAL_MS) });
    raw = result.text;
  } catch (err) {
    throw new ApiError(
      ErrorCode.MODEL_UNAVAILABLE,
      `模型调用失败：${err instanceof Error ? err.message : '未知错误'}`,
      502,
      true,
    );
  }
  try {
    return opts.parse(raw);
  } catch {
    throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '模型输出解析失败，可重试', 502, true);
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
