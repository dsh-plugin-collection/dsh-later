/**
 * B3（栈内位置契约）的现场采集与像素结论：起一个**自己的** headless chromium，把
 * `docs/dock-stacking-demo.html` 的五个现场（每种现场左=B2 判据、右=B3 判据）截成图，
 * 并用本目录 `criteria.mjs` 那**同一把尺**给出结论。
 *
 * 为什么不并进 `capture-demo.mjs`（复用优先，但这里复用会扭曲那个脚本）：
 *  - `capture-demo.mjs` 的 MATRIX 与 `docs/media/seam-matrix/manifest.json` 是 #41/#42
 *    **已入库的历史证据**，8 帧的计数被 `tests/seam-pixel-criteria.test.mjs` 钉住
 *    （`matrix.length === 8`、`checked === 6`）；把 B3 的 10 个半区塞进同一份 manifest，
 *    等于同时改坏那条断言和「历史基线一帧不动」的约定（实测：B3 段插在 solo 之前
 *    会让 solo 的两张基线帧因滚动相位变化而 ±1 通道抖动，故 B3 段已挪到全页最后）。
 *  - 两者的实验形状也不同：那边是「一个 scheme × 若干档位 → 逐帧判据」，
 *    这边是「一个现场 × 两套判据 → 成对照齐 + 差异落在哪一行」。
 *  复用的是**判据与口径**：同一组 criteria 函数、同一套双锚点（上段底边 + 我们顶边）、
 *  同一 band=24、同样 DPR=1，所以新旧结论同一把尺可比。
 *
 * 为什么存在：#42 §3 判据 4 要「四种现场各有截图与像素结论」。「有图可看」不等于
 * 「人眼看过了」，所以每个现场同时产出：截图 + 计算值读数 + 判据结论（方角/圆角、
 * 接缝带有无横线、判据换形前后的像素差与差异行）。结论写成可核对的数字，不写「看着没问题」。
 * 现场与应然之间每一条不符都会让本脚本非零退出 —— 它不是出图器，是判据执行器。
 *
 * **这条判据不在 CI 里**：它要浏览器，CI（`node:22` 容器）没有。CI 内守的是三条结构判据
 * （B3 与 styles.ts 同源、复刻渲染器形状、五现场都在），见 `tests/dock-tube-seam.test.mjs`。
 * 本脚本是**手工复核**用的：改了 demo 或宿主升级后跑一次，产物落 /tmp（不进仓）。
 *
 * ## 三条写死在代码里的坑（都是实测踩到的，别再退回旧写法）
 *
 *  1. **clip 用视口坐标，而 `getBoundingClientRect()` 已经是视口坐标。**
 *     再减一次 `scrollY` 会把裁框推到视口之外，实测截出 2px 高的空条，
 *     于是「逐像素相同」对一张空图返回成功 —— 典型假绿。本文件全程用 rect 原值，
 *     只做 `Math.max(0, …)` 夹进视口，不做任何坐标换算。
 *  2. **不能拿左右两半在页面上的原位截图直接比像素。** 两半位于不同的 x，
 *     字形与 .5px 描边落在不同的设备像素相位上，实测「应相同」的两半也差 6~1400 像素。
 *     所以像素对照前先把**一个**现场半区孤立出来（其余 display:none、栅格改单列、
 *     容器宽钉成整数 720px），两半落在**同一个 rect** 上；再显式断言两次取样的
 *     left/top/width 逐位相等 —— 对不齐就判无效，不硬说「相同」。
 *  3. **`getComputedStyle(el,'::after')` 在节点刚渲染后的若干帧里返回未生成的假值**
 *     （content:"normal"、border-top-style:none）。拿假值比两半会两边同假而判成相同。
 *     所以轮询到每个 `.ss-dock-body` 的 `::after.content === '\"\"'` **且**连续两帧
 *     几何/计算值签名一致才算稳定，并把等待条件与耗时写进 evidence；不稳定直接拒绝出结论。
 *
 * 用法（仓库根）：
 *   node scripts/seam-check/capture-b3-scenes.mjs [--out /tmp/seam-b3-shots] [--rows 1|3] [--theme dark|light]
 * 产物默认落 /tmp：采集图与 evidence.json 是**手工复核的中间产物**，不进仓（要留证据走
 * docs/media 那套既有口径，与本仓 #41/#42 的矩阵一致）。
 * @module dsh-later/scripts/seam-check/capture-b3-scenes
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DEMO = path.join(REPO, 'docs', 'dock-stacking-demo.html');

const { decodePngRgb } = await import(new URL('../../scripts/seam-check/png.mjs', import.meta.url).pathname);
const { assertPixelIdentical, detectRoundedTopCorners, detectSeamLine } =
  await import(new URL('../../scripts/seam-check/criteria.mjs', import.meta.url).pathname);

/**
 * 五个现场 + 每个现场的**应然**。`want` 是「这套判据在该现场该画出什么顶边」，
 * 逐条来自 docs/notes/dock-stack-contract.md §2 的一致性表与 §4。
 *
 * `same` 是「B2 判据 ↔ B3 判据在同一现场应不应该逐像素相同」，分两个口径：
 *  `tube`（顶边带：上段面板顶 → 我们面板底）与 `stack`（整段，含下方邻居与 composer）。
 *  现场 5 两半的**顶边描边**确实相同，但 tube 带收到我们的**底边**，而 B2 的 -9px 恰恰让下段
 *  压回我们底边 3px（实测该带 diff=1845/28796，差异行 41..45/46 —— 全在底部 5 行内）——
 *  所以两个口径都期望有差异，但差异**必须**只出现在底部带（`band: 'bottom'`）。
 *  这条是实测校正出来的，不是先验设定：我先按「顶边带应相同」写，跑出来 1845 像素差，
 *  查差异行才确认它落在最后 5 行，于是把结论改成「差异只许在底边」——比原来的说法更硬。
 */
