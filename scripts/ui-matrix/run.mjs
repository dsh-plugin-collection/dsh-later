#!/usr/bin/env node
/**
 * 跨内核代次 **UI 面**矩阵：一条命令把每一代的 GUI 拉起来、拍三张证据、拼成一页矩阵。
 *
 *     npm run verify:ui                                   # 跑 KERNEL_GENERATIONS 全部代次
 *     npm run verify:ui -- --versions 0.1.2-rc.1,0.2.1-rc.2
 *     PLAYWRIGHT_MODULE=<playwright 包目录> npm run verify:ui
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KERNEL_GENERATIONS } from '../../lib/upstream-compat.js';
import { captureUi } from './capture.mjs';
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
const given = (opt('versions', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VERSIONS = given.length ? given : KERNEL_GENERATIONS.map((g) => g.id ?? g);

/**
 * 生成矩阵页（纯函数，能被测试直接调）。
 * @param {Array<{version: string, ok: boolean, error?: string, dockRows?: number, panelOpened?: boolean, buttonFound?: boolean, errors?: string[], shots?: Record<string,string>}>} rows
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
    if (!row.ok) return `<div class="bad">未能启动：${(row.error ?? '未知原因').slice(0, 160)}</div>`;
    const bits = [
      `按钮：${row.buttonFound ? '在' : '缺'}`,
      `dock 行：${row.dockRows ?? 0}`,
      `面板：${row.panelOpened ? '打开' : '未打开'}`,
      `控制台错误：${(row.errors ?? []).length}`,
    ];
    const cls = row.buttonFound && row.dockRows > 0 && row.panelOpened && (row.errors ?? []).length === 0 ? 'good' : 'warn';
    return `<div class="${cls}">${bits.join('　')}</div>`;
  };
  const body = rows.map((row) => `
  <tr>
    <th><div class="ver">${row.version}</div>${status(row)}</th>
    ${['composer', 'dock', 'panel'].map((key) => `<td>${cell(row, key)}</td>`).join('')}
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
      console.log(`按钮=${capture.buttonFound ? 'Y' : 'N'} dock=${capture.dockRows} 面板=${capture.panelOpened ? 'Y' : 'N'} 错误=${capture.errors.length}`);
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
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n汇总：成功 ${rows.length - failed} / 失败 ${failed}；矩阵 ${join(OUT, 'matrix.html')}`);
  return rows;
}

// 只在被当作脚本运行时执行（import 时保持纯函数，测试要 import renderMatrixHtml）。
const invoked = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invoked !== undefined && invoked === fileURLToPath(import.meta.url)) {
  const rows = await runMatrix();
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}
