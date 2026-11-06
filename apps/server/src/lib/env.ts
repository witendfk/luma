import { z } from 'zod';

/**
 * 服务端环境变量（集中读取，密钥只在服务端，设计文档 §11）。
 * 惰性解析：构建期不触库不读模型配置，运行时首次访问时校验。
 */

const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalText = z.preprocess(blankToUndefined, z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 必填'),

  // GPT 模型（AC-18：密钥不下发小程序）
  OPENAI_API_KEY: optionalText,
  OPENAI_BASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  LUMA_MODEL_ID: z.string().default('gpt-4o'),
  LUMA_IMAGE_MODEL_ID: z.string().default('gpt-image-1'),
  IMAGE_REQUEST_MS: z.coerce.number().int().positive().default(180000),

  // 微信小程序（FR-01）
  WECHAT_APPID: optionalText,
  WECHAT_APP_SECRET: optionalText,
  LUMA_DEV_FAKE_LOGIN: flag,

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // 腾讯云 COS
  COS_SECRET_ID: optionalText,
  COS_SECRET_KEY: optionalText,
  COS_BUCKET: optionalText,
  COS_REGION: optionalText,

  // ---- Agent 运行保护上限（设计文档 §4.7：分项计数，可配置；正式默认值待实测调整）----
  CONTEXT_INPUT_TOKENS: z.coerce.number().int().min(2000).default(12000),
  MODEL_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  MODEL_REQUEST_MS: z.coerce.number().int().positive().default(90000),
  MAX_MODEL_REQUESTS: z.coerce.number().int().positive().default(24),
  MAX_RUN_TOKENS: z.coerce.number().int().positive().default(100000),
  MAX_DECISIONS: z.coerce.number().int().positive().default(12),
  MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(6),
  MAX_TOOL_EXECUTIONS: z.coerce.number().int().positive().default(10),
  MODEL_MAX_CORRECTIONS: z.coerce.number().int().min(1).default(1),
  RUN_LEASE_MS: z.coerce.number().int().positive().default(120_000),
  /** 整项目标截止时间；后台等待计入且恢复不重置 */
  TURN_TOTAL_MS: z.coerce.number().int().positive().default(600_000),
  JOB_TOTAL_MS: z.coerce.number().int().positive().default(300_000),

  // 后台任务（设计文档 §8.3）
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  JOB_LEASE_MS: z.coerce.number().int().positive().default(900_000),
  LUMA_MOCK_AGENT: flag,
}).superRefine((value, ctx) => {
  if (value.LUMA_DEV_FAKE_LOGIN && value.NODE_ENV !== 'development') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LUMA_DEV_FAKE_LOGIN'],
      message: '假登录仅允许在 development 环境使用',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

export function parseEnv(input: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))].join(', ');
    throw new Error(`环境变量缺失或非法：${fields}`);
  }
  return parsed.data;
}

/** 是否已配置模型凭据；未配置时走框架提示分支 */
export function hasModelCredentials(): boolean {
  return Boolean(env().OPENAI_API_KEY);
}
