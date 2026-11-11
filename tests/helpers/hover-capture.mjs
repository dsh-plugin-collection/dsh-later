#!/usr/bin/env node
/**
 * 悬停卡**真 GUI** 取证采集件（issue #153，SPEC §4.1）。
 *
 * 它做的事只有一件：在**隔离实例**（真内核 + 真会话 + 真 Chromium）里造一条
 * `after` 提醒，悬停**那条**会话，把
 *   ① 截图（整页 + 卡片裁切），
 *   ② `document.body` 直系子元素 → 首个子元素的子节点（tagName / 属性 / 文本）的结构化 DOM 落盘，
 *   ③ 卡片正文的完整 `innerHTML` 与「插件行是否注入」的判定
 * 写进 `--out` 目录。
 *
 * 改前/改后**各跑一次**，只有 `--plugin-dir` 换（改前=本树 `4bedb24`；改后=实现分支的产物），
 * 其余参数与流程完全一致 —— 成对证据的差别只允许来自被测代码。
 *
 * 用法：
 *   PLAYWRIGHT_MODULE=<playwright 包目录> node tests/helpers/hover-capture.mjs \
 *     --label pre --plugin-dir . --version 0.2.2-rc.1 --port 3611 \
 *     --home .verify/hover-evidence/pre --out docs/media/hover-idle-2026-11-11
 *
 * 为什么不复用 `scripts/ui-matrix/capture.mjs`：那条链拍的是「按钮在不在 / dock 有几行 /
 * 面板开没开」这三面，判据是结构性的但**不含悬停**——它的鼠标从没移到过侧栏行上，
 * 宿主卡片因此从未弹出过，`findHoverCard()` 这条路径一次都没被走到。本文件补的就是这一面。
 *
 * @module tests/helpers/hover-capture
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, mintCookie } from '../../scripts/ui-matrix/capture.mjs';
import { createInstance, seedWorkspaceStore, startWeb, stopInstance } from '../../scripts/ui-matrix/instance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};

const LABEL = opt('label', 'pre');
const PLUGIN_DIR = resolve(opt('plugin-dir', ROOT));
const VERSION = opt('version', '0.2.2-rc.1');
const PORT = Number(opt('port', 3611));
const HOME = resolve(opt('home', resolve(ROOT, '.verify', 'hover-evidence', LABEL)));
const OUT = resolve(opt('out', resolve(ROOT, 'docs', 'media', 'hover-idle-2026-11-11')));
const MINUTES = Number(opt('minutes', 40));
/** 正文里带标签与插件版本号：两张图长得一样时，只有正文能自证是哪一版跑的。 */
const pkgVersion = JSON.parse(readFileSync(resolve(PLUGIN_DIR, 'package.json'), 'utf8')).version;
const MARKER = `悬停证据 ${LABEL} v${pkgVersion}`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 采集 `document.body` 直系子元素的 DOM（SPEC §3.1 要求的形状）：
 * 直系子元素 → 首个子元素的子节点（tagName / 属性 / 文本），并**按层继续下钻**到 8 层。
 *
 * 为什么不能只到 3 层：本插件识别卡片只押「body 直系子元素 → 首个子元素 = 状态行父容器」
 * 这一条。宿主把卡片外面再包一层 portal（实测 `body > span._portal_* > div._card_* >
 * div.hoverContent`）时，3 层正好停在识别逻辑失配的地方、看不到状态行长什么样，
 * 也就无法判断「改对了吗 / 该往哪改」。浮层本身很小，全抄进证据文件不贵。
 */
const BODY_DUMP = () => {
  const attrs = (el) => {
    const out = {};
    for (const a of Array.from(el.attributes ?? [])) out[a.name] = a.value;
    return out;
  };
  const text = (el) => {
    // 只看**自身**文本节点，别把整棵子树的拼接当成一坨。
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('');
    return own.replace(/\s+/g, ' ').trim();
  };
  const node = (el, depth) => {
    const item = { tag: el.tagName, attrs: attrs(el), text: text(el) };
    if (depth > 0) item.children = Array.from(el.children).map((c) => node(c, depth - 1));
    return item;
  };
  return Array.from(document.body.children).map((el) => node(el, 8));
};

