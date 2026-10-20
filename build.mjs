/**
 * 构建脚本：
 *  1. tsc 编译 host 端（src/ → lib/，tsconfig.json 已排除 src/client）
 *  2. esbuild 打包 client 端单文件并包进 __ModuleLoader__.load 模板
 *  3. 把 shared 目录（smart-window/time-utils）同步进 lib/shared，供 host 引用
 *
 * 产物：lib/index.js（host）+ lib/client.js（浏览器端）
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// 1. host 端：tsc（容忍依赖版本差异导致的 TS 错误）
try {
  execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
} catch (error) {
  console.warn('⚠️ host tsc 遇到依赖类型差异，尝试 esbuild 降级构建…');
  const entries = ['src/index.ts', 'src/domain.ts', 'src/owned-event-registration.ts', 'src/user-tools.ts', 'src/commands.ts', 'src/runtime.ts', 'src/projection.ts', 'src/presence.ts', 'src/schedule-summary.ts', 'src/schedule-summary-store.ts', 'src/smart-window.ts', 'src/time-utils.ts', 'src/upstream-compat.ts', 'src/kernel-identity.ts'];
  for (const entry of entries) {
    const name = entry.replace('src/', '').replace('.ts', '.js');
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      write: false,
      logLevel: 'error',
      external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-schedule', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-commands', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-settings', 'zod'],
    });
    writeFileSync(`lib/${name}`, result.outputFiles[0].text);
  }
}

// 1b. client 端类型检查（noEmit；避免类型错误溜进浏览器产物）
try {
  execSync('npx tsc -p tsconfig.client.json --noEmit', { stdio: 'inherit' });
} catch (error) {
  console.warn('⚠️ client tsc 遇到依赖类型差异，继续用 esbuild 构建…');
}

// 2. client 端：esbuild 打包（type-only imports 剥离；react 从宿主运行时解析）
const result = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'warning',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  // 与 DSH 官方 client 插件一致：JSX 走 react/jsx-runtime（automatic），
  // 由 __ModuleLoader__ 的 require 从宿主解析；不用 transform 模式（会生成
  // 全局 React.createElement，宿主无全局 React 导致渲染崩溃）。
  jsx: 'automatic',
  // react / react-dom 由 __ModuleLoader__ 的 require 从宿主解析（前端运行时提供）。
  // @deepseek-ai/dsh-client-ui-primitives 是宿主 seed 模块表基线（PLATFORM_MODULES），
  // 必须保持 external：内联会复制一份官方组件实例（模块身份/主题漂移），
  // require 到宿主 seed 表才能拿到官方同一份（issue #19）。
  external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/*', '@deepseek-ai/dsh-client-ui-primitives'],
});

const body = result.outputFiles[0].text;
const wrapped = `window.__ModuleLoader__.load({
	id: "dsh-later",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${body}
		return module.exports;
	}
});
`;

mkdirSync('lib', { recursive: true });
writeFileSync('lib/client.js', wrapped);

// 4. 部署同步（**默认关闭**，issue #46）：各 profile 里安装的本插件与工作区是
//    **硬链接**关系，tsc/esbuild 重写文件时可能替换 inode（unlink+create），悄悄
//    断链导致 profile 端拿到旧代码——重链就是为了解决这个。但它原先是 build 的
//    **默认副作用**，代价更大：未合并分支只要 build 一次就进到运行中的 host；
//    多个 worktree 还会经 profile 共享 inode、彼此静默覆盖（实测发生过）。
//    因此改为显式部署：`npm run deploy` / `--deploy` / `DSH_LATER_RELINK=1`。
//    决策逻辑抽在 scripts/relink-policy.mjs（纯函数，可测且不碰文件系统）。
import { shouldRelink, RELINK_SKIP_NOTICE } from './scripts/relink-policy.mjs';
import { readdirSync, statSync, linkSync, existsSync, rmSync } from "node:fs";
import { homedir } from 'node:os';
import { resolve as resolvePath, dirname as parentOf } from 'node:path';

if (!shouldRelink(process.argv.slice(2))) {
  console.log(RELINK_SKIP_NOTICE);
} else try {
  const localLib = resolvePath(process.cwd(), 'lib');
  const profilesRoot = resolvePath(homedir(), '.dsh/profiles');
  const targets = [];
  if (existsSync(profilesRoot)) {
    for (const name of readdirSync(profilesRoot)) {
      const lib = resolvePath(profilesRoot, name, 'node_modules/dsh-later/lib');
      if (existsSync(lib) && lib !== localLib) targets.push({ name, lib });
    }
  }
  /** 实际被改写的 profile 名（含链接数），用于末尾的部署回报。 */
  const deployed = [];
  for (const { name, lib: profileLib } of targets) {
    let linked = 0;
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const src = resolvePath(dir, entry.name);
        const dst = profileLib + src.slice(localLib.length);
        if (entry.isDirectory()) {
          mkdirSync(dst, { recursive: true });
          walk(src);
        } else {
          try {
            if (statSync(src).ino !== statSync(dst).ino) {
              rmSync(dst, { force: true });
              linkSync(src, dst);
              linked++;
            }
          } catch {
            mkdirSync(parentOf(dst), { recursive: true });
            rmSync(dst, { force: true });
            linkSync(src, dst);
            linked++;
          }
        }
      }
    };
    walk(localLib);
    if (linked > 0) {
      deployed.push(`${name}(${linked} 文件)`);
      console.log(`🔗 已重链 ${linked} 个文件到 profile:${name}`);
    }
  }
  // 部署是显式触发的，回报也要显式：说清动了哪些 profile、代码来自哪个工作树。
  if (deployed.length > 0) {
    console.log(`🚀 已部署到 ${deployed.join('、')}；来源 ${localLib}`);
  }
} catch (error) {
  console.warn(`⚠️ profile 重链跳过: ${error instanceof Error ? error.message : String(error)}`);
}

console.log('✅ lib/index.js (host, tsc) + lib/client.js (browser, esbuild) 构建完成');
