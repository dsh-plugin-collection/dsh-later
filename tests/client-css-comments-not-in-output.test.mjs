/**
 * 分区注释不得再以字符串元素的形式混进 COMPONENTS（issue #145 A-3）。
 *
 * 背景：`src/client/styles.ts` 曾把分区注释写成 `'/* … *\/'` 这样的数组元素。它属于 CSS
 * 文本的一部分，于是 esbuild 的 minify / legalComments 都处理不到它——产物里 77 个注释块
 * 逐字保留（实测 client.js 里数组字面量 60,224B，其中注释 28,058B，占 47%），还要叠加
 * 中文的 \u 转义。改成数组元素之间的 TS 注释后，注释留在源码里、不再进入产物。
 *
 * 等价性不靠肉眼：本文件把注入浏览器的 CSS 文本还原出来（数组元素按 join 分隔符拼接），
 * 与 `lib/client.js` 里同一段 CSS 比对，要求两边**归一化空白后**逐字节相等。归一化是必须的：
 * 注释元素消失后本就该少掉空行，而 CSS 的空行/缩进/`{ }` 前后空白对渲染零影响；真正的错误
 * （选择器粘连、规则被吞、少一条声明）在归一化后仍会现形。
 *
 * 变异自证：把一条注释塞回数组，前两条判据必须变红（见文件末尾）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const STYLES = new URL('../src/client/styles.ts', import.meta.url);
const CLIENT = new URL('../lib/client.js', import.meta.url);
const source = readFileSync(STYLES, 'utf8');

/** 用仓库自带的 TypeScript 解析器取 COMPONENTS 数组（行级正则会误抓别的字符串字面量）。 */
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');

/** 取出 COMPONENTS 的元素文本列表与 join 分隔符。 */
function componentsOf(text) {
  const sf = ts.createSourceFile('styles.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let decl;
  ts.forEachChild(sf, function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'COMPONENTS') decl = node;
    ts.forEachChild(node, visit);
  });
  assert.ok(decl, 'styles.ts 里应有 COMPONENTS 声明');
  const init = decl.initializer;
  const arrayLiteral = ts.isCallExpression(init) ? init.expression.expression : init;
  assert.ok(arrayLiteral.elements, 'COMPONENTS 应是数组字面量');
  const strings = arrayLiteral.elements.map((element) => {
    assert.ok(
      ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element),
      `COMPONENTS 里出现非字符串字面量元素，CSS 文本无法还原：${element.getText(sf).slice(0, 60)}`,
    );
    return element.text;
  });
  const joinArg = ts.isCallExpression(init) ? init.arguments[0] : undefined;
  const separator = joinArg ? joinArg.text : '\n';
  return { elements: strings, separator };
}

const { elements, separator } = componentsOf(source);

/** 浏览器实际注入的那段 CSS。 */
const cssText = (text = source) => {
  const parsed = componentsOf(text);
  return parsed.elements.join(parsed.separator);
};

/** 判据用的归一化：去注释 + 空白折叠。 */
const normalize = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();

test('COMPONENTS 里没有元素以 /* 开头（分区注释已改成 TS 注释）', () => {
  const offenders = elements
    .map((element, index) => ({ index, element }))
    .filter(({ element }) => element.trimStart().startsWith('/*'));
  assert.deepEqual(
    offenders.map(({ index, element }) => `#${index}: ${element.slice(0, 50)}`),
    [],
    '这些元素是 CSS 注释字符串：它们会原样进入产物，esbuild 动不了。' +
      '改写成数组元素之间的 TS 注释（`/* … *\/` 不加引号、不加尾逗号）。',
  );
});

test('COMPONENTS 里没有纯空白元素（防止用空白占位绕过上一条）', () => {
  // 这条与上一条是一对：只查「以 /* 开头」时，有人可以先把注释挪到一个空白元素旁边再塞回来；
  // 先立「不许有空壳元素」，注释就没有地方藏。空串 '' 合法——它是原生 CSS 的换行占位。
  const blanks = elements
    .map((element, index) => ({ index, element }))
    .filter(({ element }) => element !== '' && element.trim() === '');
  assert.deepEqual(
    blanks.map(({ index, element }) => `#${index}: ${JSON.stringify(element)}`),
    [],
    '数组里出现了纯空白元素。空行对渲染零影响，只会给产物加字节；' +
      '需要空行就靠 join 的换行，或用空串 \'\'。',
  );
});

test('源码还原出的 CSS 与产物 CSS 一致（防止数组形态与注入文本脱钩）', () => {
  if (!existsSync(CLIENT)) return; // 未构建时跳过：这条只在有产物时有意义
  const built = componentsOf(readFileSync(CLIENT, 'utf8')).elements.join(separator);
  assert.equal(
    normalize(cssText()),
    normalize(built),
    'styles.ts 的 COMPONENTS 与实际构建出的 CSS 不一致：要么 lib/client.js 过期（跑 npm run build），' +
      '要么数组形态变了但注入文本没跟着变',
  );
});

test('变异自证：把一条注释塞回数组，前两条判据必须变红', () => {
  const mutated = source.replace(
    /(const COMPONENTS = \[\n)/,
    "$1'/* 变异探针 */',\n'   ',", // 一条注释元素 + 一个纯空白元素，正好踩中两条判据
  );
  assert.notEqual(mutated, source, '自证脚本没能改动 COMPONENTS 数组，判据是否空转无法确认');

  const mutatedElements = componentsOf(mutated).elements;
  assert.ok(
    mutatedElements.some((element) => element.trimStart().startsWith('/*')),
    '塞回了注释元素却抓不到 → 「没有元素以 /* 开头」这条是摆设',
  );
  assert.ok(
    mutatedElements.some((element) => element !== '' && element.trim() === ''),
    '塞回了空白元素却抓不到 → 「没有纯空白元素」这条是摆设',
  );

  // 第三次自证走归一化判据本身：改动一条声明，归一化比较必须不等。
  const drifted = mutated.replace('.ss-sched-row { display: inline-flex;', '.ss-sched-row { display: flex;');
  assert.notEqual(drifted, mutated, '自证脚本没能改动 CSS 文本');
  // 注释与空白元素被去掉后，改动的声明仍在比较链上。
  assert.notEqual(normalize(cssText(drifted)), normalize(cssText(mutated)),
    '归一化判据对「声明被改」无感 → 它证明不了等价性');
});
