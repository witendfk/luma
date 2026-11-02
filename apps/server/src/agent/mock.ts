/**
 * 联调回退响应：未配置模型凭据时保持教学形态可走通（识别核对 / 引导 / 解析）。
 * 仅在无 OPENAI_API_KEY 时使用，交付环境必须配置模型。
 */
export function mockClarify(subjectText: string): string {
  return [
    '题目收到了，请你对照核对：',
    '',
    subjectText || '（未提取到题干文本）',
    '',
    '- 无误的话点击「内容正确，开始学习」；',
    '- 有误请先修改核对内容，再开始学习。',
  ].join('\n');
}

export function mockGuide(userText: string): string {
  return [
    '（联调提示）先别急着算。',
    userText ? `你刚才说到「${userText.slice(0, 40)}」——` : '',
    '想一想：这道题的关键量是什么？它受哪些条件限制？',
    '说说你的初步想法，我再带你往下走一步。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function mockSolution(): string {
  return [
    '建议先自己推一遍，再看下面的解析。',
    '',
    '（联调占位解析）此处应包含：条件检查 → 分步推导 → 结论。',
    '配置 GPT 凭据后由模型按已确认题干生成完整解析。',
  ].join('\n');
}

/** 把文本切成小块，模拟流式输出节奏 */
export function mockChunks(text: string): string[] {
  const size = 24;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
