/** 独立的前端交互示例，不作为真实模型输出，也不写入正式学习记录。 */
export const studyExample = {
  id: 'preview-quadratic',
  title: '换一个角度，看见最小值',
  subject: '已知 f(x) = x² − 2x + 3，求 f(x) 的最小值。',
  intro: '把一个式子换成更容易看懂的样子，最小值就藏在里面。',
  sections: [
    { id: 'concept', heading: '先看懂，什么在变化', body: '当 x 改变时，函数值也在改变。开口向上的抛物线有一个最低点，它的纵坐标就是函数的最小值。\n\n我们要做的，是找到这个最低点，而不是随意代入几个 x 猜答案。', figure: '/static/preview/quadratic.svg', caption: '最低点是 (1, 2)，对应的函数值为 2。', detail: '先把 x 想成一个可以左右移动的点：x 越接近 1，图上的点就越接近最低处。你觉得走到最低处以后，还能继续向下吗？', example: '想象一个碗：从左侧或右侧向碗底移动，高度都会下降。碗底的高度，就是这条曲线所能达到的最低高度。' },
    { id: 'steps', heading: '把式子变成“平方 + 常数”', body: '观察 x² − 2x，它与 (x − 1)² 只差一个常数。\n\n先加上 1，凑出完整平方；再减去 1，保证式子的值不变。', formula: 'x² − 2x + 3 = (x − 1)² + 2', note: '因为 (x − 1)² ≥ 0，所以 f(x) ≥ 2。\n当 x = 1 时，平方项为 0，最小值 2 才真正取到。', detail: '展开 (x − 1)²，会得到 x² − 2x + 1。原式的常数是 3，所以还需要补上多少，才能和原式完全相等？', example: '换成 g(x) = x² − 4x + 7，先想到 (x − 2)² = x² − 4x + 4。还差 3，因此 g(x) = (x − 2)² + 3。你能找到它的最小值吗？' },
    { id: 'pitfall', heading: '别漏掉，最小值何时取到', body: '“最小值为 2”和“x 的最小值为 2”说的是两件不同的事。这里最小的是函数值，不是 x。\n\n完整表达应当同时写出取值条件和结果。', note: '当 x = 1 时，f(x) 取得最小值 2。', detail: '这里有两个量：输入的 x，和输出的 f(x)。把 x = 1 代入原式，算出的 2 属于哪一个量？', example: '对于 h(x) = (x + 2)² + 5，平方项在 x = −2 时等于 0。此时最小的函数值为 5，而不是说 x 的最小值为 5。' },
  ],
  exercises: [
    { id: 'e1', kind: '基础理解', stem: '已知 g(x) = (x − 3)² + 4，求 g(x) 的最小值，并写出取到最小值时 x 的值。', purpose: '区分函数最小值与对应的 x。', hint: '平方项最小可以是多少？它在什么条件下等于这个值？', answer: '当 x = 3 时，g(x) 的最小值为 4。', analysis: '因为 (x − 3)² ≥ 0，所以 g(x) ≥ 4。等号在 x = 3 时成立。' },
    { id: 'e2', kind: '同类变式', stem: '已知 h(x) = x² + 4x + 7，求 h(x) 的最小值。', purpose: '通过配方，把原式改写成平方与常数的和。', hint: '观察 x² + 4x，与 (x + 2)² 比较，还差哪一个常数？', answer: '当 x = −2 时，h(x) 的最小值为 3。', analysis: 'h(x) = x² + 4x + 4 + 3 = (x + 2)² + 3。平方项非负，所以最小值为 3，在 x = −2 时取得。' },
  ],
};

export type StudySection = typeof studyExample.sections[number];
export type StudyRating = 'independent' | 'partial' | 'stuck';

