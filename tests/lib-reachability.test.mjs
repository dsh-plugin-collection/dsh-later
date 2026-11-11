/**
 * `npm run check:lib-reach` 的判据层：host 产物里每个 `.js` 都必须能从 `lib/index.js`
 * 静态走到（见 `scripts/lib-reachability.mjs`）。
 *
 * 四层，缺一层判据就可能是个永远通过的摆设：
 *  1. **纯函数**：说明符解析（`from` / 副作用导入 / `import()`）、相对路径解析、
 *     BFS 与排除项，各喂小表验证。快，不依赖磁盘。
 *  2. **仓库现状**：`lib/` 真的有零个不可达文件。这条就是门禁本身。
 *  3. **变异验证**：往真 `lib/` 里塞一个没人 import 的 `lib/zzz-orphan.js`，
 *     判据必须判红；删回去必须恢复绿。证明第 2 条不是恒真。
 *  4. **CLI**：不可达时非零退出并逐个打印文件名；`lib/` 不存在时也不放过。
 *
 * 第 3 层会真的往仓库的 `lib/` 写文件。node --test 默认按文件并行，所以这里
 * **串行地**在建/删之间走完，删除放在 `after()` 里兜底，避免中途断言失败留下垃圾。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENTRY,
  DEFAULT_EXCLUDE,
  extractSpecifiers,
  isRelativeSpecifier,
  resolveLibSpecifier,
  isExcluded,
  isEmptyModule,
  findUnreachable,
  checkLibDirectory,
  main,
} from '../scripts/lib-reachability.mjs';

const repoRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const libDir = join(repoRoot, 'lib');
const scriptPath = join(repoRoot, 'scripts/lib-reachability.mjs');

/* ---------------- 1. 纯函数：说明符解析 ---------------- */

test('说明符解析：from / export ... from / 副作用导入 / import() 四种形态都取到', () => {
  const source = [
    "import { a } from './a.js';",
    "import type { T } from './t.js';",
    "export { b } from './b.js';",
    "export * from './c.js';",
    "import './side-effect.js';",
    "const lazy = await import('./lazy.js');",
    "import fs from 'node:fs';",
    "const nope = await import(someVar);",
  ].join('\n');
  const found = extractSpecifiers(source);
  assert.deepEqual(found, [
    './a.js',
    './t.js',
    './b.js',
    './c.js',
    'node:fs',
    './side-effect.js',
    './lazy.js',
  ]);
  assert.ok(!found.includes('someVar'), '非字面量的动态导入解析不了，不应被当成说明符');
});

test('说明符解析：只有 ./ 与 ../ 算本包内相对路径', () => {
  assert.equal(isRelativeSpecifier('./x.js'), true);
  assert.equal(isRelativeSpecifier('../x.js'), true);
  assert.equal(isRelativeSpecifier('node:fs'), false);
  assert.equal(isRelativeSpecifier('zod'), false);
  assert.equal(isRelativeSpecifier('@deepseek-ai/dsh-tools'), false);
});

test('相对路径解析：按发出文件所在目录换算，越出 lib 的返回 undefined', () => {
  assert.equal(resolveLibSpecifier('index.js', './runtime.js'), 'runtime.js');
  assert.equal(resolveLibSpecifier('index.js', './sub/deep.js'), 'sub/deep.js');
  assert.equal(resolveLibSpecifier('sub/deep.js', '../runtime.js'), 'runtime.js');
  assert.equal(resolveLibSpecifier('sub/deep.js', './sibling.js'), 'sub/sibling.js');
  assert.equal(resolveLibSpecifier('index.js', '../../escape.js'), undefined);
});

test('排除项：lib/client.js 与 lib/types/** 不参与判定', () => {
  assert.equal(isExcluded('client.js'), true);
  assert.equal(isExcluded('types/index.d.ts'), true);
  assert.equal(isExcluded('types'), true);
  assert.equal(isExcluded('index.js'), false);
  // 名字像但不是排除项：client/ 目录下的文件仍要参与判定
  assert.equal(isExcluded('client/presence.js'), false);
  assert.deepEqual(DEFAULT_EXCLUDE, ['client.js', 'types/']);
});

test('空模块判据：只认「只有 export {};」的类型声明产物', () => {
  assert.equal(isEmptyModule('export {};\n'), true);
  assert.equal(isEmptyModule('  export { };\n\n'), true);
  assert.equal(isEmptyModule('export {};'), true);
  // 真代码不算空
  assert.equal(isEmptyModule("import { a } from './a.js';\nexport const b = a;\n"), false);
  assert.equal(isEmptyModule("export const reExported = 1;\n"), false);
  assert.equal(isEmptyModule(''), false, '空字符串不是 tsc 的产物形态，不该顺手放行');
});

