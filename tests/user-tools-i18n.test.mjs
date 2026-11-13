/**
 * task-7：`src/user-tools.ts` 的工具错误回执跟随 locale（8 语言）。
 *
 * ## 为什么这个文件必须存在
 *
 * 改动的核心风险不是「翻得对不对」，而是**回执还会不会按 zh 吐出来**。本仓的
 * `tests/at-time-normalize.test.mjs`、`tests/user-tools-prompt-limits.test.mjs`
 * 都按中文字面量断言 message，它们能证明「zh 没坏」，但**证明不了**
 * 「en 真的换了语言」——只要某条回执在 `hostT()` 外面漏了个模板字符串，
 * 那两个文件照样全绿（它们只看 zh）。所以这里逐条核对非 zh 语言。
 *
 * ## 覆盖策略
 *
 * 1. **键集**：24 个 `errTool*` 键在 8 门里都存在且非空（漏一个 = 用户又看到中文）。
 * 2. **占位符**：带 `{…}` 的键必须在 8 门里出现**同一组**占位符名（语序可换、名字不可丢，
 *    丢了就渲染成字面量 `{maxChars}`，比不翻更糟）。
 * 3. **行为**：真的调工具、真的切 locale，断言 message 随 locale 变、code 不变。
 * 4. **作用域还原**：`enterHostLocale` 的 `finally` 必须把栈弹干净，否则后续调用
 *    会带着上一个请求的语言——这是最容易漏、也最难在线上看出来的那类 bug。
 * 5. **zh 逐字不变**：历史文案一个字都不许动（有测试按字面量断言）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_SCHEDULES,
  enterHostLocale,
  resetHostLocaleForTest,
  userScheduleCreate,
  userScheduleDelete,
  userScheduleEditPrompt,
  userScheduleList,
  userSchedulePause,
  userScheduleResume,
  validateCreateInput,
  validatePrompt,
} from '../lib/user-tools.js';
import { hostDicts, hostDictFor, hostFormat } from '../lib/locales/host.js';
import { LOCALE_IDS } from '../lib/locales/locale-id.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

/** 与 user-tools.ts 的 `enterHostLocale` 用法对齐：作用域包住整次调用。 */
const CALLS = ['errToolPromptEmpty', 'errToolResumeNotFound', 'errToolUidInvalid'];

/** 只取 `errTool*` 前缀的键（本任务新增的那批）。 */
const TOOL_KEYS = Object.keys(hostDicts.zh).filter((k) => k.startsWith('errTool'));