const SCENES = [
  { scene: '1', name: '独存（栈里只有我们）', want: { B2: 'round', B3: 'round' }, same: { tube: true, stack: true } },
  { scene: '2', name: '上方=宿主队列条 [data-queue-dock]', want: { B2: 'square', B3: 'square' }, same: { tube: true, stack: true } },
  { scene: '3', name: '上方=非队列的别的 dock（关键对照）', want: { B2: 'round', B3: 'square' }, same: { tube: false, stack: false }, band: 'top' },
  { scene: '4', name: '上方=崩溃空锚点 [data-slot-error]（已知降级）', want: { B2: 'round', B3: 'square' }, same: { tube: false, stack: false }, band: 'top', degradation: true },
  { scene: '5', name: '我们不在栈底（下面还有一条 dock）', want: { B2: 'round', B3: 'round' }, same: { tube: false, stack: false }, band: 'bottom' },
];

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const OUT_DIR = path.resolve(arg('out', '/tmp/seam-b3-shots')); // 采集产物不进仓（#42 证据走 docs/media，本段是手工复核）
const ROWS = Number(arg('rows', 1));
const THEME = arg('theme', 'dark');
const ISOLATE_WIDTH = 720; // 整数宽：让两半落在同一设备像素相位上（见文件头第 2 条）

/**
 * playwright **只在真要跑的时候加载**：CI 里没有它，判据测试不需要这个脚本可运行
 * （口径同 `capture.mjs`，也正是本脚本的像素 AE 不进 CI 的原因 —— AE 与 CI 是同一件事）。
 * 解析顺序：① 标准包名解析（本仓或上层 node_modules 装了就直接用）；② `PLAYWRIGHT_MODULE`
 * 指一份现成的副本。两条都不通就打印一句可执行的提示并以非 0 退出 ——
 * 不把某台机器的绝对路径写进仓内脚本（上一版就是这么写的，别人机器上是死路）。
 */
