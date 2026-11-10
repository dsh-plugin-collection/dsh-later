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
 *   node scripts/seam-check/capture-demo.mjs [--out-dir docs/media/seam-matrix] [--dpr 1,2]
 *
 * ## 单位：这个脚本是全链路唯一的 CSS→设备像素换算点（#62）
 *
 * `page.screenshot({clip})` 的 clip 按 **CSS px** 收，存下来的 PNG 却是 **设备像素**
 * （尺寸 = clip × dpr）。而 `criteria.mjs` 的判据按 PNG 自己的行下标取样 —— 所以锚点
 * 必须以设备像素写进 manifest。旧版直接把 CSS 差值写进去，1x 时两种单位数值相等，
 * 八帧全绿是巧合；2x 时锚点指到真实位置上方约一半行数，判据 1 会把有缝的对照帧漏判。
 * 换算集中在 `toCropPx()`，manifest 里 `seamsInCrop` / `panelTopInCrop` /
 * `strokeLeftInCrop` / `strokeRightInCrop` 四个字段一律是设备像素，判据侧不再碰 CSS 几何。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
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

/**
 * CSS 文档坐标 → 裁图内的**设备像素**行/列下标。
 *
 * 顺序必须是「先减原点再乘 dpr 再取整」：锚点是分数（`hostPanel.bottom =
 * 1135.421875`），旧写法先四舍五入到 CSS 整数、再当设备像素用，等于把小数抹掉后
 * 按 1x 交差 —— 1x 时两种单位数值相等所以看不出来，2x 时锚点落在真实位置上方约
 * 一半的行数上。`originCss` 是 clip 原点，本来就是整数，所以 dpr=1 时
 * `Math.round(x - origin) === Math.round(x) - origin`：既有 8 帧的锚点值逐字不变，
 * 本次改的是**单位**，不是判定结果。
 */
function toCropPx(cssDoc, originCss, dpr) {
  return Math.round((cssDoc - originCss) * dpr);
}

/**
 * CSS 文档坐标 → 裁图内**该边内侧第一行**的设备像素下标（判据 3 的探针行）。
 *
 * ⚠️ 这里曾经走过两个错方向，都记下来，别再试第三遍：
 *
 * 1. **直接沿用 CSS 值**（旧写法）：1x 时两种单位数值相等，八帧全绿是巧合；2x 时
 *    探针落在真实位置上方约一半的行数 —— 实测 2x 的 solo 帧（radius=16px）在 CSS 行 2
 *    上量到 `L=0 R=0`，把有圆角的帧说成直角。
 * 2. **改用 `Math.ceil` 求「内侧第一行」**（我中途试过）：物理上更"正确"，但它换掉了
 *    判据 3 一直在量的那一行 —— 1x 的 scheme0 从 `15/15`（可分）变成 `5/5`（与直角组的
 *    3 再也分不开），等于为了单位对齐悄悄改了判据语义，阈值 6 也当场失去定标依据。
 *
 * 定稿：**探针行 = 旧公式算出的那一 CSS 行，按 dpr 换算成设备像素**，即"同一物理行、
 * 只是换了单位"。这样 1x 的八帧锚点逐字不变（既有判据结论不受扰动），2x 落到同一物理
 * 行。实测（`0-r1-s1-dark-dpr2` 行 150 → `30/30` 圆角；`B2-r1-s1-dark-dpr2` 行 150 →
 * `6/6` 直角；`solo-r0-s1-dark-dpr2` 行 4 → `32/32`）：两档内部直角组与圆角组都可分。
 */
function toCropRowPx(cssRow, dpr) {
  return Math.round(cssRow * dpr);
}

/**
 * playwright **只在真要跑的时候加载**（口径同 `capture-b3-scenes.mjs` / `capture.mjs`：
 * 本仓运行时零依赖，CI 里没有它）。解析顺序：① 标准包名解析；② `PLAYWRIGHT_MODULE`
 * 指一份现成的副本。两条都不通就打一句可执行的提示并非 0 退出 —— 不把某台机器的
 * 绝对路径写进仓内脚本。
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
      + '  2) 指一份现成的：PLAYWRIGHT_MODULE=/绝对路径/playwright node scripts/seam-check/capture-demo.mjs\n'
      + '（本仓运行时零依赖，playwright 只服务于手工采集，不参与 CI。）');
    process.exit(1);
  }
}

/** `--dpr 1,2` → `[1, 2]`。默认只跑 1x，即既有矩阵的档位。 */
function parseDprs() {
  const i = process.argv.indexOf('--dpr');
  if (i === -1) return [1];
  const raw = String(process.argv[i + 1] ?? '').split(',').map((s) => Number(s.trim()));
  if (raw.length === 0 || raw.some((d) => !Number.isFinite(d) || d <= 0)) {
    console.error(`✗ --dpr 要的是逗号分隔的正数，实得 "${process.argv[i + 1]}"`);
    process.exit(1);
  }
  return [...new Set(raw)].sort((a, b) => a - b);
}

