/**
 * 运行时依赖必须在 `package.json` 里声明（issue #145 的 C 组，正确性 bug）。
 *
 * 事故形态：`src/projection.ts` 里 `import { z } from 'zod'` 是**值 import**，
 * emit 后 `lib/projection.js` 保留同一条 ESM import。但 zod 当时只写在
 * `devDependencies`：开发树里有、profile 里没有就是 `ERR_MODULE_NOT_FOUND`，
 * 而它发生在 `lib/index.js` 的静态 import 期——整个插件**一条 fiber 都不激活**，
 * 不是降级成「少一个投影」，是 `/later` 与三个工具一起消失。
 *
 * 现在能跑绿纯属巧合：宿主自己的 `@deepseek-ai/dsh-session-projection` 依赖
 * zod@4.4.3，pnpm 把它 hoist 到 profile 的 `node_modules/zod`，`import 'zod'`
 * 恰好解析到了别人的副本。那个依赖哪天换掉，本插件就整条挂掉。
 *
 * 本文件锁三层，各自都能独立变异：
 *  1. **声明口径**：`lib/` 里每条被 host 入口静态加载的裸包说明符（`from 'x'`、
 *     `import 'x'`，`x` 不是 `./` 相对路径也不是 `node:` 内建），都必须出现在
 *     `dependencies` 或 `peerDependencies` 里。`devDependencies` 不算。
 *  2. **端到端反证**：把仓库的 `node_modules` 复制成一份**去掉 zod** 的目录，
 *     用它在真 `lib/` 上 `import()`。改前实测红（`Cannot find package 'zod'
 *     imported from lib/projection.js`），补上 peers 后转绿——这条是「判据真的
 *     能咬人」的证据，不是复述第 1 层。
 *  3. **为什么不能变回 dependencies**：宿主 `ProjectionDefinition.stateSchema`
 *     的类型是 `ZodType`（来自 zod），校验靠实例方法 `.strict()`/`.passthrough()`
 *     判分支。若本包自带一份 zod，就可能与宿主拿到的是**两个不同的 zod 实例**，
 *     跨实例的 schema 在类型面与行为面都不保证兼容。所以 zod 走 peer。
 *     这条只钉住「zod 在 peers 且不在 dependencies」，不替作者做别的包的决定。
 *
 * 读取产物而非源码：源码里可能出现 `import type`（编译后被完全剥掉，不需要
 * 运行时声明），只有 emit 后的 import 语句才是真实的运行时依赖。
 * @module tests/runtime-dependency-declaration
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

/** 从一份 emit 产物里取静态裸包说明符（`from 'x'` / `import 'x'` / `export * from 'x'`）。 */
export function bareSpecifiersOf(source) {
  const found = new Set();
  // 同时覆盖 import/export ... from 'x' 与副作用 import 'x'；
  // `import('x')` 是动态导入，同样需要运行时解析，一并收。
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    // 取包名：`@scope/name/sub` → `@scope/name`，`name/sub` → `name`
    const parts = spec.split('/');
    found.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
  }
  return found;
}

/** host 在 `lib/` 里静态加载的每个模块（不含 client bundle 与类型声明）。 */
function hostEmittedFiles() {
  const lib = join(repoRoot, 'lib');
  if (!existsSync(lib)) return [];
  const out = [];
  for (const entry of readdirSync(lib, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'client.js') {
      out.push(join(lib, entry.name));
    }
  }
  return out;
}

test('lib/ 里每条静态 import 的裸包都在 dependencies 或 peerDependencies 里', () => {
  const files = hostEmittedFiles();
  assert.ok(files.length > 0, 'lib/ 里没有 host 产物：先 npm run build，别让这条判据空转');

  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);

  const missing = [];
  for (const file of files) {
    for (const spec of bareSpecifiersOf(readFileSync(file, 'utf8'))) {
      if (declared.has(spec)) continue;
      missing.push(`${file.slice(repoRoot.length + 1)} → ${spec}`);
    }
  }

  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    `以下运行时依赖没在 dependencies/peerDependencies 里声明（devDependencies 不算）：\n  ${missing.join('\n  ')}`,
  );
});

test('zod 走 peerDependencies（宿主 ProjectionDefinition 的类型面就是 ZodType）', () => {
  assert.ok(
    Object.hasOwn(pkg.peerDependencies ?? {}, 'zod'),
    'zod 必须在 peerDependencies：它是运行时值 import，只写 devDependencies 时 profile 里没有就整条挂',
  );
  assert.ok(
    !Object.hasOwn(pkg.dependencies ?? {}, 'zod'),
    'zod 不能用 dependencies 自带一份：宿主 ProjectionDefinition.stateSchema 是 ZodType，两份 zod 实例的 schema 不保证互通',
  );
});

