/**
 * `/schedule`、`/later` 与 `user-schedule-*` 的**命令面文案**跟随宿主 locale。
 *
 * 回归背景：命令描述（`description`）、输入框占位提示（`input.hint`）与 handler 的
 * 回执（`CommandResult.text`）在界面上是**同一块区域**里的三行字——命令被选中时
 * 宿主把 description 与 hint 一起显示，执行完再把 text 显示在同一位置。它们原先
 * 全是硬编码中文，于是英文界面上「命令名是英文、下面三行字是中文」。
 *
 * 本文件的断言分四层：
 *  1. **8 门都翻**：9 条命令的 description 与 hint 在 8 种语言下互不相同、且都不含
 *     汉字（zh 除外）。这一层盯的是「漏翻一条」，比逐字比对更耐文案调整。
 *  2. **回执跟随 locale**：同一个输入，en 与 zh 的回执不同，且 en 不含汉字——包括
 *     `parseScheduleInput` 失败（未建任何任务，纯拒绝回执）与成功（已建成）两条路径。
 *  3. **占位符逐字插值**：`{count}` / `{max}` / `{chars}` 这类把数字真正填进去，
 *     不留 `{count}` 原样，也不因 `${…}` 拼接而错位。
 *  4. **时间格式化也跟随 locale**：回执里的相对时间（`约 1 小时后` / `in about 1 hour`）
 *     与绝对时间都按 locale 渲染——这是与文案字典**两套**机制，只改字典修不到。
 *
 * 另有一条**说明书与解析器对齐**的护栏：命令描述里拿 `+1h*3` 这类写法举例，而解析器
 * 只认中文口语（`30分钟后`、`明天9点`）。两者在同一块区域里上下相邻，若描述写着
 * 「30 分钟后」而解析器拒收，用户照着描述抄就会失败。见文件末段。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userScheduleCommands, parseScheduleInput } from '../lib/commands.js';
import { hostDicts } from '../lib/locales/host.js';
import { LOCALE_IDS } from '../lib/locales/locale-id.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

/**
 * 判定「这门语言里混进了中文」。
 *
 * ⚠️ 不能对 `ja` 用 `\p{Script=Han}`：日语**正常使用汉字**（「セッション内に…」的「内」、
 * 移除「削除」的「削」都是日文正字），拿 Han 脚本判会把合法的日语全都判红。
 * 所以 `ja` 只挡**简体中文专属**字（日文里不会出现的简体形），其余 5 门才用 Han 脚本判。
 */
const HAN = /\p{Script=Han}/u;
const JA_LEAK = /[这们说时对开关闭删务张应为级请题录设个发让汉语岁读]/u;

/**
 * 允许在任意语言里出现的**中文输入示例**。
 *
 * 这些不是说明文字，而是要用户**照抄进输入框**的字符串：解析器真能吃的中文口语
 * （`30分钟后`、`明天9点`、`9点半`、`8月21日`）与 `+1h*3` 一样属于「词汇表」，
 * 翻成 "in 30 minutes" 用户抄进去就解析失败。lead 已裁定 8 门一律保留原文。
 *
 * 因此判「混进中文」必须先剥掉这些片段再看——**不是**放宽成「含示例就整条放过」：
 * 剥掉之后还有汉字，照样判红。剥法是按最长优先替换，避免 `30分钟后` 先被 `分钟` 吃掉。
 */
const INPUT_EXAMPLES = [
  '2026-08-21 15:32',
  '30分钟后',
  '半小时后',
  '明天9点',
  '后天 10:00',
  '8月21日',
  '9点半',
  '编号',
];

/** 剥掉已知的输入示例，剩下的才是「真正的说明文字」。 */
function stripInputExamples(text) {
  let rest = text;
  for (const example of [...INPUT_EXAMPLES].sort((a, b) => b.length - a.length)) {
    rest = rest.split(example).join(' ');
  }
  return rest;
}

/** 该语言下「混进中文」的判据；`zh` 不判。 */
function leaksChinese(locale, text) {
  if (locale === 'zh') return false;
  const rest = stripInputExamples(text);
  if (locale === 'ja') return JA_LEAK.test(rest);
  return HAN.test(rest);
}

/** handler 内部只用到 sessions.flush；命令面文案的断言不需要更完整的假 ctx。 */
const commandCtx = { sessions: { flush: async () => true }, logger: { warn: () => undefined } };

function defs(locale) {
  return userScheduleCommands(commandCtx, 100, () => {}, undefined, () => locale);
}

function defOf(locale, name) {
  return defs(locale).find((d) => d.name === name);
}