/**
 * 侧栏会话行清单：`[role="treeitem"]` 且**不带** `aria-expanded`（工作区行带）。
 * 顺带做 fiber 反查拿 sessionId，与插件的 `HOST_DOM.fiberKeyPrefix/sessionIdPrefix`
 * 同一套读法（这里独立实现，避免"插件自己找不到卡片"与"证据里说它存在"互相循环）。
 */
const ROW_DUMP = () => {
  const rows = Array.from(document.querySelectorAll('[role="treeitem"]')).filter((r) => !r.hasAttribute('aria-expanded'));
  const findFiber = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return key === undefined ? undefined : el[key];
  };
  const sessionIdOf = (el) => {
    let node = findFiber(el);
    for (let d = 0; d < 8 && node !== undefined; d += 1) {
      const id = node.memoizedProps?.node?.id;
      if (typeof id === 'string' && id.startsWith('session-')) return id;
      node = node.return;
    }
    return null;
  };
  return rows.map((r, i) => ({
    index: i,
    sessionId: sessionIdOf(r),
    text: (r.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    /** 插件侧栏 badge（有活动提醒的行才有）：数据面在位的证据，与卡片是否注入分开判。 */
    badge: (() => {
      const b = r.querySelector('.ss-presence') ?? (r.nextElementSibling?.classList?.contains('ss-presence') ? r.nextElementSibling : null);
      return b === null ? null : { state: b.dataset.state ?? null, aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), inside: b === r.querySelector('.ss-presence') };
    })(),
    /**
     * 宿主自己的「进行中」orb：`.ss-presence` **外面**的 svg 才算。
     * 本插件的时钟图标本身也是 svg（塞在 slot 内或 slot 之后），不加这层排除，
     * 「有 svg = 这条会话在跑」会被自己的 badge 污染成永远为真。
     */
    hostOrb: (() => {
      const svgs = Array.from(r.querySelectorAll('svg')).filter((s) => s.closest('.ss-presence') === null);
      return svgs.length > 0;
    })(),
    box: (() => {
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })(),
  }));
};

/**
 * 悬停后读卡片。**刻意不用插件自己的识别逻辑**当唯一入口：issue #153 要判的正是
 * 「插件那套只押『body 直系子元素 → 首个子元素』的识别有没有命中」。若用同一套逻辑
 * 去找卡片，识别失败时会得到一个「现场没有卡片」的假结论——而现场明明弹着卡片。
 *
 * 所以这里两件事分开记：
 *  - `pluginRecognizes`：复刻 `findHoverCard()` 的条件（只看 firstElementChild 的直接子节点），
 *    回答「插件那一行有没有机会被注进去」；
 *  - `statusHost`：沿 DOM **下钻**找真正的状态行父容器（含 `hoverStatus` 类名或状态点形状），
 *    回答「宿主卡片实际长什么样、插件行实际在不在里面」。
 */
