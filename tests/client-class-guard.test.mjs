/**
 * 客户端类名守护：组件 `className` 里用到的每个 `ss-*` 类，必须在 `styles.ts` 有定义。
 *
 * 起因是仓库里真实存在过的缺陷：`SchedulerSettingsCard.tsx` 已经在渲染
 * `<span className="ss-section-beta">`，而 `styles.ts` 里**从来没有**这条规则 ——
 * 于是徽标一直是个无样式的裸文本。这类 bug 的特征是：
 *  - 编译不报错（className 是字符串，TS 管不着）；
 *  - 测试不报错（没有断言看过它）；
 *  - 肉眼也难发现（组件确实"渲染了徽标"，只是长得不对）。
 * 所以只能靠一条结构性守护。
 *
 * 提取规则（都是踩出来的，改动前请先跑 `--` 下面的自证）：
 *  - 只认 `className="…"` 与 `className={…}` 两种属性，**不全域扫 `ss-`**：
 *    全域扫会把 `data-ss-dock`（探针属性）、`id="ss-show-settings"`（DOM id）、
 *    `aria-labelledby` 全当成类名，误报 6 个，守护立刻失去可信度；
 *  - `className={…}` 用花括号平衡取整个表达式，再取其中的字符串/模板字面量
 *    （三元与模板串里的 `' ss-due'` 这类必须能看见）；
 *  - 剔除 `${…}` 插值并要求 token 不以 `-` 结尾：否则 `ss-section-${id}` 会被截成
 *    `ss-section-` 这种半截名字；
 *  - 窗口式启发（"取 className 后 N 个字符"）已试过，**会把类名从中间截断**
 *    （`ss-tasklist-header` → `ss-tasklist-h`），不要退回那种写法。
 *
 * 反向自证用**内存里删规则**而不是 `git show main:…`：不依赖 ref 名，且在别的
 * 克隆/CI 上同样成立。
 * @module tests/client-class-guard
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

/** 递归列出 src/client 下的 TS/TSX（排除样式表本身）。 */
function clientFiles(dir = 'src/client') {
  const abs = path.join(repoRoot, dir);
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...clientFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('styles.ts')) out.push(rel);
  }
  return out;
}

/** 从组件源码里精确收集 `className` 用到的 `ss-*` 类名。 */
export function classNamesUsed(src) {
  const out = new Set();
  const addTokens = (text) => {
    const cleaned = text.replace(/\$\{[^}]*\}/g, ' ');
    for (const m of cleaned.matchAll(/(?<![\w-])ss-[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/g)) {
      if (!m[0].endsWith('-')) out.add(m[0]);
    }
  };
  for (const m of src.matchAll(/className="([^"]*)"/g)) addTokens(m[1]);
  for (const m of src.matchAll(/className=\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    const expr = src.slice(m.index + m[0].length, i - 1);
    for (const s of expr.matchAll(/['"`]([^'"`]*)['"`]/g)) addTokens(s[1]);
  }
  return out;
}

/** styles.ts 里定义了哪些 `.ss-*` 类（复合选择器 `.a.b` 两个都算）。 */
export function classNamesDefined(stylesSrc) {
  return new Set([...stylesSrc.matchAll(/\.ss-[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/g)].map((m) => m[0].slice(1)));
}

const styles = read('src/client/styles.ts');
const used = new Map();
for (const file of clientFiles()) {
  for (const cls of classNamesUsed(read(file))) if (!used.has(cls)) used.set(cls, file);
}

test('组件用到的每个 ss-* 类都在 styles.ts 里有定义（零豁免）', () => {
  const defined = classNamesDefined(styles);
  const missing = [...used].filter(([cls]) => !defined.has(cls));
  assert.deepEqual(missing.map(([cls, file]) => `${cls} ← ${file}`), [],
    '有类名被引用却没有规则：要么补样式，要么删掉这个死类（别留着骗人）');
});

test('提取器不是空转：它真的看见了这么多类名', () => {
  // 判据失效的形态是"扫不到任何东西 → 永远通过"。这里给一个下限。
  assert.ok(used.size > 60, `只解析到 ${used.size} 个类名，疑似提取器失配`);
  for (const probe of ['ss-dock-row', 'ss-section-beta', 'ss-dock-thumb']) {
    assert.ok(used.has(probe) || definedHas(probe), `探针类 ${probe} 既没被用到也没被定义？`);
  }
});

test('反向自证：删掉某条规则，守护必须立刻抓到它（防判据永真）', () => {
  const probe = 'ss-section-beta';
  assert.ok(used.has(probe), '本自证依赖组件确实引用了 ss-section-beta');
  const stripped = styles.replace(/'\.ss-section-beta \{',[\s\S]*?'\}',\n/, '');
  assert.notEqual(stripped, styles, '没能从 styles.ts 里摘掉那条规则，自证无效');
  const missing = [...classNamesUsedAll()].filter((c) => !classNamesDefined(stripped).has(c));
  assert.ok(missing.includes(probe), '删了规则却抓不到 → 守护是摆设');
});

function definedHas(cls) {
  return classNamesDefined(styles).has(cls);
}
function classNamesUsedAll() {
  return used.keys();
}
