import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import sharp from 'sharp';
import type { ContentBlock, RichNode } from '@luma/shared';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
// No network, HTML, link or user macro packages. MathJax typesets formulas; it does not create teaching figures.
const document = mathjax.document('', { InputJax: new TeX({ packages: AllPackages.filter((p) => !['html', 'autoload', 'require', 'newcommand', 'configmacros'].includes(p)), maxBuffer: 2000 }), OutputJax: new SVG({ fontCache: 'none' }) });
const cache = new Map<string, { src: string; width: number; height: number }>();
export async function renderFormula(latex: string, display = false) {
  if (latex.length > 1500) throw new Error('公式过长');
  const key = `${display}:${latex}`;
  if (cache.has(key)) return cache.get(key)!;
  const root = document.convert(latex, { display, em: 16, ex: 8, containerWidth: 600 });
  if (adaptor.outerHTML(root).includes('data-mjx-error')) throw new Error('公式无法排版');
  const svg = adaptor.firstChild(root);
  if (!svg || typeof svg === 'string') throw new Error('公式无法排版');
  let source = adaptor.outerHTML(svg as any);
  const viewBox = source.match(/viewBox="([^"]+)"/)?.[1]?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2]! <= 0 || viewBox[3]! <= 0) throw new Error('公式尺寸无效');
  const width = Math.ceil(viewBox[2]! * .018), height = Math.ceil(viewBox[3]! * .018);
  if (width > 2400 || height > 400) throw new Error('公式过大');
  source = source.replace(/width="[^"]+"/, `width="${width * 2}"`).replace(/height="[^"]+"/, `height="${height * 2}"`).replace(/currentColor/g, '#354a37');
  const png = await sharp(Buffer.from(source)).png().toBuffer();
  const result = { src: `data:image/png;base64,${png.toString('base64')}`, width, height };
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, result); return result;
}

async function inline(text: string): Promise<RichNode[]> {
  const parts = text.split(/(\$[^$\n]+\$|\\\([^\n]*?\\\)|\*\*[^*]+\*\*)/g).filter(Boolean);
  return Promise.all(parts.map(async (part): Promise<RichNode> => {
    if ((part.startsWith('$') && part.endsWith('$')) || (part.startsWith('\\(') && part.endsWith('\\)'))) {
      const latex = part.startsWith('$') ? part.slice(1, -1) : part.slice(2, -2);
      try { const img = await renderFormula(latex); return { name: 'img', attrs: { src: img.src, style: `width:${img.width}px;height:${img.height}px;vertical-align:middle;`, alt: latex } }; }
      catch { return { type: 'text', text: latex }; }
    }
    if (part.startsWith('**') && part.endsWith('**')) return { name: 'strong', attrs: { style: 'font-weight:600;color:#40543e;' }, children: [{ type: 'text', text: part.slice(2, -2) }] };
    return { type: 'text', text: part };
  }));
}
export async function renderContent(text: string): Promise<ContentBlock[]> {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g).filter(Boolean);
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    if (part.startsWith('$$') || part.startsWith('\\[')) {
      const latex = part.slice(2, -2);
      const fallback = latex.replace(/<[^>]*>/g, '');
      try { blocks.push({ kind: 'formula', ...await renderFormula(latex, true), fallback }); }
      catch { blocks.push({ kind: 'text', nodes: [{ type: 'text', text: fallback }] }); }
    } else {
      const nodes: RichNode[] = [];
      for (const paragraph of part.split(/\n\s*\n/).filter(Boolean)) {
        const heading = /^#{1,4}\s+/.test(paragraph);
        nodes.push({ name: 'p', attrs: { style: `margin:0 0 12px;white-space:pre-wrap;word-break:break-word;${heading ? 'font-weight:600;' : ''}` }, children: await inline(paragraph.replace(/^#{1,4}\s+/gm, '').replace(/^[-*] /gm, '• ')) });
      }
      blocks.push({ kind: 'text', nodes });
    }
  }
  return blocks;
}