/** 极简假 agent：`userScheduleCreate` 只碰 session.append 与 header 上的少数字段。 */
function fakeAgent() {
  return {
    session: {
      appended: [],
      flush: async () => true,
      append: async (event) => {
        if (event.type === 'schedule/change') this.appended.push(event);
      },
      header: { id: 'sess-i18n' },
      events: [],
    },
  };
}

// ── 1. 9 条命令的 description / hint 8 门齐全 ──────────────────────────────

const COMMANDS = [
  'user-schedule-create',
  'user-schedule-list',
  'user-schedule-delete',
  'user-schedule-edit',
  'user-schedule-pause',
  'user-schedule-resume',
  'user-schedule-steer-now',
  'schedule',
  'later',
];

test('命令面 i18n：9 条命令的 description 8 门互不相同，且非 zh 不含汉字', () => {
  for (const name of COMMANDS) {
    const seen = new Map();
    for (const locale of LOCALE_IDS) {
      const description = defOf(locale, name)?.description;
      assert.equal(typeof description, 'string', `${name} 在 ${locale} 下没有 description`);
      assert.ok(description.length > 0, `${name} 在 ${locale} 下 description 为空`);
      if (locale !== 'zh') {
        assert.ok(!leaksChinese(locale, description), `${name} 的 description 在 ${locale} 下仍是中文：${description}`);
      }
      seen.set(locale, description);
    }
    // 「互不相同」这一条能抓住「忘了加进某门、回退成 en」的缺口：回退会让 en 与
    // 那一门逐字相同。（8 门语言里出现两句完全相同的命令行描述，概率上不成立。）
    assert.equal(new Set(seen.values()).size, LOCALE_IDS.length, `${name} 的 description 有语言撞车（某门漏翻回退成 en？）`);
  }
});

test('命令面 i18n：9 条命令的 input.hint 8 门互不相同，且非 zh 不含汉字', () => {
  for (const name of COMMANDS) {
    const seen = new Map();
    for (const locale of LOCALE_IDS) {
      const hint = defOf(locale, name)?.input?.hint;
      assert.equal(typeof hint, 'string', `${name} 在 ${locale} 下没有 input.hint（内核 matchEnter 认领开关）`);
      if (locale !== 'zh') {
        assert.ok(!leaksChinese(locale, hint), `${name} 的 input.hint 在 ${locale} 下仍是中文：${hint}`);
      }
      seen.set(locale, hint);
    }
    assert.equal(new Set(seen.values()).size, LOCALE_IDS.length, `${name} 的 input.hint 有语言撞车`);
  }
});

test('命令面 i18n：/schedule 与 /later 的 hint 仍带各自的示例（占位符与示例不得被翻译吞掉）', () => {
  // 示例片段是解析器的输入样例，翻译时只能改包裹在周围的话，不能把样例本身翻成句子。
  for (const locale of LOCALE_IDS) {
    assert.match(defOf(locale, 'schedule').input.hint, /1532/, `/schedule 的 hint（${locale}）丢了 1532 示例`);
    assert.match(defOf(locale, 'schedule').input.hint, /\+30m/, `/schedule 的 hint（${locale}）丢了 +30m 示例`);
    assert.match(defOf(locale, 'later').input.hint, /1532/, `/later 的 hint（${locale}）丢了 1532 示例`);
    assert.match(defOf(locale, 'later').input.hint, /\+1h\*3/, `/later 的 hint（${locale}）丢了 +1h*3 示例`);
  }
});

test('命令面 i18n：/schedule 与 /later 的描述保留已经内置化的中文口语示例原文', () => {
  // `30分钟后`、`明天9点` 是**输入示例**（用户要照抄进输入框的字符串），不是说明文字，
  // 因此 8 门一律保持中文原样——把示例翻译成 "in 30 minutes"，用户抄进去解析器也不认。
  for (const locale of LOCALE_IDS) {
    for (const example of ['30分钟后', '明天9点', '+1h30m', '15:32']) {
      assert.ok(
        defOf(locale, 'schedule').description.includes(example),
        `/schedule 的描述（${locale}）应有输入示例 ${example}`,
      );
    }
  }
});

// ── 2. 回执跟随 locale ─────────────────────────────────────────────────────

const invocation = (rawInput) => ({
  commandId: 'c-i18n',
  agent: fakeAgent(),
  rawInput,
  attachments: [],
  signal: new AbortController().signal,
});

