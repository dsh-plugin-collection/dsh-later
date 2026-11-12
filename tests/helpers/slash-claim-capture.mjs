#!/usr/bin/env node
/**
 * issue #126（GitHub #10）的**真 GUI** A/B 取证：手敲 `/user-schedule-*` 带参数时，
 * 整行是被命令认领，还是被当普通聊天消息发给模型。
 *
 * 判据来源：issue 原文实测「未修 → `POST /api/session/prompt` 1 次；已修 → 0 次且草稿被认领」。
 * 本脚本只做这一件事，**不**复用 `scripts/ui-matrix/capture.mjs`：那条链拍的是
 * 按钮 / dock / 面板 / badge 四面，它的输入路径从没走过「手敲带参命令」，
 * 所以它对本条 issue 是空转的（跑绿了也不证明修复在）。
 *
 * 做法：
 *   1. 起隔离实例（真内核 + 全新 DSH_HOME + 真 Chromium）；
 *   2. 拦网络，记录所有 `POST /api/session/prompt` 请求；
 *   3. 在 composer 里 `insertText` 一条带参命令，按回车；
 *   4. 记：发出的 prompt 请求数、输入框里还剩什么（被认领 = 草稿留下/被消费）。
 *
 * 「未修」那一半靠 `--plugin-dir` 指向 1.11.x 的产物跑同一个流程，差别只允许来自被测代码。
 *
 * 用法：
 *   PLAYWRIGHT_MODULE=<playwright 包目录> node tests/helpers/slash-claim-capture.mjs \
 *     --label fixed --version 0.2.1-rc.4 --port 3621 --out .verify/slash-claim
 *
 * @module tests/helpers/slash-claim-capture
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

const LABEL = opt('label', 'fixed');
const VERSION = opt('version', '0.2.1-rc.4');
const PORT = Number(opt('port', 3621));
const HOME = resolve(opt('home', resolve(ROOT, '.verify', 'slash-claim', LABEL)));
const OUT = resolve(opt('out', resolve(ROOT, '.verify', 'slash-claim')));
/** 被测插件的产物目录：默认本仓；做 A/B 的另一半时指向别的已发布版本。 */
const PLUGIN_DIR = resolve(opt('plugin-dir', ROOT));
/** 被测的插件版本：只用于证据正文自证，不影响流程。 */
const PKG_VERSION = JSON.parse(readFileSync(resolve(PLUGIN_DIR, 'package.json'), 'utf8')).version;

/** 被测的那行：issue 原文里复现用的形状（带 JSON 载荷）。 */
const LINE = '/user-schedule-delete {"id":"schedule-does-not-exist"}';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { versionRoot } = createInstance({
    version: VERSION,
    pluginDir: PLUGIN_DIR,
    home: HOME,
    profile: 'ui',
  });
  seedWorkspaceStore(HOME);
  const started = await startWeb({ versionRoot, home: HOME, profile: 'ui', port: PORT });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const cookie = mintCookie(PORT);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ ...cookie, domain: '127.0.0.1', path: '/' }]);
  const page = await context.newPage();

  /** 所有 POST /api/session/prompt 的载荷，判据就是它的条数。 */
  const promptPosts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/session/prompt')) {
      promptPosts.push({ url: req.url(), body: (req.postData() ?? '').slice(0, 400) });
    }
  });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });

  const result = { label: LABEL, line: LINE, pluginVersion: PKG_VERSION };
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4500);

    // 「Preview Notice」遮罩会盖住整页，不关掉任何点击都点不到。
    // 按钮文案随界面语言变：英文是 "Continue"，中文是「继续」——两种都要认。
    // （ui-matrix/capture.mjs 只找「继续」，在英文界面下匹配不到，这里不复用它的写法。）
    const dismissed = await page.evaluate(() => {
      const label = (b) => (b.textContent || '').trim();
      const target = [...document.querySelectorAll('button')].find((b) => label(b) === 'Continue' || label(b) === '继续');
      target?.click();
      return target !== undefined;
    });
    await page.waitForTimeout(1500);
    result.previewDismissed = dismissed;
    // 确认遮罩真的没了，没掉再点一次（关掉了才敢点 composer，否则点击会被拦截）
    const stillBlocking = await page.evaluate(() => {
      const dialog = document.querySelector('[role="presentation"]');
      if (dialog === null) return false;
      return (dialog.offsetWidth || dialog.offsetHeight) > 0;
    });
    result.overlayStillBlocking = stillBlocking;
    await page.evaluate(() => {
      const label = (b) => (b.textContent || '').trim();
      const fresh = [...document.querySelectorAll('button')].find((b) => label(b) === 'New Session' || label(b) === '新会话' || b.getAttribute('aria-label') === '新建会话');
      fresh?.click();
    });
    await page.waitForTimeout(3500);

    // composer 就绪：等可编辑区出现并可见
    const composer = page.locator('[contenteditable="true"]').first();
    await composer.waitFor({ state: 'visible', timeout: 60_000 });
    await sleep(1000);

    await composer.click();
    await page.keyboard.insertText(LINE);
    await sleep(400);
    result.draftBeforeEnter = await composer.evaluate((el) => el.textContent ?? '');
    const shotBefore = resolve(OUT, `${LABEL}-1-typed.png`);
    await page.screenshot({ path: shotBefore });

    const before = promptPosts.length;
    await page.keyboard.press('Enter');
    await sleep(2500);

    result.promptPostsBefore = before;
    result.promptPostsAfter = promptPosts.length;
    result.promptRequestsIssued = promptPosts.length - before;
    result.promptBodies = promptPosts.slice(before);
    result.draftAfterEnter = await composer.evaluate((el) => el.textContent ?? '');
    result.consoleErrors = consoleErrors;
    const shotAfter = resolve(OUT, `${LABEL}-2-after-enter.png`);
    await page.screenshot({ path: shotAfter });
    result.shots = { typed: shotBefore, afterEnter: shotAfter };
  } finally {
    await browser.close();
    stopInstance(HOME);
  }

  result.verdict = result.promptRequestsIssued === 0 ? 'CLAIMED（被命令认领，未发成聊天消息）' : `LEAKED（${result.promptRequestsIssued} 次 POST /api/session/prompt）`;
  writeFileSync(resolve(OUT, `${LABEL}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label: result.label, pluginVersion: result.pluginVersion, promptRequestsIssued: result.promptRequestsIssued, draftAfterEnter: (result.draftAfterEnter ?? '').slice(0, 80), verdict: result.verdict }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
