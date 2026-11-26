/**
 * build 门禁测试的共享夹具：**暂存一棵可构建的工作树** + **在隔离环境里跑一次构建**。
 *
 * ## 为什么要抽出来（issue #208 卫生第 5 条）
 *
 * `build-artifact-shape` / `build-client-typecheck-gate` / `build-no-silent-deploy` 三个文件
 * 各自抄了一份「复制工作树、塞类型错误、给产物放哨兵、用假 HOME 跑 build.mjs」。
 * 三份手抄的代价不是几行重复，而是**判据口径会分叉**：`PATH` 前置、`DSH_LATER_RELINK`
 * 清空、`DSH_LATER_BUILD_FALLBACK` 清空、假 HOME —— 任一份漏一条，那一份测出来的
 * 「构建行为」就与别处不同，而失败信息里看不出是这个差异造成的。
 *
 * 抽完之后**每个文件仍然各自 stage 自己的树**（不跨文件共享目录）：node --test 默认
 * 按文件并行，共享一棵树会互相投毒（一个文件注入的 host 类型错误会让另一个文件的
 * 「client 面」也跟着红，红的原因还是错的）。共享的是**机器**，不是**树**。
 *
 * ## 三条口径，都是踩出来的
 *
 * 1. **复制而不是原地改**：直接在仓库 `src/` 里塞类型错误会与并行跑的其它测试文件抢
 *    同一份源码；临时副本还能用「哨兵字节是否原样」直接判「lib/ 未被改写」。
 * 2. **假 HOME + 清空环境开关**：`DSH_LATER_RELINK` / `DSH_LATER_BUILD_FALLBACK` 若从
 *    开发者的 shell 漏进来，同一份代码在两台机器上会走不同分支 —— 测试结果就取决于
 *    「谁的机器上恰好设了那个变量」。这里一律清空，要开闸的用例显式传。
 * 3. **`PATH` 前置本仓 `node_modules/.bin`**：`build.mjs` 的 host 段是 `npx tsc`，
 *    不前置时在离线环境会去解析/下载 —— 让门禁挂在网络上，是另一类假红。
 *
 * @module tests/helpers/staged-build
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 本环境能不能真跑构建（缺 esbuild/typescript 时整组端到端用例跳过）。
 *
 * 这是「本地契约」之一：干净的 checkout 或只跑单测的环境没有依赖树，跳过是诚实的；
 * 但也正因如此 `npm test --require-no-skip` 在那种环境上会红（见 `scripts/run-tests.mjs` 文件头）。
 * @param {string} repoRoot - 仓库根。
 * @returns {boolean} 能否构建。
 */
export function canBuild(repoRoot) {
  return existsSync(join(repoRoot, 'node_modules/esbuild')) && existsSync(join(repoRoot, 'node_modules/typescript'));
}

/**
 * 一棵**可构建的最小工作树**（临时目录里）。
 *
 * 只复制 `build.mjs` 真正用得到的东西：两个 tsconfig、package.json、`src/`、`scripts/*.mjs`
 * （`build.mjs` 只 import 其中的策略模块；不复制 `seam-check/`、`ui-matrix/` 等目录）。
 * `node_modules` 用**符号链接**指回仓库那份 —— 20 核机器上复制一次依赖树是几秒级的浪费，
 * 而构建对它只读。
 *
 * @param {string} repoRoot - 仓库根。
 * @param {string} purpose - 临时目录名里的用途标记（便于分辨 `/tmp` 里谁是谁的垃圾）。
 * @returns {{
 *   dir: string,
 *   path: (rel: string) => string,
 *   read: (rel: string) => string,
 *   write: (rel: string, content: string) => void,
 *   injectTypeError: (rel: string, marker: string) => string,
 *   runBuild: (argv?: string[], extraEnv?: Record<string, string>) => {
 *     status: number | null, signal: string | null, stdout: string, stderr: string },
 *   dispose: () => void,
 * }} 夹具句柄。
 */