/* ---------------- 2. 纯函数：BFS ---------------- */

test('BFS：从入口走到多层依赖，走不到的进不可达清单', () => {
  const files = {
    'index.js': "import { a } from './a.js';\nimport { b } from './b.js';",
    'a.js': "import { c } from './c.js';\nimport fs from 'node:fs';",
    'b.js': "export { c } from './c.js';",
    'c.js': 'export const c = 1;',
    'orphan.js': 'export const orphan = 1;',
    'empty.js': 'export {};',
    'client.js': 'window.__ModuleLoader__.load({});',
  };
  const report = findUnreachable(files);
  assert.deepEqual(report.reachable, ['a.js', 'b.js', 'c.js', 'index.js']);
  assert.deepEqual(report.unreachable, ['orphan.js'], '只有真正有运行时导出的孤儿才该判红');
  assert.deepEqual(report.typeOnly, ['empty.js'], '空模块按形状放行，另列');
  assert.ok(!report.unreachable.includes('client.js'), 'client.js 是排除项');
});

test('BFS：副作用导入与 import() 也算边（少解析一条就会假红）', () => {
  const files = {
    'index.js': "import './effect.js';\nconst lazy = await import('./lazy.js');",
    'effect.js': 'globalThis.x = 1;',
    'lazy.js': 'export const lazy = 1;',
  };
  const report = findUnreachable(files);
  assert.deepEqual(report.unreachable, [], `副作用导入与 import() 都应连上：${report.unreachable.join('、')}`);
});

test('BFS：入口不存在时全部报不可达，不能返回空清单冒充绿', () => {
  const report = findUnreachable({ 'a.js': 'export const a = 1;' });
  assert.deepEqual(report.unreachable, ['a.js']);
  assert.deepEqual(report.reachable, []);
});

test('BFS：相对导入指向 lib 里不存在的文件时，记为悬空而不是静默跳过', () => {
  // 这是「host 模块的导入断了线」那一类：目标没了，被指向的兄弟模块变成孤儿。
  // 只看不可达清单只能看到结果，看不到是谁把它弄丢的，所以悬空说明符要单独记。
  const files = {
    'index.js': "import { a } from './a.js';\nimport { d } from './due-typo.js';",
    'a.js': 'export const a = 1;',
    'due.js': 'export const d = 1;',
  };
  const report = findUnreachable(files);
  assert.deepEqual(report.dangling, ['index.js → ./due-typo.js'], '悬空说明符必须被点名');
  assert.deepEqual(report.unreachable, ['due.js'], '被弄丢的兄弟模块进不可达清单');
});

test('BFS：在 lib 根下不可达、但别人 import 的子目录文件算可达', () => {
  const files = {
    'index.js': "import { p } from './client/presence.js';",
    'client/presence.js': 'export const p = 1;',
    'client/other.js': 'export const o = 1;',
  };
  const report = findUnreachable(files);
  assert.deepEqual(report.unreachable, ['client/other.js']);
});

/* ---------------- 3. 仓库现状：门禁本身 ---------------- */

test('仓库现状：lib 下每个 host js 都能从 lib/index.js 走到', () => {
  if (!existsSync(join(libDir, ENTRY))) {
    assert.fail('lib/index.js 不存在：先 `npm run build`。缺产物不等于零不可达。');
  }
  const report = checkLibDirectory(libDir);
  assert.deepEqual(
    report.unreachable,
    [],
    `lib 里这些产物宿主永远不会执行（成因见 scripts/lib-reachability.mjs 头部注释）：\n- ${report.unreachable.join('\n- ')}`,
  );
  assert.ok(report.reachable.length > 1, `可达文件只有 ${report.reachable.length} 个，BFS 没生效`);
});

test('仓库现状：client-only 模块不在 lib 下产出任何文件（产物已按 A-5 移出 host emit）', () => {
  // 这 9 个模块只被客户端用：tsconfig.client.json 是 noEmit、tsconfig.json 又 exclude 了
  // src/client，所以它们没有任何项目 emit，lib/ 与 lib/client/ 下都不该有对应文件。
  // 测试改从 src/ 读（见 scripts/transpile-module.mjs）。
  const clientOnly = [
    'attachment-failure',
    'bar-geometry',
    'bubble-marker',
    'command-outcome',
    'media-url',
    'presence',
    'schedule-facet',
    'schedule-summary-store',
    'schedule-summary',
  ];
  for (const name of clientOnly) {
    for (const rel of [`${name}.js`, `client/${name}.js`]) {
      assert.ok(!existsSync(join(libDir, rel)), `lib/${rel} 不该存在：该模块只被客户端用，不进 host emit`);
    }
  }
});

