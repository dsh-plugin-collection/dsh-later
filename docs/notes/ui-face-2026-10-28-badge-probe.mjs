#!/usr/bin/env node
/**
 * 逐代次 **侧栏 badge 探针**（一次性驱动，.verify/ 内）。
 *
 * 回答的问题：`HOST_DOM.sessionRow = '[role="treeitem"][draggable="true"]'` +
 * `aria-expanded` 排除规则，在每一代真 GUI 里到底能不能命中会话行；
 * 命中不到时，新增的漂移自检（console.warn）有没有告出来。
 *
 * 手段：真实例真回合 + 在**实例副本**的 lib/client.js 里插一行 console.debug，
 * 把 scan 看到的 rows / badgeable / indexSize 打出来（仓库源码未改，副本每次重建）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInstance, seedWorkspaceStore, startWeb, stopInstance } from '../scripts/ui-matrix/instance.mjs';
import { loadPlaywright, mintCookie } from '../scripts/ui-matrix/capture.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const VERSIONS = (opt('versions', '0.1.2-rc.1,0.1.5-rc.3,0.1.7-rc.1,0.1.7-rc.2,0.2.0-rc.2,0.2.1-rc.2')).split(',');
const VERSIONS_ROOT = resolve(opt('versions-root', '/home/wujue/dsh-versions'));
const OUT = resolve(opt('out', join(ROOT, '.verify', 'badge-probe')));
const PORT0 = Number(opt('port-base', 3600));

const ANCHOR = 'const rows = Array.from(document.querySelectorAll(HOST_DOM.sessionRow));\n    if (rows.length > 0) {';
const PROBE = 'const rows = Array.from(document.querySelectorAll(HOST_DOM.sessionRow));\n'
  + '    console.debug("BP " + JSON.stringify({ rows: rows.length, badgeable: rows.filter((r) => !r.hasAttribute(HOST_DOM.workspaceRowAttr)).length, indexSize: index.size }));\n'
  + '    if (rows.length > 0) {';

mkdirSync(OUT, { recursive: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true });
const rows = [];

for (const [i, VERSION] of VERSIONS.entries()) {
  const PORT = PORT0 + i;
  const HOME = join(OUT, 'homes', VERSION);
  const dir = join(OUT, VERSION);
  mkdirSync(dir, { recursive: true });
  const rec = { version: VERSION, port: PORT, verdict: 'UNKNOWN' };
  const probes = [];
  const con = [];
  try {
    const inst = createInstance({ version: VERSION, versionsRoot: VERSIONS_ROOT, pluginDir: ROOT, home: HOME });
    seedWorkspaceStore(HOME);
    const copy = join(inst.profileDir, 'node_modules', 'dsh-later', 'lib', 'client.js');
    const src = readFileSync(copy, 'utf8');
    if (!src.includes(ANCHOR)) throw new Error('探针锚点未命中（产物形态变了）');
    writeFileSync(copy, src.replace(ANCHOR, PROBE));
    await startWeb({ versionRoot: join(VERSIONS_ROOT, VERSION), home: HOME, profile: 'ui', port: PORT });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', deviceScaleFactor: 1 });
    await context.addCookies([{ ...mintCookie(PORT), domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    page.on('console', (m) => {
      const t = m.text();
      if (t.startsWith('BP ')) { probes.push(JSON.parse(t.slice(3))); return; }
      if (m.type() === 'warning' || m.type() === 'error' || m.type() === 'pageerror') con.push({ type: m.type(), text: t.slice(0, 220) });
    });
    page.on('pageerror', (e) => con.push({ type: 'pageerror', text: String(e).slice(0, 220) }));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    for (const label of ['继续', '知道了', '暂不开启', 'Got it', 'Continue']) {
      await page.evaluate((l) => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === l)?.click(); }, label);
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /新建会话|New session|新会话/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))?.click(); });
    await page.waitForTimeout(3500);
    rec.buttonFound = await page.evaluate(() => document.querySelectorAll('[class*="ss-sched-btn"]').length > 0);

    const ed = page.locator('[contenteditable="true"]').first();
    await ed.click({ timeout: 12000 }).catch(() => {});
    await page.keyboard.type(`/later +25m badge探针 ${VERSION}`, { delay: 5 });
    await page.keyboard.press('Enter');
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      const dockRows = await page.evaluate(() => [...document.querySelectorAll('[class*="ss-dock-row"]')]
        .filter((e) => String(e.className).split(/\s+/).includes('ss-dock-row')).length);
      if (dockRows > 0 && probes.some((p) => p.indexSize > 0)) break;
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2500);
    const dom = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[role="treeitem"]')];
      return {
        badges: document.querySelectorAll('.ss-presence').length,
        selectorRows: document.querySelectorAll('[role="treeitem"][draggable="true"]').length,
        badgeable: [...document.querySelectorAll('[role="treeitem"][draggable="true"]')].filter((r) => !r.hasAttribute('aria-expanded')).length,
        treeitems: all.length,
        nonExpanded: all.filter((r) => !r.hasAttribute('aria-expanded')).map((r) => ({
          draggable: r.getAttribute('draggable'),
          cls: String(r.className).slice(0, 40),
          text: (r.textContent || '').trim().slice(0, 14),
        })).slice(0, 4),
        dockRows: [...document.querySelectorAll('[class*="ss-dock-row"]')].filter((e) => String(e.className).split(/\s+/).includes('ss-dock-row')).length,
      };
    });
    Object.assign(rec, {
      dom,
      probes: { count: probes.length, last: probes[probes.length - 1] ?? null, everIndex: probes.some((p) => p.indexSize > 0), everBadgeable: probes.some((p) => p.badgeable > 0) },
      driftWarn: con.filter((c) => c.type === 'warning' && /badge|侧栏|会话行/.test(c.text)).map((c) => c.text.slice(0, 180)),
      consoleErrors: con.filter((c) => c.type !== 'warning'),
    });
    rec.verdict = dom.badges > 0 ? 'BADGE-OK'
      : (rec.probes.everIndex ? (dom.badgeable === 0 ? 'BADGE-MISSING-DOM-DRIFT' : 'BADGE-MISSING-OTHER') : 'BADGE-NO-DATA(未判定)');
    await page.screenshot({ path: join(dir, `${VERSION}-sidebar-real-gui.png`) });
  } catch (error) {
    rec.verdict = 'BOOT-FAILED(未判定)';
    rec.error = String(error?.message ?? error).slice(0, 300);
  } finally {
    stopInstance(HOME);
    await new Promise((d) => setTimeout(d, 1200));
  }
  rows.push(rec);
  console.log(`${VERSION.padEnd(14)} ${rec.verdict.padEnd(24)} badge=${rec.dom?.badges ?? '-'} rows=${rec.dom?.selectorRows ?? '-'} badgeable=${rec.dom?.badgeable ?? '-'} index=${rec.probes?.last?.indexSize ?? '-'} warn=${rec.driftWarn?.length ?? 0} 非展开行=${JSON.stringify(rec.dom?.nonExpanded ?? [])}`);
  writeFileSync(join(OUT, 'badge-probe.json'), JSON.stringify(rows, null, 2) + '\n');
}
await browser.close();
writeFileSync(join(OUT, 'badge-probe.json'), JSON.stringify(rows, null, 2) + '\n');
console.log(`\n→ ${join(OUT, 'badge-probe.json')}`);