async function loadChromium() {
  try {
    // eslint-disable-next-line import/no-unresolved
    return (await import('playwright')).chromium;
  } catch {
    const override = process.env.PLAYWRIGHT_MODULE;
    if (override) {
      const req = createRequire(import.meta.url);
      try { return req(override).chromium; } catch { /* 落到统一报错 */ }
    }
    console.error('✗ 找不到 playwright。二选一：\n'
      + '  1) 装一份：npm i -D playwright && npx playwright install chromium\n'
      + '  2) 指一份现成的：PLAYWRIGHT_MODULE=/绝对路径/playwright node scripts/seam-check/capture-b3-scenes.mjs\n'
      + '（本仓运行时零依赖，playwright 只服务于手工采集，不参与 CI。）');
    process.exit(1);
  }
}

/** 孤立某个现场的某一半，并把它钉在固定视口位置上（两半取样的 rect 因此可逐位对齐）。 */
function isolateInPage({ scene, impl, width }) {
  document.querySelectorAll('style[data-cap]').forEach((s) => s.remove());
  const css = `
    .schemes{max-width:${width}px!important;width:${width}px!important}
    .b3-scene{display:none!important}
    .b3-scene[data-b3-scene="${scene}"]{display:flex!important}
    .b3-scene[data-b3-scene="${scene}"] .b3-duo{display:block!important}
    .b3-scene[data-b3-scene="${scene}"] .b3-duo>.scheme{display:none!important}
    .b3-scene[data-b3-scene="${scene}"] .b3-duo>.scheme[data-impl="${impl}"]{display:block!important}
    body{padding-bottom:3000px!important}`;
  const tag = document.createElement('style');
  tag.setAttribute('data-cap', '1');
  tag.textContent = css;
  document.head.appendChild(tag);
  const pane = document.querySelector(`.b3-duo > .scheme[data-scene="${scene}"][data-impl="${impl}"]`);
  if (!pane) return { error: '找不到现场半区' };
  const before = pane.getBoundingClientRect();
  window.scrollTo(0, Math.round(window.scrollY + before.top - 120));
  /* padding-bottom 那 3000px 不是装饰：B3 段挪到全页最后之后，最后一个现场（⑤）
     想滚到固定 y 会撞上 maxScroll，而两半的总高正好差那 9px 让位边距 ——
     浏览器钳制滚动 → 两半落在不同 rect 上（实测 839.313 vs 830.313），
     像素对照当场无效。留出滚动余量，让"对齐"这件事不依赖页面还剩多少可滚。 */
  const after = pane.getBoundingClientRect();
  return { drift: +(after.top - 120).toFixed(3), left: +after.left.toFixed(3) };
}