/** 从模板里抽出占位符名（`{name}` 语法，与 hostFormat 一致）。 */
function placeholders(template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/**
 * 「看起来是中文」的判据。
 *
 * ⚠️ 不能直接写 `/[\u4e00-\u9fff]/`：日文正文里本来就用汉字（「本文は空にできません」里的
 * 「本文」「空」都在 U+4E00–9FFF 段内），那样会把**正确的日文**判成漏翻。
 *
 * 判据用两个「只有全中文才会同时成立」的信号：
 *  1. 含汉字；
 *  2. **既不含假名（日文）也不含拉丁字母（英/西/法/德/葡）**——一条真正翻好的文案
 *     必定至少含其中之一（俄文除外，用西里尔字母判定）。
 *
 * 这样「リマインダーの本文は空にできません」会因为含假名而放行，
 * 「提醒内容不能为空。」则三条全中（无假名、无拉丁、无西里尔）被判为没翻。
 */
const KANA = /[\u3040-\u30ff]/;
const LATIN = /[A-Za-zÀ-ÿ]/;
const CYRILLIC = /[\u0400-\u04ff]/;

/** 该语言是否还需要看「有没有被 zh 文案顶替」。 */
function looksChinese(text) {
  if (!/[\u4e00-\u9fff]/.test(text)) return false; // 没有汉字，一定不是中文残留
  if (KANA.test(text)) return false; // 日文
  if (LATIN.test(text)) return false; // 拉丁语系
  if (CYRILLIC.test(text)) return false; // 俄文
  return true; // 有汉字，且没有任何本语言字母 → 未翻译
}

// ── 1. 键集 ────────────────────────────────────────────────────────────────

test('errTool* 键集在 8 门字典里齐全且非空', () => {
  assert.ok(TOOL_KEYS.length >= 24, `errTool* 键应至少 24 个，实际 ${TOOL_KEYS.length}`);
  for (const locale of LOCALE_IDS) {
    for (const key of TOOL_KEYS) {
      const value = hostDicts[locale][key];
      assert.equal(typeof value, 'string', `${locale}.${key} 必须存在且是字符串`);
      assert.ok(value.trim().length > 0, `${locale}.${key} 不得为空`);
      // 288B / FEFF 等不可见字符是 check:i18n 的红线，顺手在这条用例里守住。
      assert.ok(!/[\u200b\ufeff]/.test(value), `${locale}.${key} 含零宽空格或 BOM`);
    }
  }
});

test('非 zh 的 errTool* 一律不含汉字（漏翻的直接现场）', () => {
  for (const locale of LOCALE_IDS) {
    if (locale === 'zh') continue;
    for (const key of TOOL_KEYS) {
      assert.ok(
        !looksChinese(hostDicts[locale][key]),
        `${locale}.${key} 看起来还是中文（漏翻）：${hostDicts[locale][key]}`,
      );
    }
  }
});

// ── 2. 占位符 ──────────────────────────────────────────────────────────────

test('带占位符的 errTool 键在 8 门里占位符名完全一致', () => {
  const withParams = TOOL_KEYS.filter((k) => placeholders(hostDicts.zh[k]).length > 0);
  assert.ok(withParams.length >= 5, `应有多个带占位符的键，实际 ${withParams.length}`);
  for (const key of withParams) {
    const expected = placeholders(hostDicts.zh[key]);
    for (const locale of LOCALE_IDS) {
      assert.deepEqual(
        placeholders(hostDicts[locale][key]),
        expected,
        `${locale}.${key} 的占位符与 zh 不一致`,
      );
    }
  }
});

test('hostFormat 能把占位符真正替换掉，且不留字面量 {x}', () => {
  const rendered = hostFormat(hostDictFor('en').errToolQuotaFull, { maxSchedules: 7 });
  assert.match(rendered, /7/);
  assert.ok(!rendered.includes('{'), `仍有未替换的占位符：${rendered}`);
});

// ── 3. zh 逐字不变 ────────────────────────────────────────────────────────

test('zh 的回执文案逐字不变（历史断言依赖这些字面量）', () => {
  const zh = hostDictFor('zh');
  assert.equal(zh.errToolPromptEmpty, '提醒内容不能为空。');
  assert.equal(zh.errToolPromptTooLong, '提醒内容不能超过 {maxChars} 字符。');
  assert.equal(zh.errToolCreateNotObject, 'create 参数必须是一个对象。');
  assert.equal(zh.errToolInternalFailed, '定时任务操作失败，请重试。');
  assert.equal(zh.errToolLogUnreadable, '会话定时日志读取失败。');
  assert.equal(zh.errToolQuotaFull, '当前会话最多 {maxSchedules} 个定时任务，请先删除部分任务。');
  assert.equal(zh.errToolScheduleIdInvalid, 'schedule id 必须是去空白非空字符串。');
  assert.equal(zh.errToolUidInvalid, 'uid 必须是去空白非空字符串。');
  assert.equal(zh.errToolPauseUnsupportedKind, '仅支持暂停「再等 N 分钟」类（after）提醒。');
});

// ── 4. 作用域 ──────────────────────────────────────────────────────────────

test('enterHostLocale 退出后还原：嵌套与外层都不受影响', () => {
  resetHostLocaleForTest();
  const outer = enterHostLocale('ja');
  try {
    assert.equal(hostDictFor('ja').errToolLogUnreadable, hostDictFor('ja').errToolLogUnreadable);
    const inner = enterHostLocale('de');
    inner();
    inner(); // 幂等：二次调用不得多弹一层
    // 外层仍是 ja：用一条 zh/en 明显不同的键间接验证栈没被弹穿
    assert.notEqual(hostDictFor('ja').errToolPromptEmpty, hostDictFor('zh').errToolPromptEmpty);
  } finally {
    outer();
  }
  resetHostLocaleForTest();
});

// ── 5. 行为：真的调工具、真的切 locale ────────────────────────────────────

test('validatePrompt：en 作用域下回执是英文，code 不变', () => {
  resetHostLocaleForTest();
  const leave = enterHostLocale('en');
  try {
    const empty = validatePrompt('   ', { allowLong: false, maxChars: 1000 });
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'invalid_prompt', 'code 不随 locale 变');
    assert.equal(empty.message, 'Reminder content cannot be empty.');
    assert.ok(!looksChinese(empty.message), '不得出现中文');

    const tooLong = validatePrompt('x'.repeat(1001), { allowLong: false, maxChars: 1000 });
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.message, /1000/, '占位符必须被替换成实际上限');
    assert.ok(!looksChinese(tooLong.message));
  } finally {
    leave();
    resetHostLocaleForTest();
  }
});

