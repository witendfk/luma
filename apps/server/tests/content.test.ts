import assert from 'node:assert/strict';
import test from 'node:test';
import { renderContent } from '../src/lib/content-render';
import { Diagram, Lesson, TeachingGraphic } from '@luma/shared';
import sharp from 'sharp';
import { graphicSvg, presentDiagram, renderGraphic } from '../src/lib/teaching-graphic';
import { parseLesson } from '../src/jobs/lesson.task';
import { applyLessonRepair } from '../src/jobs/lesson-revision';

const parabola = { kind: 'quadratic' as const, a: 1, b: -4, c: 7, bounds: { xMin: -1, xMax: 5, yMin: -1, yMax: 12 }, caption: '观察抛物线最低点', revealValues: false };
test('有限输入映射显示每条对应关系，相同输出去重，允许多对一但拒绝重复输入', async () => {
  const mapping = TeachingGraphic.parse({ kind: 'mapping', caption: '允许的输入与实际输出',
    inputLabel: '输入 <x>', pairs: [-2, -1, 0, 1, 2].map((input) => ({ input, output: input * input })) });
  const svg = graphicSvg(mapping);
  assert.equal((svg.match(/marker-end="url\(#mapping-arrow\)"/g) ?? []).length, 5);
  assert.equal((svg.match(/>4<\/text>/g) ?? []).length, 1);
  assert.match(svg, /输入 &lt;x&gt;/);
  assert.doesNotMatch(svg, /最低点|对称轴|沿曲线/);
  const data = await renderGraphic(mapping);
  assert.equal((await sharp(data).metadata()).format, 'png');
  for (const pairs of [[{ input: 1, output: 1 }, { input: 1, output: 2 }], [{ input: 0, output: Infinity }, { input: 1, output: 1 }]]) {
    assert.equal(TeachingGraphic.safeParse({ ...mapping, pairs }).success, false);
  }
  assert.equal(TeachingGraphic.safeParse({ ...mapping, pairs: [{ input: 1, output: 1 }] }).success, false);
  assert.equal(TeachingGraphic.safeParse({ ...mapping, pairs: Array.from({ length: 9 }, (_, input) => ({ input, output: 0 })) }).success, false);
});
test('实际函数图可显示与放大，提示模式不提前标注最小值', async () => {
  const svg = graphicSvg(parabola);
  assert.match(svg, /最低点/);
  assert.doesNotMatch(svg, /\(2, 3\)|x = 2/);
  assert.match(graphicSvg({ ...parabola, revealValues: true }), /\(2, 3\)/);
  const metadata = await sharp(await renderGraphic(parabola)).metadata();
  assert.equal(metadata.format, 'png');
  assert.ok(metadata.width! >= 640);
  const shown = await presentDiagram({ title: '看图理解', graphic: parabola, steps: [{ label: '曲线', detail: '开口向上' }, { label: '最低点', detail: '沿曲线观察' }] });
  assert.match(shown.figure!, /^data:image\/png;base64,/);
  assert.throws(() => graphicSvg({ ...parabola, bounds: { ...parabola.bounds, yMax: 2 } }));
});

test('平方关系使用a或t作横轴，图中标签与正文一致且旧图仍默认x/y', () => {
  const square = { ...parabola, b: 0, c: 0, bounds: { xMin: -3, xMax: 3, yMin: -1, yMax: 10 } };
  const svg = graphicSvg({ ...square, xLabel: 'a', yLabel: 'q', revealValues: true });
  assert.match(svg, />a<\/text>/);
  assert.match(svg, />q<\/text>/);
  assert.match(svg, />a = 0<\/text>/);
  assert.doesNotMatch(svg, />x<\/text>|>y<\/text>|>x =/);
  assert.match(graphicSvg(square), />x<\/text>/);
  assert.match(graphicSvg({ ...square, xLabel: '<t>' }), /&lt;t&gt;/);
  assert.throws(() => graphicSvg({ ...square, xLabel: '' }));
});

