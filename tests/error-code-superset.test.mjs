/**
 * 上游 ScheduleInputError code 闭包的超集护栏（Gitea issue #54）。
 *
 * 为什么需要它：`UserScheduleErrorCode` 是**手写镜像**，上游每加一个 code 就
 * 可能悄悄漂移。0.2.1 给 ScheduleInputError 加了 `subagent_session`，而当时
 * 本仓 devDep 还停在 0.2.0-rc.2——手写镜像有没有跟上，编译器在这个版本下
 * 根本看不出来。所以这里不手抄码表，而是**从实际安装的
 * @deepseek-ai/dsh-schedule 类型声明里取** `ScheduleInputError.code` 的联合，
 * 断言本插件源码里的 `UserScheduleErrorCode` 是它的超集。
 *
 * 读取源码而不读 lib/：lib/** 是构建产物，可能滞后于 src（本仓惯例是集成时
 * 由 Lead 统一重建），拿滞后产物做护栏会在最该报警的时候静默通过。
 *
 * 变异验证（仅手工用，不在 CI 里跑）：
 *   ① 从 src/user-tools.ts 的联合里删掉一个上游码（如 'not_future'）→ 本测试红；
 *   ② 给上游声明加一个本插件没有的码 → 本测试红。② 不必改 node_modules：
 *      复制 domain.d.ts 到临时路径、在 property/constructor 两处联合里插入
 *      `'brand_new_code' |`，再以
 *      `DSH_LATER_SCHEDULE_TYPES_DTS=/tmp/.../domain.d.ts node --test
 *      tests/error-code-superset.test.mjs` 运行即可。该环境变量只是变异验证
 *      的注入口，正常运行时不会设置，路径始终来自实际安装的包。
 * @module tests/error-code-superset
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** 从一段声明文本里抽出字符串字面量集合（重复出现视为声明写错）。 */
function literalsOf(declaration, label) {
  const codes = [...declaration.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(codes.length > 0, `${label}：没解析到任何字符串字面量（上游声明格式变了？）`);
  assert.equal(new Set(codes).size, codes.length, `${label}：字面量重复，码表写错了？`);
  return new Set(codes);
}

/** 本插件源码里的 UserScheduleErrorCode 联合（源码是事实来源，不读 lib/）。 */
function pluginCodes() {
  const file = resolve(root, 'src/user-tools.ts');
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf('export type UserScheduleErrorCode =');
  assert.notEqual(start, -1, 'src/user-tools.ts 里找不到 `export type UserScheduleErrorCode =`');
  const end = source.indexOf(';', start);
  assert.notEqual(end, -1, '`UserScheduleErrorCode` 联合未以 `;` 收尾');
  return literalsOf(source.slice(start, end), 'src/user-tools.ts 的 UserScheduleErrorCode');
}

/** 定位实际安装的 dsh-schedule 里承载 ScheduleInputError 的类型声明文件。 */
function upstreamTypesFile() {
  const override = process.env.DSH_LATER_SCHEDULE_TYPES_DTS;
  if (override !== undefined && override.length > 0) return override;

  // 经 exports 解析 package.json，再沿它声明的 types 入口找 domain 声明：
  // 入口 index.d.ts 以 `export { …, ScheduleInputError, … } from './domain.ts'`
  // 重导出，因此从入口的重导出目标取文件，避免写死内部目录结构。
  const pkgJsonPath = require.resolve('@deepseek-ai/dsh-schedule/package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const entry = resolve(dirname(pkgJsonPath), pkg.types ?? 'lib/types/index.d.ts');
  const entryText = readFileSync(entry, 'utf8');
  const reExport = /export\s*\{[^}]*\bScheduleInputError\b[^}]*\}\s*from\s*'([^']+)'/.exec(entryText);
  assert.ok(reExport, `dsh-schedule 入口类型 ${entry} 里找不到 ScheduleInputError 的重导出`);
  const from = resolve(dirname(entry), reExport[1]);
  // tsc 声明里相对导入写的是 './domain.ts'，实际文件是 domain.d.ts。
  for (const candidate of [from, from.replace(/\.ts$/, '.d.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* 试下一个候选 */
    }
  }
  assert.fail(`ScheduleInputError 的声明文件不存在：${from}`);
}

/** 上游 ScheduleInputError.code 的实际联合。 */
function upstreamCodes() {
  const file = upstreamTypesFile();
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('export declare class ScheduleInputError');
  assert.notEqual(start, -1, `${file} 里找不到 \`export declare class ScheduleInputError\``);
  const end = text.indexOf('\n}', start);
  assert.notEqual(end, -1, `${file} 里 ScheduleInputError 类声明未正常闭合`);
  const block = text.slice(start, end);
  const property = /readonly code:\s*([^;]+);/.exec(block);
  const constructor = /constructor\(code:\s*([^,]+),/.exec(block);
  assert.ok(property, `${file} 里找不到 \`readonly code: …\``);
  assert.ok(constructor, `${file} 里找不到 \`constructor(code: …)\``);

  const fromProperty = literalsOf(property[1], 'ScheduleInputError.code');
  const fromConstructor = literalsOf(constructor[1], 'ScheduleInputError 构造签名');
  // 同一联合在类声明里出现两次（属性 + 构造参数）；两处不一致说明上游声明本身
  // 自相矛盾，护栏不该替它挑一处当真。
  assert.deepEqual(
    [...fromConstructor].sort(),
    [...fromProperty].sort(),
    'ScheduleInputError 的属性联合与构造签名联合不一致',
  );
  return fromProperty;
}

test('UserScheduleErrorCode 是上游 ScheduleInputError.code 的超集（#54）', () => {
  const upstream = upstreamCodes();
  const plugin = pluginCodes();
  const missing = [...upstream].filter((code) => !plugin.has(code));
  assert.deepEqual(
    missing,
    [],
    `本插件 UserScheduleErrorCode 缺少上游 code：${missing.join(', ')}。` +
      '请在 src/user-tools.ts 的联合里追加，并在 src/strings.ts 的 zh/en 字典补 err* 文案。',
  );
});

test('subagent_session 具备 zh / en 两套文案（#54）', () => {
  const source = readFileSync(resolve(root, 'src/strings.ts'), 'utf8');
  const messages = [...source.matchAll(/errSubagentSession:\s*'([^']*)'/g)].map((match) => match[1]);
  assert.equal(messages.length, 2, 'src/strings.ts 的 zh / en 字典应各有一条 errSubagentSession');
  for (const message of messages) {
    assert.ok(message.trim().length > 0, 'errSubagentSession 文案不能为空');
  }
  assert.match(messages[0], /[\u4e00-\u9fff]/, 'zh 字典的 errSubagentSession 应是中文文案');
  assert.notEqual(messages[0], messages[1], 'zh / en 文案不应相同');
});