test('仓库现状：只含类型声明的 upstream-shims 落成 export {};，按内容判据放行而非白名单', () => {
  const shims = join(libDir, 'upstream-shims.js');
  assert.ok(existsSync(shims), 'lib/upstream-shims.js 应存在：源码全 type/interface，emit 出来是空模块');
  assert.equal(isEmptyModule(readFileSync(shims, 'utf8')), true, '它必须是 export {}; 形态');
  const report = checkLibDirectory(libDir);
  assert.ok(
    report.typeOnly.includes('upstream-shims.js'),
    '空模块应在 typeOnly 里被单独列出，而不是被文件名白名单静默跳过',
  );
});

/* ---------------- 4. 变异验证：真塞一个孤儿，判据必须红 ---------------- */

const ORPHAN = join(libDir, 'zzz-orphan.js');

after(() => {
  rmSync(ORPHAN, { force: true });
});

/**
 * 用 CLI 跑一次检查（真起子进程，验证的是用户与 CI 实际走的那条路）。
 * @param args 追加参数（lib 目录）。
 * @returns `{ status, stdout, stderr }`
 */
function runCli(args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('变异验证：往 lib 里塞一个没人 import 的 zzz-orphan.js → 判据判红，删掉后恢复绿', () => {
  // 变异前：绿
  const before = runCli();
  assert.equal(before.status, 0, `变异前应绿，实际退出码 ${before.status}：${before.stderr}`);

  // 塞一个「有运行时导出、但没有任何人 import」的副本
  writeFileSync(
    ORPHAN,
    "/** 变异验证用的孤儿副本：没有任何模块 import 它。 */\nexport const orphanMarker = 'zzz';\n",
    'utf8',
  );
  try {
    // 纯函数层：判红并点名
    const report = checkLibDirectory(libDir);
    assert.ok(report.unreachable.includes('zzz-orphan.js'), 'BFS 必须认出这个孤儿');

    // CLI 层：非零退出 + 打印清单
    const mutated = runCli();
    assert.notEqual(mutated.status, 0, `变异后应非零退出，实际 ${mutated.status}：${mutated.stdout}`);
    assert.match(mutated.stderr, /zzz-orphan\.js/, 'CLI 必须把不可达文件名打出来');
    assert.match(mutated.stderr, /1 个文件从 index\.js 走不到/, 'CLI 应报出准确的不可达数量');
  } finally {
    rmSync(ORPHAN, { force: true });
  }

  // 还原后：重新变绿（证明红是变异造成的，不是环境的）
  const after_ = runCli();
  assert.equal(after_.status, 0, `还原后应恢复绿，实际退出码 ${after_.status}：${after_.stderr}`);
});

test('变异验证：只含类型声明的空模块不被判红（照抄 tsc 的 export {}; 形态）', () => {
  const emptyCopy = join(libDir, 'zzz-empty.js');
  writeFileSync(emptyCopy, 'export {};\n', 'utf8');
  try {
    const report = checkLibDirectory(libDir);
    assert.ok(!report.unreachable.includes('zzz-empty.js'), '空模块不是「断线」，不该判红');
    assert.ok(report.typeOnly.includes('zzz-empty.js'), '空模块应被单独列出，而不是静默忽略');
  } finally {
    rmSync(emptyCopy, { force: true });
  }
});

/* ---------------- 5. CLI：环境问题也不放过 ---------------- */

test('CLI：lib 目录不存在时非零退出（「没有产物」不等于「零不可达」）', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'dsh-later-reach-')), 'nope');
  try {
    assert.equal(main([missing]), 2, 'lib 不存在应返回环境错误码 2');
  } finally {
    rmSync(missing, { force: true });
    rmSync(join(missing, '..'), { recursive: true, force: true });
  }
});

test('CLI：指向一个临时 lib 目录时按该目录判定（可注入，不绑死仓库路径）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-later-reach-'));
  try {
    writeFileSync(join(dir, 'index.js'), "import './a.js';\n", 'utf8');
    writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n', 'utf8');
    assert.equal(main([dir]), 0, '两个文件都在闭包里，应绿');

    writeFileSync(join(dir, 'b.js'), 'export const b = 1;\n', 'utf8');
    assert.equal(main([dir]), 1, '多了个孤儿，应红');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli 与 package.json scripts 接线：check:lib-reach 指向本脚本', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(
    pkg.scripts['check:lib-reach'],
    'node scripts/lib-reachability.mjs',
    'package.json 的 check:lib-reach 应直接跑本脚本（CI 与本地是同一条命令）',
  );
});
