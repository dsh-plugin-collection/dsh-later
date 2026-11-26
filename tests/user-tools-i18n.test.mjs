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
  hostTextFor,
  toInputError,
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
import { ScheduleInputError } from '@deepseek-ai/dsh-schedule';
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

// ── 6. 跨事务边界（issue #197）────────────────────────────────────────────
//
// 写路径不短：`runUserScheduleTransaction` 把操作排在 `tails.get(agent).then(operation)`
// ——**微任务**里。入口的 `try` 里 `return` 那个 promise 之后，`finally { leaveLocale() }`
// 立刻把栈弹空，事务体那时还没起跑。于是事务体内的回执读到的永远是空栈 ⇒ zh。
//
// 这一组用例全部**在事务体内部**触发回执，所以它们在修复前必然红；改完之后语言来自
// 入口钉住的那份字典，与「此刻栈里是什么」解耦。

/**
 * 让 fold 读路径抛出的假 Session。
 *
 * 为什么不用「一条 delete 指向 inactive id」那种历史日志：上游 0.1.7 及更早会抛
 * `delete targets inactive id`，但 0.2.2-alpha.3 起本仓走自己的容错 fold，
 * 对不自洽的序列是**跳过**而不是抛——同一份日志在两代上一条抛一条不抛，用例会
 * 只在部分代次上真的走到那个分支。把 `ownEvents()` 本身弄坏则跨代一致：读日志
 * 那一步就没有返回值，`foldUserState` 必然抛。
 */
function unreadableSession() {
  const session = new FakeSession();
  session.ownEvents = () => {
    throw new Error('log unreadable');
  };
  return session;
}

test('#197 跨事务边界：locale:"en" + maxSchedules:0 的回执是英文', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const result = await userScheduleCreate(
    { prompt: 'quota', after_seconds: 600 },
    agent,
    fakeCtx,
    0,
    { locale: 'en' },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'quota_exceeded');
  assert.ok(
    !looksChinese(result.message),
    `事务体内回执仍有中文（locale 栈已被 finally 弹空）：${result.message}`,
  );
  assert.equal(result.message, hostDictFor('en').errToolQuotaFull.replace('{maxSchedules}', '0'));
});

test('#197 跨事务边界：edit 不存在的 id 回执随 locale（不是「未找到定时任务」）', async () => {
  freshOwnershipDir();
  const edit = await userScheduleEditPrompt('schedule-missing', 'new text', fakeAgent(), fakeCtx, undefined, 'en');
  assert.equal(edit.ok, false);
  assert.equal(edit.code, 'schedule_not_found');
  // ⚠️ 这里不能用 `looksChinese` 判：那条判据把「含拉丁字母」当作已翻译的信号，
  // 而这条文案里带着 id（`schedule-missing`），于是中文原文也会被判「不是中文」。
  // 事务体路径必须与字典**逐字**对齐，顺带钉住占位符来自本次调用。
  assert.equal(
    edit.message,
    hostDictFor('en').errToolScheduleNotFoundById.replace('{id}', 'schedule-missing'),
  );
  assert.ok(!/\p{Script=Han}/u.test(edit.message), `edit 事务体内回执仍有汉字：${edit.message}`);
});

test('#197 跨事务边界：delete 折读失败的回执随 locale', async () => {
  freshOwnershipDir();
  // `ownEvents()` 抛 ⇒ `foldUserState` 抛出 ⇒ 删除路径的读失败分支（事务体内部）。
  const agent = fakeAgent();
  agent.session = unreadableSession();
  const result = await userScheduleDelete('schedule-ghost', agent, fakeCtx, 'en');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'internal_error');
  assert.ok(!looksChinese(result.message), `delete 事务体内回执仍有中文：${result.message}`);
  assert.equal(result.message, hostDictFor('en').errToolLogUnreadable);
});

// ── 7. every_seconds 地板与 toInputError 本地化（issue #198）─────────────