/** 页内取样：形状 + 计算值 + 两套判据真值 + 截图用的矩形（视口坐标原值，不做换算）。 */
function sampleInPage() {
  const out = [];
  document.querySelectorAll('.b3-duo > .scheme').forEach((pane) => {
    if (pane.offsetParent === null && getComputedStyle(pane).display === 'none') return; // 被孤立的另一半不取
    const root = pane.querySelector('[data-ss-dock]');
    const body = pane.querySelector('[data-ss-body]');
    const stack = pane.querySelector('[data-stack]');
    const composer = pane.querySelector('.host-composer');
    if (!root || !body || !stack) return;
    const after = getComputedStyle(body, '::after');
    const anchor = root.parentElement;
    const above = pane.querySelector('[data-host-panel], [data-above-panel]');
    const errorAnchor = pane.querySelector('[data-slot-error]');
    const lower = pane.querySelector('[data-lower-dock]');
    const prev = root.previousElementSibling;
    const attrOf = (el) => (!el ? null : el.hasAttribute('data-queue-dock') ? 'data-queue-dock'
      : el.hasAttribute('data-other-dock') ? 'data-other-dock'
      : el.hasAttribute('data-slot-error') ? 'data-slot-error' : (el.getAttribute('data-slot') ?? 'other'));
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
    const ss = r(body);
    out.push({
      scene: pane.dataset.scene,
      impl: pane.dataset.impl,
      shape: {
        anchorDataSlot: anchor ? anchor.getAttribute('data-slot') : null,
        anchorDisplay: anchor ? getComputedStyle(anchor).display : null,
        siblingCount: anchor ? anchor.children.length : 0,
        indexOfOurs: anchor ? [...anchor.children].indexOf(root) : -1,
        isFirst: root.matches(':first-child'),
        isLast: root.matches(':last-child'),
        prevSibling: attrOf(prev),
        nextSibling: attrOf(root.nextElementSibling),
        errorAnchorPresent: !!errorAnchor,
        errorAnchorHeight: errorAnchor ? +errorAnchor.getBoundingClientRect().height.toFixed(2) : null,
      },
      computed: {
        topRadius: getComputedStyle(body).borderTopLeftRadius,
        topBorderWidth: after.borderTopWidth,
        topBorderStyle: after.borderTopStyle,
        afterContent: after.content,
        afterGenerated: after.content === '""' || after.content === "''",
        marginBottom: getComputedStyle(root).marginBottom,
      },
      criteria: {
        sniffHit: prev ? prev.hasAttribute('data-queue-dock') : false,
        positionHit: body.matches('[data-slot="conversation.input.dock"] > .ss-dock-root:not(:first-child) .ss-dock-body'),
        notLastHit: root.matches('[data-slot="conversation.input.dock"] > .ss-dock-root:not(:last-child)'),
      },
      observed: (Number.parseFloat(getComputedStyle(body).borderTopLeftRadius) || 0) === 0 ? 'square' : 'round',
      rects: { stack: r(stack), ssBody: ss, above: above ? r(above) : null, lower: lower ? r(lower) : null, composer: composer ? r(composer) : null },
      overlap: above ? +(above.getBoundingClientRect().bottom - ss.top).toFixed(1) : null,
    });
  });
  return { panes: out, viewport: { w: innerWidth, h: innerHeight }, dpr: devicePixelRatio };
}

/** 稳定条件：所有可见 .ss-dock-body 的 ::after 已生成，且连续两帧几何/计算值签名一致。 */
const STABLE_FN = () => {
  const bodies = [...document.querySelectorAll('.b3-duo > .scheme [data-ss-body]')]
    .filter((b) => b.getClientRects().length > 0);
  const allGenerated = bodies.length > 0 && bodies.every((b) => {
    const c = getComputedStyle(b, '::after').content;
    return c === '""' || c === "''";
  });
  const sig = bodies.map((b) => {
    const pane = b.closest('.scheme');
    const rect = b.getBoundingClientRect();
    const s = getComputedStyle(b);
    const a = getComputedStyle(b, '::after');
    const m = getComputedStyle(pane.querySelector('[data-ss-dock]'));
    return `${pane.dataset.scene}:${pane.dataset.impl}:${rect.top.toFixed(2)}:${rect.width.toFixed(2)}:${s.borderTopLeftRadius}:${a.borderTopWidth}:${m.marginBottom}`;
  }).join('|');
  return { allGenerated, sig, count: bodies.length };
};

/**
 * 两图的差异**落在哪些行**：只报 diffPixels 不够 —— 现场 5 要求「差别只在底边」，
 * 现场 ③④ 要求「差别就在顶边带」，两个都是位置结论，不是数量结论。
 */
function diffRows(a, b) {
  if (a.width !== b.width || a.height !== b.height) return null;
  let first = null; let last = null; let count = 0;
  for (let y = 0; y < a.height; y += 1) {
    let row = 0;
    for (let x = 0; x < a.width; x += 1) {
      const p = (y * a.width + x) * 3;
      if (a.data[p] !== b.data[p] || a.data[p + 1] !== b.data[p + 1] || a.data[p + 2] !== b.data[p + 2]) row += 1;
    }
    if (row > 0) {
      if (first === null) first = y;
      last = y; count += row;
    }
  }
  return { first, last, count, height: a.height };
}

const clip = (x, y, w, h) => ({
  x: Math.round(Math.max(0, x)), y: Math.round(Math.max(0, y)),
  width: Math.round(w), height: Math.max(1, Math.round(h)),
});