test('图文复核修复只替换指定图，保留正文和其他图并校验局部范围', () => {
  const diagram = { title: '图', graphic: parabola, steps: [{ label: '看', detail: '观察曲线' }, { label: '想', detail: '联系图像' }] };
  const lesson = Lesson.parse({ title: '平方', sections: ['s1', 's2', 's3'].map((id) => ({ id, heading: id, body: '保持正文' })),
    diagrams: [{ sectionId: 's1', content: diagram }, { sectionId: 's2', content: diagram }] });
  const patch = { diagrams: [{ sectionId: 's2', content: { ...diagram, graphic: { ...parabola, xLabel: 'a' } } }] };
  const repaired = applyLessonRepair(lesson, JSON.stringify(patch), 's2');
  assert.deepEqual(repaired.sections, lesson.sections);
  assert.deepEqual(repaired.diagrams[0], lesson.diagrams[0]);
  assert.equal(repaired.diagrams[1]!.content.graphic!.kind === 'quadratic' && repaired.diagrams[1]!.content.graphic!.xLabel, 'a');
  assert.throws(() => applyLessonRepair(lesson, JSON.stringify(patch), 's1'));
  assert.throws(() => applyLessonRepair(lesson, JSON.stringify({ diagrams: [{ ...patch.diagrams[0], sectionId: 'missing' }] })));
  assert.throws(() => applyLessonRepair(lesson, JSON.stringify({ sections: [] })));
});

test('新讲义不能用纯文字卡冒充图文，也不能指定外部图片地址', () => {
  const input = { title: '看图理解', sections: ['s1','s2','s3'].map((id) => ({ id, heading: id, body: '说明' })), diagrams: [{ sectionId: 's2', content: { title: '示意', steps: [{ label: '一', detail: '说明' }, { label: '二', detail: '说明' }], figure: 'https://untrusted.invalid/a.png' } }] };
  assert.throws(() => parseLesson(JSON.stringify(input)));
  const parsed = parseLesson(JSON.stringify({ ...input, diagrams: [{ ...input.diagrams[0], content: { ...input.diagrams[0]!.content, graphic: parabola } }] }));
  assert.equal(parsed.diagrams[0]!.content.figure, undefined);
  const geometry = graphicSvg({ kind: 'geometry', caption: '线段', points: [{ x: 0, y: 0, label: '<A>' }, { x: 1, y: 1, label: 'B' }], edges: [[0,1]] });
  assert.match(geometry, /&lt;A&gt;/);
  assert.throws(() => graphicSvg({ kind: 'geometry', caption: '无效', points: [{ x: 0, y: 0, label: 'A' }, { x: 1, y: 1, label: 'B' }], edges: [[0,3]] }));
});

test('图文讲义将正文和教学图解作为同一份结构化成果校验', () => {
  const diagram = { title: '配方步骤', steps: [{ label: '凑平方', detail: '找一次项系数的一半', formula: '(x-1)^2' }, { label: '比较常数', detail: '让式子值保持不变' }], takeaway: '平方项非负' };
  assert.equal(Diagram.parse(diagram).steps.length, 2);
  assert.equal(Lesson.parse({ title: '配方法', sections: [
    { id: 's1', heading: '概念', body: '概念' }, { id: 's2', heading: '步骤', body: '步骤' }, { id: 's3', heading: '辨析', body: '辨析' },
  ], diagrams: [{ sectionId: 's2', content: diagram }] }).diagrams[0]?.sectionId, 's2');
  assert.throws(() => Lesson.parse({ title: '配方法', sections: [
    { id: 's1', heading: '概念', body: '概念' }, { id: 's1', heading: '步骤', body: '步骤' }, { id: 's3', heading: '辨析', body: '辨析' },
  ], diagrams: [{ sectionId: 'missing', content: diagram }] }));
});

test('讲义按需支持多幅图，但每节最多一幅且最多三幅', () => {
  const diagram = { title: '示意', graphic: parabola, steps: [{ label: '看', detail: '观察曲线' }, { label: '想', detail: '联系最低点' }] };
  const base = { title: '配方法', sections: [
    { id: 's1', heading: '概念', body: '概念' }, { id: 's2', heading: '看图', body: '步骤' }, { id: 's3', heading: '辨析', body: '辨析' },
  ] };
  assert.equal(Lesson.parse({ ...base, diagrams: [{ sectionId: 's1', content: diagram }, { sectionId: 's2', content: diagram }] }).diagrams.length, 2);
  assert.throws(() => Lesson.parse({ ...base, diagrams: [{ sectionId: 's1', content: diagram }, { sectionId: 's1', content: diagram }] }), /每节最多一幅/);
  assert.throws(() => Lesson.parse({ ...base, diagrams: [diagram, diagram, diagram, diagram].map((content, i) => ({ sectionId: `s${(i % 3) + 1}`, content })) }));
});