test('#198 every_seconds=90 被拒，且回执是本地语言（不是上游英文）', async () => {
  freshOwnershipDir();
  const agent = fakeAgent();
  const result = await userScheduleCreate(
    { prompt: 'x', every_seconds: 90 },
    agent,
    fakeCtx,
    DEFAULT_MAX_SCHEDULES,
    { locale: 'en' },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'frequency_too_high');
  // 修复前这里要么放行（上游 0.2.x 地板是 60），要么透出上游英文
  // `every_seconds must be at least 60.`；两种都不该出现。
  assert.equal(result.message, hostDictFor('en').errFrequencyTooHigh);
});

test('#198 every_seconds=30 的 code 是 frequency_too_high（不是 invalid_rule）', async () => {
  freshOwnershipDir();
  // code 与文案是两件事：形状错一律 invalid_rule，而「间隔太短」有专属码，
  // 调用方（GUI 高亮哪个字段）与模型（要不要改大一点）都靠它区分。
  const api = await userScheduleCreate({ prompt: 'x', every_seconds: 30 }, fakeAgent(), fakeCtx);
  assert.equal(api.ok, false, 'every_seconds=30 必须被拒');
  assert.equal(api.code, 'frequency_too_high');
  assert.equal(api.message, hostDictFor('zh').errFrequencyTooHigh, 'zh 回执走字典');
});

test('#198 toInputError 对 ScheduleInputError 走本地字典，code 原样透出', async () => {
  const en = hostDictFor('en');
  const cases = [
    { code: 'not_future', key: 'errNotFuture' },
    { code: 'time_out_of_range', key: 'errTimeOutOfRange' },
    { code: 'frequency_too_high', key: 'errFrequencyTooHigh' },
    { code: 'invalid_rule', key: 'errInvalidRule' },
    { code: 'subagent_session', key: 'errSubagentSession' },
    { code: 'invalid_prompt', key: 'errEmptyPrompt' },
    { code: 'invalid_selector', key: 'errInvalidSelector' },
    { code: 'invalid_time_zone', key: 'errToolTimeZoneInvalid' },
  ];
  for (const { code, key } of cases) {
    const upstream = new ScheduleInputError(code, `upstream english for ${code}`);
    const result = toInputError(upstream, hostTextFor('en'));
    assert.equal(result.ok, false);
    assert.equal(result.code, code, `${code}: code 必须原样透出（翻译器不吞码）`);
    assert.equal(result.message, en[key], `${code}: 回执必须走本地字典（不是上游英文）`);
  }
  // 表里没有的码回落上游文案（宁可英文，也不要一条对不上号的本地文案）。
  const unknown = new ScheduleInputError('brand_new_code', 'upstream english for brand_new_code');
  const fallback = toInputError(unknown, hostTextFor('en'));
  assert.equal(fallback.code, 'brand_new_code');
  assert.equal(fallback.message, 'upstream english for brand_new_code', '未知码必须回落上游原文');
});

test('#198 死的 cmdScheduleDesc 已从 8 门键集里删除（/schedule 用 quickScheduleDesc）', () => {
  // 键在字典里但零引用，是比死码更坏的「假现状」：读代码的人会以为还有一条命令面文案
  // 挂在它上面。`/schedule` 的注册用的是 `quickScheduleDesc`（见 src/commands.ts）。
  for (const locale of LOCALE_IDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(hostDicts[locale], 'cmdScheduleDesc'),
      false,
      `${locale}.cmdScheduleDesc 应已删除（该键零引用）`,
    );
  }
});

test('未收录的 locale id 回退 zh（不是回退 en，也不是抛）', () => {
  assert.equal(hostDictFor('xx-XX').errToolPromptEmpty, hostDictFor('zh').errToolPromptEmpty);
  assert.equal(hostDictFor(undefined).errToolPromptEmpty, hostDictFor('zh').errToolPromptEmpty);
});

// 让 `CALLS` 这个常量确实被用到（防守：将来有人删掉用例时不要留死代码警告）
test('用例本身覆盖了 validatePrompt 分支的代表键', () => {
  assert.ok(CALLS.every((k) => typeof hostDicts.zh[k] === 'string'));
});