async function captureScene(page, sc, impl) {
  await page.evaluate(isolateInPage, { scene: sc.scene, impl, width: ISOLATE_WIDTH });
  const t0 = Date.now();
  let prev = null; let stableFrames = 0; let st = null;
  while (Date.now() - t0 < 15000) {
    st = await page.evaluate(STABLE_FN);
    if (st.allGenerated && prev === st.sig) stableFrames += 1; else stableFrames = 0;
    prev = st.sig;
    if (stableFrames >= 2) break;
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(res)));
  }
  if (!st.allGenerated) throw new Error(`现场 ${sc.scene}/${impl}：::after 未生成（等了 ${Date.now() - t0}ms），拒绝在假值上出结论`);
  const sample = await page.evaluate(sampleInPage);
  const p = sample.panes.find((x) => x.scene === sc.scene && x.impl === impl);
  if (!p) throw new Error(`现场 ${sc.scene}/${impl}：取样失败（data-* 或形状漂了）`);
  p.waitedMs = Date.now() - t0;

  const R = p.rects;
  const vh = sample.viewport.h;
  const f = (name) => path.join(OUT_DIR, `scene${sc.scene}-${impl}-${name}.png`);
  const stackFile = f('stack');
  await page.screenshot({ path: stackFile, clip: clip(R.stack.left - 2, R.stack.top - 2, R.stack.width + 4, Math.min(R.stack.height + 4, vh - R.stack.top)) });
  const from = (R.above ? R.above.top : R.ssBody.top) - 2;
  const tubeY = Math.max(0, from);
  const tubeFile = f('tube');
  await page.screenshot({ path: tubeFile, clip: clip(R.ssBody.left - 2, tubeY, R.ssBody.width + 4, R.ssBody.bottom + 2 - tubeY) });

  let seamFile = null; let seam = null;
  if (R.above) {
    const lo = Math.round(R.above.bottom); const hi = Math.round(R.ssBody.top);
    const y0 = Math.max(0, Math.min(lo, hi) - 24);
    const y1 = Math.min(vh, Math.max(lo, hi) + 24);
    if (y1 - y0 > 8) {
      seamFile = f('seam');
      await page.screenshot({ path: seamFile, clip: clip(R.ssBody.left, y0, R.ssBody.width, y1 - y0) });
      const img = decodePngRgb(seamFile);
      const uniq = [...new Set([lo - y0, hi - y0])].filter((v) => v >= 0 && v < img.height);
      const res = detectSeamLine(img, { seams: uniq });
      seam = { pass: res.pass, worstSpanPct: +(res.worst.spanRatio * 100).toFixed(1), worstRow: res.worst.y, anchors: uniq, crop: [img.width, img.height] };
    }
  }
  const tubeImg = decodePngRgb(tubeFile);
  const topYinTube = Math.round(R.ssBody.top - tubeY);
  const corners = { ...detectRoundedTopCorners(tubeImg, { topY: topYinTube }), topYinTube, crop: [tubeImg.width, tubeImg.height] };

  return {
    scene: sc.scene, impl, name: sc.name, ...p, seam, corners, waitedMs: p.waitedMs,
    align: {
      left: +R.ssBody.left.toFixed(3), top: +R.ssBody.top.toFixed(3), width: +R.ssBody.width.toFixed(3), tubeY, topYinTube,
      // 裁图内的参考行：自己的顶边与底边（band 判据用它，不用绝对行号）
      topRow: Math.round(R.ssBody.top - tubeY), bottomRow: Math.round(R.ssBody.bottom - tubeY),
    },
    files: { stack: stackFile, tube: tubeFile, seam: seamFile ?? null },
  };
}

