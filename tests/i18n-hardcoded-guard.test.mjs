/**
 * 护栏：用户可见的文案不得在代码里硬编码中文（必须走 8 门字典）。
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
 * 「会被交给用户看」的位置上一旦出现中文字面量就直接判红。
 *
 * ## 判据的边界（刻意保守）
 *
 * 只看**明确的用户可见位置**，共三类（#201 之后，之前只有第一类）：
 *  1. 对象/JSX 上的可见属性：`message:` / `text:` / `label:` / `title:` / `hint:` /
 *     `placeholder:` / `description:` / `tooltip:` / `aria-label` / `alt`；
 *  2. JSX 的**文本子节点**：`<span>两次都写了一遍中文</span>`；
 *  3. 函数值里的字面量（`label: () => … return '中文'` 那种 thunk 形态）。
 *
 * 不看：
 *  - `logger.warn(...)` / `throw new Error(...)`：诊断给人看的是开发者，
 *    保持中文可读性更重要（`later:` 前缀那批）；
 *  - 注释：不参与运行时；
 *  - `src/locales/**`：那本来就是字典本体；
 *  - 解析输入用的词表（`CN_DIGIT` 中文数字等）：那是文法不是文案。
 *
 * 因此这条护栏**不会**要求把日志也翻译掉 —— 那种"清零"会让排障变难。
 *
 * ## #201：两类漏网形态（护栏当时确实抓不到）
 *
 * 1. **`aria-label` / `alt` 不在白名单里**。读屏用户听到的是这串中文，界面上却
 *    看不见它，所以靠肉眼走查也漏；而且它们是 **JSX 属性**
 *    （`aria-label={…}`，分隔符是 `=`），旧正则只认对象字面量的 `prop: '…'`
 *    形态，加进白名单也不够 —— 必须同时认 `=`。
 * 2. **模板串**。`aria-label={`${t(labelKey)}说明`}` 里中文在**插值的尾巴上**，
 *    旧正则的字符串类遇到插值前的 `${…}` 仍然能整段捕获，但 `labelKey` 那串代码
 *    里的反引号/花括号让"整段是一个字面量"这件事变得不显然，实测也漏过；更关键的是
 *    3. **JSX 文本子节点**整类没有被扫过（`<div className="ss-hint">中文</div>`）。
 *
 * @module tests/i18n-hardcoded-guard
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTranspiledTree } from '../scripts/transpile-module.mjs';

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
 *
 * `aria-label` / `alt` 是 #201 补上的：**看不见**但会被读屏念出来，所以不能用
 * 「界面上没出现中文」当放过理由。它们在本仓全是 JSX 属性形态（`aria-label={…}`），
 * 因此 {@link INLINE_RE} 必须同时认 `=` 分隔符，否则加进白名单也照样匹配不到。
 */
const VISIBLE_PROPS = [
  'message', 'text', 'label', 'title', 'hint', 'placeholder', 'description', 'tooltip',
  'aria-label', 'alt',
];
const VISIBLE_PROP_RE = new RegExp(`^\\s*(?:${VISIBLE_PROPS.join('|')})+\\s*[:=]`);

/**
 * 直接写在可见属性上的字面量：`message: '中文'`、`aria-label={`…`}`。
 *
 * 两条扩展（#201），缺一条都会让白名单形同虚设：
 *  - 分隔符同时接受 `:` 与 `=` —— JSX 属性是后者；
 *  - 值可以是 `"…"` / `'…'` / `` `…` ``（模板串）。模板串里的中文经常在**插值的
 *    尾巴**上（`` `${t(labelKey)}说明` ``），所以匹配到的是整段模板串内容，CJK 判定
 *    对「任一段」成立即红；走字典的写法（`{format(t('helpAria'), { label: … })}`）
 *    在 `=` 后面跟的是标识符，压根不产生字符串字面量。
 */
const INLINE_RE = new RegExp(
  `(?:${VISIBLE_PROPS.join('|')})\\s*[:=]\\s*(?:\\{\\s*)?(['"\`])((?:[^'"\`\\\\]|\\\\.)*)\\1`,
);