async function main() {
  const outDir = process.argv.includes('--out-dir')
    ? process.argv[process.argv.indexOf('--out-dir') + 1]
    : path.join(REPO, 'docs/media/seam-matrix');
  const DPRS = parseDprs();
  fs.mkdirSync(outDir, { recursive: true });

  const chromium = await loadChromium();
  const browser = await chromium.launch();

  const manifest = [];
  /**
   * 每个 DPR 档开一个 page：`deviceScaleFactor` 在建页时定死，不能在页内改；
   * 顺带把 scrollIntoView 留下的滚动状态隔离在档之间。外层按档、内层按组合，
   * manifest 里 1x 的 8 项顺序与旧版逐字一致，2x 的 8 项追加在后面。
   */
  for (const dpr of DPRS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 2000 }, deviceScaleFactor: dpr });
    await page.goto(`file://${DEMO}`, { waitUntil: 'load' });
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
      // 1x 的 tag 与旧版逐字相同（既有帧的文件名、测试里的 find(tag) 都不动）；>1x 才加档位后缀
      const baseTag = `${combo.scheme}-r${combo.rows}-s${combo.sched}-${combo.theme}`;
      const tag = dpr === 1 ? baseTag : `${baseTag}-dpr${dpr}`;
      if (geo.error) { manifest.push({ ...combo, tag, dpr, error: geo.error }); console.log(`  ✗ ${tag}: ${geo.error}`); continue; }
      /**
       * 页面自报的 `window.devicePixelRatio` 必须等于请求的档位，否则说明这台 Chromium
       * 没接受 `deviceScaleFactor`（无头模式下曾见过被 `--force-device-scale-factor` 覆盖）。
       * 那就等于拿 1x 帧冒充 2x 帧交差 —— 宁可炸掉，不许静默降级。
       */
      if (geo.dpr !== dpr) {
        throw new Error(`${tag}: 请求 deviceScaleFactor=${dpr}，页面实测 window.devicePixelRatio=${geo.dpr}（档位没生效，采出来的帧是假的）`);
      }

      const seamY = geo.hostPanelRect ? geo.hostPanelRect.bottom : null;
      const band = 24; // CSS px：接缝带半宽（#42 §2 的裁图口径）
      let cropFile = null;
      let seamsInCrop = null;
      if (seamY !== null) {
        const y0 = Math.max(0, Math.round(seamY - band));
        const y1 = Math.min(geo.viewport.h, Math.round(seamY + band));
        if (y1 > y0) {
          cropFile = path.join(outDir, `${tag}-seam.png`);
          await page.screenshot({
            path: cropFile,
            clip: { x: Math.max(0, Math.round(geo.ssBodyRect.left)), y: y0, width: Math.round(geo.ssBodyRect.width), height: y1 - y0 },
          });
          /**
           * 双锚点（**设备像素**，相对裁图）：B2 的 3px 消缝重叠让 hostPanel.bottom 与
           * ssBody.top 不等，缝线可能落在两者之间 —— 只给单点会漏判（实测把一个已知有
           * 缺陷的对照帧判成 PASS）。clip 的 y 原点 y0 是 CSS 整数，所以传进 toCropPx 的
           * 原点就是它本身，2x 时锚点随之翻倍（1x 的 [24, 21] → 2x 的 [48, 42]）。
           */
          seamsInCrop = [
            toCropPx(geo.hostPanelRect.bottom, y0, dpr),
            toCropPx(geo.ssBodyRect.top, y0, dpr),
          ];
        }
      }
      // 整根管子：判据 2（侧线连续）与判据 4（solo 基线）需要
      const tubeFrom = geo.hostPanelRect ? geo.hostPanelRect.top : geo.ssBodyRect.top;
      const ty0 = Math.max(0, Math.round(tubeFrom) - 2);
      const tx0 = Math.max(0, Math.round(geo.ssBodyRect.left) - 2);
      const ty1 = Math.min(geo.viewport.h, Math.round(geo.ssBodyRect.bottom) + 2);
      const tubeFile = path.join(outDir, `${tag}-tube.png`);
      await page.screenshot({
        path: tubeFile,
        clip: {
          x: tx0,
          y: ty0,
          width: Math.round(geo.ssBodyRect.width) + 4,
          height: Math.max(1, ty1 - ty0),
        },
      });

      const entry = {
        ...combo, tag, theme: state.theme,
        /**
         * 顶层 dpr：护栏测试断的是「manifest 覆盖的 DPR 档位集合 ⊇ {1,2}」，不是帧数
         * （见 tests/seam-pixel-criteria.test.mjs 的矩阵覆盖用例）。`geo.dpr` 是页面自报值，
         * 这个字段是采集时的**请求值** —— 上面已强制两者相等，写两份是为了让人一眼看出
         * 档位是采出来的、不是事后补标的。
         */
        dpr,
        seamsInCrop,
        /**
         * 判据 2/3 的锚点同样按设备像素存，判据侧不再自己做 CSS 换算。
         * 探针行取 `toCropRowPx`（旧 CSS 行 × dpr），不是 `toCropPx(文档坐标…)`：
         * 后者会把「判据 3 一直在量哪一行」一起改掉，1x 的阈值定标当场失效。详见该函数注释。
         */
        panelTopInCrop: toCropRowPx(2 + Math.round(geo.ssBodyRect.top - tubeFrom), dpr),
        strokeLeftInCrop: toCropPx(geo.ssBodyRect.left, tx0, dpr),
        strokeRightInCrop: toCropPx(geo.ssBodyRect.right, tx0, dpr) - 1, // 右边缘是开区间，取最后一列
        crop: cropFile ? path.relative(REPO, cropFile) : null,
        tube: path.relative(REPO, tubeFile),
        geo,
      };
      manifest.push(entry);
      console.log(`  ✓ ${tag}  dpr=${dpr}  overlap=${geo.overlap} 圆角=${geo.ssPanelRadius} seam=${geo.seamToComposer} 锚点=${JSON.stringify(seamsInCrop)}`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n清单 → ${path.relative(REPO, path.join(outDir, 'manifest.json'))}（${manifest.length} 项）`);
  await browser.close();
}

if (process.argv[1] && process.argv[1].endsWith('capture-demo.mjs')) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
}
