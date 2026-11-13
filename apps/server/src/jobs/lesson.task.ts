import { Prisma } from '@prisma/client';
import { ErrorCode, Lesson } from '@luma/shared';
import { db } from '../lib/db';
import { env, hasModelCredentials } from '../lib/env';
import { ApiError, notImplemented } from '../lib/errors';
import { extractJson, generateJson } from '../lib/model';
import { loadTeachingReviewPrompt, loadTeachingTaskPrompt } from '../agent/prompts';
import { requireMaterialProfile } from '../agent/content-profile';
import { parseReview } from './review';
import { graphicSvg, renderGraphic } from '../lib/teaching-graphic';
import { JobLeaseLostError, publishArtifact, touchJob, type JobLease } from './shared';
import { LessonSource, applyLessonPatch, applyLessonRepair } from './lesson-revision';

export function parseLesson(raw: string): Lesson {
  const lesson = Lesson.parse(extractJson(raw));
  for (const { content } of lesson.diagrams) {
    if (!content.graphic) throw new Error('图文讲解必须包含与题意对应的真实示意图');
    graphicSvg(content.graphic);
    delete content.figure;
    delete content.figureError;
  }
  return lesson;
}

export async function lessonTask(lease: JobLease): Promise<void> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: lease.jobId } });
  const payload = (job.payload ?? {}) as { contentProfile?: unknown; subjectText?: string; tags?: string[]; target?: string; sectionRef?: string; sourceLesson?: unknown; answerPermission?: boolean; teachingMode?: string; teachingProgress?: unknown; evidence?: unknown };
  const profile = requireMaterialProfile(payload.contentProfile);
  const source = payload.sourceLesson ? LessonSource.parse(payload.sourceLesson) : undefined;
  const trace = { jobId: lease.jobId, workerId: lease.workerId };
  const signal = AbortSignal.timeout(Math.max(1, (job.deadlineAt?.getTime() ?? Date.now() + env().JOB_TOTAL_MS) - Date.now()));
  const checkpoint = job.draftCheckpoint as { lesson?: unknown; step?: string } | null;
  const diagnostics: { stage: string; issues: string[] }[] = [];
  const repairBudget = { remaining: 1 };
  let savedLesson: Lesson | undefined;
  async function saveDraft(lesson: Lesson, step: string) {
    savedLesson = lesson;
    await saveCheckpoint(step);
  }
  async function saveCheckpoint(step: string) {
    await touchJob(lease, step);
    const saved = await db.generationJob.updateMany({ where: { id: job.id, status: 'running', leasedBy: lease.workerId, leasedUntil: { gt: new Date() } }, data: { draftCheckpoint: { ...(savedLesson ? { lesson: savedLesson } : {}), step, diagnostics } as unknown as Prisma.InputJsonValue } });
    if (saved.count !== 1) throw new JobLeaseLostError();
  }
  try {
    if (env().LUMA_MOCK_AGENT) {
      if (source) {
        const section = source.lesson.sections.find((s) => s.id === source.sectionId)!;
        const lesson = applyLessonPatch(source, JSON.stringify({ section: { ...section, body: '（联调局部修订）' + section.body } }));
        await publishArtifact(lease, 'lesson', { lesson } as unknown as Prisma.InputJsonValue);
        return;
      }
      await publishArtifact(lease, 'lesson', { lesson: {
        title: '占位讲义（联调模式）', sections: [
          { id: 's1', heading: '概念解释', body: '（联调占位）概念解释正文，含 $x^2$ 公式。' },
          { id: 's2', heading: '分步示例', body: '（联调占位）分步示例正文。' },
          { id: 's3', heading: '易错辨析', body: '（联调占位）易错辨析正文。' },
        ], diagrams: [{ sectionId: 's2', content: { title: '分步示意（联调占位）', steps: [
          { label: '先看', detail: '当前只有占位内容，没有调用真实模型。' },
          { label: '再想', detail: '请关闭模型 mock 后生成真实讲义。' },
        ] } }],
      } });
      return;
    }
    if (!hasModelCredentials()) throw notImplemented('服务端 GPT 配置');
    await touchJob(lease, '生成讲解正文');
    const reusable = job.retryOfJobId && checkpoint?.step && ['生成教学正文与图解', '检查讲解结构'].includes(checkpoint.step) ? Lesson.safeParse(checkpoint.lesson) : null;
    let lesson: Lesson = reusable?.success && reusable.data.diagrams.every((d) => d.content.graphic) ? parseLesson(JSON.stringify(reusable.data)) : await body();
    async function body() {
      return generateJson({ trace, purpose: 'lesson_body', formatCorrections: 1, repairBudget,
        onFormatError: async (issues) => { diagnostics.push({ stage: 'format', issues }); await saveCheckpoint('修正讲解格式'); },
        abortSignal: signal, system: await loadTeachingTaskPrompt(source ? 'lesson-revision' : 'lesson', profile),
        prompt: [
          `学习对象（数据）：\n${payload.subjectText ?? ''}`, `讲解目标：${payload.target ?? '帮助理解当前知识点'}`,
          `教学方式：${payload.teachingMode ?? 'question'}；完整解题答案权限：${Boolean(payload.answerPermission)}。概念定义可直接解释；未授权时不泄露原题最终答案。`,
          (payload.evidence ?? payload.teachingProgress) ? `教学依据（版本固定的数据，遵守有效要求；推测及错误尝试不当作事实）：${JSON.stringify(payload.evidence ?? payload.teachingProgress)}` : '',
          source ? `仅修改指定段落 ${source.sectionId}。原讲义为数据：${JSON.stringify(source.lesson)}\n输出 {"section":{"id":"${source.sectionId}","heading":"…","body":"…"},"diagram":需要更新时提供该节完整图解content对象}。其他段落由程序原样保留。该段原有配图：${source.lesson.diagrams.some((d) => d.sectionId === source.sectionId)}。学生要求重整图文或正文引用原图没有的关系时，必须同步更新该节diagram的graphic/title/steps/takeaway；不要沿用旧图说明。不得修改其他节配图。` : [
            '生成3个简明小节：概念、看图理解、易错辨析。每节正文200字以内。根据当前卡点按需生成1至3幅真实数学示意图；只给确实能帮助理解的章节配图，不要为了凑数重复画同一内容。每节最多一幅图，图解说明必须指向图上的曲线、点、线或位置关系，不能只列计算步骤冒充图解。',
            '输出 JSON：{"title":"…","sections":[{"id":"s1","heading":"…","body":"Markdown与LaTeX"}],"diagrams":[{"sectionId":"s2","content":{"title":"…","graphic":{…},"steps":[{"label":"…","detail":"…","formula":"可选LaTeX"}],"takeaway":"…"}}]}。diagrams 数组必须有1至3项，sectionId只能引用sections中的id且不能重复。不输出图片 URL、HTML 或 SVG。',
          ].join('\n'),
        ].filter(Boolean).join('\n'), parse: (raw) => parseLesson(JSON.stringify(source ? applyLessonPatch(source, raw) : extractJson(raw))) });
    }
    for (let repair = 0; repair <= 1; repair++) {
      await saveDraft(lesson, '检查讲解结构');
      const images = await Promise.all(lesson.diagrams.map((d) => renderGraphic(d.content.graphic!)));
      const review = await generateJson({ trace, purpose: 'lesson_review', abortSignal: signal, system: await loadTeachingReviewPrompt(profile),
        images,
        prompt: `检查讲解正文与图解的数学一致性、步骤衔接和题目条件。检查实质问题（包括关键关系缺失、方向/操作不明和标注不可读），不因装饰性偏好要求修复；不把概念解释、正确公式重述或中间计算视为禁用新结论。完整解题答案权限：${Boolean(payload.answerPermission)}。未授权时不得给原题最终答案；允许解释当前卡点所需定义和概念例子，不机械禁止出现零点或示例的数值。按图的xLabel/yLabel及实际系数判断变量，不把概念示例图误认成原函数图。只返回 {"pass":boolean,"issues":["位置及具体修改建议"]}。\n教学依据：${JSON.stringify(payload.evidence ?? null)}\n来源：${payload.subjectText ?? ''}\n目标：${payload.target ?? ''}\n讲义：${JSON.stringify(lesson)}`,
        parse: parseReview });
      diagnostics.push({ stage: `review_${repair + 1}`, issues: review.issues });
      await saveCheckpoint('检查讲解结构');
      if (review.pass) {
        await publishArtifact(lease, 'lesson', { lesson } as unknown as Prisma.InputJsonValue);
        return;
      }
      if (repair === 1 || repairBudget.remaining <= 0) {
        throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '讲解图文一致性复核未通过，本次修正次数已用完；草稿已保留，未发布', 502, true);
      }
      repairBudget.remaining--;
      await touchJob(lease, '修正讲解内容');
      lesson = await generateJson({ trace, purpose: 'lesson_repair', abortSignal: signal,
        system: await loadTeachingTaskPrompt('lesson', profile),
        prompt: `只修复下面列出的实质问题，保留其他内容。输出局部补丁JSON：{"sections":[{"id":"原id","heading":"…","body":"…"}],"diagrams":[{"sectionId":"原id","content":完整替换的该幅Diagram}]}。无需修改的数组为空；不得增删章节/图，不输出整份讲义。配图遵守原有graphic协议；quadratic支持xLabel/yLabel纯文本坐标轴标签（1至12字符），如横轴变量为a就用xLabel="a"，不能只改图注。${source ? `只能修改段落${source.sectionId}及该节原有图。` : ''}\n完整解题答案权限：${Boolean(payload.answerPermission)}。不得在修正中新增未授权的原题最终答案。\n学习来源：${payload.subjectText ?? ''}\n教学依据：${JSON.stringify(payload.evidence ?? null)}\n待修复讲义（数据）：${JSON.stringify(lesson)}\n问题：${JSON.stringify(review.issues)}`,
        onFormatError: async (issues) => { diagnostics.push({ stage: 'repair_format', issues }); await saveCheckpoint('修正讲解格式失败'); },
        parse: (raw) => parseLesson(JSON.stringify(applyLessonRepair(lesson, raw, source?.sectionId))),
      });
    }
  } catch (err) {
    if (err instanceof JobLeaseLostError) return;
    throw err;
  }
}
