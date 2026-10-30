#!/usr/bin/env node
/**
 * 跨内核代次 **UI 面**矩阵：一条命令把每一代的 GUI 拉起来、拍三张证据、拼成一页矩阵。
 *
 *     npm run verify:ui                                   # 跑 KERNEL_GENERATIONS 全部代次
 *     npm run verify:ui -- --versions 0.1.2-rc.1,0.2.1-rc.2
 *     PLAYWRIGHT_MODULE=<playwright 包目录> npm run verify:ui
 *     npm run verify:ui -- --evidence docs/media/ui-matrix   # 同时落一份**进仓**的证据
 *
 * 产物（默认 `.verify/ui-matrix/`，已在 .gitignore）：
 *   - `<version>-{1-composer,2-dock,3-panel}.png`
 *   - `matrix.json`（逐代次结论：按钮/dock 行数/面板/控制台错误）
 *   - `matrix.html`（点图看原图的一页矩阵；矩阵图与结论同源，不会各说一套）
 *
 * ## 与另外两个验证入口的分工
 *
 * | 入口 | 面 | 证据形态 |
 * |---|---|---|
 * | `verify:kernels --steps mount,function` | 装配 + 功能 | 进程内事件形状（spliced / dispatch） |
 * | `verify:kernels --steps type` | 类型 | 换线树 tsc 两个项目 |
 * | `verify:ui`（本文件） | UI | 真 GUI 截图 + 三处 DOM/交互判据 |
 *
 * UI 面是"画出来、点得动"，只能看；所以这里的判据是**结构性**的（按钮在、dock 有行、面板开了、
 * 控制台零错误），截图作为人眼复核材料 —— 不给像素阈值，避免把字体渲染差异当成回归。
 * @module scripts/ui-matrix/run
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KERNEL_GENERATIONS } from '../../lib/upstream-compat.js';
import { captureUi, loadPlaywright } from './capture.mjs';
import { createInstance, listVersionTrees, seedWorkspaceStore, startWeb, stopInstance } from './instance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const VERSIONS_ROOT = resolve(opt('versions-root', join(homedir(), 'dsh-versions')));
const OUT = resolve(opt('out', join(ROOT, '.verify', 'ui-matrix')));
const PORT_BASE = Number(opt('port-base', 3500));
const EVIDENCE = opt('evidence', '');
const given = (opt('versions', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VERSIONS = given.length ? given : KERNEL_GENERATIONS.map((g) => g.id ?? g);

/**
 * 一行的结论。**唯一一份** —— HTML、matrix.json、进程退出码都必须走它。
 *
 * 为什么要抽出来：此前"合格"的判据在 HTML 里写一遍，退出码在另一处用 `rows.every(ok)`
 * 判一遍，而 `ok` 只代表"浏览器起来了 + 截图没炸"。结果 badge 在 4 个代次整块不出现，
 * 矩阵仍然 `exit 0`。同一个结论算两次，就一定会漂成两个不同的结论。
 *
 * @param {Record<string, any>} row
 * @returns {{pass: boolean, bits: string[]}}
 */
export function rowVerdict(row) {
  if (row.ok !== true) return { pass: false, bits: [`未能启动：${String(row.error ?? '未知原因').slice(0, 160)}`] };
  const bits = [
    `按钮：${row.buttonFound ? '在' : '缺'}`,
    `dock 行：${row.dockRows ?? 0}`,
    `面板：${row.panelOpened ? '打开' : '未打开'}`,
    `侧栏 badge：${row.badges ?? 0}`,
    `控制台错误：${(row.errors ?? []).length}`,
    `警告：${(row.warns ?? []).length}`,
  ];
  const pass = Boolean(row.buttonFound)
    && (row.dockRows ?? 0) > 0
    && row.panelOpened === true
    // badge 进判据：它是"用户在侧栏看得见提醒"这一面的唯一证据。此前它根本不被观测。
    && (row.badges ?? 0) > 0
    && (row.errors ?? []).length === 0;
  // 自检告过警说明"漂了但至少说话了"，与"无声消失"区分开——后者更糟。
  if ((row.driftWarns ?? []).length > 0) bits.push('⚠ 自检已报宿主 DOM 漂移');
  return { pass, bits };
}

/**
 * 生成矩阵页（纯函数，能被测试直接调）。
 * @param {Array<{version: string, ok: boolean, error?: string, dockRows?: number, panelOpened?: boolean, buttonFound?: boolean, badges?: number, errors?: string[], warns?: string[], shots?: Record<string,string>}>} rows
 * @param {{title?: string, generatedAt?: string}} [meta]
 * @returns {string} HTML
 */
