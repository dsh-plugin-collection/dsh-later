/**
 * issue #145 A 面的判据层：**注释不随产物走、`lib/client.js` 不把中文写成转义**。
 *
 * 为什么要单独钉住：这两条都只是一行构建配置（`tsconfig.json` 的 `removeComments`、
 * `build.mjs` 里 client 那步的 `charset: 'utf8'`），删掉之后构建照样成功、测试照样全绿，
 * 唯一的信号是产物体积悄悄涨回去。所以分三层判：
 *
 * 1. **配置在位**：`tsconfig.json` 明确写了 `removeComments: true`；`build.mjs` 的 client
 *    `build({...})` 里写了 `charset: 'utf8'`。等价于反向锚点：配置被删就直接红。
 * 2. **产物符合**：仓库里的 `lib/client.js` 没有中日韩区间的 `\uXXXX`（正则里剩余的控制
 *    字符转义不算，见 `\u` 计数函数的注释），且 `lib/*.js` 里没有块注释。
 * 3. **行内注释在位**：`charset` 那条注释必须讲清「为什么安全」与 esbuild 文档的两条边界，
 *    以及宿主送出侧的 charset 取证。这三件事一旦只剩代码没有理由，下一个人就会顺手删掉它。
 *
 * 只读文件与读产物，不跑构建，因此可与其它测试文件并行。
 * @module tests/build-emit-slimming
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * 数 `\uXXXX` 转义里落在中日韩区间的那些。
 * 只数 CJK 区间是因为产物里合法保留的控制字符转义（如路径校验正则里的 `\u0000-\u001f`）
 * 与中文无关，把它们算进来会让判据对「中文是否还在被转义」失去分辨力。
 * @param {string} source
 * @returns {string[]}
 */
function cjkEscapes(source) {
  const all = source.match(/\\u[0-9a-fA-F]{4}/g) ?? [];
  /** @param {string} escape */
  return all.filter((escape) => {
    const code = Number.parseInt(escape.slice(2), 16);
    return (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    );
  });
}

/* ---------------- 1. 配置在位 ---------------- */

test('tsconfig.json 开 removeComments：注释不随 tsc 产物走', () => {
  const tsconfig = JSON.parse(read('tsconfig.json'));
  assert.equal(
    tsconfig.compilerOptions.removeComments,
    true,
    'removeComments 必须是 true：注释留在 lib/ 与 lib/types/ 里，等于每份产物多背一遍源码注释',
  );
});

test('build.mjs 的 client esbuild 步骤带 charset: utf8', () => {
  const build = read('build.mjs');
  assert.match(
    build,
    /^\s*charset:\s*'utf8',$/m,
    "client 那步 esbuild 必须显式写 charset: 'utf8'：默认 ascii 会把每个汉字写成 6 字节转义",
  );
});

test('charset 的注释同时讲清「为什么安全」「文档两条边界」「宿主取证」', () => {
  const build = read('build.mjs');
  const start = build.indexOf("entryPoints: ['src/client/index.tsx']");
  assert.notEqual(start, -1, "找不到 client 那步 esbuild 的 build({...})");
  const end = build.indexOf('\n});', start);
  assert.notEqual(end, -1, 'client 那步 build({...}) 没有闭合');
  const options = build.slice(start, end);

  assert.match(options, /charset:\s*'utf8'/, 'charset 必须在 client 的 build({...}) 里');
  assert.match(options, /为什么安全/, '必须说明为什么安全：前提是送出侧声明了 UTF-8');
  assert.match(options, /正则字面量/, '必须写明文档边界之一：不处理正则字面量里的非 ASCII');
  assert.match(options, /注释/, '必须写明文档边界之二：不作用于注释');
  assert.match(options, /charset=utf-8/, '必须写出宿主送出侧的实测 charset（不能只说"应该没问题"）');
  assert.match(
    options,
    /https:\/\/esbuild\.github\.io\/api\/#charset/,
    '必须给出 esbuild 文档依据的链接',
  );
});

/* ---------------- 2. 产物符合 ---------------- */

const clientPath = join(repoRoot, 'lib/client.js');
const canInspect = existsSync(clientPath);

test('lib/client.js 里没有中日韩区间的 \\uXXXX 转义', { skip: !canInspect }, () => {
  const escapes = cjkEscapes(read('lib/client.js'));
  assert.deepEqual(
    escapes.slice(0, 10),
    [],
    `lib/client.js 仍有 ${escapes.length} 处中文转义，charset: 'utf8' 没生效`,
  );
});

test('lib/*.js 里没有块注释（removeComments 生效）', { skip: !canInspect }, () => {
  const libDir = join(repoRoot, 'lib');
  const offenders = [];
  for (const name of readdirSync(libDir)) {
    if (!name.endsWith('.js') || name === 'client.js') continue;
    const body = read(join('lib', name));
    // 只认「行首（可带缩进）起头的块注释」：产物是 tsc 按源码重建的格式，注释若残留会
    // 出现在这种位置；字符串里恰好含 `/*` 的字符不会以行首形态出现。
    const blocks = body.match(/(^|\n)[ \t]*\/\*[\s\S]*?\*\//g) ?? [];
    if (blocks.length > 0) offenders.push(`${name}: ${blocks.length} 处`);
  }
  assert.deepEqual(
    offenders,
    [],
    `这些产物里还有整块注释，removeComments 没生效：\n- ${offenders.join('\n- ')}`,
  );
});
