/**
 * 护栏：用户可见的回执文案不得在代码里硬编码中文（必须走 8 门字典）。
 *
 * ## 为什么需要它
 *
 * i18n 这件事的失败方式很特殊：**测试全绿、界面照样给用户看中文**。
 * 2026-11 那轮把界面词条补齐 8 门之后，`src/runtime.ts` 的 9 条插话回执、
 * `src/index.ts` 的 4 条工具回执仍然是中文字面量 —— 它们不在任何字典里，
 * 于是德语/俄语用户点「插话发送」失败时看到的是「调度器已停止。」。
 * 当时的测试一条都没红：**没有任何断言在盯"这个位置该不该走字典"**。
 *
 * 所以这条护栏盯的不是翻译质量（那个靠人工审校），而是**结构**：
 * `message:` / `text:` 这些「会被 renderText 交给用户看」的位置上，
 * 一旦出现中文字面量就直接判红。
 *
 * ## 判据的边界（刻意保守）
 *
 * 只认**明确的用户可见位置**：`message:` 与 `text:` 两个属性。不看：
 *  - `logger.warn(...)` / `throw new Error(...)`：诊断给人看的是开发者，`,
 *    保持中文可读性更重要（`later:` 前缀那批）；
 *  - 注释：不参与运行时；
 *  - `src/locales/**`：那本来就是字典本体；
 *  - 解析输入用的词表（`CN_DIGIT` 中文数字等）：那是文法不是文案。
 *
 * 因此这条护栏**不会**要求把日志也翻译掉 —— 那种"清零"会让排障变难。
 * @module tests/i18n-hardcoded-guard
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAN = /[\u4e00-\u9fff]/;

/** 递归列出 `src/` 下的 ts/tsx（跳过字典本体）。 */
function sourceFiles(dir = 'src', out = []) {
  const abs = path.join(repoRoot, dir);
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 字典本体豁免：那里本来就该是中文（zh 段）。
      if (rel.includes(`${path.sep}locales`)) continue;
      sourceFiles(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** 一行是不是注释。 */
const isComment = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

/**
 * 「用户可见属性」的白名单。
 *
 * `message` / `text` 是工具与命令的回执；`label` / `title` / `hint` / `placeholder` /
 * `description` 是宿主直接渲染进界面的位置。加 `label` 这一项的直接动因是 issue #169：
 * 设置页导航条目名当时只认中英两门，而护栏判据里根本没有 `label`。
 */
const VISIBLE_PROPS = [
  'message', 'text', 'label', 'title', 'hint', 'placeholder', 'description', 'tooltip',
];
const VISIBLE_PROP_RE = new RegExp(`^\\s*(?:${VISIBLE_PROPS.join('|')})\\s*:`);

/** 直接写在可见属性上的字面量：`message: '中文'`。 */
const INLINE_RE = new RegExp(
  `(?:${VISIBLE_PROPS.join('|')})\\s*:\\s*(['"\`])((?:[^'"\`\\\\]|\\\\.)*)\\1`,
);

/**
 * 函数值里的字面量：`label: () => { … return active === 'en' ? 'A' : '中文' }`。
 *
 * 为什么要单独一条：issue #169 的那行中文在 `return` 里，**不在属性名后面**，
 * 光把 `label` 加进白名单也照样匹配不到。只认 `message:` 直跟字面量的判据对
 * 「函数值的可见属性」（`label: () => …`、getter、各种 thunk）是瞎的。
 */
const ARROW_BODY_LOOKAHEAD = 12;

/**
 * 找出所有「用户可见位置上硬编码中文」的行。
 *
 * @returns {Array<{file: string, line: number, text: string}>}
 */
function findHardcodedReceipts() {
  const hits = [];
  for (const rel of sourceFiles()) {
    hits.push(...scanText(readFileSync(path.join(repoRoot, rel), 'utf8'), rel));
  }
  return hits;
}

/**
 * 扫描一段源码文本。抽成独立函数是为了让自证可以喂**内存里的字符串**，
 * 不必写临时文件（写文件既污染工作区，在只读检出上还会失败）。
 *
 * @param {string} text - 源码文本。
 * @param {string} rel - 文件名（仅用于回报定位）。
 * @returns {Array<{file: string, line: number, text: string}>}
 */
function scanText(text, rel) {
  const hits = [];
  const lines = text.split('\n');
    lines.forEach((line, i) => {
    if (isComment(line)) return;
    // ① 属性名后面直接跟字面量
    const inline = INLINE_RE.exec(line);
    if (inline !== null && HAN.test(inline[2])) {
      hits.push({ file: rel, line: i + 1, text: inline[2].slice(0, 60) });
      return;
    }
    // ② 可见属性的值是函数，字面量在函数体里（往下看一小段）
    if (!VISIBLE_PROP_RE.test(line)) return;
    if (!/=>|\bfunction\b/.test(line)) return;
    const body = lines.slice(i, i + ARROW_BODY_LOOKAHEAD).join('\n');
    // 只看字符串字面量，避免把注释里的中文算进来
    for (const m of body.matchAll(/(['"\`])((?:[^'"\`\\\\]|\\\\.)*?)\1/g)) {
      if (HAN.test(m[2])) {
        hits.push({ file: rel, line: i + 1, text: m[2].slice(0, 60) });
        return;
      }
    }
});
return hits;
}

test('用户可见回执不得硬编码中文（必须走 8 门字典）', () => {
  const hits = findHardcodedReceipts();
  assert.deepEqual(
    hits,
    [],
    '以下位置把中文直接写进了 message/text —— 非中文用户会看到中文。'
      + '请改用 hostDictFor(locale) 的字典键：\n'
      + hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join('\n'),
  );
});

test('护栏自证：扫描器确实能抓到硬编码中文（不是空转）', () => {
  // 反向自证用**内存里的字符串**，不写临时文件：既不改工作区，也不依赖 git ref。
  // 若把 findHardcodedReceipts 的判断写坏（比如忘了匹配），这条会红。
  const sample = "    return { ok: false, code: 'x', message: '调度器已停止。' };";
  const m = /(?:message|text)\s*:\s*(['"`])((?:[^'"`\\]|\\.)*)\1/.exec(sample);
  assert.notEqual(m, null, '扫描器的正则应能匹配 message: 字面量');
  assert.ok(HAN.test(m[2]), '扫描器应能识别出这段是中文');

  // 走字典的写法不该被误判。
  const ok = "    return { ok: false, code: 'x', message: this.dict().errRtStopping };";
  assert.equal(/(?:message|text)\s*:\s*(['"`])/.exec(ok), null, '字典键引用不应被误报');
});

test('护栏自证：函数值里的可见属性（issue #169 的形态）也要能抓到', () => {
  // 反向自证用**内存里的字符串**，不写临时文件、不改工作区。
  //
  // issue #169 的原形态是这个样子的：中文不在属性名后面，而在 thunk 的 `return` 里。
  // 只测 `message: '中文'` 那种「属性名直跟字面量」的自证，测不到这个盲区 ——
  // 这正是护栏当时没拦住它的原因，所以这条自证必须钉住该形态。
  const sample = [
    '    label: () => {',
    "      const active = locale === undefined ? 'zh' : locale.getSnapshot().active;",
    "      return active === 'en' ? 'Session Scheduler' : '定时提醒';",
    '    },',
  ].join('\n');

  const hits = scanText(sample, 'src/client/index.tsx');
  assert.equal(hits.length, 1, 'label thunk 里的中文应被抓到');
  assert.match(hits[0].text, /定时提醒/u, '抓到的应是那串中文');

  // 走字典的写法（修好之后的样子）不该被误判。
  const fixed = [
    '    label: () => {',
    '      return cardT === undefined ? settingsDicts.zh.title : cardT("title");',
    '    },',
  ].join('\n');
  assert.deepEqual(scanText(fixed, 'src/client/index.tsx'), [], '字典键引用不应被误报');

  // 注释里的中文不该被误判成文案。
  const commented = [
    '    label: () => cardT("title"),',
    '    // 降级时显示「定时提醒」',
  ].join('\n');
  assert.deepEqual(scanText(commented, 'src/client/index.tsx'), [], '注释里的中文不应误报');
});