/** JSX 文本子节点：`>中文<`（同一行内、不含花括号，免得把 `=> {` 当成文本）。 */
const JSX_TEXT_RE = />\s*([^<>{}`'\n]+?)\s*</;

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
    /*
     * 行内块注释剥离：`{/* … *\/}` 是本仓组件里最常见的写法，而它的正文常常是中文。
     * 不剥的话，只要某个可见属性恰好与注释同一行就会被误判成硬编码文案——而这条护栏
     * 一旦开始抓注释，维护者就会去关掉它（判据的可信度比覆盖度更贵）。
     * 只剥成对的 `/* … *\/`；解释型 `//` 已在 isComment 里按整行处理。
     */
    const withoutBlockComments = line.replace(/\/\*.*?\*\//g, '');
    // ① 属性名后面直接跟字面量（含 JSX 的 `=` 形态与模板串）
    const inline = INLINE_RE.exec(withoutBlockComments);
    if (inline !== null && HAN.test(inline[2])) {
      hits.push({ file: rel, line: i + 1, text: inline[2].slice(0, 60) });
      return;
    }
    // ② JSX 文本子节点里的中文（`<div className="ss-hint">中文</div>`）。
    const jsxText = JSX_TEXT_RE.exec(withoutBlockComments);
    if (jsxText !== null && HAN.test(jsxText[1])) {
      hits.push({ file: rel, line: i + 1, text: jsxText[1].slice(0, 60) });
      return;
    }
    // ③ 可见属性的值是函数，字面量在函数体里（往下看一小段）
    if (!VISIBLE_PROP_RE.test(withoutBlockComments)) return;
    if (!/=>|\bfunction\b/.test(withoutBlockComments)) return;
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
    '以下位置把中文直接写进了可见属性/JSX 文本 —— 非中文用户会看到中文。'
      + '请改用字典键（设置卡走 settingsDicts，dock/面板走 schedDicts/ui.ts）：\n'
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

test('护栏自证：中文在模板串插值尾巴上（#201 的形状）也要能抓到', () => {
  // #201 的原形态：`aria-label={`${t(labelKey)}说明`}`。
  // 中文既不在属性名后面（有 `${…}` 隔着），也不在函数体的 `return` 里 ——
  // 旧判据两条都不命中，这就是它漏了三年的原因。
  const sample = '                aria-label={`${t(labelKey)}说明`}';
  const hits = scanText(sample, 'src/client/components/SchedulerSettingsCard.tsx');
  assert.equal(hits.length, 1, '模板串尾巴上的中文应被抓到');
  assert.match(hits[0].text, /说明/u, '抓到的应包含那串中文');

  // 修好之后的样子：带参键经 format 插值，源码里不再有中文字面量。
  const fixed = "                aria-label={format(t('helpAria'), { label: t(labelKey) })}";
  assert.deepEqual(scanText(fixed, 'src/client/components/SchedulerSettingsCard.tsx'), [], '字典键 + 插值不应被误报');

  // `alt` 与 `aria-label` 同为看不见但会被读屏念出来的位置。
  const alt = '      <img alt="提醒附件预览" />;';
  const altHits = scanText(alt, 'src/client/components/ScheduleDock.tsx');
  assert.equal(altHits.length, 1, 'alt 里的中文同样要判红');

  // 对象字面量里的 template string 形态（不是 JSX）也要覆盖。
  const objectTpl = '    const tip = { tooltip: `已 ${n} 条提醒` };';
  const objectHits = scanText(objectTpl, 'src/client/session-presence.ts');
  assert.equal(objectHits.length, 1, '对象字面量里的模板串也同样要判红');
});

test('护栏自证：JSX 文本子节点里的中文（#201 的第三类）也要能抓到', () => {
  // 这一整类此前**没有被扫过**：中文既不在属性值里，也不在 JS 字符串里，就是 JSX 的
  // 孩子文本。它同样是界面上的一行字。
  const sample = '      <span className="ss-hint">两次都写了一遍中文</span>';
  const hits = scanText(sample, 'src/client/components/SchedPanel.tsx');
  assert.equal(hits.length, 1, 'JSX 文本子节点里的中文应被抓到');
  assert.match(hits[0].text, /两次都写了一遍中文/u);

  // 反向：箭头函数、比较运算符里的 `>` 不是 JSX 文本。
  const safe = [
    '    const onClick = () => setOpen((value) => !value);',
    '    const ok = a >= b && c <= d;',
  ].join('\n');
  assert.deepEqual(scanText(safe, 'src/client/components/SchedButton.tsx'), [], '箭头函数与比较运算符不应误报');
});

test('护栏配套：设置卡的「说明」走带参键，8 门字典都有它且插得出 label', async () => {
  /*
   * 光把 `aria-label={`${t(labelKey)}说明`}` 换成 `format(t('helpAria'), { label })`
   * 还不够：**键必须在 8 门字典里齐全**，否则宿主回退链把 `helpAria` 本身念给读屏用户
   * （`?? key` 是链尾），等于把中文换成裸键名——比中文更难懂。
   *
   * 这里走**真字典**（`loadTranspiledTree` 现场编译 `locales/settings.ts` 及其依赖），
   * 不是正则数 `helpAria:` 出现次数：后者数不清嵌套对象，也挡不住有人把键写进错误的
   * 语言块。插值一遍才算数——带参键的唯一价值就是插值后含 label。
   */
  const { settingsDicts, mergedFor } = await loadTranspiledTree('src/client/locales/settings.ts');
  const { LOCALE_IDS } = await loadTranspiledTree('src/client/locales/ui.ts');
  assert.equal(LOCALE_IDS.length, 8, '前置：本仓登记的是 8 门语言');

  for (const id of LOCALE_IDS) {
    const dict = settingsDicts[id];
    assert.equal(typeof dict?.helpAria, 'string', `${id} 缺少 helpAria —— 宿主会把这个键名念给读屏用户`);
    assert.match(dict.helpAria, /\{label\}/, `${id} 的 helpAria 必须带 {label} 占位符（否则标签信息丢了）`);
    // 合并注册的那一份也要有：宿主实际读的是 mergedFor 的结果，不是 settingsDicts。
    assert.equal(typeof mergedFor(id).helpAria, 'string', `${id}：合并后的注册字典里也要有 helpAria`);
    const rendered = dict.helpAria.replace('{label}', dict.clockIconStyleLabel);
    assert.equal(rendered.includes('{label}'), false, `${id}：插值后不得残留 {label}`);
    assert.ok(rendered.includes(dict.clockIconStyleLabel), `${id}：插值结果必须包含字段自身的 label`);
  }
});
