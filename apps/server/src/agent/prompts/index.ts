import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { contentProfileRules, MATH_PROFILE, requireMaterialProfile, type ContentProfileRef } from '../content-profile';

/**
 * 提示词独立维护于代码仓库，运行记录保存所用版本（设计文档 §5.1）。
 * 结构：system.md 公共规则 + 各任务规则文件；每轮按任务装配。
 */
export const PROMPT_VERSION = '0.7.9';

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
    task === 'dialogue' ? 'planTurn.learningIntent=start表示本次要开启连续伴学，最终respond必须带learning.create，不能生成讲义后遗漏路线。用2至5个必要节点组织本次小目标，不为普通短问答创建课程。学生需要区分概念时，短验证应给足条件和判断对象，避免一个数字可能同时属于两个集合却强迫二选一；问输入或输出角色时直接说明在判断角色。' : '',
    task === 'dialogue' ? '路线currentNodeId指定当前节点；其他节点的待巩固记录仍保留，不按列表首项猜当前进度。学生要求回访已跳过或已通过节点时，用node.action=revisit并引用本轮studentQuote；已通过节点转待巩固，旧验证只读，换一个未示范的新任务再issue，后续回答才可evaluate。也可先用revisit+issue在同次回复设置新任务。不要因学生说忘了直接声称答错，也不要沿用旧pass恢复当前通过。暂停/恢复不改变节点证据，尊重页面记录的回访焦点。' : '',
    task === 'dialogue' ? '本轮评价旧验证后若继续提出下一道短验证，使用同一learning.update的check.evaluate和followupCheck（nodeId、prompt、taskKind）原子保存；通过后可进入下一未完成节点，仍需巩固时可在当前节点换新任务。followupCheck.prompt须原样出现在正文，不能只在正文问下一题而不保存。新任务只由下一轮学生回答评价，不拿本轮旧题答案证明新任务通过。若本轮只是解释/收尾，可不出新验证；已有待回答任务先处理，不重复出题。' : '',
    task === 'dialogue' ? '设置短验证前，先核对当前节点已保存的每项criteria：题目必须确实要求学生展示这些能力，不能拿下一节点的问题替代当前节点验证。尤其页面再巩固后，当前焦点以学习数据为准，不机械接续历史回复末尾的问题。新题prompt必须自包含必要规则、输入范围和作答要求，不用“这个函数/沿用这题”代替条件；换未示范的新例子，不能把已经讲出的原题答案重新当独立证据。若已有任务不匹配目标或学生要求换题，先对旧任务记insufficient_evidence并逐项met=false，说明未获得目标作答，再用followupCheck设置匹配原条件的新任务；不把换题请求记成答错或擅改节点条件。' : '',
    task === 'dialogue' ? '区分答错、没有作答和帮助后的答对：needs_review须有本人实际作答中的明确错误证据；学生只说懂了/不会/不确定或请求提示，记insufficient_evidence/uncertain，不推断答错，也不推进通过。已经得到提示/讲解的任务即使随后答对，也不能冒充要求独立的验证通过；可以具体肯定其修正，保留帮助记录，再用followupCheck换未示范的新任务，待后续独立回答再评价。当前回复对旧题的解释不算新任务的帮助，但不能同时示范新任务的答案。' : '',
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
  return [rules, policy, prompt, task === 'lesson' ? await loadPrompt('graphics') : ''].filter(Boolean).join('\n\n');
}

export async function loadTeachingReviewPrompt(profile: ContentProfileRef, task: 'lesson' | 'practice' = 'lesson') {
  return [await contentProfileRules(requireMaterialProfile(profile)), await loadPrompt('review'), task === 'lesson' ? await loadPrompt('graphics') : ''].filter(Boolean).join('\n\n');
}
