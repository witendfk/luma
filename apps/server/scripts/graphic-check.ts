import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
async function main() {
  const { db } = await import('../src/lib/db');
  const { runService } = await import('../src/services/run.service');
  const { drive } = await import('../src/agent/loop');
  const { artifactService } = await import('../src/services/artifact.service');
  const { renderGraphic } = await import('../src/lib/teaching-graphic');
  const { Lesson } = await import('@luma/shared');
  try {
    const c = await db.conversation.findUniqueOrThrow({ where: { id: 'cmw3f7waj001i8oy89ll1n9ne' } });
    const started = await runService.startRun(c.userId, c.id, { requestId: `graphic_${randomUUID()}`, action: 'generate_lesson', text: '请重新生成本题图文讲解，结合实际抛物线、对称轴和最低点来引导理解，先给方向提示，不直接给出最小值。' });
    await drive(started.run.id);
    const deadline = Date.now() + 150000;
    let job;
    do {
      job = await db.generationJob.findFirst({ where: { runId: started.run.id, type: 'lesson' }, orderBy: { createdAt: 'desc' } });
      if (job && ['succeeded', 'failed'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    assert.equal(job?.status, 'succeeded', JSON.stringify(job?.error));
    const artifact = await db.artifact.findUniqueOrThrow({ where: { id: job!.resultArtifactId! } });
    const lesson = Lesson.parse((artifact.content as any).lesson);
    const graphic = lesson.diagrams[0]!.content.graphic!;
    assert.equal(graphic.kind, 'quadratic');
    if (graphic.kind === 'quadratic') {
      assert.deepEqual([graphic.a, graphic.b, graphic.c], [1, -4, 7]);
      assert.equal(graphic.revealValues, false);
    }
    const view = await artifactService.get(c.userId, artifact.id);
    assert.match(JSON.stringify(view), /data:image\/png;base64/);
    await writeFile('/tmp/luma-teaching-graph.png', await renderGraphic(graphic));
    console.log(JSON.stringify({ status: 'passed', artifactId: artifact.id, version: artifact.version, title: lesson.title, graphic, sections: lesson.sections, image: '/tmp/luma-teaching-graph.png' }));
  } finally { await db.$disconnect(); }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : '图文验证失败'); process.exitCode = 1; });
