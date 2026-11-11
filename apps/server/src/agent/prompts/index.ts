import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { contentProfileRules, MATH_PROFILE, requireMaterialProfile, type ContentProfileRef } from '../content-profile';

/**
 * 提示词独立维护于代码仓库，运行记录保存所用版本（设计文档 §5.1）。
 * 结构：system.md 公共规则 + 各任务规则文件；每轮按任务装配。
 */
export const PROMPT_VERSION = '0.7.1';

const PROMPT_DIR = path.join(process.cwd(), 'src', 'agent', 'prompts');
const TUTOR_SKILL_PATH = path.join(process.cwd(), 'src', 'agent', 'skills', 'luma-tutor', 'SKILL.md');

export type TutoringTask = 'dialogue' | 'lesson' | 'practice';

/** Read the shipped policy and pass its actual text to GPT; no model-side file/Git access. */
export async function loadTutoringPolicy(task: TutoringTask): Promise<string> {
  const source = await readFile(TUTOR_SKILL_PATH, 'utf8');
  const start = source.indexOf('\n## 教学边界\n');
  if (start < 0) throw new Error('Luma 教学策略资源不完整，拒绝在缺失策略时继续教学');
  // Exclude discovery metadata, attribution and development links from the model instructions.
  const policy = source.slice(start).trim();
  const scope = {
    dialogue: '本次负责教学对话。诊断、路线建议、误解核实和提示递进通过当前回复组织；读写记忆使用已提供工具和teaching.operations。',
    lesson: '本次只生成已请求的图文讲义或指定段落，不与学生现场对话，不等待回答。围绕已知卡点组织解释、图示、例子和可选思考点；严格遵守任务JSON结构。',
    practice: '本次只生成已请求的正式题组，不重新摸底、不创建路线、不等待回答。依据有效卡点选择基础与变式题；参考答案按题组协议生成，由服务端控制可见性。',
  }[task];
  return [
    '# Luma 伴学教学策略', policy,
    '# 本次职责与真实能力', scope,
    task === 'dialogue' ? '可用respond.learning提交短学习路线、节点与短验证候选，和完整回复一起原子保存。已有路线优先续学，不为每轮重新建路线。学习数据中的ID/版本才有效；create引用学生本轮原话goalQuote并设置可观察criteria，首次短验证可用initialCheck。update按expectedVersion提交：先issue保存验证任务，再在后续学生回答时evaluate，criteriaResults逐项引用学生真实回答。自述、助手讲解或自评不是通过证据，拿不准用uncertain/insufficient_evidence，不编造分数。短验证prompt必须原样出现在本次正文中，不能只保存后台任务。换例子不重建目标；新目标替代旧路线须提供replaces。暂停/恢复/跳过尊重学生请求。' : '本次材料任务只生成材料，不写学习路线或验证状态，也不宣称学生已掌握。',
    '系统提供的本轮状态、工具协议、答案权限和输出格式优先；不能调用未提供的工具。',
  ].join('\n\n');
}

export async function loadPrompt(name: string): Promise<string> {
  return readFile(path.join(PROMPT_DIR, `${name}.md`), 'utf8');
}

/** Worker tasks receive the same pedagogy with task-specific boundaries, not chat instructions. */
export async function loadTeachingTaskPrompt(name: 'lesson' | 'lesson-revision' | 'practice', profile: ContentProfileRef = MATH_PROFILE): Promise<string> {
  const task = name === 'practice' ? 'practice' : 'lesson';
  const ref = requireMaterialProfile(profile);
  const [policy, prompt, rules] = await Promise.all([loadTutoringPolicy(task), loadPrompt(name), contentProfileRules(ref)]);
  return [rules, policy, prompt].join('\n\n');
}

export async function loadTeachingReviewPrompt(profile: ContentProfileRef) {
  return [await contentProfileRules(requireMaterialProfile(profile)), await loadPrompt('review')].join('\n\n');
}