test('命令面 i18n：未建任何任务的拒绝回执跟随 locale（en 不含汉字）', async () => {
  // `+0m` 在解析阶段就被拒（零延时不是未来时刻），因此不会写任何事件——
  // 这是纯回执路径，不掺下游 user-tools 的文案。
  const en = await defOf('en', 'schedule').handler(invocation('+0m 测试'));
  const zh = await defOf('zh', 'schedule').handler(invocation('+0m 测试'));
  assert.equal(en.kind, 'error');
  assert.equal(zh.kind, 'error');
  assert.ok(!leaksChinese('en', en.text), `en 的拒绝回执仍是中文：${en.text}`);
  assert.notEqual(en.text, zh.text, 'en 与 zh 的回执不应逐字相同');
});

test('命令面 i18n：「缺少 JSON 载荷」这类载荷解析回执跟随 locale', async () => {
  const en = await defOf('en', 'user-schedule-delete').handler(invocation('   '));
  const zh = await defOf('zh', 'user-schedule-delete').handler(invocation('   '));
  assert.equal(en.kind, 'error');
  assert.ok(!leaksChinese('en', en.text), `en 的载荷回执仍是中文：${en.text}`);
  assert.equal(zh.text, '缺少 JSON 载荷。', 'zh 必须逐字保留历史措辞（既有测试与用户记忆都按它写的）');
});

test('命令面 i18n：建成任务的成功回执跟随 locale，且内容原样保留', async () => {
  freshOwnershipDir();
  const en = await defOf('en', 'later').handler(invocation('+1h*2 起来喝水'));
  freshOwnershipDir();
  const zh = await defOf('zh', 'later').handler(invocation('+1h*2 起来喝水'));
  assert.equal(en.kind, 'success');
  assert.equal(zh.kind, 'success');
  // 提醒正文是用户自己写的内容，任何 locale 下都原样回显（不得被当作文案去翻译）。
  assert.ok(en.text.includes('起来喝水'), `en 回执丢了用户内容：${en.text}`);
  assert.ok(zh.text.includes('起来喝水'), `zh 回执丢了用户内容：${zh.text}`);
  // 去掉用户内容后比较：剩下的部分（「已展开为 2 条任务」/「Exported into 2 tasks」）
  // 必须随 locale 变化，且英文那半不得含汉字。
  const enRest = en.text.replace('起来喝水', '');
  const zhRest = zh.text.replace('起来喝水', '');
  assert.ok(!leaksChinese('en', enRest), `en 展开回执仍含中文：${enRest}`);
  assert.notEqual(enRest, zhRest);
});

test('命令面 i18n：成功回执里的数量占位符真的被插值（不留 {count} 之类）', async () => {
  freshOwnershipDir();
  for (const locale of ['zh', 'en', 'ja']) {
    const result = await defOf(locale, 'later').handler(invocation('+1h*3 交周报'));
    assert.equal(result.kind, 'success');
    assert.doesNotMatch(result.text, /\{\w+\}/, `${locale} 的回执里残留未插值占位符：${result.text}`);
    assert.match(result.text, /3/, `${locale} 的回执没把条数 3 说出来：${result.text}`);
  }
});