test('讲解内容将 Markdown、行内公式和块公式转成受控小程序节点', async () => {
  const blocks = await renderContent('从**配方**开始：$x^2-4x+7$。\n\n$$\\frac{1}{2}+\\sqrt{x}$$');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, 'text');
  assert.match(JSON.stringify(blocks[0]), /配方/);
  assert.match(JSON.stringify(blocks[0]), /data:image\/png;base64/);
  assert.equal(blocks[1]?.kind, 'formula');
  assert.match(blocks[1]?.src ?? '', /^data:image\/png;base64,/);
});

test('非法公式不注入 HTML', async () => {
  const blocks = await renderContent('$$<script>alert(1)</script>$$');
  assert.equal(blocks[0]?.kind, 'formula');
  assert.doesNotMatch(JSON.stringify(blocks), /<script>/);
});

test('加粗结论内的行内公式继续解析，不泄漏截图中的美元定界符', async () => {
  const blocks = await renderContent('因此，**$f(x)$ 的最小值为 $3$，在 $x=2$ 时取得。**');
  const nodes = blocks[0]!.nodes!;
  const strong = nodes[0]!.children!.find((n) => n.name === 'strong')!;
  assert.equal(strong.children!.filter((n) => n.name === 'img').length, 3);
  assert.doesNotMatch(JSON.stringify(nodes), /\$|\*\*/);
});

test('结构化正文、步骤标题和公式按顺序排版，禁止原样输出工具JSON', async () => {
  const { TeachingReply, teachingReplyText } = await import('@luma/shared');
  const reply = TeachingReply.parse([{ type: 'heading', text: '配方' }, { type: 'paragraph', text: '先凑完全平方。' }, { type: 'formula', text: 'f(x)=(x-2)^2+3' }]);
  const blocks = await renderContent('不应显示的旧投影', reply);
  assert.equal(blocks.at(-1)!.kind, 'formula');
  assert.match(JSON.stringify(blocks), /配方/);
  assert.doesNotMatch(JSON.stringify(blocks), /不应显示|\$\$/);
  assert.match(teachingReplyText(reply), /\$\$f\(x\)/);
  assert.throws(() => TeachingReply.parse([{ type: 'html', text: '<script>' }]));
  assert.throws(() => TeachingReply.parse([{ type: 'formula', text: '$x$' }]));
  assert.throws(() => TeachingReply.parse([{ type: 'paragraph', text: { formula: 'x' } }]));
});

test('公式排版失败给明确状态，不把LaTeX源码冒充可读公式', async () => {
  const blocks = await renderContent('仍保留说明。\n\n$$\\badcommand{x}$$');
  assert.equal(blocks.at(-1)!.failed, true);
  assert.match(JSON.stringify(blocks), /公式暂时无法排版/);
  assert.doesNotMatch(JSON.stringify(blocks), /badcommand/);
});

test('选图识别的题干和小问排版保留条件，标题预览不展示公式定界符', async () => {
  const { miniappSandbox } = await import('./helpers/miniapp');
  const { studyPreview } = miniappSandbox().load('@/utils/study-content');
  const question = '1. 已知等差数列 $a_1=3$，公差 $d=2$。\n（1）求 $a_5$；（2）写出通项公式。';
  assert.equal(studyPreview(question), '1. 已知等差数列 a₁=3，公差 d=2。 （1）求 a₅；（2）写出通项公式。');
  assert.equal(studyPreview('求 $\\frac{1}{2}$'), '求 〔公式〕');
  const nodes = (await renderContent(question))[0]!.nodes!;
  const children = nodes.flatMap((node) => node.children ?? []);
  assert.equal(children.filter((node) => node.name === 'img').length, 3);
  assert.match(children.filter((node) => node.type === 'text').map((node) => node.text).join(''), /已知等差数列.*公差.*通项公式/s);
  assert.doesNotMatch(JSON.stringify(nodes), /\$/);
});
