#!/usr/bin/env node
/**
 * 宣传片素材的真机采集：起一个只装本仓当前 `lib/` 的隔离 DSH 实例，
 * 用真实交互（真键盘、真命令通道、真倒计时、真 hover）拍下片子要用的每一帧。
 *
 * 与 `scripts/ui-matrix/capture.mjs` 的分工：那个脚本判"这一版能不能用"，这个脚本只要画面。
 * 复用同一套 `createInstance` / `seedWorkspaceStore` / `startWeb` / `mintCookie`，
 * 所以隔离边界与鉴权路径一致。
 *
 *     PLAYWRIGHT_MODULE=<playwright> node docs/promo/scripts/capture-real.mjs \
 *       --version 0.2.1-rc.4 --port 3611
 *
 * 产物：`docs/promo/assets/real/`，2x DPR。打字与倒计时是**逐帧序列**
 * （`03-typing-01..06`、`04-tick-01..04`），片子里按序播放，不是摆拍。
 * `capture.json` 记录每张的裁切矩形、内核版本、插件版本与选择器，
 * 便于回查"这个画面是哪一版拍的"。
 * @module docs/promo/scripts/capture-real
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstance, seedWorkspaceStore, startWeb, stopInstance } from '../../../scripts/ui-matrix/instance.mjs';
import { loadPlaywright, mintCookie } from '../../../scripts/ui-matrix/capture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};

const VERSION = opt('version', '0.2.1-rc.4');
const PORT = Number(opt('port', 3611));
const OUT = resolve(opt('out', join(ROOT, 'docs/promo/assets/real')));
const HOME = '/tmp/dsh-promo-capture';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const record = {
  kernelVersion: VERSION,
  pluginVersion: null,
  deviceScaleFactor: 2,
  viewport: { width: 1440, height: 900 },
  shots: [],
  geometry: {},
  notes: [],
  errors: [],
};

const BASE = opt('base', '');
const inst = BASE ? null : createInstance({ version: VERSION, pluginDir: ROOT, home: HOME });
if (!BASE) record.workspaceSeeded = seedWorkspaceStore(HOME);
record.pluginVersion = (await import(`${ROOT}/package.json`, { with: { type: 'json' } })).default.version;
if (!BASE) {
  const server = await startWeb({ versionRoot: inst.versionRoot, home: HOME, profile: inst.profile, port: PORT });
  console.log(`[capture] ${VERSION} · plugin ${record.pluginVersion} · http ${server.http}`);
} else {
  console.log(`[capture] attach ${BASE} · plugin ${record.pluginVersion}`);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: record.viewport,
  locale: 'zh-CN',
  colorScheme: 'dark',
  deviceScaleFactor: 2,
});
const cookie = BASE
  ? (() => {
      const raw = execFileSync(process.execPath, [join(ROOT, 'scripts/capture/mint-cookie.cjs'), BASE.replace(/^https?:\/\//, '')], {
        encoding: 'utf8',
      }).trim().split('\n').pop();
      const i = raw.indexOf('=');
      return { name: raw.slice(0, i), value: raw.slice(i + 1) };
    })()
  : mintCookie(PORT);
await context.addCookies([{ ...cookie, domain: '127.0.0.1', path: '/' }]);
const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && record.errors.push(m.text().slice(0, 160)));
page.on('pageerror', (e) => record.errors.push(`pageerror: ${String(e).slice(0, 160)}`));

const vp = record.viewport;

/** 拍一张，clip 由选择器或矩形给出；pad 只往外扩到视口内。 */
async function shot(name, { selector, rect, pad = 20, note = '' } = {}) {
  let r = rect;
  if (!r && selector) {
    r = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }, selector);
  }
  if (!r) {
    record.notes.push(`miss ${name}`);
    return null;
  }
  const x = Math.max(0, Math.round(r.x - pad));
  const y = Math.max(0, Math.round(r.y - pad));
  const width = Math.min(vp.width - x, Math.round(r.width + pad * 2));
  const height = Math.min(vp.height - y, Math.round(r.height + pad * 2));
  await page.screenshot({ path: join(OUT, `${name}.png`), clip: { x, y, width, height } });
  record.shots.push({ name, clip: { x, y, width, height }, note });
  record.geometry[name] = { ...(record.geometry[name] ?? {}), clip: { x, y, width, height } };
  console.log(`[capture] ${name} ${width}x${height}`);
  return { x, y, width, height };
}