test('命令面 i18n：附件数量也走占位符插值', async () => {
  freshOwnershipDir();
  const result = await defOf('en', 'later').handler({
    ...invocation('+1h 看这张图'),
    attachments: [
      { type: 'image', attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      { type: 'image', attachmentId: 'att-2', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
    ],
  });
  assert.equal(result.kind, 'success');
  assert.doesNotMatch(result.text, /\{\w+\}/);
  assert.match(result.text, /2/, `en 附件回执没报出 2 个附件：${result.text}`);
  assert.ok(!leaksChinese('en', result.text.replace('看这张图', '')), `en 附件回执仍含中文：${result.text}`);
});

// ── 3. 时间格式化跟随 locale（与文案字典是两套机制）─────────────────────────

test('命令面 i18n：成功回执的相对时间按 locale 渲染（英文界面不再出现「约」）', async () => {
  freshOwnershipDir();
  const result = await defOf('en', 'later').handler(invocation('+1h 检查构建'));
  assert.equal(result.kind, 'success');
  // 单条写法的时间段是「绝对时刻（相对时间）」。中文是「约 1 小时后」，
  // 英文是 "in about 1 hour"。抓「小时」这个汉字单位就足以钉住没传 locale 的回归。
  assert.doesNotMatch(result.text.replace('检查构建', ''), /小时|分钟|秒后/,
    `en 回执里的相对时间仍是中文：${result.text}`);
});

// ── 4. 说明书与解析器对齐（描述里写的示例必须真能被解析）───────────────────

/**
 * 命令描述会摆在输入框上方当作「说明书」，解析器的接收面是**同一块区域**的下一行。
 * 描述把 `30分钟后`、`明天9点` 列为可输入的写法，那它们就必须真能被**时间部分**解析。
 *
 * ⚠️ `/schedule`、`/later` 的语法是「时间 + 正文」两段，正文不可省：`parseScheduleInput('30分钟后')`
 * 返回的是「提醒内容不能为空」，而不是时间解析失败——那是**语法本身**的取舍（lead 已裁定
 * 不是缺陷，不改成 issue）。所以这里每一条都带上正文再断，只钉「时间那段认得出来」。
 *
 * 这条不是本轮 i18n 引入的问题，是描述文案与解析器**本来就该**对齐的契约；把它写进
 * 测试，是为了让「翻译时把示例抄错」与「解析器哪天收窄了口语」都能被抓住。
 */
test('命令描述里承诺的中文口语示例，解析器必须真的接受（带正文时）', () => {
  const now = Date.UTC(2026, 10, 13, 4, 0, 0); // 2026-11-13T04:00Z（北京时间 12:00）
  const accepted = [
    '30分钟后',
    '半小时后',
    '明天9点',
    '9点半',
    '后天 10:00',
    '8月21日 15:32',
    '1532',
    '15:32',
    '+30m',
    '+1h30m',
    '+1h*3',
    '+1h+1h+0.5h',
    '15:32+16:32',
  ];
  for (const time of accepted) {
    const input = `${time} 喝水`;
    const parsed = parseScheduleInput(input, now, 'Asia/Shanghai');
    assert.equal(parsed.ok, true, `描述里承诺的写法 ${JSON.stringify(time)} 解析器拒收了：${parsed.error ?? ''}`);
    assert.equal(parsed.content, '喝水', `${JSON.stringify(time)} 之后的正文没有被正确切出来：${parsed.content}`);
  }
});

test('只给时间不给正文时，回执说的是「内容为空」而不是「时间格式不认识」（语法取舍已裁定）', () => {
  const now = Date.UTC(2026, 10, 13, 4, 0, 0);
  const parsed = parseScheduleInput('30分钟后', now, 'Asia/Shanghai');
  assert.equal(parsed.ok, false);
  // 时间那段必须**认得出来**，报错落在正文上。若哪天变成「无法识别的时间格式」，
  // 说明解析器把口语收窄了——那才是真回归。
  assert.equal(parsed.error, hostDicts.zh.parseContentEmpty, `时间被误判成不认识：${parsed.error}`);
});

test('host 字典：新增的命令面键 8 门齐全（漏键会让 tsc 报错，这里再钉一次运行期）', () => {
  // tsc 的映射类型已经保证 8 门同键集；这条是运行期兜底，防止有人为了过编译期
  // 把某门改成 `as` 断言或 Partial 绕过去。
  const zhKeys = Object.keys(hostDicts.zh).sort();
  for (const locale of LOCALE_IDS) {
    assert.deepEqual(Object.keys(hostDicts[locale]).sort(), zhKeys, `${locale} 的宿主键集与 zh 不一致`);
    for (const key of zhKeys) {
      const value = hostDicts[locale][key];
      assert.equal(typeof value, 'string', `${locale}.${key} 不是字符串`);
      assert.ok(value.length > 0, `${locale}.${key} 是空串`);
      // 占位符集合必须与 zh 完全一致：多一个 => 插值不出来；少一个 => 那句话缺信息。
      assert.deepEqual(
        [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
        [...hostDicts.zh[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
        `${locale}.${key} 的占位符与 zh 不一致`,
      );
    }
  }
});

// ── 4. 拼接处不得产生多余空格 ───────────────────────────────────────────────

test('命令面 i18n：动词短语与时间拼接后不得出现双空格', () => {
  // `src/commands.ts` 的回执头是 `${verb}${locale === 'zh' ? '' : ' '}${times}`：
  // 空格由**代码**按语言补，字典里的 verb **不能**自带尾空格，否则西文渲染成
  // "Reminder set:  Fri, 13.11."（两个空格）。2026-11 清理时确实发现 6 门都带了
  // 尾空格——人眼在单条文案上看不出来，只有拼接后才暴露，所以钉在这里。
  for (const locale of LOCALE_IDS) {
    for (const key of ['replyVerbSet', 'replyVerbWill']) {
      const value = hostDicts[locale][key];
      assert.equal(
        value,
        value.trimEnd(),
        `${locale}.${key} 不应有尾随空格（空格由 commands.ts 按语言补）：${JSON.stringify(value)}`,
      );
    }
  }
});
