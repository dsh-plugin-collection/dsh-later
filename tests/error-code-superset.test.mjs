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
 *      复制**承载码表的那个声明文件**到临时路径，在码表里插入一个未知码——rc.2（别名链）
 *      是 types.d.ts 的 `ScheduleToolError` 联合加一枚 `| BrandNewError` 接口、并在
 *      `ScheduleInputErrorCode` 的 `Exclude` 里保留它（或直接把该联合写成
 *      `… | 'brand_new_code'`）；rc.1（内联联合）是 domain.d.ts 的属性/构造两处
 *      联合里插入 `'brand_new_code' |`。再以
 *      `DSH_LATER_SCHEDULE_TYPES_DTS=/tmp/.../domain.d.ts node --test
 *      tests/error-code-superset.test.mjs` 运行即可（别名链的入口用同一个变量指向 types.d.ts）。
 *      该环境变量只是变异验证的注入口，正常运行时不会设置，路径始终来自实际安装的包。
 *
 * ⚠️ 0.2.2-rc.2 起上游把 `readonly code` 的**内联字面量联合换成了类型别名**：
 *   domain.d.ts:  `readonly code: ScheduleInputErrorCode;`
 *   types.d.ts:   `export type ScheduleInputErrorCode = Exclude<ScheduleToolError['code'], 'internal_error'>;`
 *                 `export type ScheduleToolError = InvalidPromptError | … | InternalScheduleError;`
 *   各接口再各自声明 `readonly code: '<literal>'`。
 * 所以这里按**形状**解析而不是按某一代的写法解析：内联联合 → 别名链 → 无法解析则**断言失败**
 * （绝不「解析不到就跳过」，否则这条护栏就废了）。两条路径都收敛到同一个语义集合
 * （`Exclude` 的排除项会真的被排除掉），并且用「必须命中已知基线码」这一断言，防止解析器
 * 空转后返回一个看似合法的空集/错集。
 * @module tests/error-code-superset
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * 某个声明文件里 `export type <name> = …` 的右侧文本（到收尾 `;` 为止）。
 *
 * 够用的原因：这里要解析的都是**上游自己生成**的类型别名，右侧不会有嵌套到需要
 * 解析器的构造；若真遇上了，后续的联合解析会因「认不出成员」而断言失败，不会静默放行。
 */
function aliasBody(text, name, label) {
  const prefix = `export type ${name} =`;
  const start = text.indexOf(prefix);
  assert.notEqual(start, -1, `${label}：找不到 \`${prefix}\``);
  const end = text.indexOf(';', start);
  assert.notEqual(end, -1, `${label}：\`${name}\` 别名未以 \`;\` 收尾`);
  return text.slice(start + prefix.length, end).trim();
}

/** 从 `A | B<'c'>` 里取成员名单（按顶层 `|` 切，忽略泛型参数里的 `|`）。 */
function unionMembers(body, label) {
  const members = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '<') depth += 1;
    else if (char === '>') depth -= 1;
    if (char === '|' && depth === 0) {
      members.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  members.push(current.trim());
  assert.ok(depth === 0, `${label}：泛型尖括号不配对（${body}）`);
  return members.filter((member) => member.length > 0);
}

/** 取某个接口（或对象类型别名）声明的 `readonly code` 表达式。 */
function codeOfInterface(name, sources, label) {
  const declaration = new RegExp(`(?:export interface ${name}\\s*\\{|export type ${name} =\\s*\\{)`);
  for (const text of sources) {
    const start = text.search(declaration);
    if (start === -1) continue;
    const end = text.indexOf('\n}', start);
    assert.notEqual(end, -1, `${label}：\`${name}\` 声明未正常闭合`);
    const code = /readonly code:\s*([^;]+);/.exec(text.slice(start, end));
    assert.ok(code, `${label}：\`${name}\` 里找不到 \`readonly code: …\``);
    return code[1];
  }
  assert.fail(`${label}：在所有候选声明文件里都找不到 \`${name}\` 的声明`);
}

/**
 * 解析一个具名类型别名的码集合；右侧是接口/字面量联合时逐个递归解析成员。
 *
 * `sources` 是**全部**候选声明文件的正文：rc.2 的码表分散在 types.d.ts 的多个接口上，
 * 搜索范围不能只盯着类所在的 domain.d.ts。
 */
