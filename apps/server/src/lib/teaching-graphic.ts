import sharp from 'sharp';
import { TeachingGraphic, type Diagram } from '@luma/shared';
import { ResultCache } from './result-cache';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const number = (n: number) => String(Math.round(n * 100) / 100);
const cache = new ResultCache<Buffer>(32);
export const graphicCacheStats = () => cache.stats();

/** Model supplies mathematical data, never executable markup. Rendering only uses these bounded primitives. */
export function graphicSvg(input: TeachingGraphic): string {
  const g = TeachingGraphic.parse(input);
  const width = 640, height = 470;
  const label = (x: number, y: number, text: string, color = '#687b5a', anchor = 'start') => `<text x="${x}" y="${y}" fill="${color}" font-size="22" text-anchor="${anchor}">${escape(text)}</text>`;
  const line = (x: number, y: number, x2: number, y2: number, color = '#cdd5c3', dash = '') => `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="7 7"' : ''}/>`;
  let content = '';
  if (g.kind === 'quadratic') {
    const b = g.bounds, vx = -g.b / (2 * g.a), vy = g.a * vx * vx + g.b * vx + g.c;
    if (vx <= b.xMin || vx >= b.xMax || vy <= b.yMin || vy >= b.yMax) throw new Error('绘图范围必须包含顶点');
    if (b.xMin >= 0 || b.xMax <= 0 || b.yMin >= 0 || b.yMax <= 0) throw new Error('绘图范围必须包含坐标轴');
    const left = 64, top = 38, right = 590, bottom = 404;
    const px = (x: number) => left + (x - b.xMin) / (b.xMax - b.xMin) * (right - left);
    const py = (y: number) => bottom - (y - b.yMin) / (b.yMax - b.yMin) * (bottom - top);
    const ox = px(0), oy = py(0), cx = px(vx), cy = py(vy);
    content += `<defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs>`;
    content += line(left, oy, right + 6, oy, '#a4b398') + line(ox, bottom, ox, top - 8, '#a4b398');
    content += `<path d="M${right-4},${oy-5} L${right+6},${oy} L${right-4},${oy+5} M${ox-5},${top+2} L${ox},${top-8} L${ox+5},${top+2}" fill="none" stroke="#a4b398" stroke-width="2"/>`;
    content += label(right + 12, oy + 7, 'x') + label(ox - 14, top - 13, 'y') + label(ox - 22, oy + 28, 'O');
    let d = '';
    for (let i = 0; i <= 240; i++) { const x = b.xMin + i / 240 * (b.xMax - b.xMin); const y = g.a*x*x + g.b*x + g.c; d += `${i ? 'L' : 'M'}${px(x).toFixed(2)},${py(y).toFixed(2)} `; }
    content += `<path d="${d}" clip-path="url(#plot)" fill="none" stroke="#617b50" stroke-width="4" stroke-linecap="round"/>`;
    content += line(cx, top + 18, cx, bottom, '#b9a07c', 'dash');
    content += label(cx > right-110 ? cx-12 : cx+12, top+14, g.revealValues ? `x = ${number(vx)}` : '对称轴', '#9f8562', cx > right-110 ? 'end' : 'start');
    content += line(ox, cy, cx, cy, '#b9a07c', 'dash');
    content += `<circle cx="${cx}" cy="${cy}" r="9" fill="#faf9f4" stroke="#a98b5e" stroke-width="3"/>`;
    // The prompt can teach how to find the value without revealing the answer on axes or labels.
    const pointLabel = g.revealValues ? `(${number(vx)}, ${number(vy)})` : g.a > 0 ? '最低点' : '最高点';
    const labelY = Math.abs(cy - oy) < 42 ? cy - 22 : cy + 34;
    content += label(cx + 17, labelY, pointLabel, '#8c744f');
    content += label(320, 454, g.a > 0 ? '沿曲线向下观察，哪里不能再低？' : '沿曲线向上观察，哪里不能再高？', '#7c8d6e', 'middle');
    if (g.revealValues) content += label(ox-12, cy+7, number(vy), '#9f8562', 'end') + label(cx, oy+28, number(vx), '#9f8562', 'middle');
  } else {
    if (g.edges.some(([a,b]) => a >= g.points.length || b >= g.points.length || a === b)) throw new Error('图形连线引用无效');
    const xs = g.points.map((p) => p.x), ys = g.points.map((p) => p.y);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const scale = Math.min(460 / Math.max(xmax-xmin, 1), 300 / Math.max(ymax-ymin, 1));
    const px = (x:number) => 320 + (x-(xmin+xmax)/2)*scale, py = (y:number) => 222 - (y-(ymin+ymax)/2)*scale;
    for (const [a,b] of g.edges) content += line(px(g.points[a]!.x), py(g.points[a]!.y), px(g.points[b]!.x), py(g.points[b]!.y), '#6b835d');
    for (const p of g.points) content += `<circle cx="${px(p.x)}" cy="${py(p.y)}" r="5" fill="#a78c65"/>` + label(px(p.x)+10, py(p.y)-12, p.label);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="640" height="470" rx="12" fill="#faf9f4"/><g font-family="PingFang SC,Heiti SC,sans-serif">${content}</g></svg>`;
}

export async function renderGraphic(graphic: TeachingGraphic): Promise<Buffer> {
  const parsed = TeachingGraphic.parse(graphic);
  const key = 'graphic-v1:' + JSON.stringify(parsed);
  return cache.get(key, () => sharp(Buffer.from(graphicSvg(parsed)), { density: 144 }).png().toBuffer());
}
export async function presentDiagram(diagram: Diagram): Promise<Diagram> {
  if (!diagram.graphic) return diagram;
  try { return { ...diagram, figure: `data:image/png;base64,${(await renderGraphic(diagram.graphic)).toString('base64')}` }; }
  catch { return { ...diagram, figureError: '示意图暂时无法显示，请重新加载' }; }
}