const waitFor = async (sel, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await page.locator(sel).count()) > 0) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

/**
 * 把一组选择器的矩形换算成"相对某张图的百分比"，标线就能精确落在按钮上，
 * 不用人肉目测坐标。返回 {名称: {xPct,yPct,wPct,hPct}}。
 */
async function anchors(clipRect, pairs) {
  const out = {};
  for (const [name, sel] of Object.entries(pairs)) {
    const r = await page.evaluate((s0) => {
      const el = document.querySelector(s0);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }, sel);
    if (!r) {
      out[name] = null;
      continue;
    }
    out[name] = {
      xPct: +(((r.x - clipRect.x) / clipRect.width) * 100).toFixed(2),
      yPct: +(((r.y - clipRect.y) / clipRect.height) * 100).toFixed(2),
      wPct: +((r.width / clipRect.width) * 100).toFixed(2),
      hPct: +((r.height / clipRect.height) * 100).toFixed(2),
    };
  }
  return out;
}

/** 作曲行卡片的矩形：从 contenteditable 往上找第一个圆角容器，跳过工作区选择那一行。 */
const composerRect = () =>
  page.evaluate(() => {
    let el = document.querySelector('[contenteditable="true"]');
    let card = null;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (parseFloat(cs.borderTopLeftRadius) >= 10 && r.height >= 80) {
        card = el;
        break;
      }
      el = el.parentElement;
    }
    const r = (card ?? el).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

try {
  await page.goto(BASE || `http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });

  // 1) 先关「预览版说明」：它比侧栏晚出现，先点新会话会把它留在屏幕上，
  //    之后所有点击都会被这层遮罩截走（表现为"输了字却什么都没发生"）。
  let clearRounds = 0;
  for (let i = 0; i < 40 && clearRounds < 2; i += 1) {
    const state = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const again = dialog
        ? [...dialog.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '继续')
        : [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '继续');
      if (again) {
        again.click();
        return 'clicked';
      }
      return dialog === null ? 'clear' : 'waiting';
    });
    clearRounds = state === 'clear' ? clearRounds + 1 : 0;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(800);

  // 2) 再开新会话：真鼠标点（DOM click 在线上实例里有时只打开工作区选择器）
  for (let i = 0; i < 6; i += 1) {
    await page
      .getByRole('button', { name: /新(建)?会话/ })
      .first()
      .click({ force: true, timeout: 6000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    if ((await page.locator('[contenteditable="true"]').count()) > 0) break;
    await page.evaluate(() => {
      const fresh = [...document.querySelectorAll('button')].find(
        (x) => (x.textContent || '').trim() === '新会话' || x.getAttribute('aria-label') === '新建会话',
      );
      fresh?.click();
    });
    await page.waitForTimeout(1200);
  }
  record.notes.push(`dialog dismissed: ${(await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)) === 0}`);
  await page.waitForTimeout(2600);
  await shot('00-window', { rect: { x: 0, y: 0, width: vp.width, height: vp.height }, pad: 0, note: 'full window' });

  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 25000 });

  // 1. 空作曲行（右侧「定时发送」按钮在位）
  await shot('01-composer-empty', { rect: await composerRect(), pad: 10, note: 'empty composer' });

  // 3. 打字：分 6 段拍，片子里按序播放
  await editor.click({ timeout: 8000 }).catch(() => {});
  const text = '/later +5s 检查部署结果';
  const stepLen = Math.ceil(text.length / 6);
  for (let i = 0; i < 6; i += 1) {
    const chunk = text.slice(i * stepLen, (i + 1) * stepLen);
    if (chunk) await page.keyboard.type(chunk, { delay: 26 });
    await page.waitForTimeout(120);
    await shot(`03-typing-0${i + 1}`, {
      rect: await composerRect(),
      pad: 10,
      note: `typed "${text.slice(0, (i + 1) * stepLen)}"`,
    });
  }

  // 5. 回车 → dock；每秒拍一帧倒计时
  //    面板关闭时点过空白处，输入框可能被清掉或失焦：先确认命令还在，再回车。
  const stillTyped = async () =>
    page.evaluate(() => {
      const ed = document.querySelector('[contenteditable="true"]');
      return (ed?.innerText || '').includes('检查部署结果');
    });
  if (!(await stillTyped())) {
    record.notes.push('composer lost the command after closing the panel; retyped');
    await editor.click({ timeout: 8000 }).catch(() => {});
    await page.keyboard.press('ControlOrMeta+a').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(text, { delay: 16 });
  }
  await editor.click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.press('Enter');
  if (!(await waitFor('.ss-dock-row', 12000))) {
    await page.keyboard.press('Enter'); // 老编辑器偶发吞第一次回车
    await waitFor('.ss-dock-row', 12000);
  }
  const dockRect = () =>
    page.evaluate(() => {
      const row = [...document.querySelectorAll('[class*="ss-dock-row"]')].find((el) =>
        String(el.className).split(/\s+/).includes('ss-dock-row'),
      );
      let card = document.querySelector('[contenteditable="true"]');
      while (card && card !== document.body) {
        const cs = getComputedStyle(card);
        if (parseFloat(cs.borderTopLeftRadius) >= 10 && card.getBoundingClientRect().height >= 80) break;
        card = card.parentElement;
      }
      const top = row.getBoundingClientRect();
      const bottom = card.getBoundingClientRect();
      return { x: top.x, y: top.y, width: Math.max(top.width, bottom.width), height: bottom.bottom - top.y };
    });
  for (let i = 0; i < 4; i += 1) {
    await page.waitForTimeout(i === 0 ? 350 : 1000);
    const dockClip = await shot(`04-tick-0${i + 1}`, { rect: await dockRect(), pad: 10, note: 'dock countdown frame' });
    if (i === 0 && dockClip) {
      record.geometry['04-tick-01'].anchors = await anchors(dockClip, {
        row: '.ss-dock-row',
        edit: '.ss-dock-row button:nth-of-type(1)',
        pause: '.ss-dock-row button:nth-of-type(2)',
        del: '.ss-dock-row button:nth-of-type(3)',
        steer: '.ss-dock-row button:nth-of-type(4)',
      });
      record.geometry['04-tick-01'].buttonCount = await page.evaluate(
        () => document.querySelectorAll('.ss-dock-row button').length,
      );
    }
  }

  // 5. 到点送达：/later 以用户身份发出，气泡带插件的标记（meta 档）
  const bubble = await (async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const r = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[class*="ss-later"], [class*="chat-node"], [class*="message"]')];
        const hit = nodes.find((n) => (n.textContent || '').includes('检查部署结果'));
        if (!hit) return null;
        const b = hit.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      });
      if (r) return r;
      await page.waitForTimeout(400);
    }
    return null;
  })();
  record.notes.push(`delivered bubble: ${bubble ? 'found' : 'MISSING'}`);
  if (bubble) {
    await shot('05-delivered', { rect: bubble, pad: 30, note: 'delivered bubble + marker' });
    await page.mouse.move(bubble.x + bubble.width / 2, bubble.y + bubble.height / 2);
    await page.waitForTimeout(700);
    await shot('06-delivered-hover', { rect: bubble, pad: 30, note: 'bubble hover state' });
  }

  // 6. 侧栏：本会话排 +40m（紫），另开一个会话排 +4m（琥珀）
  await editor.click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.type('/schedule +40m 周五前把发布说明写完', { delay: 14 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '新会话' || x.getAttribute('aria-label') === '新建会话',
    );
    b?.click();
  });
  await page.waitForTimeout(2200);
  const ed2 = page.locator('[contenteditable="true"]').first();
  await ed2.click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.type('/schedule +4m 盯一下构建结果', { delay: 14 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  const badgeDeadline = Date.now() + 90000;
  let states = [];
  while (Date.now() < badgeDeadline) {
    states = await page.evaluate(() =>
      [...document.querySelectorAll('.ss-presence')].map((el) => ({
        state: el.getAttribute('data-state'),
        title: el.getAttribute('title'),
        rect: (() => {
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        })(),
      })),
    );
    if (states.length > 0) break;
    await page.waitForTimeout(2000);
  }
  record.notes.push(`presence: ${JSON.stringify(states.map((s) => s.state))}`);

  for (const s of states.slice(0, 2)) {
    const row = await page.evaluate((rect) => {
      const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const r0 = el?.closest('[role="treeitem"]') ?? el?.parentElement?.parentElement;
      const b = r0.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }, s.rect);
    if (!row) continue;
    await shot(`07-sidebar-${s.state}`, { rect: row, pad: 10, note: `badge state ${s.state}` });
    await page.mouse.move(s.rect.x + s.rect.width / 2, s.rect.y + s.rect.height / 2);
    await page.waitForTimeout(900);
    await shot(`08-sidebar-hover-${s.state}`, {
      rect: { x: row.x, y: row.y, width: 620, height: 300 },
      pad: 8,
      note: `hover card, ${s.title}`,
    });
    await page.mouse.move(700, 200);
    await page.waitForTimeout(300);
  }
  // 7. 侧栏第二遍：4 倍像素，去片子里放大时不糊
  const hi = await browser.newContext({
    viewport: vp,
    locale: 'zh-CN',
    colorScheme: 'dark',
    deviceScaleFactor: 4,
  });
  await hi.addCookies([{ ...cookie, domain: '127.0.0.1', path: '/' }]);
  const hiPage = await hi.newPage();
  await hiPage.goto(BASE || `http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await hiPage.waitForTimeout(3000);
  const hiStates = await hiPage.evaluate(() =>
    [...document.querySelectorAll('.ss-presence')].map((el) => ({
      state: el.getAttribute('data-state'),
      title: el.getAttribute('title'),
      rect: (() => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      })(),
    })),
  );
  record.notes.push(`hi-dpr presence: ${JSON.stringify(hiStates.map((s) => s.state))}`);
  for (const st of hiStates.slice(0, 2)) {
    const row = await hiPage.evaluate((r0) => {
      const el = document.elementFromPoint(r0.x + r0.width / 2, r0.y + r0.height / 2);
      const r1 = el?.closest('[role="treeitem"]') ?? el?.parentElement?.parentElement;
      const b = r1.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }, st.rect);
    const name = `09-sidebar-4x-${st.state}`;
    await hiPage.screenshot({
      path: join(OUT, `${name}.png`),
      clip: { x: Math.max(0, Math.round(row.x - 8)), y: Math.max(0, Math.round(row.y - 8)), width: Math.round(row.width + 16), height: Math.round(row.height + 16) },
    });
    record.shots.push({ name, note: `4x DPR row, ${st.state}`, dpr: 4 });
    console.log(`[capture] ${name}`);
    await hiPage.mouse.move(st.rect.x + st.rect.width / 2, st.rect.y + st.rect.height / 2);
    await hiPage.waitForTimeout(900);
    const hname = `10-sidebar-hover-4x-${st.state}`;
    await hiPage.screenshot({
      path: join(OUT, `${hname}.png`),
      clip: { x: Math.max(0, Math.round(row.x - 8)), y: Math.max(0, Math.round(row.y - 8)), width: 620, height: 300 },
    });
    record.shots.push({ name: hname, note: `4x DPR hover card, ${st.state}`, dpr: 4 });
    console.log(`[capture] ${hname}`);
    await hiPage.mouse.move(700, 200);
    await hiPage.waitForTimeout(300);
  }
  await hi.close();

  // 8. 面板：空输入框时那个按钮是禁用的，所以新开一个会话、先写字再点开
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '新会话');
    b?.click();
  });
  await page.waitForTimeout(2500);
  const ed3 = page.locator('[contenteditable="true"]').first();
  await ed3.click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.type('把发布说明写完再睡', { delay: 18 });
  await page.waitForTimeout(300);
  const btn2 = page.locator('.ss-sched-btn').first();
  await btn2.click({ timeout: 8000 }).catch(() => {});
  if (await waitFor('.ss-panel', 6000)) {
    await page.waitForTimeout(700);
    await shot('02-panel', { selector: '.ss-panel', pad: 6, note: 'panel, real click' });
  } else {
    record.notes.push('panel did not open (late pass)');
  }

  // 9. 收尾清理：采集期间挂的提醒不留给线上会话，避免它们在用户实例里到点唤醒模型
  let removed = 0;
  for (let i = 0; i < 12; i += 1) {
    if ((await page.locator('[aria-label="删除提醒"]').count()) === 0) break;
    await page.locator('[aria-label="删除提醒"]').first().click().catch(() => {});
    removed += 1;
    await page.waitForTimeout(500);
  }
  record.notes.push(`reminders cleaned: ${removed}`);
} finally {
  record.errors = record.errors.slice(0, 10);
  writeFileSync(join(OUT, 'capture.json'), `${JSON.stringify(record, null, 2)}\n`);
  await browser.close();
  if (!BASE) stopInstance(HOME);
}
console.log(`[capture] done · ${record.shots.length} shots → ${OUT}`);