function judge(rec, sc, problems) {
  const { scene, impl, observed, computed: c, criteria: k, shape } = rec;
  const tag = `现场 ${scene}/${impl}`;
  if (observed !== sc.want[impl]) problems.push(`${tag}：顶边应 ${sc.want[impl]}，实得 ${observed}（radius=${c.topRadius}）`);
  if (!c.afterGenerated) problems.push(`${tag}：::after 未生成，描边读数不可用`);
  const stroke = Number.parseFloat(c.topBorderWidth) || 0;
  if (observed === 'square' && stroke > 0) problems.push(`${tag}：直角顶仍留 ${c.topBorderWidth} 顶描边（初稿 B 的亮线形态）`);
  if (observed === 'round' && stroke === 0) problems.push(`${tag}：圆角顶却没有顶描边（读数自相矛盾）`);
  if (rec.corners.rounded !== (observed === 'round')) {
    problems.push(`${tag}：像素判角=${rec.corners.rounded ? '圆角' : '直角'} 与计算值 ${observed} 不一致（缺口 L=${rec.corners.leftOffsetColumns} R=${rec.corners.rightOffsetColumns}）`);
  }
  const driver = impl === 'B3' ? k.positionHit : k.sniffHit;
  if ((observed === 'square') !== driver) problems.push(`${tag}：${impl === 'B3' ? '位置' : '嗅探'}判据=${driver} 但顶边=${observed}`);
  if (impl === 'B3' && (Number.parseFloat(c.marginBottom) === 0) !== k.notLastHit) {
    problems.push(`${tag}：margin-bottom=${c.marginBottom} 与 :not(:last-child)=${k.notLastHit} 不自洽`);
  }
  if (impl === 'B2' && Number.parseFloat(c.marginBottom) === 0) problems.push(`${tag}：B2 半区不该让位，margin-bottom 却是 0`);
  if (shape.anchorDataSlot !== 'conversation.input.dock') problems.push(`${tag}：父节点不是 [data-slot="conversation.input.dock"]（锚点=${shape.anchorDataSlot}）`);
  if (shape.anchorDisplay !== 'contents') problems.push(`${tag}：锚点 computed display=${shape.anchorDisplay}（应为 contents）`);
  if (shape.indexOfOurs < 0) problems.push(`${tag}：.ss-dock-root 不是锚点的直接子元素`);
  if (scene === '4') {
    if (!shape.errorAnchorPresent) problems.push(`${tag}：[data-slot-error] 空锚点不在场（这一档是被删了还是藏了？）`);
    if (shape.errorAnchorHeight !== 0) problems.push(`${tag}：空锚点产生了 ${shape.errorAnchorHeight}px 盒子，现场失真`);
  }
  if (scene === '3' && shape.prevSibling !== 'data-other-dock') problems.push(`${tag}：上方兄弟不是中性假邻居（实为 ${shape.prevSibling}）`);
  if (scene === '5') {
    if (!k.notLastHit) problems.push(`${tag}：我们应不是末位`);
    if (impl === 'B3' && Number.parseFloat(c.marginBottom) !== 0) problems.push(`${tag}：A 规则应让位，margin-bottom=${c.marginBottom}`);
  }
  if (['2', '3'].includes(scene)) {
    if (rec.overlap !== 3) problems.push(`${tag}：与上段的重叠应 3px，实得 ${rec.overlap}px`);
    if (!rec.seam) problems.push(`${tag}：接缝带截图失败（几何越界？）`);
    else if (impl === 'B3' && k.positionHit && !rec.seam.pass) problems.push(`${tag}：判据命中却判出缝线（span=${rec.seam.worstSpanPct}%）`);
    else if (impl === 'B2' && scene === '3' && rec.seam.pass) problems.push(`${tag}：B2 漏判的缺陷形态应判出缝线，却判为无缝`);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chromium = await loadChromium();
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  await page.goto(`file://${DEMO}`, { waitUntil: 'load' });
  await page.evaluate(({ rows, theme }) => {
    document.body.dataset.theme = theme;
    const btn = [...document.getElementById('seg-rows').querySelectorAll('button')].find((b) => Number(b.dataset.rows) === rows);
    if (btn) btn.click();
  }, { rows: ROWS, theme: THEME });

  const problems = [];
  const records = [];
  const pairs = [];

  for (const sc of SCENES) {
    const a = await captureScene(page, sc, 'B2');
    const b = await captureScene(page, sc, 'B3');
    judge(a, sc, problems);
    judge(b, sc, problems);
    records.push(a, b);

    // 对齐自检：两半不在同一 rect 上时，像素对照没有意义 —— 直接判无效，不和稀泥。
    const aligned = a.align.left === b.align.left && a.align.top === b.align.top && a.align.width === b.align.width;
    if (!aligned) {
      problems.push(`现场 ${sc.scene}：两半取样未对齐（B2 rect=${JSON.stringify(a.align)} vs B3 rect=${JSON.stringify(b.align)}），像素对照无效`);
      continue;
    }
    for (const kind of ['tube', 'stack']) {
      const imgA = decodePngRgb(a.files[kind]);
      const imgB = decodePngRgb(b.files[kind]);
      const cmp = assertPixelIdentical(imgA, imgB);
      const rows = diffRows(imgA, imgB);
      const expectedSame = sc.same[kind];
      const rec = { scene: sc.scene, kind, expectedSame, aligned, pass: cmp.pass, diffPixels: cmp.diffPixels, totalPixels: cmp.totalPixels, maxChannelDiff: cmp.maxChannelDiff, reason: cmp.reason ?? null, diffRows: rows };
      pairs.push(rec);
      if (aligned && cmp.pass !== expectedSame) {
        problems.push(`现场 ${sc.scene}（${kind}）：两半应${expectedSame ? '逐像素相同' : '有差异'}，实得 ${cmp.pass ? '相同' : `diff=${cmp.diffPixels}/${cmp.totalPixels}`}${cmp.reason ? `（${cmp.reason}）` : ''}`);
      }
      /* band 判据（只有 tube 带能谈位置：stack 的高度本身会因让位而变）：
         参考行**不是裁图第 0 行** —— tube 带从「上段面板顶 -2」起，我们自己的顶边落在
         `edges.topRow`（实测现场 ③ 的差异行 39..54 就是它，按绝对行号会误判成"差异不在顶边"）。
           · ③④：差异必须**跨过我们自己的顶边行**（判据改的就是一条顶边）；
           · 5：顶边行必须**一个像素都不差**（A 规则只动下边距），差异只能落在底边带。 */
      if (kind === 'tube' && rows && rows.first !== null) {
        const topRow = b.align.topRow; const bottomRow = b.align.bottomRow;
        rec.edges = { topRow, bottomRow };
        if (sc.band === 'top' && !(rows.first <= topRow && rows.last >= topRow)) {
          problems.push(`现场 ${sc.scene}：两半差异必须覆盖我们自己的顶边行（第 ${topRow} 行），实得差异行=${rows.first}..${rows.last}/${rows.height}`);
        }
        if (sc.band === 'bottom') {
          const touchedTop = rows.first <= topRow + 8 && rows.last >= Math.max(0, topRow - 2);
          if (touchedTop) problems.push(`现场 ${sc.scene}：A 规则不许碰顶边带（第 ${Math.max(0, topRow - 2)}~${topRow + 8} 行应零差异），实得差异行=${rows.first}..${rows.last}`);
          if (rows.last < bottomRow - 4) problems.push(`现场 ${sc.scene}：差异应落在底边带（我们面板底边第 ${bottomRow} 行附近），实得末差异行=${rows.last}/${rows.height}`);
        }
      }
      rec.band = sc.band ?? null;
    }
  }

  /* ---- 人眼对照图：恢复并排两半，逐现场截 pair（不参与 pass/fail，只负责"看得见"） ---- */
  await page.evaluate(() => document.querySelectorAll('style[data-cap]').forEach((s) => s.remove()));
  for (const sc of SCENES) {
    await page.evaluate((n) => document.querySelector(`.b3-scene[data-b3-scene="${n}"]`).scrollIntoView({ block: 'start' }), sc.scene);
    const box = await page.evaluate((n) => {
      const r = document.querySelector(`.b3-scene[data-b3-scene="${n}"]`).getBoundingClientRect();
      return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 };
    }, sc.scene);
    const file = path.join(OUT_DIR, `scene${sc.scene}-pair.png`);
    await page.screenshot({ path: file, clip: clip(box.x, box.y, box.width, Math.min(box.height, 1190 - box.y)) });
    records.filter((r) => r.scene === sc.scene).forEach((r) => { r.files.pair = file; });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'evidence.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    demo: path.relative(REPO, DEMO),
    rows: ROWS, theme: THEME,
    viewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
    isolation: { width: ISOLATE_WIDTH, reason: '两半必须落在同一个 rect 上才能逐像素比；并排原位比会把设备像素相位差当成判据差' },
    wait: { condition: "每个可见 .ss-dock-body 的 ::after.content === '\"\"'，且连续两帧几何/计算值签名一致", insteadOf: '固定 sleep（未生成的伪元素会让两边同假而误判相同）' },
    pairs,
    problems,
    scenes: records,
  }, null, 2));
  await browser.close();

  console.log(`现场采集 → ${OUT_DIR}（DPR=1，孤立半区宽 ${ISOLATE_WIDTH}px）\n`);
  for (const sc of SCENES) {
    console.log(`现场${sc.scene} ${sc.name}`);
    for (const impl of ['B2', 'B3']) {
      const r = records.find((x) => x.scene === sc.scene && x.impl === impl);
      if (!r) continue;
      const seamTxt = r.seam ? `缝线=${r.seam.pass ? '无' : `有(${r.seam.worstSpanPct}%)`}` : '缝线=n/a';
      console.log(`  ${impl} 顶边=${r.observed}${r.observed === sc.want[impl] ? '✓' : `✗(应 ${sc.want[impl]})`} `
        + `radius=${r.computed.topRadius} 顶描边=${r.computed.topBorderWidth} margin-bottom=${r.computed.marginBottom} `
        + `重叠=${r.overlap ?? 'n/a'}px ${seamTxt} 判角(像素)=${r.corners.rounded ? '圆' : '方'}(L${r.corners.leftOffsetColumns}/R${r.corners.rightOffsetColumns})`);
      console.log(`     判据{嗅探:${r.criteria.sniffHit} 位置:${r.criteria.positionHit} 非末位:${r.criteria.notLastHit}} `
        + `形状{兄弟=${r.shape.indexOfOurs + 1}/${r.shape.siblingCount} 上邻=${r.shape.prevSibling} 锚点=${r.shape.anchorDisplay}} 等稳定=${r.waitedMs}ms`);
      console.log(`     ${r.files.pair ?? '—'} | ${r.files.tube} | ${r.files.seam ?? '—'} | ${r.files.stack}`);
    }
    for (const kind of ['tube', 'stack']) {
      const p = pairs.find((x) => x.scene === sc.scene && x.kind === kind);
      if (!p) continue;
      const dr = p.diffRows ? ` 差异行=${p.diffRows.first ?? '—'}..${p.diffRows.last ?? '—'}/${p.diffRows.height ?? '—'}` : '';
      const eg = p.edges ? ` 顶边行=${p.edges.topRow} 底边行=${p.edges.bottomRow}` : '';
      console.log(`  两半 ${kind}：diff=${p.diffPixels ?? 'n/a'}/${p.totalPixels ?? 'n/a'} 期望${p.expectedSame ? '相同' : '有差异'} ${p.pass === p.expectedSame ? '✓' : '✗'}${p.reason ? `（${p.reason}）` : ''}${dr}${eg} 带=${p.band ?? '—'}`);
    }
  }
  if (problems.length) {
    console.log(`\n✗ ${problems.length} 条与 §2/§3 应然不符：`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ 五现场的顶边观感、判据真值、形状前提与像素对照，全部与 §2/§4 应然一致');
  }
}

main().catch((e) => { console.error(`✗ ${e.stack || e.message}`); process.exitCode = 1; });