test('src/projection.ts 的 zod 仍是值 import（若改成 import type，上面两条就该放宽）', () => {
  const source = readFileSync(join(repoRoot, 'src/projection.ts'), 'utf8');
  const valueImport = /^import\s*\{[^}]*\bz\b[^}]*\}\s*from\s*'zod'/m.test(source);
  const typeImport = /^import\s+type\s*\{[^}]*\bz\b/m.test(source);
  assert.ok(valueImport, 'src/projection.ts 里找不到 `import { z } from \'zod\'`：判据前提变了，先核对');
  assert.ok(!typeImport, 'src/projection.ts 把 zod 改成了 import type？那 zod 就不再是运行时依赖，本文件判据要跟着改');
});

/**
 * 端到端反证（issue #145 的「跨内核 verify 再加一维」）：profile 的 node_modules
 * 里**没有** zod 时，`lib/index.js` 能不能加载。
 *
 * 做法与审计脚本一致：造一份只链回仓库 node_modules 的临时目录，唯独把 zod
 * 摘掉，再把真 `lib/` 放进去 import。这不是「模拟」，它真的跑一遍 Node 的
 * ESM 解析器——所以它证明的是解析结果，不是某个字符串匹配。
 *
 * skip 条件：仓库没装依赖时无法造这份隔离目录（CI 里 pnpm install 之后才有）。
 */
test('profile 里没有 zod 时 lib/index.js 仍能加载（判据前提：zod 已被 hoist 掩盖）', async (t) => {
  const sourceModules = join(repoRoot, 'node_modules');
  const hostEntry = join(repoRoot, 'lib/index.js');
  if (!existsSync(sourceModules) || !existsSync(hostEntry)) return t.skip('没有 node_modules 或 lib/：先 install + build');

  const dir = mkdtempSync(join(tmpdir(), 'dsh-later-nozod-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'node_modules', '@deepseek-ai'), { recursive: true });
  for (const name of readdirSync(sourceModules)) {
    if (name === 'zod' || name.startsWith('.') || name.startsWith('@')) continue;
    symlinkSync(join(sourceModules, name), join(dir, 'node_modules', name));
  }
  for (const name of readdirSync(join(sourceModules, '@deepseek-ai'))) {
    symlinkSync(join(sourceModules, '@deepseek-ai', name), join(dir, 'node_modules', '@deepseek-ai', name));
  }
  assert.ok(!existsSync(join(dir, 'node_modules', 'zod')), '隔离目录里不该有 zod，否则反证失效');
  cpSync(join(repoRoot, 'lib'), join(dir, 'lib'), { recursive: true });
  cpSync(join(repoRoot, 'package.json'), join(dir, 'package.json'));

  // 正向：没 zod 时必须失败。改前实测信息是
  // `Cannot find package 'zod' imported from lib/projection.js`。
  let failure;
  try {
    await import(join(dir, 'lib/index.js'));
  } catch (error) {
    failure = error;
  }
  assert.ok(failure !== undefined, '没有 zod 竟然加载成功了？说明 host 入口已不再静态依赖 zod——本反证可以退役');
  assert.equal(failure.code, 'ERR_MODULE_NOT_FOUND', `失败原因不是缺包：${failure.code} ${failure.message}`);
  assert.match(
    failure.message,
    /Cannot find package '(zod|@deepseek-ai\/[^']+)' imported from/,
    `失败原因不是缺运行时依赖：${failure.message}`,
  );

  // 复现完成后把 repo 那份 zod 放回去：证明同一份产物在有 zod（= peer 被宿主满足）时能加载。
  // 这才是「声明的 peer 被满足后插件能起来」的那一半。

  // ⚠️ 必须在**新进程**里重试，不能在同进程里 import 第二次。
  // 本文件最初用的就是同进程 `import(... + '?satisfied=' + Date.now())`，在 node 24 上
  // **绿**、在本仓 CI 的 node 22 上**红**。实测隔离（探针见下）：node 24 会把一次失败的
  // 解析按文件路径记住，此后换任何 query 都不再重新解析；node 22 会重新解析。
  // 于是那条断言在 node 24 上「通过」的原因是错的——它压根没走到成功路径，
  // 而在一半的受支持版本上是红的。这条失败本身就是「版本差异造成的假绿」的实例。
  //
  // 探针（可复跑）：先 import 一个依赖不存在的 a.mjs（ERR_MODULE_NOT_FOUND），装上依赖、
  // 再用 `a.mjs?q=2` import —— node 24 仍报 ERR_MODULE_NOT_FOUND，node 22 返回 OK。
  //
  // 新进程没有任何解析缓存，它检验的正是「这份产物在 peer 被满足时能不能起来」。
  symlinkSync(join(sourceModules, 'zod'), join(dir, 'node_modules', 'zod'));
  const probe = `
    import(${JSON.stringify(join(dir, 'lib/index.js'))})
      .then(() => process.exit(0))
      .catch((error) => {
        process.stderr.write(String(error && error.stack || error));
        process.exit(1);
      });
  `;
  const retry = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(
    retry.status,
    0,
    `补回 zod 后 lib/index.js 仍加载失败：不是依赖声明问题，是别的激活问题\n${retry.stderr ?? ''}`,
  );
});
