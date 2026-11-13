import { z } from 'zod';
import { loadPrompt } from './prompts';

export const ContentProfileRef = z.object({ id: z.enum(['math', 'unconfigured']), version: z.literal('1') }).strict();
export type ContentProfileRef = z.infer<typeof ContentProfileRef>;
export const MATH_PROFILE: ContentProfileRef = { id: 'math', version: '1' };
export const UNCONFIGURED_PROFILE: ContentProfileRef = { id: 'unconfigured', version: '1' };

/** Shipped capabilities, not a claim that a foundation model can deliver every domain. */
export async function contentProfileRules(ref: ContentProfileRef): Promise<string> {
  ContentProfileRef.parse(ref);
  if (ref.id === 'unconfigured') return '当前内容尚未配置教学能力。可澄清目标、说明范围或回读已有资料；不得套数学规则、生成数学讲义/题组或声称已验证该领域的学习效果。';
  return [await loadPrompt('math'),
    '内容配置 math@1：图示支持 quadratic/geometry/mapping/operation_chain；有限输入与输出集合优先用mapping，数列项与间隔或四则变化优先用带逐段操作与方向的operation_chain。关键关系须在图内可读，不靠长图注补齐。正式练习支持2～3题；短验证支持判断、解释、比较与应用。评价关注条件、理由与迁移，不能仅凭最终数值或学生自述判定理解。',
  ].join('\n\n');
}

export function requireMaterialProfile(raw: unknown): ContentProfileRef {
  // Pre-profile jobs were created by the mathematical material pipeline. Preserve their retry snapshots.
  const ref = raw === undefined ? MATH_PROFILE : ContentProfileRef.parse(raw);
  if (ref.id !== 'math') throw new Error('当前内容没有可用的图文/练习生成配置');
  return ref;
}
