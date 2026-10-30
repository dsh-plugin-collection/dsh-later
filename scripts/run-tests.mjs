#!/usr/bin/env node
/**
 * `npm test` 的入口：先把测试文件展开成**显式列表**，再交给 `node --test`。
 *
 * ## 为什么不能直接把 glob 丢给 node --test
 *
 * 原先是 `node --test "tests/*.test.mjs"`，展开由 node 负责，而**展开为空时它照跑不误**：
 * 实测 `node --test "tests/NOPE-*.test.mjs"` 打印 `# tests 0 / # pass 0` 并以 **0** 退出。
 * 于是「pattern 打错」「tests/ 目录没被 checkout」「测试文件整体改名」这类事故在 CI 上
 * 表现为一条绿色测试步骤：门禁什么都没跑，却宣布通过。判空必须自己做。
 *
 * ## 为什么不顺手改成目录形式 `node --test tests/`
 *
 * 实测（node v22.22.2）目录形式**红**：`# fail 1`，node 把 `tests` 当入口模块去 require，
 * 报 `Cannot find module .../tests`，这条路本身就走不通。而 `tests/helpers/` 里放的是共享夹具
 * （`ownership-state.mjs` 不是用例），显式列表按 `*.test.mjs` 筛，夹具按构造进不来，不必交给
 * 「扫目录」再赌它扫对了什么。两种歧义都由「交进去之前自己筛过」消掉。
 *
 * ## 三条断言（缺一条例子就还能空跑）
 *  1. 展开零匹配 → throw，根本不启动 `node --test`，退出码 1；
 *  2. 传播 `node --test` 的退出码（不翻译，免得把「子进程崩了」抹成一个通用 1）；
 *  3. 从子进程 stdout 解析 pass 计数：解析不出来，或 exit 0 而 `pass` 为 0，都算失败。
 *     第 1 条挡住了「文件名不匹配」，第 3 条挡住「匹配到了但一条用例都没跑起来」。
 *     它不是装饰：node 在递归调用时就是 exit 0 + 零输出（见 runTests 里对 NODE_TEST_CONTEXT 的处理），
 *     只看退出码会把它当成一次干净的绿色。
 *
 * ## reporter 选择
 * 子进程的 stdout 是本脚本的管道（我们要读它做第 3 条断言），node 会因此**自动**改用 tap。
 * 为了不把本地终端里的可读输出弄丢，这里显式按父进程是否 TTY 选 spec/tap，与改动前的观感一致。
 * 输出逐块转发给 process.stdout，所以人看到的仍是实时进度，不是等子进程结束才一大坨。
 *
 * 用法：
 *   npm test
 *   node scripts/run-tests.mjs                                   # 默认 tests/*.test.mjs
 *   node scripts/run-tests.mjs --pattern 'tests/bar-*.test.mjs'   # 子集（零匹配同样判红）
 *   node scripts/run-tests.mjs -- --test-name-pattern='projection' # `--` 之后的参数转交 node --test
 *
 * 退出码：0 全绿；1 本脚本的判空/判数不通过、子进程被信号打断、或 node --test 本身退 1；
 * 其余原样沿用 node --test 的退出码。
 * @module scripts/run-tests
 */
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 默认展开的 pattern（相对仓库根）。 */
export const DEFAULT_PATTERN = 'tests/*.test.mjs';

/** 递归下钻（`**`）时跳过的目录：防止误写 pattern 时把 node_modules/其它 worktree 全走一遍。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.agents']);

/** 零匹配专用错误：测试要 `assert.throws(..., NoTestFilesError)`，不该靠 message 的子串认它。 */
export class NoTestFilesError extends Error {
  /**
   * @param {string} pattern - 没匹配到任何东西的 pattern。
   * @param {string} cwd - 展开时用的仓库根。
   */
  constructor(pattern, cwd) {
    super(`run-tests: pattern "${pattern}" 在 ${cwd} 下匹配到 0 个测试文件。`);
    this.name = 'NoTestFilesError';
    this.pattern = pattern;
    this.cwd = cwd;
  }
}

/**
 * 把单个路径段编译成 RegExp：`*` → 同段任意字符、`?` → 同段一个字符，其余按字面转义。
 * 段内不跨 `/`，所以 `tests/*` 不会吃到 `tests/helpers/x`。
 * @param {string} segment - 不含 `/` 的 pattern 段。
 * @returns {RegExp} 整段锚定的匹配器。
 */