const CARD_DUMP = () => {
  const attrs = (el) => {
    const out = {};
    for (const a of Array.from(el.attributes ?? [])) out[a.name] = a.value;
    return out;
  };
  const txt = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const isDot = (el) => el !== null && el.tagName === 'SPAN' && el.getAttribute('aria-hidden') === 'true';
  /** 放宽版：类名词尾 `*_hoverStatus`，或「有状态点 + 非空文本」。 */
  const isRow = (el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)[A-Za-z0-9_-]*_hoverStatus(\s|$)/.test(cls)) return true;
    return isDot(el.firstElementChild) && txt(el).length > 0;
  };
  /** 原版复刻（插件的 findHoverCard 只用这个）：首子元素是状态点 + ≥2 子节点。 */
  const isRowShallow = (el) => el.children.length >= 2 && isDot(el.firstElementChild);
  const hostRows = (host) => {
    if (host === null) return [];
    const kids = Array.from(host.children).filter(
      (c) => !(typeof c.className === 'string' ? c.className : '').includes('ss-hover-status'),
    );
    const direct = kids.filter(isRow);
    return direct.length > 0 ? direct : kids.flatMap((c) => Array.from(c.children).filter(isRow));
  };
  const findHost = (root) => {
    const order = [];
    const walk = (el, d) => {
      if (d > 8) return;
      order.push(el);
      for (const c of Array.from(el.children)) walk(c, d + 1);
    };
    walk(root, 0);
    for (const el of order) if (hostRows(el).length > 0) return el;
    return null;
  };
  const out = [];
  const overlays = Array.from(document.body.children).filter(
    (el) => el.nodeType === 1 && el.id !== 'root' && ['DIV', 'SPAN', 'ASIDE'].includes(el.tagName),
  );
  for (const card of overlays) {
    const host = findHost(card);
    const rows = hostRows(host);
    const injected = Array.from(card.querySelectorAll('.ss-hover-status'));
    if (host === null && injected.length === 0) continue;
    /**
     * 可见性判据（issue #153 实测修正）：**不要用 portal 根自己的 `getBoundingClientRect()`**。
     * 真 DOM 里 `body > span._portal_*` 只是定位壳，尺寸可能为 0；带尺寸的是它里面那层
     * `div._card_*`（`position: fixed` + `left/top`）。首版按根量尺寸，于是**弹着的卡片被判成没弹**
     * —— 与 §3.1 记录的「只量 body 直系子元素」是同一个坑，只是换了个位置。
     * 现在取 `statusHost` 或卡片壳里**面积最大**的那个矩形，并要求正文非空。
     */
    const boxes = [card, ...Array.from(card.querySelectorAll('*')).slice(0, 40)]
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    const r = boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? card.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || txt(card) === '') continue;
    const shallow = card.firstElementChild;
    const rowParent = rows.length > 0 ? rows[0].parentElement : null;
    out.push({
      cardTag: card.tagName,
      cardBox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      cardAttrs: attrs(card),
      pluginRecognizes: shallow !== null && Array.from(shallow.children).some(isRowShallow),
      statusHostAttrs: host === null ? null : attrs(host),
      statusHostDepth: (() => {
        let d = 0;
        let n = host;
        while (n !== null && n !== card) { n = n.parentElement; d += 1; }
        return n === null ? null : d;
      })(),
      /**
       * 状态行的**真实直接父容器**。上面的 `statusHost` 是「第一个能数到状态行的祖先」，
       * 宿主把行再包一层时它会高一层（实测 0.2.2-rc.1：statusHost=`_card_*`，
       * rowParent=`YDXeBa_hoverContent`）。判「注入到哪」必须看这一项，不然会把
       * 「宿主的容器」当成「宿主的行容器」。
       */
      hostRowParentAttrs: rowParent === null ? null : attrs(rowParent),
      hostRowParentChain: (() => {
        const chain = [];
        let n = card;
        while (n !== null && n !== document.body) {
          chain.push(n.tagName + (typeof n.className === 'string' && n.className ? `.${n.className.split(/\s+/)[0]}` : ''));
          if (n === rowParent) break;
          n = n.firstElementChild;
        }
        return chain;
      })(),
      hostRows: rows.map((el) => ({ tag: el.tagName, attrs: attrs(el), text: txt(el), hasDot: isDot(el.firstElementChild), children: Array.from(el.children).map((c) => ({ tag: c.tagName, attrs: attrs(c), text: txt(c) })) })),
      injectedRows: injected.map((el) => ({ tag: el.tagName, attrs: attrs(el), text: txt(el) })),
      hostStatusTexts: rows.map(txt),
      statusHostChildrenTags: host === null ? [] : Array.from(host.children).map((c) => c.tagName),
      statusHostHtml: host === null ? null : host.innerHTML,
    });
  }
  return out;
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(dirname(HOME), { recursive: true });
  process.stdout.write(`实例：plugin=${PLUGIN_DIR} version=${VERSION} home=${HOME} port=${PORT}\n`);
  createInstance({ version: VERSION, pluginDir: PLUGIN_DIR, home: HOME });
  seedWorkspaceStore(HOME);
  const started = await startWeb({ versionRoot: resolve(process.env.DSH_VERSIONS_ROOT ?? `${process.env.HOME}/dsh-versions`, VERSION), home: HOME, profile: 'ui', port: PORT });
  process.stdout.write(`HTTP ${started.http}（日志 ${started.logFile}）\n`);

  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  const report = {
    label: LABEL,
    capturedAt: new Date().toISOString(),
    pluginDir: PLUGIN_DIR,
    pluginVersion: pkgVersion,
    kernelVersion: VERSION,
    port: PORT,
    marker: MARKER,
    scheduleMinutes: MINUTES,
    steps: [],
  };
  const step = (name, info) => {
    report.steps.push(name);
    process.stdout.write(`· ${name}${info === undefined ? '' : `：${JSON.stringify(info).slice(0, 300)}`}\n`);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', deviceScaleFactor: 2 });
    await context.addCookies([{ ...mintCookie(PORT), domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    const consoleErrors = [];
    const consoleWarns = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240));
      if (m.type() === 'warning') consoleWarns.push(m.text().slice(0, 240));
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 240)}`));

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    // 预览版说明遮罩会盖住整页（0.1.2 起各代都有）。
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '继续')?.click();
    });
    await sleep(1200);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '新会话' || b.getAttribute('aria-label') === '新建会话')?.click();
    });
    await sleep(3500);
    step('已新建会话');

    // 真实命令通道造一条 after 提醒（本地处理，不烧模型）→ 归属**当前打开的会话**。
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    await editor.click({ timeout: 10_000 }).catch(() => {});
    await page.keyboard.type(`/later +${MINUTES}m ${MARKER}`, { delay: 8 });
    await page.keyboard.press('Enter');

    // 等 dock 里出现待发送行（精确类名 token，别把 -time/-countdown/-prompt 数成多行）。
    let dockRows = 0;
    for (let i = 0; i < 40; i += 1) {
      dockRows = await page.evaluate(() => [...document.querySelectorAll('[class*="ss-dock-row"]')]
        .filter((el) => String(el.className).split(/\s+/).includes('ss-dock-row')).length);
      if (dockRows > 0) break;
      await sleep(500);
    }
    report.dockRows = dockRows;
    step('dock 待发送行', { dockRows });
    if (dockRows === 0) throw new Error('提醒没建出来（dock 0 行），后面的悬停证据没有意义');

    // 等侧栏 badge 起来（摘要 store 有 30s tick + 60s 列表重拉，固定 sleep 会假红）。
    let rows = [];
    const badgeDeadline = Date.now() + 180_000;
    for (;;) {
      rows = await page.evaluate(ROW_DUMP);
      if (rows.some((r) => r.badge !== null)) break;
      if (Date.now() > badgeDeadline) break;
      await sleep(3000);
    }
    report.rows = rows;
    step('侧栏会话行', rows.map((r) => ({ i: r.index, sid: r.sessionId, badge: r.badge?.state ?? null, orb: r.hostOrb })));

    // 样本选择：**有 badge（= 有活动提醒）**的行优先；再要求宿主 orb 不在（= 非「进行中」）。
    // 空闲这一条不靠猜：卡片里宿主状态行的文本随后会落进 cardDump，见 sampleProof。
    const target = rows.find((r) => r.badge !== null && r.hostOrb === false) ?? rows.find((r) => r.badge !== null) ?? rows[0];
    if (target === undefined) throw new Error('侧栏没有可悬停的会话行');
    report.targetRow = target;
    step('选定样本行', { index: target.index, sid: target.sessionId, text: target.text.slice(0, 60) });

    // 悬停 → 等宿主卡片弹出（body 直系浮层里出现「首个子元素含状态点行」的那个）。
    await page.mouse.move(target.box.x + Math.min(30, target.box.w / 2), target.box.y + target.box.h / 2);
    /**
     * 轮询两个条件，**两个都要满足才算稳**：
     *  ① 卡片弹出来了；
     *  ② 插件有机会对这张卡做出反应 —— 即状态区文案已经是插件的（追加行或替换行都算），
     *     或者宿主这条会话本来就该空闲且已给足若干轮。
     *
     * 只等①会在插件接管之前就快照，于是"宿主空闲 + 有提醒"的样本被记成「插件没工作」——
     * 这是 issue #153 取证里踩到的坑（同一棵树的两次运行结论相反，差别只是快照时刻）。
     * 所以等满 `PLUGIN_WAIT` 轮，取**最后一次**的快照，中间不提前退出。
     */
    const PLUGIN_WAIT = 12;
    let cards = [];
    for (let i = 0; i < 30; i += 1) {
      await sleep(400);
      cards = await page.evaluate(CARD_DUMP);
      if (cards.length > 0 && i >= PLUGIN_WAIT) break;
    }
    report.cards = cards;
    report.bodyDump = await page.evaluate(BODY_DUMP);
    step('弹出卡片', cards.map((c) => ({ host: c.hostRows.length, injected: c.injectedRows.length, tags: c.statusHostChildrenTags })));

    // 截图：整页 + 卡片裁切（卡片坐标在 hover 态才有效，所以先裁再移鼠标）。
    const fullShot = `${LABEL}-gui-full.png`;
    await page.screenshot({ path: resolve(OUT, fullShot) });
    report.shots = { full: fullShot };
    if (cards.length > 0) {
      const box = cards[0].cardBox;
      const clip = {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: Math.min(1440 - Math.max(0, box.x - 8), box.w + 16),
        height: Math.min(900 - Math.max(0, box.y - 8), box.h + 16),
      };
      const clipShot = `${LABEL}-gui-card.png`;
      await page.screenshot({ path: resolve(OUT, clipShot), clip });
      report.shots.card = clipShot;
    }

    // 「插件行到底有没有被注入」分三问，缺一不可：
    //  ① 卡片弹出来了吗（可见判据：box 有尺寸 + 正文非空）；
    //  ② 插件那套只押 firstElementChild 的识别命中了吗（pluginRecognizes）；
    //  ③ `.ss-hover-status` 真在卡片里吗（injectedRows）。
    // ①真 ②假 ③0 = issue #153 说的「识别失效」；①真 ③真 但宿主行还在 = 「并列」。两者要分得开。
    const card0 = cards[0] ?? null;
    const injectedAnywhere = cards.reduce((n, c) => n + c.injectedRows.length, 0);
    const hostRowTexts = cards.flatMap((c) => c.hostStatusTexts);
    /**
     * ⚠️ **「插件干活了没有」不能只看 `.ss-hover-status` 行数**（issue #153 的判据修正）。
     * 合并语义下，「宿主空闲」那一档是**替换文案**、根本不新增行，于是 `.ss-hover-status`
     * 数量本来就是 0 —— 拿它当"没注入"会得出与现场相反的结论。真正要问的是
     * 「状态区里现在显示的是不是插件的定时文案」。
     */
    const pluginTextPattern = /定时提醒|已到期|已暂停|scheduled reminder|paused reminder/i;
    const adoptedRows = cards.flatMap((c) => c.hostRows.filter((r) => pluginTextPattern.test(r.text)));
    const pluginWorked = injectedAnywhere > 0 || adoptedRows.length > 0;
    report.verdict = {
      hoverCardVisible: cards.length > 0,
      pluginRecognizesCard: card0?.pluginRecognizes ?? false,
      statusHostDepth: card0?.statusHostDepth ?? null,
      injectedRows: injectedAnywhere,
      adoptedRows: adoptedRows.map((r) => r.text),
      /** 插件在卡片状态区生效了（追加行 或 替换行都算）。 */
      pluginLineInjected: pluginWorked,
      hostStatusRowTexts: hostRowTexts,
      sampleIsIdle: hostRowTexts.some((t) => /空闲|idle/i.test(t)),
      dataSideBadgePresent: target.badge !== null,
      sampleHasActiveReminder: dockRows > 0 && target.badge !== null,
      consoleErrors,
      consoleWarns,
    };
    step('判定', report.verdict);
  } finally {
    await browser.close();
    stopInstance(HOME);
    await sleep(1500);
  }
  const jsonPath = resolve(OUT, `${LABEL}-dom.json`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`落盘：${jsonPath} + ${report.shots?.full ?? '(无截图)'}\n`);
}

await main();
