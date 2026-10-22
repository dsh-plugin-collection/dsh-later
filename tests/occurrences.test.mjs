/**
 * 多次写法：`+1h*3`（等间隔 ×N）与 `+1h+1h+0.5h`（链式序列）。
 *
 * 产品语义（与决策记录一致）：
 *  - 首次落在第一个间隔之后：`+1h*3` → t+1h、t+2h、t+3h；
 *  - 序列链式累加：`+1h+1h+0.5h` → t+1h、t+2h、t+2.5h；
 *  - 展开成 N 条 one-shot（`after`），不是 1 条 `every`：宿主记录没有次数字段，
 *    而 one-shot 天然带 pause/resume、行内编辑、单条取消、到点自动清理；
 *  - 上限 10 条；多次写法的间隔 ≥60 秒（单条不受约束，`/later +5s` 仍合法）；
 *  - `/later` 的附件每条都带同一份（不是只有第一条）。
 *
 * 同时锁住回归：旧版正则的 `(?![0-9a-z])` 放过了 `*` 与 `+`，于是 `+1h*3 x`
 * 被静默解析成「单条 +1h、内容为 `*3 x`」——猜错比拒绝更糟，现在一律显式报错。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScheduleInput,
  parseScheduleSpec,
  userScheduleCommands,
  MAX_OCCURRENCES,
  MIN_OCCURRENCE_INTERVAL_SECONDS,
} from '../lib/commands.js';
import { getOwnership } from '../lib/ownership-store.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

const NOW = Date.parse('2026-10-13T06:00:00.000Z');
const TZ = 'Asia/Shanghai';

/** 取多次写法的累计秒数（单条写法同样返回长度为 1 的数组）。 */
function secondsOf(raw) {
  const r = parseScheduleInput(`${raw} 内容`, NOW, TZ);
  if (!r.ok) throw new Error(`unexpected error for ${raw}: ${r.error}`);
  return r.targets.map((t) => (t.kind === 'after' ? t.afterSeconds : -1));
}

function errorOf(raw) {
  const r = parseScheduleInput(`${raw} 内容`, NOW, TZ);
  assert.ok(!r.ok, `应当拒绝：${raw}`);
  return r.error;
}

// ── 1. 展开语义 ─────────────────────────────────────────────────────────────

test('等间隔 ×N：+1h*3 → t+1h、t+2h、t+3h（链式累计，不是三次同一时刻）', () => {
  assert.deepEqual(secondsOf('+1h*3'), [3600, 7200, 10800]);
});

test('序列：+1h+1h+0.5h → t+1h、t+2h、t+2.5h（梯度催办）', () => {
  assert.deepEqual(secondsOf('+1h+1h+0.5h'), [3600, 7200, 9000]);
});

test('序列容忍段间空格与复合段：+1h +30m、+1h30m+15m', () => {
  assert.deepEqual(secondsOf('+1h +30m'), [3600, 5400]);
  assert.deepEqual(secondsOf('+1h30m+15m'), [5400, 6300]);
});

test('次数后缀的多种写法：*3 / ×3次 / x3 / 紧跟正文', () => {
  assert.deepEqual(secondsOf('+1h*3'), [3600, 7200, 10800]);
  assert.deepEqual(secondsOf('+1h×3次'), [3600, 7200, 10800]);
  assert.deepEqual(secondsOf('+1hx3'), [3600, 7200, 10800]);
  assert.deepEqual(secondsOf('+1h x3'), [3600, 7200, 10800]);
});

test('中文相对时长同样支持次数：半小时后×3', () => {
  assert.deepEqual(secondsOf('半小时后×3'), [1800, 3600, 5400]);
});

test('*1 就是一条（不重复），与单条写法等价', () => {
  const r = parseScheduleInput('+1h*1 内容', NOW, TZ);
  assert.ok(r.ok);
  assert.equal(r.targets.length, 1);
});

// ── 2. 守卫：宁拒不错 ───────────────────────────────────────────────────────

test('次数上限：*0 拒绝、*11 拒绝、*10 通过', () => {
  assert.match(errorOf('+1h*0'), /正整数/);
  assert.match(errorOf(`+1h*${MAX_OCCURRENCES + 1}`), /重复次数过多/);
  assert.equal(secondsOf(`+1h*${MAX_OCCURRENCES}`).length, MAX_OCCURRENCES);
});

