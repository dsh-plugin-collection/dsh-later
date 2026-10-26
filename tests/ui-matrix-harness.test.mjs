/**
 * `scripts/ui-matrix/` 的口径契约（issue #95 之后补的 UI 面）。
 *
 * 这条链只在"有窗口的机器"上跑得起来（要 playwright、要真内核树），所以它能被 CI 覆盖的
 * 只有**纯逻辑**：启动器形态判定、模块回退清单补写、矩阵页渲染、以及"采集件不许静态依赖
 * playwright"这条结构约束。真 GUI 的三处判据由 `npm run verify:ui` 在现场产出。
 * @module tests/ui-matrix-harness
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLauncher, ensureModuleFallbackManifest, instanceSummary } from '../scripts/ui-matrix/instance.mjs';
import { renderMatrixHtml } from '../scripts/ui-matrix/run.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

test('classifyLauncher：软链指 JS → node；实体 shell 脚本 → 直接执行（混用会 SyntaxError）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-launcher-'));
  // ① 软链（npm 树的形态）
  const jsTarget = join(dir, 'bin.js');
  writeFileSync(jsTarget, '#!/usr/bin/env node\nconsole.log("ok");\n');
  const link = join(dir, 'dsh-link');
  symlinkSync(jsTarget, link);
  assert.equal(classifyLauncher(link), 'node');

  // ② 实体 shell 脚本（pnpm 树的形态）—— 这就是把 `node .bin/dsh` 喂出
  //    `SyntaxError: Invalid or unexpected token` 的那份文件
  const shell = join(dir, 'dsh-sh');
  writeFileSync(shell, '#!/bin/sh\n# Resolve $0 through symlinks so basedir is the shim\'s real directory.\nexec node "$basedir/../x/bin.js" "$@"\n');
  chmodSync(shell, 0o755);
  assert.equal(classifyLauncher(shell), 'exec');

  // ③ 实体 JS（少见）
  const js = join(dir, 'dsh-js');
  writeFileSync(js, '#!/usr/bin/env node\nconsole.log(1);\n');
  assert.equal(classifyLauncher(js), 'node');

  // ④ 没有
  assert.equal(classifyLauncher(join(dir, 'nope')), 'missing');
});

test('ensureModuleFallbackManifest：补 `<dsh 包>/node_modules/package.json`，已有则不动', () => {
  const root0 = mkdtempSync(join(tmpdir(), 'ui-tree-'));
  const pkgDir = join(root0, 'node_modules', '@deepseek-ai', 'dsh');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), '{"name":"@deepseek-ai/dsh"}\n');

  assert.equal(ensureModuleFallbackManifest(root0), true, '第一次应补上');
  const manifest = join(pkgDir, 'node_modules', 'package.json');
  assert.equal(readFileSync(manifest, 'utf8').trim(), '{}', '占位清单是合法的空对象');
  assert.equal(ensureModuleFallbackManifest(root0), false, '第二次不应重复写');
});

test('renderMatrixHtml：成功的行给图 + 三处判据，失败的行说明原因（不假装截到了）', () => {
  const html = renderMatrixHtml([
    {
      version: '0.2.1-rc.2', ok: true, buttonFound: true, dockRows: 5, panelOpened: true, errors: [],
      shots: { composer: '/tmp/x/0.2.1-rc.2-1-composer.png', dock: '/tmp/x/0.2.1-rc.2-2-dock.png', panel: '/tmp/x/0.2.1-rc.2-3-panel.png' },
    },
    { version: '0.0.9-rc.1', ok: false, error: '版本树不存在：/x/0.0.9-rc.1' },
  ], { pluginVersion: '1.7.0' });
  assert.match(html, /0\.2\.1-rc\.2-2-dock\.png/, '成功的行必须引用截图');
  assert.match(html, /按钮：在　dock 行：5　面板：打开　控制台错误：0/);
  assert.match(html, /未能启动：版本树不存在/);
  assert.match(html, /（未截到）/, '失败的行不能伪造图片格');
  assert.match(html, /1\.7\.0/);
});

test('结构：采集件不许静态依赖 playwright（CI 里没有它，静态 import 会让门禁直接红）', () => {
  const capture = readFileSync(join(root, 'scripts', 'ui-matrix', 'capture.mjs'), 'utf8');
  assert.doesNotMatch(capture, /^import .*from 'playwright'/m, 'playwright 必须是动态解析');
  assert.match(capture, /import\('playwright'\)/, '保留裸解析这条路');
  assert.match(capture, /PLAYWRIGHT_MODULE/, '并支持用环境变量指认（本机装在 @playwright/mcp 下）');
});

test('结构：实例引导必须处理两处跨代次差异（否则老代次起不来）', () => {
  const inst = readFileSync(join(root, 'scripts', 'ui-matrix', 'instance.mjs'), 'utf8');
  assert.match(inst, /classifyLauncher\(/, '启动器形态要判');
  assert.match(inst, /ensureModuleFallbackManifest\(/, '模块回退清单要补');
  assert.match(inst, /\.credentials\.yaml/, '凭据要软链（否则 API 全 401、插件按钮不渲染）');
  assert.match(inst, /seedWorkspaceStore/, '工作区清单要铺（否则 composer 禁用、按钮不渲染）');
});

test('结构：package.json 有 verify:ui 入口，且默认跑 KERNEL_GENERATIONS', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['verify:ui'], 'node scripts/ui-matrix/run.mjs');
  const run = readFileSync(join(root, 'scripts', 'ui-matrix', 'run.mjs'), 'utf8');
  assert.match(run, /KERNEL_GENERATIONS/, '代次清单取自 lib/upstream-compat.js，不另写一份');
  assert.match(run, /\.verify/, '产物落在 gitignore 的 .verify 下');
});

test('instanceSummary：能给诊断用的结构摘要（不启动实例）', () => {
  const home = mkdtempSync(join(tmpdir(), 'ui-inst-'));
  mkdirSync(join(home, 'profiles', 'ui', 'node_modules'), { recursive: true });
  writeFileSync(join(home, 'profiles', 'ui', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }));
  const summary = instanceSummary(home);
  assert.equal(summary.hasProfile, true);
  assert.deepEqual(summary.bundles, ['@deepseek-ai/dsh-base']);
});
