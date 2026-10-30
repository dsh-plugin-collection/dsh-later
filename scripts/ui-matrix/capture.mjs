#!/usr/bin/env node
/**
 * 单代次 UI 截图：**一个作曲行 + 三条可指认的证据**。
 *
 * 拍什么（每代次三张，缺一张就说明那一面没验证到）：
 *  1. `1-composer` — 作曲行右侧的「定时发送」按钮在位（client bundle 在该代次加载成功）；
 *  2. `2-dock`     — 发一条 `/later +30m …`（走**真实命令通道**，不触发模型）后，dock 里出现
 *                    待发送行：时间、倒计时、正文、编辑/暂停/删除/插话四个动作；
 *  3. `3-panel`    — 点按钮展开的面板。
 *
 * 为什么用命令造数据而不是点面板表单：面板的快捷档会随"现在"漂移，而命令的 `+30m` 是相对量，
 * 六代跑下来行为一致；同时它验证的是**命令通道 + dock 投影**这条主链路。
 *
 * @module scripts/ui-matrix/capture
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * 找 playwright：本仓 devDependencies 里没有它（那是 UI 采集件的既有约定 —— CI 不装、不进 CI）。
 *
 * 解析顺序：`PLAYWRIGHT_MODULE` 环境变量（指向包目录）→ 裸 `playwright`（全局/本地已装）。
 * @returns {Promise<any>} playwright 模块。
 */
export async function loadPlaywright() {
  const explicit = process.env.PLAYWRIGHT_MODULE;
  if (explicit !== undefined && explicit.length > 0) {
    const require = createRequire(`${explicit.replace(/\/+$/, '')}/`);
    return require('playwright');
  }
  return import('playwright');
}

/**
 * 用本机凭据铸 web GUI 的会话 cookie（web 侧鉴权，与真机同一条路径）。
 * @param {number} port
 * @returns {{ name: string, value: string }}
 */
export function mintCookie(port) {
  const script = new URL('../capture/mint-cookie.cjs', import.meta.url).pathname;
  const raw = execFileSync(process.execPath, [script, `127.0.0.1:${port}`], { encoding: 'utf8' }).trim().split('\n').pop() ?? '';
  const eq = raw.indexOf('=');
  if (eq <= 0) throw new Error(`mint-cookie 输出无法解析：${raw.slice(0, 80)}`);
  return { name: raw.slice(0, eq), value: raw.slice(eq + 1) };
}

/**
 * 采集一个代次的 UI 证据。
 *
 * @param {object} options
 * @param {number} options.port - 已启动实例的端口。
 * @param {string} options.outDir - 截图目录。
 * @param {string} options.version - 代次名（用于文件名）。
 * @param {string} [options.prompt] - 用来造待发送行的命令内容。
 * @returns {Promise<{
 *   version: string,
 *   shots: Record<string, string>,
 *   dockRows: number,
 *   panelOpened: boolean,
 *   buttonFound: boolean,
 *   errors: string[],
 * }>}
 */