test('序列段数上限同样受 MAX_OCCURRENCES 约束', () => {
  const tooMany = Array.from({ length: MAX_OCCURRENCES + 1 }, () => '+1h').join('');
  assert.match(errorOf(tooMany), /时间序列过长/);
});

test('多次写法有 60 秒地板，但单条写法不受影响（/later +5s 仍合法）', () => {
  assert.match(errorOf(`+${MIN_OCCURRENCE_INTERVAL_SECONDS - 1}s*3`), /间隔至少/);
  assert.match(errorOf('+30s+30s'), /间隔至少/);
  assert.deepEqual(secondsOf('+30s'), [30]);
  assert.deepEqual(secondsOf('+5s'), [5]);
});

test('回归：次数/时长残片绝不静默并入正文', () => {
  // 旧版这三条都会成功建任务（内容里带着 *3 / +1h），用户以为设了多次
  assert.match(errorOf('15:32*3'), /没有生效/);
  assert.match(errorOf('明天9点*2'), /没有生效/);
  assert.match(errorOf('+1h+1h*2'), /没有生效/);
  // 「次数后面紧跟正文」不算次数（+1h*3号楼见 里 *3 属于内容）→ 拒绝而非猜
  assert.match(errorOf('+1h*3号楼见'), /没有生效/);
});

test('回归：+1h3 / +0m 这类残缺时长仍然整体拒绝（旧 (?![0-9a-z]) 口径）', () => {
  assert.match(errorOf('+1h3'), /无法识别/);
  assert.match(errorOf('+0m'), /无法识别/);
});

test('旧写法零回退：+90s / +1w / +1h30m / +2.5h 仍是单条', () => {
  assert.deepEqual(secondsOf('+90s'), [90]);
  assert.deepEqual(secondsOf('+1w'), [604800]);
  assert.deepEqual(secondsOf('+1h30m'), [5400]);
  assert.deepEqual(secondsOf('+2.5h'), [9000]);
  // 「+90s x」的 x 属于正文：段尾空格不能被算进时间写法（否则边界判定误杀）
  const r = parseScheduleInput('+90s x', NOW, TZ);
  assert.ok(r.ok);
  assert.equal(r.content, 'x');
});

test('target 恒等于 targets[0]（既有调用方兼容）', () => {
  const r = parseScheduleInput('+1h*3 内容', NOW, TZ);
  assert.ok(r.ok);
  assert.deepEqual(r.target, r.targets[0]);
});

test('parseScheduleSpec（GUI 单次通道）明确拒绝多次写法', () => {
  const multi = parseScheduleSpec('+1h*3', NOW, TZ);
  assert.ok(!multi.ok);
  assert.match(multi.error, /多条任务/);
  const single = parseScheduleSpec('+1h', NOW, TZ);
  assert.ok(single.ok && single.kind === 'after' && single.afterSeconds === 3600);
});

// ── 3. 端到端：命令真的建出 N 条 ────────────────────────────────────────────

let fakeSessionSeq = 0;

class FakeSession {
  constructor() {
    this.header = { id: `session-occurrences-${++fakeSessionSeq}`, seedLength: 0 };
    this.events = [];
    this.appended = [];
  }

  append(type, data) {
    const event = { type, seq: this.events.length, time: Date.now(), data };
    this.events.push(event);
    this.appended.push(event);
    return event;
  }
}

class FakeAgent {
  constructor(session = new FakeSession()) {
    this.id = 'agent-occurrences';
    this.session = session;
    this.messages = [];
    this.steered = [];
  }

  followup(message) {
    this.messages.push(message);
  }

  steer(message) {
    this.steered.push(message);
  }

  async whenIdle() {}

  async runMaintenance(job) {
    return job();
  }
}

/** 命令 handler 只用到 sessions.flush；附件走 invocation 参数（可信通道）。 */
const commandCtx = { sessions: { flush: async () => true } };

const IMG = (id = 'att-1') => ({
  type: 'image',
  attachment: { attachmentId: id, mediaType: 'image/png', bytes: 128, width: 4, height: 4 },
});

function defOf(name, maxSchedules = 100) {
  const defs = userScheduleCommands(commandCtx, maxSchedules, () => {});
  return defs.find((d) => d.name === name);
}

function createdEvents(agent) {
  return agent.session.appended.filter(
    (e) => e.type === 'schedule/change' && e.data?.operation === 'create',
  );
}