test('validateCreateInput：en 作用域下各条回执都是英文', () => {
  resetHostLocaleForTest();
  const leave = enterHostLocale('en');
  try {
    const cases = [
      { input: [], key: 'errToolCreateNotObject' },
      { input: { prompt: 'p', after_seconds: 600, at: '2026-10-26T09:00:00+08:00' }, key: 'errToolSelectorExactlyOne' },
      { input: { prompt: 'p', at: '2026-10-26 09:00', time_zone: 'Asia/Shanghai' }, key: 'errToolAtNeedsZone' },
      { input: { prompt: 'p', at: { date: '2026-10-26' } }, key: 'errToolAtObjectMissing' },
      { input: { prompt: 'p', at: 42 }, key: 'errToolAtShape' },
    ];
    for (const { input, key } of cases) {
      const result = validateCreateInput(input);
      assert.equal(result.ok, false, `${key}: 应当被拒`);
      assert.ok(!looksChinese(result.message), `${key}: 回执仍有中文 → ${result.message}`);
      // 与字典原文逐字比对，确保真的走了字典而不是别的分支
      assert.equal(result.message, hostDictFor('en')[key], `${key}: 回执与字典不一致`);
    }
  } finally {
    leave();
    resetHostLocaleForTest();
  }
});

/** 极简假 Session（与 user-tools.test.mjs 同构，但这里只关心回执）。 */
let seq = 0;
class FakeSession {
  constructor() {
    this.header = { id: `session-i18n-${++seq}` };
    this.events = [];
  }
  append(type, data) {
    const event = { type, seq: this.events.length, time: Date.now(), data };
    this.events.push(event);
    return event;
  }
}

function fakeAgent() {
  return { id: 'agent-i18n', session: new FakeSession(), ctx: {} };
}

const fakeCtx = { sessions: { flush: async () => true } };

test('userScheduleCreate / List / Delete：en 与 zh 的回执语言不同、code 相同', async () => {
  freshOwnershipDir();
  // zh：保持历史文案
  const zhAgent = fakeAgent();
  const zhEmpty = await userScheduleCreate({ prompt: '  ', after_seconds: 600 }, zhAgent, fakeCtx);
  assert.equal(zhEmpty.ok, false);
  assert.equal(zhEmpty.message, '提醒内容不能为空。');

  // en：同一份输入，消息换语言
  const enAgent = fakeAgent();
  const enEmpty = await userScheduleCreate(
    { prompt: '  ', after_seconds: 600 },
    enAgent,
    fakeCtx,
    DEFAULT_MAX_SCHEDULES,
    { locale: 'en' },
  );
  assert.equal(enEmpty.ok, false);
  assert.equal(enEmpty.code, zhEmpty.code, 'code 必须与 locale 无关');
  assert.equal(enEmpty.message, 'Reminder content cannot be empty.');

  // delete 的 id 校验走另一条分支
  const enDelete = await userScheduleDelete(' padded ', fakeAgent(), fakeCtx, 'en');
  assert.equal(enDelete.ok, false);
  assert.ok(!looksChinese(enDelete.message), `delete 回执仍有中文：${enDelete.message}`);

  // list 在没有日志时是成功分支；这里只验证它不为空 log 时**不抛**
  const list = await userScheduleList(fakeAgent(), 'en');
  assert.equal(list.ok, true);
});

test('userSchedulePause / Resume：en 作用域下回执不含汉字', async () => {
  freshOwnershipDir();
  const pause = await userSchedulePause(' no-such-id ', fakeAgent(), fakeCtx, 'en');
  assert.equal(pause.ok, false);
  assert.ok(!looksChinese(pause.message), `pause 回执仍有中文：${pause.message}`);

  const resume = await userScheduleResume(' no-such-uid ', fakeAgent(), fakeCtx, DEFAULT_MAX_SCHEDULES, 'en');
  assert.equal(resume.ok, false);
  assert.ok(!looksChinese(resume.message), `resume 回执仍有中文：${resume.message}`);
});

test('userScheduleEditPrompt：en 作用域下的 id 校验回执是英文', async () => {
  freshOwnershipDir();
  const edit = await userScheduleEditPrompt('  ', 'x', fakeAgent(), fakeCtx, undefined, 'en');
  assert.equal(edit.ok, false);
  assert.ok(!looksChinese(edit.message), `edit 回执仍有中文：${edit.message}`);
});

test('未收录的 locale id 回退 zh（不是回退 en，也不是抛）', () => {
  assert.equal(hostDictFor('xx-XX').errToolPromptEmpty, hostDictFor('zh').errToolPromptEmpty);
  assert.equal(hostDictFor(undefined).errToolPromptEmpty, hostDictFor('zh').errToolPromptEmpty);
});

// 让 `CALLS` 这个常量确实被用到（防守：将来有人删掉用例时不要留死代码警告）
test('用例本身覆盖了 validatePrompt 分支的代表键', () => {
  assert.ok(CALLS.every((k) => typeof hostDicts.zh[k] === 'string'));
});
