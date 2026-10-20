/**
 * 时钟进度环 · 构建产物视觉验证（人工看，不进 CI）。
 *
 * ## 为什么需要它
 *
 * 设计评审阶段的 demo 是**手写**的，改完实现后二者必然漂移 —— 本项目已经踩过
 * 一次：classic 点阵时钟的 demo SVG 是按记忆"重画"的，与源码实际坐标不符，
 * 导致评审结论建立在错误图形上。
 *
 * 本脚本从 `lib/client.js` 里把**真实的 CSS 字符串数组**与**真实的
 * CLOCK_SVG_MODERN 模板**抠出来（不是手抄），再用真实的 `progressOf()` 算比例，
 * 拼成一份对照页。页面上每个环都等于线上会渲染出来的东西。
 *
 * ## 用法
 *
 *     npm run build && node scripts/verify-clock-progress.mjs
 *     # 打开 docs/clock-progress-verify.html
 *
 * ## 注意
 *
 * 它按字符串形态抠产物内部结构（esbuild 的引号选择、变量名），**故意不做健壮化**：
 * 一旦抠不到就抛错，而不是静默生成一张空表 —— 静默成功比失败更危险。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { progressOf, summarizeSchedules } from '../lib/presence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8');

// ---------- 1. 抠 .ss-presence 系的 CSS（产物里是字符串数组） ----------
const cssAnchor = clientSrc.indexOf('".ss-presence { display: inline-flex');
if (cssAnchor < 0) throw new Error('未找到 CSS 锚点：lib/client.js 的产物形态变了？');
const cssStart = clientSrc.lastIndexOf('\n', cssAnchor) + 1;
const cssParts = [];
for (const line of clientSrc.slice(cssStart, cssStart + 8000).split('\n')) {
  // esbuild 按内容选引号：串里本来就有双引号的（如 [data-state="urgent"]）会被单引号
  // 包裹，两种形态都要认，否则提取会在第 8 行静默截断。
  const m = line.match(/^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'),?\s*$/);
  if (!m) break;
  const raw = m[1] !== undefined ? m[1] : m[2].replace(/"/g, '\\"');
  // 越出 .ss-presence 段（后面是悬浮卡片那批）就停：那边的注释含 \xNN 这类 JSON
  // 不认的转义，继续解会抛，而本页不需要它们。
  if (/悬浮卡片|_dot/.test(raw)) break;
  cssParts.push(JSON.parse(`"${raw}"`));
}
if (cssParts.length === 0) throw new Error('CSS 提取为空');
const css = cssParts.join('\n');

// ---------- 2. 抠 CLOCK_SVG_MODERN 模板并求值 ----------
const svgStart = clientSrc.indexOf('var CLOCK_FACE_R = 9.5;');
if (svgStart < 0) throw new Error('未找到 SVG 锚点：CLOCK_FACE_R 被改名了？');
const mark = '</g></svg>`;';
const svgEnd = clientSrc.indexOf(mark, svgStart) + mark.length;
const CLOCK_SVG_MODERN = new Function(clientSrc.slice(svgStart, svgEnd) + '; return CLOCK_SVG_MODERN;')();
const CIRC = 2 * Math.PI * 9.5;

console.log('[提取] CSS 规则行数:', cssParts.length);
console.log('[自检] 初始 offset 是满周长(0%):', /stroke-dashoffset="59\.690"/.test(CLOCK_SVG_MODERN));
console.log('[自检] track + prog 双环都在:', /ss-clock-track/.test(CLOCK_SVG_MODERN), /ss-clock-prog/.test(CLOCK_SVG_MODERN));

// ---------- 3. 用真实逻辑核对三种 kind 的进度口径 ----------
const NOW = Date.parse('2026-09-05T12:00:00Z');
const iso = (ms) => new Date(NOW + ms).toISOString();
const after = summarizeSchedules([{ scheduled_at: iso(600_000), kind: 'after', after_seconds: 600 }]);
const every = summarizeSchedules([{ scheduled_at: iso(30_000), kind: 'every', every_seconds: 300 }]);
const at = summarizeSchedules([{ scheduled_at: iso(3_600_000), kind: 'at', created_at: iso(-1_800_000) }]);
const none = summarizeSchedules([{ scheduled_at: iso(60_000), kind: 'at' }]);
const checks = [
  ['after 半程', progressOf(after, NOW + 300_000), 0.5],
  ['after 超时夹住', progressOf(after, NOW + 900_000), 1],
  ['every 半程', progressOf(every, NOW + 30_000 - 150_000), 0.5],
  ['at 三分之一', progressOf(at, NOW), 1 / 3],
  ['无窗口 → undefined', progressOf(none, NOW), undefined],
  ['暂停项 → undefined', progressOf({ count: 1, pausedCount: 1 }, NOW), undefined],
];
let bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`[逻辑] ${name}: ${got} (期望 ${want}) ${ok ? '✓' : '✗'}`);
}
if (bad > 0) throw new Error(`进度口径有 ${bad} 项不符，先修逻辑再看图`);

// ---------- 4. 拼对照页 ----------
const svgAt = (ratio) => {
  if (ratio === undefined) {
    // 无进度 = 隐藏进度弧，只剩 track —— 即改造前的单环观感
    return CLOCK_SVG_MODERN.replace(/<circle class="ss-clock-prog"[^>]*\/>/, '');
  }
  const off = (CIRC * (1 - ratio)).toFixed(3);
  return CLOCK_SVG_MODERN.replace(/stroke-dashoffset="[\d.]+"/, `stroke-dashoffset="${off}"`);
};

const STATES = [['scheduled', '正常排期'], ['urgent', '紧急 ≤5min'], ['overdue', '到期未派发']];
const COLS = [[undefined, '无进度（弧隐藏）'], [0, '0%'], [0.25, '25%'], [0.6, '60%'], [1, '100%']];

const rows = STATES.map(([st, name]) => `
  <tr>
    <th>${name}<br><code>${st}</code></th>
    ${COLS.map(([r, lbl]) => `
      <td>
        <div class="cell">
          <span class="ss-presence" data-state="${st}" role="img" aria-label="x">${svgAt(r)}</span>
          <span class="ss-presence big" data-state="${st}" role="img" aria-label="x">${svgAt(r)}</span>
        </div>
        <div class="lbl">${lbl}</div>
      </td>`).join('')}
  </tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>dsh-later 进度环 · 产物验证</title>
<style>
:root{
  --ds-ease-in-out: cubic-bezier(.4,0,.2,1);
  --dsw-alias-state-warn-secondary:#f59e0b;
  --dsw-alias-state-error-primary:#f25a5a;
}
body{background:#13131d;color:#e8e8f2;font-family:-apple-system,'Noto Sans SC',sans-serif;padding:32px 36px}
h1{font-size:20px;margin-bottom:8px}
p.sub{color:#8a8aa6;font-size:12.5px;margin-bottom:24px;line-height:1.75}
p.sub code{background:#25253a;padding:1px 6px;border-radius:4px;color:#b9c8e8}
table{border-collapse:collapse}
th,td{border:1px solid #32324a;padding:14px 20px;text-align:center;vertical-align:middle}
th{background:#1c1c2a;font-size:12.5px;font-weight:600}
th code{color:#8a8aa6;font-size:10.5px;font-weight:400}
td .cell{display:flex;align-items:center;justify-content:center;gap:22px;margin-bottom:9px}
td .lbl{font-size:10.5px;color:#6e6e8a}
.ss-presence.big svg{width:46px;height:46px}
${css}
</style></head>
<body>
<h1>dsh-later 进度环 · 构建产物验证</h1>
<p class="sub">CSS 与 SVG 均由 <code>scripts/verify-clock-progress.mjs</code> 从 <code>lib/client.js</code> 提取，比例经真实 <code>progressOf()</code> 计算后内联。<br>
每格左侧为 <b>14px 实际尺寸</b>，右侧为放大对照。「无进度」列是进度弧被隐藏后的退化态 —— 应与改造前的单环观感完全一致。</p>
<table>
  <tr><th></th>${COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr>
  ${rows}
</table>
</body></html>`;

const out = path.join(ROOT, 'docs/clock-progress-verify.html');
fs.writeFileSync(out, html);
console.log('[输出]', path.relative(ROOT, out));