export function stageBuildableTree(repoRoot, purpose) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-later-${purpose}-`));
  for (const rel of ['build.mjs', 'tsconfig.json', 'tsconfig.client.json', 'package.json']) {
    cpSync(join(repoRoot, rel), join(dir, rel));
  }
  cpSync(join(repoRoot, 'src'), join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const name of readdirSync(join(repoRoot, 'scripts'))) {
    if (name.endsWith('.mjs')) cpSync(join(repoRoot, 'scripts', name), join(dir, 'scripts', name));
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
  mkdirSync(join(dir, 'lib'), { recursive: true });

  const path = (rel) => join(dir, rel);
  const read = (rel) => readFileSync(path(rel), 'utf8');
  const write = (rel, content) => writeFileSync(path(rel), content);

  return {
    dir,
    path,
    read,
    write,
    /**
     * 塞一个**真类型错误**（`number = "not a number"`），返回该文件的相对路径。
     *
     * 用真类型错误而不是「让 tsc 退出非零」的假件：门禁要证明的是「类型错误 ⇒ 构建失败」，
     * 而假 tsc 只能证明「非零退出 ⇒ 构建失败」。代价是每跑一次真 tsc（秒级），
     * 所以这类用例**一份夹具只跑一次构建**，多个断言读同一份结果。
     * @param {string} rel - 相对工作树的文件路径（如 `src/__probe.ts`）。
     * @param {string} marker - 写进文件头的标记（断言里按它认人）。
     * @returns {string} 该文件的相对路径。
     */
    injectTypeError(rel, marker) {
      const abs = path(rel);
      const slash = abs.lastIndexOf('/');
      if (slash >= 0) mkdirSync(abs.slice(0, slash), { recursive: true });
      write(
        rel,
        `// ${marker}：故意让 tsc 失败\nexport const probeNotANumber: number = "not a number";\n`,
      );
      return rel;
    },
    /**
     * 在隔离环境里跑一次 `build.mjs`。
     *
     * 环境开关一律清空（见文件头第 2 条）；`PATH` 前置本仓 `.bin`（第 3 条）。
     * @param {string[]} [argv] - 追加给 build.mjs 的参数（如 `--allow-fallback`）。
     * @param {Record<string, string>} [extraEnv] - 额外环境变量（要开闸的用例显式传）。
     * @returns {{ status: number | null, signal: string | null, stdout: string, stderr: string }}
     */
    runBuild(argv = [], extraEnv = {}) {
      return runBuildIn(dir, repoRoot, { argv, env: extraEnv });
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 在给定目录里跑一次 `build.mjs`（`cwd` 可以是暂存树，也可以是仓库本身）。
 *
 * 抽成独立导出是因为 `build-no-silent-deploy` 需要在**仓库根**上跑真构建
 * （它测的是「默认 build 会不会改写 profile」，路径必须是真仓库那份），
 * 但它对环境的清空口径与暂存树完全一致 —— 那种一致性只能有一处实现。
 *
 * @param {string} cwd - 跑构建的目录。
 * @param {string} repoRoot - 仓库根（用来前置 `.bin` 与指 node_modules）。
 * @param {{ argv?: string[], env?: Record<string, string>, timeout?: number }} [options]
 * @returns {{ status: number | null, signal: string | null, stdout: string, stderr: string }}
 */
export function runBuildIn(cwd, repoRoot, options = {}) {
  const home = join(cwd, 'fake-home');
  mkdirSync(home, { recursive: true });
  const result = spawnSync(process.execPath, ['build.mjs', ...(options.argv ?? [])], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      XDG_CACHE_HOME: join(home, '.cache'),
      DSH_LATER_RELINK: '',
      DSH_LATER_BUILD_FALLBACK: '',
      // 让 build.mjs 里的 `npx tsc` 直接命中已安装的 tsc，不依赖网络
      PATH: `${join(repoRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      ...(options.env ?? {}),
    },
    encoding: 'utf8',
    timeout: options.timeout ?? 300_000,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * 文件级收尾：把本文件建出来的暂存树删掉。
 *
 * 传一个 `Set` 而不是让每个用例自己删：**断言失败时用例自己的清理不会跑**，
 * 而那正是最容易攒垃圾的分支（本仓实测 `/tmp` 里积过 200 个假 HOME）。
 *
 * @param {Iterable<{ dispose: () => void }>} staged - 本文件 stage 出来的夹具。
 * @returns {void}
 */
export function disposeAll(staged) {
  for (const tree of staged) {
    try {
      tree.dispose();
    } catch {
      /* 清理失败不改写断言结论 */
    }
  }
}