function resolveUnionAlias(name, sources, label, seen = new Set()) {
  assert.ok(!seen.has(name), `${label}：类型别名 \`${name}\` 出现循环引用`);
  const nextSeen = new Set(seen).add(name);

  for (const text of sources) {
    if (!text.includes(`export type ${name} =`)) continue;
    const codes = new Set();
    for (const member of unionMembers(aliasBody(text, name, label), label)) {
      if (member.startsWith("'")) {
        // 联合里直接写死的字面量成员（变异验证就是这么注入的）
        for (const code of literalsOf(member, `${label} 的成员`)) codes.add(code);
        continue;
      }
      // 成员既可能是接口名（`InvalidPromptError`），也可能是嵌套表达式
      // （rc.2 的 `ScheduleInputErrorCode = Exclude<ScheduleToolError['code'], …>`，
      // 那里 `['code']` 里的引号会让它落不到「单个标识符」这一支）。
      assert.match(
        member,
        /^(?:[A-Za-z_$][\w$]*|Exclude<.*>)$/,
        `${label}：联合里认不出的成员 \`${member}\``,
      );
      const expression = /^[A-Za-z_$][\w$]*$/.test(member)
        ? codeOfInterface(member, sources, label)
        : member;
      const memberCodes = resolveCodeExpression(expression, sources, label, nextSeen);
      for (const code of memberCodes) codes.add(code);
    }
    assert.ok(codes.size > 0, `${label}：\`${name}\` 解出空集合，上游声明形态变了？`);
    return codes;
  }
  assert.fail(`${label}：在所有候选声明文件里都找不到 \`export type ${name} =\``);
}

/**
 * 解析一个「code 成员」所指向的码集合。
 *
 * 三种上游形状都要认（不同代次各用其一）：
 *   1. 内联字面量联合：`readonly code: 'a' | 'b'`（0.2.1-rc.2 及更早）
 *   2. 类型别名：`readonly code: ScheduleInputErrorCode`（0.2.2-rc.2 起）
 *   3. `Exclude<ScheduleToolError['code'], 'internal_error'>`：并起成员接口的 code，
 *      再**真的**减掉排除项。
 * 认不出就断言失败——这是护栏本身，不能退化成「解析不到就跳过」。
 */
function resolveCodeExpression(expression, sources, label, seen = new Set()) {
  const text = expression.trim();

  if (text.startsWith("'")) return literalsOf(text, label);

  const exclude = /^Exclude<(\w+)\['code'\],\s*([^>]+)>$/.exec(text);
  if (exclude !== null) {
    const [, unionName, excludedText] = exclude;
    const excluded = literalsOf(excludedText, `${label} 的 Exclude 排除项`);
    const codes = resolveUnionAlias(unionName, sources, label, seen);
    for (const code of excluded) {
      assert.ok(
        codes.has(code),
        `${label}：Exclude 排除项 '${code}' 不在 ${unionName} 里，上游声明自相矛盾`,
      );
    }
    const kept = new Set([...codes].filter((code) => !excluded.has(code)));
    assert.ok(kept.size > 0, `${label}：Exclude<${unionName}['code'], …> 解出空集合，上游形态变了？`);
    return kept;
  }

  if (/^[A-Za-z_$][\w$]*$/.test(text)) return resolveUnionAlias(text, sources, label, seen);

  assert.fail(
    `${label}：认不出的上游声明形态 \`${text}\`（既非内联字面量联合、也非类型别名或 Exclude）。` +
      '上游又换了写法——请按新形态扩展本函数的解析，不要把断言放宽成跳过。',
  );
}

/**
 * 每一代都必定存在的基线码：解析器空转会得到空集，而「插件是空集的超集」恒真——
 * 那正是这条护栏失效的样子。缺任何一个基线码都说明解析坏了（或上游真的要删码，
 * 那种情况应该让这条红一次、由人确认后同步更新，而不是悄悄失效）。
 */
const BASELINE_CODES = [
  'invalid_prompt',
  'invalid_selector',
  'invalid_rule',
  'invalid_time_zone',
  'not_future',
  'time_out_of_range',
  'frequency_too_high',
  'subagent_session',
];

/** 上游 ScheduleInputError.code 的实际联合（兼容内联联合与别名链两种声明形态）。 */
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

  // 候选文件：类所在文件在前，再补同目录的其它 d.ts（rc.2 的码表在 types.d.ts）。
  const dir = dirname(file);
  const siblings = readdirSync(dir)
    .filter((name) => name.endsWith('.d.ts'))
    .sort()
    .map((name) => readFileSync(resolve(dir, name), 'utf8'))
    .filter((other) => other !== text);
  const sources = [text, ...siblings];

  const fromProperty = resolveCodeExpression(property[1], sources, 'ScheduleInputError.code');
  const fromConstructor = resolveCodeExpression(
    constructor[1],
    sources,
    'ScheduleInputError 构造签名',
  );
  // 同一联合在类声明里出现两次（属性 + 构造参数）；两处不一致说明上游声明本身
  // 自相矛盾，护栏不该替它挑一处当真。
  assert.deepEqual(
    [...fromConstructor].sort(),
    [...fromProperty].sort(),
    'ScheduleInputError 的属性联合与构造签名联合不一致',
  );

  for (const baseline of BASELINE_CODES) {
    assert.ok(
      fromProperty.has(baseline),
      `ScheduleInputError.code 里缺少基线码 '${baseline}'：解析逻辑坏了，或上游真的要删码`,
    );
  }
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