export async function captureUi({ port, outDir, version, prompt }) {
  // 正文里带代次：两张截图长得一模一样时（同分钟 + 同倒计时 + 同字体），只有正文能自证是哪一代。
  const text = prompt ?? `截图矩阵 ${version}：这条会出现在 dock 里`;
  const { chromium } = await loadPlaywright();
  mkdirSync(outDir, { recursive: true });
  const cookie = mintCookie(port);
  const browser = await chromium.launch({ headless: true });
  const result = {
    version,
    shots: {},
    dockRows: 0,
    panelOpened: false,
    buttonFound: false,
    badges: 0,
    errors: [],
    strictErrors: [],
    /**
     * console **warning** 单独收（`warns`），并把 badge 漂移自检那一条挑出来（`driftWarns`）。
     * 此前这里只收 `error`，于是"控制台 0 错误"这个结论完全掩盖了漂移告警——2026-10-28
     * 那次四代 badge 整块不出现、自检一条没告，采集面也同样是瞎的。
     */
    warns: [],
    driftWarns: [],
  };
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      deviceScaleFactor: 2,
    });
    await context.addCookies([{ ...cookie, domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    page.on('console', (m) => {
      const text = m.text().slice(0, 240);
      if (m.type() === 'warning') {
        result.warns.push(text);
        if (text.includes('badge 未注入')) result.driftWarns.push(text);
        return;
      }
      if (m.type() !== 'error') return;
      result.errors.push(text);
      // 资源 404/401 只记不判红：老代次少一两个静态资源（favicon 之类）不该掩盖真正的 JS 错误。
      if (!/Failed to load resource/.test(text)) result.strictErrors.push(text);
    });
    page.on('pageerror', (e) => {
      const text = `pageerror: ${String(e).slice(0, 240)}`;
      result.errors.push(text);
      result.strictErrors.push(text);
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    // 「预览版说明」遮罩会盖住整页，不关掉任何点击都点不到（六代都有，0.1.2 起）。
    await page.evaluate(() => {
      const again = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '继续');
      again?.click();
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const fresh = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '新会话' || b.getAttribute('aria-label') === '新建会话');
      fresh?.click();
    });
    await page.waitForTimeout(3500);
    result.shots.composer = join(outDir, `${version}-1-composer.png`);
    await page.screenshot({ path: result.shots.composer });

    // 用真实命令通道造一条待发送提醒（不烧模型：命令在本地处理）。
    result.buttonFound = (await page.locator('[class*="ss-sched-btn"]').count()) > 0;
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    const draft = async () => {
      await editor.click({ timeout: 10_000 }).catch(() => {});
      await page.keyboard.type(`/later +30m ${text}`, { delay: 8 });
      await page.keyboard.press('Enter');
      // 等 dock 里真的出现待发送行（老代次渲染更慢，固定 sleep 会假红）
      for (let i = 0; i < 20; i += 1) {
        // 数**精确类名** `ss-dock-row` 的元素（一行一个）。用子串选择器会把
        // `ss-dock-row-line` / `-time` / `-countdown` / `-prompt` 也算进去 —— 一行数成 5。
        // 另外 `ss-sched-row` 是作曲行旁的芯片，先出现，不能当 dock 行。
        const rows = await page.evaluate(() => [...document.querySelectorAll('[class*="ss-dock-row"]')]
          .filter((el) => String(el.className).split(/\s+/).includes('ss-dock-row')).length);
        if (rows > 0) return rows;
        await page.waitForTimeout(500);
      }
      return 0;
    };
    let rows = await draft();
    if (rows === 0) rows = await draft(); // 老编辑器偶发吞第一次回车：重试一次，别把抖动当缺陷
    result.dockRows = rows;
    result.dockRows = await page.evaluate(() => {
      const exact = [...document.querySelectorAll('[class*="ss-dock-row"]')]
        .filter((el) => String(el.className).split(/\s+/).includes('ss-dock-row')).length;
      return exact;
    });
    result.shots.dock = join(outDir, `${version}-2-dock.png`);
    await page.screenshot({ path: result.shots.dock });

    // 面板：先试真鼠标点击（被遮挡会自动重试），失败再退回 DOM 点击。
    const button = page.locator('[class*="ss-sched-btn"]').first();
    if ((await button.count()) > 0) {
      const waitPanel = async (limitMs) => {
        const deadline = Date.now() + limitMs;
        while (Date.now() < deadline) {
          if (await page.evaluate(() => !!document.querySelector('[class*="ss-panel"], [class*="ss-sched-panel"]'))) return true;
          await page.waitForTimeout(400);
        }
        return false;
      };
      await button.click({ timeout: 6000 }).catch(() => {});
      result.panelOpened = await waitPanel(6000);
      if (!result.panelOpened) {
        await page.evaluate(() => document.querySelector('[class*="ss-sched-btn"]')?.click());
        result.panelOpened = await waitPanel(6000);
      }
    }
    result.shots.panel = join(outDir, `${version}-3-panel.png`);
    await page.screenshot({ path: result.shots.panel });

    /**
     * 侧栏 badge。这一面此前**根本不在判据里**，所以它在四代上整块消失时矩阵仍然
     * `exit 0` —— "前五面全绿 ≠ 插件能用"的活标本。
     *
     * 必须轮询而不是固定 sleep：badge 的数据来自摘要 store，它有 30s 状态 tick 与
     * 60s 列表重拉，实测 `indexSize` 要等若干轮扫描才起来（前 8 次扫描都是 0，
     * 只看前几条会误判成"数据面也漂了"）。
     */
    const badgeDeadline = Date.now() + 150_000;
    let sidebar = { badges: 0, matched: 0, badgeable: 0 };
    do {
      sidebar = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[role="treeitem"]')];
        return {
          badges: document.querySelectorAll('.ss-presence').length,
          matched: rows.length,
          badgeable: rows.filter((r) => !r.hasAttribute('aria-expanded')).length,
        };
      });
      if (sidebar.badges > 0) break;
      await page.waitForTimeout(2000);
    } while (Date.now() < badgeDeadline);
    result.badges = sidebar.badges;
    result.badgeRows = sidebar;
    // 失败项也要出图：badge 没出现时这张就是证据，别只交成功的那几张。
    result.shots.badge = join(outDir, `${version}-4-badge-${sidebar.badges > 0 ? 'PASS' : 'FAIL'}.png`);
    await page.screenshot({ path: result.shots.badge });
  } finally {
    await browser.close();
  }
  return result;
}