function segmentToRegExp(segment) {
  let source = '';
  for (const ch of segment) {
    if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** 目录条目是否是「可以当文件收下来」（含指向文件的符号链接）。 */
function isFileLike(dirAbs, entry) {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(join(dirAbs, entry.name)).isFile();
  } catch {
    return false; // 断链
  }
}

/** 目录条目是否可以下钻（含指向目录的符号链接；node_modules/.git/.agents 除外）。 */
function isDescendable(dirAbs, entry) {
  if (SKIP_DIRS.has(entry.name)) return false;
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(join(dirAbs, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 递归收集匹配 segment 的文件，返回相对 root 的路径（用 `/` 分隔）。
 * @param {string} root - 仓库根绝对路径。
 * @param {string} relDir - 当前目录相对 root 的路径（根为 ''）。
 * @param {string[]} segments - 尚未匹配的 pattern 段。
 * @param {string[]} acc - 收集桶（就地追加）。
 * @returns {void}
 */
function collect(root, relDir, segments, acc) {
  const [head, ...rest] = segments;
  const dirAbs = relDir === '' ? root : join(root, relDir);
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return; // 目录不存在 → 就是零匹配，由调用方报错
  }

  if (head === '**') {
    // `**` 先按「吃掉零段」就地试 rest，再逐层下钻试「吃掉一段及以上」。
    if (rest.length > 0) collect(root, relDir, rest, acc);
    for (const entry of entries) {
      if (!isDescendable(dirAbs, entry)) continue;
      collect(root, relDir === '' ? entry.name : `${relDir}/${entry.name}`, segments, acc);
    }
    return;
  }

  const re = segmentToRegExp(head);
  for (const entry of entries) {
    if (!re.test(entry.name)) continue;
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (rest.length === 0) {
      if (isFileLike(dirAbs, entry)) acc.push(rel);
    } else if (isDescendable(dirAbs, entry)) {
      collect(root, rel, rest, acc);
    }
  }
}

/**
 * 展开 pattern → 排序后的**相对路径列表**（这就是传给 node --test 的显式文件列表）。
 *
 * 不走 shell glob：shell 展开的零结果有两种流派（原样传 vs 报错），npm 又可能换 shell，
 * 把判空的确定性建在 shell 行为上，等于把门禁挂在别人的兼容性上。
 * 支持段内 `*` / `?` 与整段 `**`；不支持字符类（本仓库用不到，宁可不匹配也别猜错）。
 *
 * @param {string} [pattern] - 相对 cwd 的 glob。
 * @param {string} [cwd] - 仓库根，默认 `process.cwd()`。
 * @returns {string[]} 排序后的文件路径（相对 cwd）。
 * @throws {NoTestFilesError} 零匹配时。空列表继续跑 = 一条会空跑的绿色门禁。
 */
export function expandTestFiles(pattern = DEFAULT_PATTERN, cwd = process.cwd()) {
  const segments = String(pattern).split('/').filter((s) => s !== '' && s !== '.');
  const acc = [];
  if (segments.length > 0) collect(cwd, '', segments, acc);
  const files = [...new Set(acc)].sort();
  if (files.length === 0) throw new NoTestFilesError(String(pattern), cwd);
  return files;
}

/**
 * 从 node --test 的输出里取汇总计数。
 *
 * 两种 reporter 的汇总行分别是 `# pass 620`（tap）与 `ℹ pass 620`（spec）；先剥 ANSI，
 * 免得颜色码让「按行首锚定」变成运气活。**取最后一次出现**：汇总块在输出末尾，而中间可能被
 * 别的东西顶掉第一次的位置（失败用例的源码片段里就可能有 `# pass 0` 这样的字面量，实测踩到过）。
 * 取不到就返回 undefined，**由调用方判红**：解析失败也放行等于把第 3 条断言又打开。
 * @param {string} text - 子进程 stdout。
 * @returns {{ tests: number | undefined, pass: number | undefined, fail: number | undefined }}
 */
export function parseSummary(text) {
  const clean = String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');
  const pick = (label) => {
    const matches = [...clean.matchAll(new RegExp(`(?:#|ℹ)\\s+${label}\\s+(\\d+)`, 'g'))];
    const last = matches[matches.length - 1];
    return last === undefined ? undefined : Number(last[1]);
  };
  return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail') };
}

/**
 * 展开 + 起 `node --test` + 逐块转发 stdout。
 * @param {object} [options]
 * @param {string} [options.pattern] - glob，默认 {@link DEFAULT_PATTERN}。
 * @param {string} [options.cwd] - 仓库根。
 * @param {string[]} [options.extraArgs] - 追加给 node --test 的参数。
 * @param {typeof import('node:child_process').spawn} [options.spawnFn] - 注入点，测试用。
 * @param {boolean} [options.quiet] - 不向 process.stdout 转发（测试用）。
 * @returns {Promise<{files: string[], status: number | null, signal: string | null, error: Error | null, output: string}>}
 * @throws {NoTestFilesError} 展开零匹配（此时不会起子进程）。
 */
export async function runTests(options = {}) {
  const {
    pattern = DEFAULT_PATTERN,
    cwd = process.cwd(),
    extraArgs = [],
    spawnFn = spawn,
    quiet = false,
  } = options;

  const files = expandTestFiles(pattern, cwd);
  const reporter = process.stdout.isTTY ? 'spec' : 'tap';
  // NODE_TEST_CONTEXT 标记「本进程是 test runner spawn 出来的子进程」。带着它再去起一轮
  // 全量测试，node 会打 `node:test run() is being called recursively within a test file.
  // skipping running files.`，然后**以 0 退出且不产出任何汇总**（v22.22.2 实测）——空跑却长得
  // 像成功，正是本脚本要防的形状。清掉它，让这条命令按「一次独立的完整测试运行」行事
  // （被别的测试文件包一层调用时也要真跑，见 tests/run-tests-gate.test.mjs 的端到端段）。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnFn(process.execPath, ['--test', `--test-reporter=${reporter}`, ...extraArgs, ...files], {
    cwd,
    env,
    // stdout 必须是 pipe：第 3 条断言要读它。stderr 交回终端（失败堆栈不该被我们吞成字符串）。
    stdio: ['inherit', 'pipe', 'inherit'],
  });

  const chunks = [];
  child.stdout.on('data', (chunk) => {
    chunks.push(chunk);
    if (!quiet) process.stdout.write(chunk);
  });

  const { status, signal, error } = await new Promise((settle) => {
    child.once('error', (err) => settle({ status: null, signal: null, error: err }));
    child.once('close', (code, sig) => settle({ status: code, signal: sig, error: null }));
  });

  return { files, status, signal, error, output: Buffer.concat(chunks).toString('utf8') };
}

/**
 * 解析命令行：`--pattern <glob>` 换展开用的 pattern，`--` 之后的东西原样转交 node --test。
 * @param {string[]} argv - 不含 node 与脚本名。
 * @returns {{ pattern: string, extraArgs: string[], help: boolean, error: string | null }}
 */
function parseArgv(argv) {
  const help = argv.includes('--help');
  let head = argv.filter((arg) => arg !== '--help');
  let extraArgs = [];
  const dashIndex = head.indexOf('--');
  if (dashIndex >= 0) {
    extraArgs = head.slice(dashIndex + 1);
    head = head.slice(0, dashIndex);
  }
  const patternIndex = head.indexOf('--pattern');
  if (patternIndex >= 0 && head[patternIndex + 1] === undefined) {
    return { pattern: DEFAULT_PATTERN, extraArgs, help, error: '--pattern 后面要跟上 glob（例：--pattern "tests/bar-*.test.mjs"）。' };
  }
  const pattern = patternIndex >= 0 ? head[patternIndex + 1] : DEFAULT_PATTERN;
  const rest = patternIndex >= 0 ? head.filter((_, i) => i !== patternIndex && i !== patternIndex + 1) : head;
  // 剩下的参数一律转交 node --test，别静默吞掉：悄悄忽略「--paltern」这种手滑，
  // 等于让调用方以为跑的是自己指定的那个子集。node 会对着认不出的选项非零退出。
  return { pattern, extraArgs: [...rest, ...extraArgs], help, error: null };
}

/**
 * CLI 入口。
 * @param {string[]} argv - 不含 node 与脚本名。
 * @returns {Promise<number>} 退出码。
 */
async function main(argv) {
  const { pattern, extraArgs, help, error: argError } = parseArgv(argv);
  if (argError !== null) {
    console.error(`❌ ${argError}`);
    return 1;
  }
  if (help) {
    console.log('用法：node scripts/run-tests.mjs [--pattern <glob>] [-- <node --test 参数>]');
    console.log(`默认 pattern：${DEFAULT_PATTERN}（零匹配即判红，不会空跑）。`);
    return 0;
  }

  let run;
  try {
    run = await runTests({ pattern, extraArgs });
  } catch (error) {
    if (error instanceof NoTestFilesError) {
      console.error(`❌ ${error.message}`);
      console.error('   这不是「没有失败的测试」，是「一条测试都没跑」。node --test 在零匹配时');
      console.error('   以 0 退出（实测 `# tests 0` / exit 0），所以判空只能留在这里。');
      console.error(`   检查 tests/ 是否存在、pattern 是否写错（默认 ${DEFAULT_PATTERN}）。`);
      return 1;
    }
    throw error;
  }

  if (run.error !== null) {
    console.error(`❌ 无法启动 node --test：${run.error.message}`);
    return 1;
  }
  if (run.signal !== null) {
    console.error(`❌ node --test 被信号打断（${run.signal}），按失败处理。`);
    return 1;
  }

  const summary = parseSummary(run.output);
  if (typeof summary.pass !== 'number') {
    console.error(
      `❌ 解析不到 pass 计数（${run.files.length} 个文件、退出码 ${run.status}）：` +
        '无法确认「真的跑过用例」的门禁，不放行。',
    );
    return run.status === 0 ? 1 : run.status;
  }
  if (run.status === 0 && summary.pass === 0) {
    console.error(`❌ 退出码 0 但 pass 0 / fail ${summary.fail ?? '?'}：等价于空跑，不放行。`);
    return 1;
  }

  // 结论行写 stderr：stdout 保持 node --test 的原样输出，下游工具还能直接 grep `# pass`。
  console.error(
    `run-tests: ${run.files.length} 个文件，pass ${summary.pass} / fail ${summary.fail ?? '?'}（node --test 退出码 ${run.status}）`,
  );
  return run.status ?? 1;
}

// 只在被当作脚本直接运行时执行，import 时保持纯函数（测试要 import expandTestFiles/parseSummary）。
const invoked = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invoked !== undefined && import.meta.url === invoked) {
  process.exitCode = await main(process.argv.slice(2));
}