test('/later +1h*3：写出 3 条 create 事件，文案报出「展开为 3 条」', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const result = await defOf('later').handler({
    commandId: 'c1',
    agent,
    rawInput: '+1h*3 起来喝水',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /已展开为 3 条任务/);
  assert.match(result.text, /起来喝水/);

  const created = createdEvents(agent);
  assert.equal(created.length, 3);
  const kinds = created.map((e) => e.data.schedule.kind);
  assert.deepEqual(kinds, ['after', 'after', 'after'], '展开成 one-shot，而不是 1 条 every');
  const deltas = created.map((e) => e.data.schedule.afterSeconds);
  assert.deepEqual(deltas, [3600, 7200, 10800]);
  assert.equal(new Set(created.map((e) => e.data.schedule.id)).size, 3, '三条必须是不同 id');
});

test('/later 带附件 + 多次写法：每条都带同一份附件（不是只有第一条）', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const result = await defOf('later').handler({
    commandId: 'c2',
    agent,
    rawInput: '+1h*2 看这张图',
    attachments: [IMG('att-a'), IMG('att-b')],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /（含 2 个附件）/);
  for (const event of createdEvents(agent)) {
    const entry = getOwnership(agent.session.header.id, event.data.schedule.id);
    assert.ok(entry, '每条都应有 sidecar 所有权条目');
    assert.equal(entry.delivery, 'user');
    assert.equal(entry.attachments?.length, 2, '附件必须逐条带上');
    assert.equal(entry.attachments[0].attachment.attachmentId, 'att-a');
  }
});