export interface StudyContent {
  id: string; title: string; subject: string; intro: string;
  sections: Array<{ id: string; heading: string; body: string; figure?: string; caption?: string; formula?: string; note?: string; detail: string; example: string }>;
  exercises: Array<{ id: string; kind: string; stem: string; purpose: string; hint: string; answer: string; analysis: string }>;
}
/** 各自独立的受控教学样例，不是对学生图片的真实识别或模型生成。 */
export const studyExamples: Record<string, StudyContent> = {
  quadratic: studyExample,
  sets: {
    id: 'preview-sets-material', title: '把两个条件，放在一起看', subject: '已知 A = {1, 2, 3}，B = {2, 3, 4}，求 A ∩ B 与 A ∪ B。', intro: '先判断元素满足哪个条件，再决定留下哪些元素。',
    sections: [
      { id: 'concept', heading: '交集：两个条件都满足', body: '交集保留同时属于 A 和 B 的元素。2 和 3 在两个集合中都出现，因此 A ∩ B = {2, 3}。', detail: '逐个检查：1 是否也在 B 中？2 和 3 呢？', example: '既喜欢数学又喜欢物理的同学，属于这两个集合的交集。' },
      { id: 'steps', heading: '并集：至少满足一个条件', body: '并集收集属于 A 或属于 B 的元素。重复元素只写一次，所以 A ∪ B = {1, 2, 3, 4}。', detail: '先写 A 的元素，再补上 B 中还没有写过的元素。', example: 'A = {a, b}，B = {b, c}，并集是 {a, b, c}，b 不需要重复写。' },
      { id: 'pitfall', heading: '或者，也包括同时满足', body: '数学中的“或者”允许两个条件同时成立；并集也包含交集中的元素。', note: '交集是“并且”，并集是“至少一个”。', detail: '如果一个元素同时在 A 和 B 中，它满足“至少在一个集合中”吗？', example: '既喜欢数学又喜欢物理，也属于“喜欢数学或物理”的同学。' },
    ],
    exercises: [
      { id: 'e1', kind: '基础理解', stem: 'A = {1, 3, 5}，B = {3, 5, 7}，求 A ∩ B。', purpose: '找出同时满足两个条件的元素。', hint: '哪些元素在两个集合中都出现？', answer: '{3, 5}。', analysis: '3 和 5 同时属于 A、B；1 不属于 B，7 不属于 A。' },
      { id: 'e2', kind: '同类变式', stem: 'A = {a, b}，B = {b, c}，求 A ∪ B。', purpose: '合并元素并去掉重复。', hint: '先写 A，再补 B 中新出现的元素。', answer: '{a, b, c}。', analysis: 'a、b、c 至少属于一个集合，b 只写一次。' },
    ],
  },
  inequality: {
    id: 'preview-inequality', title: '为什么乘负数，要换个方向', subject: '解不等式 −2x + 4 > 0，并说明除以负数时不等号如何变化。', intro: '把每一步对等式两边的影响看清楚。',
    sections: [
      { id: 'concept', heading: '先把含 x 的项留下', body: '两边同时减去 4，得到 −2x > −4。加减同一个数，不等号方向不变。', detail: '为了消去左侧的 +4，需要两边同时做什么？', example: 'x + 3 > 5，两边同时减去 3，得到 x > 2。' },
      { id: 'steps', heading: '除以负数，顺序反过来', body: '两边同时除以 −2，不等号方向反转，得到 x < 2。', formula: '−2x > −4  ⇒  x < 2', detail: '比较 1 < 2，乘以 −1 后变成 −1 > −2。你能看到大小顺序反转了吗？', example: '−3x ≤ 6，两边除以 −3，得到 x ≥ −2。' },
      { id: 'pitfall', heading: '代一个数，检查方向', body: '代入 x = 0，原式为 4 > 0，成立；代入 x = 3，原式为 −2 > 0，不成立。与 x < 2 一致。', note: '乘除负数才反向；移项本身不是反向的原因。', detail: '把 x = 2 代入后是 0 > 0，等号能取到吗？', example: '严格不等号 > 不包含边界，因此 x = 2 不在解集中。' },
    ],
    exercises: [
      { id: 'e1', kind: '基础理解', stem: '解不等式 −3x > 6。', purpose: '判断除以负数后的不等号方向。', hint: '除以 −3 后，方向要怎样变？', answer: 'x < −2。', analysis: '两边同除以 −3，不等号反向，得到 x < −2。' },
      { id: 'e2', kind: '同类变式', stem: '解不等式 2 − x ≥ 5。', purpose: '先移项，再处理负系数。', hint: '先减去 2，得到 −x ≥ 3。', answer: 'x ≤ −3。', analysis: '由 −x ≥ 3，两边乘以 −1 并反向，得到 x ≤ −3。' },
    ],
  },
};
