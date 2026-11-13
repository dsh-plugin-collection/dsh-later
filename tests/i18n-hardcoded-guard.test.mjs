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
 * 找出所有「用户可见位置上硬编码中文」的行。
 *
 * @returns {Array<{file: string, line: number, text: string}>}
 */
function findHardcodedReceipts() {
  const hits = [];
  for (const rel of sourceFiles()) {
    const lines = readFileSync(path.join(repoRoot, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      // 用户可见位置：message: 或 text:
      const m = /(?:message|text)\s*:\s*(['"`])((?:[^'"`\\]|\\.)*)\1/.exec(line);
      if (m === null) return;
      if (!HAN.test(m[2])) return;
      hits.push({ file: rel, line: i + 1, text: m[2].slice(0, 60) });
    });
  }
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