test('/schedule +1h+1h+0.5h：context 投递，3 条独立提醒', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const result = await defOf('schedule').handler({
    commandId: 'c3',
    agent,
    rawInput: '+1h+1h+0.5h 盯发布',
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success');
  const created = createdEvents(agent);
  assert.equal(created.length, 3);
  assert.deepEqual(created.map((e) => e.data.schedule.afterSeconds), [3600, 7200, 9000]);
  for (const event of created) {
    assert.equal(getOwnership(agent.session.header.id, event.data.schedule.id)?.delivery, 'context');
  }
});

test('名额不足时保留已建成的部分并如实报出 2/3，而不是静默只建一条', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const result = await defOf('later', 2).handler({
    commandId: 'c4',
    agent,
    rawInput: '+1h*3 交周报',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success', '已建成 2 条就是成功，不能假装什么都没发生');
  assert.equal(createdEvents(agent).length, 2);
  assert.match(result.text, /只建成 2\/3 条/);
  assert.match(result.text, /quota_exceeded/);
});

test('一条都没建成时按错误返回（不出现「已展开为 0 条」）', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const result = await defOf('later', 0).handler({
    commandId: 'c5',
    agent,
    rawInput: '+1h*3 交周报',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'error');
  assert.equal(createdEvents(agent).length, 0);
});

test('多次写法仍需非空内容，且拒绝时一个事件都不写', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const result = await defOf('later').handler({
    commandId: 'c6',
    agent,
    rawInput: '+1h*3 ',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /内容不能为空/);
  assert.equal(agent.session.appended.length, 0);
});

// ── 4. 锚点序列（P1）：绝对时刻作首段，`+` 串后续 ──────────────────────────
//
// 基准 NOW = 2026-10-13T06:00Z（Asia/Shanghai 14:00）。绝对时刻锚点受既有
// 「今天已过则顺延」规则影响：`10:00` 落到 10-14、`0821` 落到明年，都是预期。

const atOf = (raw, now = NOW, tz = TZ) => {
  const r = parseScheduleInput(`${raw} 内容`, now, tz);
  if (!r.ok) throw new Error(`unexpected error for ${raw}: ${r.error}`);
  return r.targets.map((t) => (t.kind === 'at' ? `${t.at.date} ${t.at.time.slice(0, 5)}` : `+${t.afterSeconds}s`));
};

const chainErrorOf = (raw, now = NOW, tz = TZ) => {
  const r = parseScheduleInput(`${raw} 内容`, now, tz);
  assert.ok(!r.ok, `应当拒绝：${raw}`);
  return r.error;
};

test('锚点序列：三个挂钟时刻同日展开', () => {
  assert.deepEqual(atOf('15:32+16:32+17:32'), [
    '2026-10-13 15:32',
    '2026-10-13 16:32',
    '2026-10-13 17:32',
  ]);
});

test('锚点序列：后一个时刻早于前一个 → 顺延到次日（复用既有顺延规则）', () => {
  assert.deepEqual(atOf('23:00+01:00'), ['2026-10-13 23:00', '2026-10-14 01:00']);
});

test('锚点序列：+1d 走日历日，三天都落在同一墙钟', () => {
  assert.deepEqual(atOf('9:00+1d+1d'), [
    '2026-10-14 09:00', // 今天 09:00 已过 → 锚点顺延明天
    '2026-10-15 09:00',
    '2026-10-16 09:00',
  ]);
});

test('锚点序列：绝对锚点 + 相对时长（明天9点+1h、混合单位段 +1d12h）', () => {
  assert.deepEqual(atOf('明天9点+1h'), ['2026-10-14 09:00', '2026-10-14 10:00']);
  assert.deepEqual(atOf('10:00+1d12h'), ['2026-10-14 10:00', '2026-10-15 22:00']);
});

test('锚点序列：裸 HHMM 与紧凑日期都能串', () => {
  assert.deepEqual(atOf('1532+1732'), ['2026-10-13 15:32', '2026-10-13 17:32']);
  // 0821 今年已过 → 顺延到明年（既有「只写月日」规则作用在锚点上）
  assert.deepEqual(atOf('0821-1532+1732'), ['2027-08-21 15:32', '2027-08-21 17:32']);
});

test('锚点序列：相邻落点仍受 60 秒地板约束', () => {
  assert.match(chainErrorOf('9:00+1s'), /至少要隔 60 秒/);
});

test('锚点序列：段数受 MAX_OCCURRENCES 约束', () => {
  const twelve = ['15:32', ...Array.from({ length: 11 }, (_, i) => `${16 + Math.floor(i / 2)}:${i % 2 === 0 ? '30' : '35'}`)].join('+');
  assert.match(chainErrorOf(twelve), /时间序列过长/);
});

test('锚点序列只允许「绝对锚点 → 往后累加」这个方向', () => {
  // 相对段后面接绝对时刻（+1h+15:32）要开始猜意图了，明确拒绝
  assert.match(chainErrorOf('+1h+15:32'), /没有生效/);
});

test('P0：区间省略号残片不再静默并入正文，但正文开头的省略号不受影响', () => {
  assert.match(chainErrorOf('+1h..3h'), /没有生效/);
  assert.match(chainErrorOf('+1h…3h'), /没有生效/);
  const ellipsis = parseScheduleInput('+1h … 记得带伞', NOW, TZ);
  assert.ok(ellipsis.ok);
  assert.equal(ellipsis.targets.length, 1);
  assert.equal(ellipsis.content, '… 记得带伞');
});

test('锚点序列跨夏令时：+1d 保住墙钟（按 86400 秒累加会漂一小时）', () => {
  const laNow = Date.parse('2026-10-31T06:00:00-07:00'); // 回拨日之前的周六
  const r = parseScheduleInput('10:00+1d 打卡', laNow, 'America/Los_Angeles');
  assert.ok(r.ok, r.error);
  const [a, b] = r.targets;
  assert.equal(a.at.date, '2026-10-31');
  assert.equal(b.at.date, '2026-11-01');
  assert.equal(a.at.time, '10:00:00');
  assert.equal(b.at.time, '10:00:00');
  // 回拨日「同一墙钟的次日」相隔 25 小时，而不是 86400 秒
  assert.equal((b.epoch - a.epoch) / 3600000, 25);
});

test('锚点序列落到不存在的墙钟（前拨跳过）时报错，不静默挪时刻', () => {
  const springNow = Date.parse('2026-03-07T00:00:00-08:00');
  assert.match(chainErrorOf('2:30+1d', springNow, 'America/Los_Angeles'), /不存在/);
});

test('parseScheduleSpec 拒绝锚点序列', () => {
  const r = parseScheduleSpec('15:32+16:32', NOW, TZ);
  assert.ok(!r.ok);
  assert.match(r.error, /多条任务/);
});

/**
 * 端到端断言只用**相对关系**（条数、kind、间隔、内容、附件）。
 * 写死绝对日期会随真实墙上时钟飘——handler 用的是 Date.now()，不是这里的 NOW。
 */
test('/later 明天9点+1h：建出 2 条 at 记录，间隔一小时，内容与附件一致', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const result = await defOf('later').handler({
    commandId: 'c7',
    agent,
    rawInput: '明天9点+1h 站会两次',
    attachments: [IMG('att-chain')],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /已展开为 2 条任务/);

  const created = createdEvents(agent);
  assert.equal(created.length, 2);
  assert.deepEqual(created.map((e) => e.data.schedule.kind), ['at', 'at']);
  const stamps = created.map((e) => Date.parse(e.data.schedule.scheduledAt));
  assert.equal((stamps[1] - stamps[0]) / 3600000, 1, '锚点 +1h 就是相差一小时');
  assert.ok(stamps[0] > Date.now(), '首条必须在未来');
  for (const event of created) {
    const entry = getOwnership(agent.session.header.id, event.data.schedule.id);
    assert.equal(entry.delivery, 'user');
    assert.equal(entry.attachments?.[0].attachment.attachmentId, 'att-chain');
  }
});

// ── 5. 高级语法开关（实验性，默认开）──────────────────────────────────────

test('开关关闭：三种多次写法一律拒绝，并指明去哪儿开', () => {
  const off = { advancedSyntax: false };
  for (const raw of ['+1h*3 内容', '+1h+1h+0.5h 内容', '15:32+16:32 内容', '9:00+1d 内容']) {
    const r = parseScheduleInput(raw, NOW, TZ, undefined, off);
    assert.ok(!r.ok, `应当拒绝：${raw}`);
    assert.match(r.error, /实验性功能「高级语法」/);
    assert.match(r.error, /设置 → 插件 → 定时提醒 → 高级语法/);
  }
});

test('开关关闭：单条写法与默认（不传 options）都不受影响', () => {
  const off = { advancedSyntax: false };
  const gated = parseScheduleInput('+1h 内容', NOW, TZ, undefined, off);
  assert.ok(gated.ok);
  assert.equal(gated.targets.length, 1);
  // 默认开：老调用方不传第 5 个参数，行为与开关打开一致
  const legacy = parseScheduleInput('+1h*3 内容', NOW, TZ);
  assert.ok(legacy.ok && legacy.targets.length === 3);
  const explicitOn = parseScheduleInput('15:32+16:32 内容', NOW, TZ, undefined, { advancedSyntax: true });
  assert.ok(explicitOn.ok && explicitOn.targets.length === 2);
});

test('开关关闭 ≠ 回到旧 bug：残片守卫始终生效（报的是残片，不是实验性提示）', () => {
  // 「关闭高级语法」绝不能把 `+1h*3测试` 退回成「静默建一条内容为 *3测试 的任务」
  const off = { advancedSyntax: false };
  for (const raw of ['+1h*3测试 内容', '+1h..3h 内容', '15:32*3 内容']) {
    const r = parseScheduleInput(raw, NOW, TZ, undefined, off);
    assert.ok(!r.ok, `应当拒绝：${raw}`);
    assert.match(r.error, /没有生效/, `${raw} 应报残片错误，说明守卫没被开关旁路`);
    // 两种措辞都不该出现在残片错误里：钉住"这是残片、不是被开关拦下"。
    // 留 Beta 是防术语回退时这条断言悄悄变成永真。
    assert.doesNotMatch(r.error, /实验性|Beta/);
  }
});

test('/later handler：开关来自 settings，关闭时一条事件都不写', async () => {
  freshOwnershipDir();
  const agent = new FakeAgent();
  const defs = userScheduleCommands(commandCtx, () => ({ maxSchedules: 100, advancedSyntax: false }), () => {});
  const result = await defs.find((d) => d.name === 'later').handler({
    commandId: 'c8',
    agent,
    rawInput: '+1h*3 喝水',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /实验性功能「高级语法」/);
  assert.equal(agent.session.appended.length, 0);

  // 同一个 agent 换回默认（getter 省略该字段 = 开），写法应正常展开
  const onDefs = userScheduleCommands(commandCtx, () => ({ maxSchedules: 100 }), () => {});
  const onAgent = new FakeAgent();
  const onResult = await onDefs.find((d) => d.name === 'later').handler({
    commandId: 'c9',
    agent: onAgent,
    rawInput: '+1h*3 喝水',
    attachments: [],
    signal: new AbortController().signal,
  });
  assert.equal(onResult.kind, 'success');
  assert.equal(createdEvents(onAgent).length, 3);
});
