/**
 * 从 `docs/dock-stacking-demo.html` 采集接缝矩阵（issue #42 §2）。
 *
 * ## 为什么用 demo 而不是真机实例
 *
 * #42 §3 要求"demo 与真机用**同一把尺**"，且明示 capture 脚本**复用** demo 的
 * `measure()`。demo 是浏览器实渲染（真实 CSS 布局、真实伪元素、真实 backdrop-filter），
 * 它有真机没有的三个性质：
 *
 *   1. **能任意造状态** —— `scheme` / `rows` / `sched` / `theme` 四个维度全可编程，
 *      包括"队列 3 条 + 提醒 3 条 + 浅色 + 展开"这种真机很难凑的组合；
 *   2. **零副作用** —— 不必建 `delivery: user` 的待发提醒。此前为了造"队列+提醒同屏"
 *      必须在活跃工作区落持久状态，已经出过一次事故（测试提醒被建进活跃工作区，
 *      靠手工隔离才拆掉）；demo 路线从根上消除这一类风险；
 *   3. **不需要模型凭据** —— 真机路线要跑 agent 回合才会有队列条，容器里配不通。
 *
 * 代价是它仿真的是宿主 QueueDock 的**外观契约**而非宿主本体。这由 §4 的升级复查
 * 兜住 —— 但复查项已随 #42 换判据而改轨：插件样式不再嗅探 `data-queue-dock`（那是宿主
 * QueueDock 的私有属性），改读**栈内位置**（`[data-slot="conversation.input.dock"] >
 * .ss-dock-root:not(:first-child|:last-child)`）。所以现在要复查的是**出口结构与位置选择器
 * 是否仍成立**（`.ss-dock-root` 是否仍是 `[data-slot]` 锚点的直接子元素、锚点是否仍
 * display:contents），而不是「那个私有属性还在不在」；两者分工写在
 * `docs/notes/dock-alignment.md` §8 第 10 项，判据本身在 `docs/notes/dock-stack-contract.md`。
 *
 * 用法：
 *   node scripts/seam-check/capture-demo.mjs [--out-dir docs/media/seam-matrix]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DEMO = path.join(REPO, 'docs/dock-stacking-demo.html');

/** #42 §2 的矩阵维度。抽样跑关键组合，不追求 24 帧全跑。 */
export const MATRIX = [
  { scheme: 'B2', rows: 1, sched: 1, theme: 'dark' },
  { scheme: 'B2', rows: 3, sched: 3, theme: 'dark' },
  { scheme: 'B2', rows: 1, sched: 1, theme: 'light' },
  { scheme: 'B2', rows: 3, sched: 3, theme: 'light' },
  { scheme: '0', rows: 1, sched: 1, theme: 'dark' },   // 对照：被否决方案，必须判出缝线
  { scheme: '0', rows: 1, sched: 1, theme: 'light' },  // 对照：浅色下也必须判出
  { scheme: 'solo', rows: 0, sched: 1, theme: 'dark' },// solo 基线
  { scheme: 'solo', rows: 0, sched: 1, theme: 'light' },
];

/**
 * 在页面里量出接缝几何 —— 与 `docs/dock-stacking-demo.html` 的 `measure()` 同一把尺。
 * 逐条对应 measure() 的 `overlap` / `seam` / 两面板圆角 / marginBottom。
 */
export function measureInPage(schemeSel) {
  const scheme = document.querySelector(schemeSel);
  if (!scheme) return { error: `找不到 ${schemeSel}` };
  const hostPanel = scheme.querySelector('[data-host-panel]');
  const ssBody = scheme.querySelector('[data-ss-body]');
  const ssRoot = scheme.querySelector('[data-ss-dock]');
  const composer = scheme.querySelector('.host-composer');
  if (!ssBody) return { error: '缺 [data-ss-body]' };
  const sb = ssBody.getBoundingClientRect();
  const hp = hostPanel ? hostPanel.getBoundingClientRect() : null;
  const cs = composer ? composer.getBoundingClientRect() : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
    schemeRect: (() => { const r = scheme.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; })(),
    ssBodyRect: { top: sb.top, bottom: sb.bottom, left: sb.left, right: sb.right, width: sb.width, height: sb.height },
    hostPanelRect: hp ? { top: hp.top, bottom: hp.bottom, left: hp.left, right: hp.right, width: hp.width, height: hp.height } : null,
    composerRect: cs ? { top: cs.top, bottom: cs.bottom, left: cs.left, right: cs.right } : null,
    // —— 与 demo measure() 同一把尺 ——
    overlap: hp ? +(hp.bottom - sb.top).toFixed(1) : null,
    seamToComposer: cs ? +(cs.top - sb.bottom).toFixed(1) : null,
    queuePanelRadius: hostPanel ? getComputedStyle(hostPanel).borderRadius : null,
    ssPanelRadius: getComputedStyle(ssBody).borderRadius,
    ssMarginBottom: ssRoot ? getComputedStyle(ssRoot).marginBottom : null,
    stackGap: ssRoot && ssRoot.parentElement ? getComputedStyle(ssRoot.parentElement).gap : null,
  };
}