export function renderMatrixHtml(rows, meta = {}) {
  const cell = (row, key) => {
    const shot = row.shots?.[key];
    if (shot === undefined) return '<div class="miss">（未截到）</div>';
    const file = shot.split('/').pop();
    return `<a href="${file}" target="_blank"><img src="${file}" alt="${file}" loading="lazy"></a>`;
  };
  const status = (row) => {
    const { pass, bits } = rowVerdict(row);
    return `<div class="${pass ? 'good' : 'warn'}">${bits.join('　')}</div>`;
  };
  const body = rows.map((row) => `
  <tr>
    <th><div class="ver">${row.version}</div>${status(row)}</th>
    ${['composer', 'dock', 'panel', 'badge'].map((key) => `<td>${cell(row, key)}</td>`).join('')}
  </tr>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${meta.title ?? 'UI 矩阵'}</title>
<style>
  body { font: 14px/1.55 -apple-system, "Segoe UI", "Noto Sans CJK SC", sans-serif; margin: 28px; color: #1b1b1f; background: #fafaf9; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { color: #6b6b76; margin-bottom: 18px; }
  table { border-collapse: collapse; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  th, td { border: 1px solid #e6e6ea; padding: 10px; vertical-align: top; }
  thead th { background: #f4f4f5; text-align: left; }
  th { text-align: left; width: 230px; }
  .ver { font: 600 15px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .good { color: #1a7f37; font-size: 12px; margin-top: 4px; }
  .warn { color: #8a4b00; font-size: 12px; margin-top: 4px; }
  .bad { color: #b42318; font-size: 12px; margin-top: 4px; }
  img { width: 420px; display: block; border: 1px solid #ececf1; border-radius: 4px; }
  .miss { width: 420px; height: 120px; display: grid; place-items: center; color: #9a9aa5; background: #f6f6f7; border: 1px dashed #d9d9e0; border-radius: 4px; }
  footer { margin-top: 16px; color: #6b6b76; font-size: 12px; }
</style></head><body>
<h1>${meta.title ?? 'dsh-later · 跨内核代次 UI 截图矩阵'}</h1>
<div class="sub">每格都是真内核隔离实例 + 独立 headless Chromium；待发送行由同一条命令 <code>/later +30m …</code> 经真实命令通道造出（不烧模型）。点图看原图。</div>
<table><thead><tr><th>DSH 代次</th><th>作曲行 + 定时按钮</th><th>待发送 dock</th><th>面板展开</th></tr></thead>
<tbody>${body}
</tbody></table>
<footer>生成时间：${meta.generatedAt ?? new Date().toLocaleString('zh-CN')} · 插件 ${meta.pluginVersion ?? ''}</footer>
</body></html>`;
}

/**
 * 生成"进仓证据"的清单（纯函数，便于测试）。
 *
 * 为什么还要这份清单：截图原件在 `.verify/`（26M、含实例目录、随时可重跑），进仓只放
 * ① 一页拼图 ② 每代的 dock 缩略图 ③ 本清单。清单把"哪次运行、什么结论、对应哪个文件、
 * 文件的 sha256"钉在一起 —— 只留图不留口径，过两周就没人说得清那张图跑的是哪一版。
 * @param {Array<object>} rows - runMatrix 的行。
 * @param {{pluginVersion: string, commit: string, capturedAt?: string, files?: Record<string, {bytes: number, sha256: string}>}} meta
 * @returns {object} 清单对象。
 */
export function buildEvidenceManifest(rows, meta) {
  const frames = rows.map((row) => {
    const evidence = `${row.version}-dock.png`;
    const file = meta.files?.[evidence];
    return {
      version: row.version,
      verdict: rowVerdict(row).pass ? 'PASS' : 'FAIL',
      button: row.buttonFound ?? null,
      dockRows: row.dockRows ?? 0,
      panelOpened: row.panelOpened ?? false,
      // badge 与 warning 都要进产物：缺了它们，"全绿"这个词就还是不可信的。
      badges: row.badges ?? 0,
      badgeRows: row.badgeRows ?? null,
      consoleErrors: (row.strictErrors ?? []).length,
      consoleWarnings: (row.warns ?? []).length,
      driftWarns: (row.driftWarns ?? []).length,
      error: row.error ?? null,
      evidence: file === undefined ? null : { file: evidence, bytes: file.bytes, sha256: file.sha256 },
      sources: row.shots ?? {},
    };
  });
  return {
    pluginVersion: meta.pluginVersion,
    commit: meta.commit,
    capturedAt: meta.capturedAt ?? new Date().toISOString(),
    deviceScaleFactor: 2,
    howToRegenerate: 'npm run verify:ui -- --evidence docs/media/ui-matrix（需要 playwright 与本地版本树）',
    frames,
  };
}

/** 跑 `convert` 等比缩放到目标宽度（进仓的缩略图，别把 26M 原件搬进仓库）。 */
function downscale(src, dst, width) {
  spawnSync('convert', [src, '-resize', `${width}x`, '-strip', dst], { encoding: 'utf8' });
}

/**
 * 落一份**进仓证据**：拼图 + 每代 dock 缩略图 + 清单。
 * @param {Array<object>} rows
 * @param {string} dir - 证据目录（如 docs/media/ui-matrix）。
 * @returns {Promise<string>} 清单路径。
 */
async function writeEvidence(rows, dir) {
  mkdirSync(dir, { recursive: true });
  const files = {};
  const record = (name, path) => {
    if (!existsSync(path)) return;
    files[name] = { bytes: statSync(path).size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  };
  // ① 一页拼图（直接对 matrix.html 截图：结论与图同源，不会各写一套）
  const sheet = join(dir, 'matrix.png');
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(`file://${join(OUT, 'matrix.html')}`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: sheet, fullPage: true });
  } finally {
    await browser.close();
  }
  record('matrix.png', sheet);
  // ② 每代 dock 缩略图（900px 宽，~40KB）
  for (const row of rows) {
    const src = row.shots?.dock;
    if (src === undefined) continue;
    const name = `${row.version}-dock.png`;
    const dst = join(dir, name);
    downscale(src, dst, 900);
    record(name, dst);
  }
  // ③ 清单
  const manifest = buildEvidenceManifest(rows, {
    pluginVersion: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    commit: spawnSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    files,
  });
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

/** 逐代次跑一遍（导出便于测试时替换实现）。 */
export async function runMatrix(versions = VERSIONS) {
  const pluginVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const rows = [];
  let port = PORT_BASE;
  for (const version of versions) {
    port += 1;
    const home = join(OUT, 'instances', version);
    const row = { version, ok: false };
    process.stdout.write(`\n### ${version} … `);
    try {
      if (!existsSync(join(VERSIONS_ROOT, version, 'node_modules', '@deepseek-ai', 'dsh'))) {
        const known = listVersionTrees(VERSIONS_ROOT);
        throw new Error(`版本树不存在：${VERSIONS_ROOT}/${version}（已装：${known.join(', ') || '无'}）`);
      }
      createInstance({ version, versionsRoot: VERSIONS_ROOT, pluginDir: ROOT, home });
      seedWorkspaceStore(home);
      const started = await startWeb({ versionRoot: join(VERSIONS_ROOT, version), home, profile: 'ui', port });
      process.stdout.write(`HTTP ${started.http} `);
      const capture = await captureUi({ port, outDir: OUT, version });
      Object.assign(row, capture, { ok: true });
      console.log(`按钮=${capture.buttonFound ? 'Y' : 'N'} dock=${capture.dockRows} 面板=${capture.panelOpened ? 'Y' : 'N'} badge=${capture.badges} 错误=${capture.errors.length} 警告=${capture.warns.length}`);
    } catch (error) {
      row.error = String(error?.message ?? error);
      console.log(`失败：${row.error.slice(0, 160)}`);
    } finally {
      stopInstance(home);
      await new Promise((done) => setTimeout(done, 800));
    }
    rows.push(row);
  }
  writeFileSync(join(OUT, 'matrix.json'), `${JSON.stringify({ pluginVersion, versions, rows }, null, 2)}\n`);
  writeFileSync(join(OUT, 'matrix.html'), renderMatrixHtml(rows, { pluginVersion }));
  // 结论取自 rowVerdict（与 HTML、manifest 同一份），不再用"浏览器起来了"当"这代能用"。
  const failed = rows.filter((r) => !rowVerdict(r).pass).length;
  console.log(`\n汇总：通过 ${rows.length - failed} / 不通过 ${failed}；矩阵 ${join(OUT, 'matrix.html')}`);
  if (EVIDENCE.length > 0) {
    const manifest = await writeEvidence(rows, resolve(EVIDENCE));
    console.log(`证据：${manifest}（拼图 + 每代 dock 缩略图 + 清单）`);
  }
  return rows;
}

// 只在被当作脚本运行时执行（import 时保持纯函数，测试要 import renderMatrixHtml）。
const invoked = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invoked !== undefined && invoked === fileURLToPath(import.meta.url)) {
  const rows = await runMatrix();
  /**
   * 退出码必须用 rowVerdict，不能用 `r.ok`。`ok` 只代表"浏览器起来了、截图没炸"，
   * 于是 badge 在 4 个代次整块不出现时这条命令仍然报 0 —— 采集件自己把红报成绿。
   */
  process.exit(rows.every((r) => rowVerdict(r).pass) ? 0 : 1);
}
