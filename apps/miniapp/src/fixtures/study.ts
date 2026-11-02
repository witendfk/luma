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
