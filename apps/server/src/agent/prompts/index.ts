import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 提示词独立维护于代码仓库，运行记录保存所用版本（设计文档 §5.1）。
 * 结构：system.md 公共规则 + 各任务规则文件；每轮按任务装配。
 */
export const PROMPT_VERSION = '0.2.0';

const PROMPT_DIR = path.join(process.cwd(), 'src', 'agent', 'prompts');

export async function loadPrompt(name: string): Promise<string> {
  return readFile(path.join(PROMPT_DIR, `${name}.md`), 'utf8');
}
