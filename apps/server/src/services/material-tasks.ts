import type { MaterialTaskView } from '@luma/shared';
import { taskFrameFrom } from '../agent/types';

interface MaterialArtifact { id: string; type: string; publishStatus: string; content: unknown }
interface MaterialRun { id: string; userMessageId: string | null; subjectRevisionId: string | null; taskFrame: unknown }
interface MaterialJob {
  id: string; type: string; runId: string | null; subjectRevisionId: string | null;
  status: string; step: string | null; resultArtifactId: string | null;
  retryOfJobId: string | null; payload: unknown; error: unknown;
}

export function materialPreview(artifact?: MaterialArtifact): { title: string; summary: string } {
  const content = artifact?.content as { lesson?: { title?: string; sections?: Array<{ heading: string }> } } | undefined;
  if (artifact?.type === 'lesson') return { title: content?.lesson?.title?.slice(0, 100) || '图文讲解',
    summary: content?.lesson?.sections?.map((s) => s.heading).slice(0, 3).join(' · ').slice(0, 140) || '结合图示，理解当前卡点' };
  // Never project exercise content, answers, draft bodies or private diagnostics into a chat card.
  return { title: artifact?.type === 'exercise_set' ? '同知识点练习' : '图文讲解', summary: '' };
}

/** Input is already account/subject scoped by the service. Collapse retry chains into the original card. */
export function projectMaterialTasks(jobs: MaterialJob[], artifacts: MaterialArtifact[], runs: MaterialRun[], revisionId?: string): MaterialTaskView[] {
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const roots = new Map<string, { root: MaterialJob; latest: MaterialJob }>();
  for (const job of jobs) {
    if (job.type !== 'lesson' && job.type !== 'exercise_set') continue;
    let root = job;
    const visited = new Set([job.id]);
    while (root.retryOfJobId && jobMap.has(root.retryOfJobId) && !visited.has(root.retryOfJobId)) {
      root = jobMap.get(root.retryOfJobId)!; visited.add(root.id);
    }
    roots.set(root.id, { root, latest: job }); // jobs are oldest first
  }
  const cards: MaterialTaskView[] = [...roots.values()].map(({ root, latest: job }) => {
    const run = runs.find((r) => r.id === root.runId);
    const artifact = artifacts.find((a) => a.id === job.resultArtifactId && a.publishStatus === 'published');
    const error = job.error as { message?: string; retryable?: boolean } | null;
    const preview = materialPreview(artifact);
    return { id: root.id, jobId: job.id, runId: root.runId, userMessageId: run?.userMessageId ?? null,
      subjectRevisionId: job.subjectRevisionId, type: job.type as MaterialTaskView['type'],
      status: job.status === 'succeeded' && !artifact ? 'failed' : job.status as MaterialTaskView['status'], step: job.step,
      artifactId: artifact?.id ?? null, ...preview,
      ...(job.type === 'exercise_set' && !artifact ? { title: '同知识点练习' } : {}),
      historical: job.subjectRevisionId !== revisionId,
      error: job.status === 'succeeded' && !artifact ? { message: '成果暂未载入，请稍后重新打开', retryable: false }
        : error ? { message: error.message || '本次生成未完成', retryable: error.retryable === true } : null };
  });
  // A reused lesson has no new generation job, but its verified completion still needs a turn-local entry.
  for (const run of runs) for (const goal of taskFrameFrom(run.taskFrame).goals) {
    if (goal.type !== 'lesson' || !goal.completedArtifactId || goal.startedJobId) continue;
    if (jobs.some((j) => j.runId === run.id && j.resultArtifactId === goal.completedArtifactId)) continue;
    const artifact = artifacts.find((a) => a.id === goal.completedArtifactId && a.publishStatus === 'published');
    if (!artifact) continue;
    cards.push({ id: `reuse:${run.id}:${artifact.id}`, jobId: null, runId: run.id, userMessageId: run.userMessageId,
      subjectRevisionId: run.subjectRevisionId, type: 'lesson', status: 'succeeded', step: null, artifactId: artifact.id,
      ...materialPreview(artifact), historical: run.subjectRevisionId !== revisionId, error: null });
  }
  return cards;
}
