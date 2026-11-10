import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesPracticeSource, type PracticeSource } from '../src/services/lesson-practice';
import { projectMaterialTasks } from '../src/services/material-tasks';

const source: PracticeSource = { artifactId: 'lesson1', artifactVersion: 1, subjectRevisionId: 'rev1', scope: 'whole_lesson', count: 2, difficulty: 'basic' };

test('配套题组严格匹配讲义、版本和训练范围，不按同名考点复用', () => {
  assert.equal(matchesPracticeSource({ practiceSource: source }, source), true);
  for (const patch of [{ artifactId: 'other' }, { artifactVersion: 2 }, { subjectRevisionId: 'rev2' }, { scope: 'section' }, { count: 3 }, { difficulty: 'transfer' }]) {
    assert.equal(matchesPracticeSource({ practiceSource: { ...source, ...patch } }, source), false);
  }
  assert.equal(matchesPracticeSource({ topic: '同一知识点' }, source), false);
  assert.equal(matchesPracticeSource(null, source), false);
});

test('旧任务仅通过准确的整份讲义依据关联，章节追问和无版本记录不猜测迁移', () => {
  const focus = { artifactId: source.artifactId, artifactVersion: 1 };
  assert.equal(matchesPracticeSource({ count: 2, evidence: { focus } }, source), true);
  for (const patch of [{ sectionId: 's1' }, { attemptId: 'attempt1' }, { exerciseId: 'ex1' }, { artifactVersion: undefined }, { artifactVersion: 2 }, { artifactId: 'other' }]) {
    assert.equal(matchesPracticeSource({ evidence: { focus: { ...focus, ...patch } } }, source), false);
  }
  assert.equal(matchesPracticeSource({ count: 3, evidence: { focus } }, source), false);
});

test('跨轮复用题组只投影已有材料入口，不创建新任务或泄漏答案', () => {
  const cards = projectMaterialTasks([], [{ id: 'set', type: 'exercise_set', publishStatus: 'published', content: { answer: 'PRIVATE' } }],
    [{ id: 'run', userMessageId: 'u', subjectRevisionId: 'rev1', taskFrame: { goals: [{ type: 'practice', completedArtifactId: 'set' }] } }], 'rev1');
  assert.equal(cards.length, 1); assert.equal(cards[0]!.type, 'exercise_set');
  assert.equal(cards[0]!.artifactId, 'set'); assert.equal(cards[0]!.jobId, null);
  assert.doesNotMatch(JSON.stringify(cards), /PRIVATE/);
});