async function main() {
  const outDir = process.argv.includes('--out-dir')
    ? process.argv[process.argv.indexOf('--out-dir') + 1]
    : path.join(REPO, 'docs/media/seam-matrix');
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
  await page.goto(`file://${DEMO}`, { waitUntil: 'load' });

  const manifest = [];
  for (const combo of MATRIX) {
    // 用 demo 自己的控件设状态，而不是改内部变量 —— 走的是用户路径
    const state = await page.evaluate(({ rows, sched, theme }) => {
      document.body.dataset.theme = theme;
      document.querySelectorAll('#seg-theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
      // demo 的状态存在闭包里的 state 对象，控件点击才是唯一公开入口
      for (const [id, key, value] of [['seg-rows', 'rows', rows], ['seg-sched', 'sched', sched]]) {
        const el = document.getElementById(id);
        const btn = [...(el?.querySelectorAll('button') ?? [])].find((b) => Number(b.dataset[key]) === value);
        if (btn) btn.click();
      }
      return { theme: document.body.dataset.theme };
    }, combo);

    /**
     * `page.screenshot({clip})` 只接受**视口坐标**，而几何是文档坐标。
     * 先 `scrollIntoView` 把该 scheme 顶到视口，再取**滚动后**的 rect ——
     * 直接拿滚动前的 rect 会裁出高度 0（实测踩过：y=1880 远超 900 视口）。
     */
    const geo = await page.evaluate((sel) => {
      const scheme = document.querySelector(sel);
      scheme.scrollIntoView({ block: 'start' });
      return null;
    }, `[data-scheme="${combo.scheme}"]`).then(() => page.evaluate(measureInPage, `[data-scheme="${combo.scheme}"]`));
    const tag = `${combo.scheme}-r${combo.rows}-s${combo.sched}-${combo.theme}`;
    if (geo.error) { manifest.push({ ...combo, tag, error: geo.error }); console.log(`  ✗ ${tag}: ${geo.error}`); continue; }

    const seamY = geo.hostPanelRect ? geo.hostPanelRect.bottom : null;
    const band = 24;
    let cropFile = null;
    if (seamY !== null) {
      const y0 = Math.max(0, Math.round(seamY - band));
      const y1 = Math.min(geo.viewport.h, Math.round(seamY + band));
      if (y1 > y0) {
        cropFile = path.join(outDir, `${tag}-seam.png`);
        await page.screenshot({
          path: cropFile,
          clip: { x: Math.max(0, Math.round(geo.ssBodyRect.left)), y: y0, width: Math.round(geo.ssBodyRect.width), height: y1 - y0 },
        });
      }
    }
    // 整根管子：判据 2（侧线连续）与判据 4（solo 基线）需要
    const tubeFrom = geo.hostPanelRect ? geo.hostPanelRect.top : geo.ssBodyRect.top;
    const ty0 = Math.max(0, Math.round(tubeFrom) - 2);
    const ty1 = Math.min(geo.viewport.h, Math.round(geo.ssBodyRect.bottom) + 2);
    const tubeFile = path.join(outDir, `${tag}-tube.png`);
    await page.screenshot({
      path: tubeFile,
      clip: {
        x: Math.max(0, Math.round(geo.ssBodyRect.left) - 2),
        y: ty0,
        width: Math.round(geo.ssBodyRect.width) + 4,
        height: Math.max(1, ty1 - ty0),
      },
    });

    const entry = {
      ...combo, tag, theme: state.theme,
      /**
       * 双锚点（相对裁图）：B2 的 3px 消缝重叠让 hostPanel.bottom 与 ssBody.top 不等，
       * 缝线可能落在两者之间 —— 只给单点会漏判（实测把一个已知有缺陷的对照帧判成 PASS）。
       */
      seamsInCrop: seamY === null ? null : [
        Math.round(geo.hostPanelRect.bottom) - Math.max(0, Math.round(seamY - band)),
        Math.round(geo.ssBodyRect.top) - Math.max(0, Math.round(seamY - band)),
      ],
      crop: cropFile ? path.relative(REPO, cropFile) : null,
      tube: path.relative(REPO, tubeFile),
      geo,
    };
    manifest.push(entry);
    console.log(`  ✓ ${tag}  overlap=${geo.overlap} 圆角=${geo.ssPanelRadius} seam=${geo.seamToComposer}`);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n清单 → ${path.relative(REPO, path.join(outDir, 'manifest.json'))}（${manifest.length} 项）`);
  await browser.close();
}

if (process.argv[1] && process.argv[1].endsWith('capture-demo.mjs')) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
}
