/**
 * 用户调度器 runtime 测试：决策纯函数 + 假 agent 下的触发/去重/重驱。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueUserDecision, renderOneShotBatchFraming, UserScheduleRuntime } from '../lib/runtime.js';
import { foldScheduleEvents, renderReminderFraming } from '@deepseek-ai/dsh-schedule';
import { getPaused, recordPaused, recordOwnership } from '../lib/ownership-store.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

const S = (over = {}) => ({
  id: 's1',
  kind: 'after',
  prompt: 'p',
  afterSeconds: 60,
  scheduledAt: '2999-01-01T08:00:00.000Z',
  ...over,
});

/** 干净的 at 记录（无多余字段，可通过 dsh-schedule 严格解码）。 */
const S_AT = (id, scheduledAt) => ({
  id,
  kind: 'at',
  prompt: 'p',
  scheduledAt,
});

test('决策：无到期 → wait 返回下一个目标', () => {
  const now = Date.parse('2099-01-01T00:00:00.000Z');
  const d = dueUserDecision([S()], now);
  assert.equal(d.kind, 'wait');
  if (d.kind === 'wait') assert.equal(d.target, Date.parse('2999-01-01T08:00:00.000Z'));
});

test('决策：到期一次性 → one-shot（最早优先）', () => {
  const now = Date.parse('2999-01-01T09:00:00.000Z');
  const d = dueUserDecision([S({ id: 'a', scheduledAt: '2999-01-01T08:30:00.000Z' }), S({ id: 'b', scheduledAt: '2999-01-01T08:00:00.000Z' })], now);
  assert.equal(d.kind, 'one-shot');
  if (d.kind === 'one-shot') {
    assert.equal(d.records.length, 2); // P1-5：积压一次性合并为同形态批次
    assert.equal(d.records[0].id, 'b'); // 最早到期在前
    assert.equal(d.delivery, 'context');
  }
});

test('决策：P1-5 积压批次按投递形态分组，取最早组', () => {
  const now = Date.parse('2999-01-01T09:00:00.000Z');
  const records = [
    S({ id: 'ctx-late', scheduledAt: '2999-01-01T08:40:00.000Z' }),
    S({ id: 'user-early', scheduledAt: '2999-01-01T08:00:00.000Z' }),
    S({ id: 'user-late', scheduledAt: '2999-01-01T08:20:00.000Z' }),
    S({ id: 'ctx-early', scheduledAt: '2999-01-01T07:50:00.000Z' }),
  ];
  const delivery = new Map([['user-early', 'user'], ['user-late', 'user']]);
  const d = dueUserDecision(records, now, delivery);
  assert.equal(d.kind, 'one-shot');
  if (d.kind === 'one-shot') {
    // context 组最早（07:50 < user 组 08:00）→ 本轮只派发 context 组
    assert.equal(d.delivery, 'context');
    assert.deepEqual(d.records.map((r) => r.id), ['ctx-early', 'ctx-late']);
  }
  // 反之 user 组更早时派发 user 组
  const d2 = dueUserDecision(
    [S({ id: 'ctx', scheduledAt: '2999-01-01T08:30:00.000Z' }), S({ id: 'u', scheduledAt: '2999-01-01T08:10:00.000Z' })],
    now,
    new Map([['u', 'user']]),
  );
  assert.equal(d2.kind, 'one-shot');
  if (d2.kind === 'one-shot') {
    assert.equal(d2.delivery, 'user');
    assert.deepEqual(d2.records.map((r) => r.id), ['u']);
  }
});

test('决策：到期固定间隔 → every 批次', () => {
  const now = Date.parse('2999-01-01T09:00:00.000Z');
  const d = dueUserDecision(
    [S({ id: 'e', kind: 'every', everySeconds: 300, scheduledAt: '2999-01-01T08:00:00.000Z' })],
    now,
  );
  assert.equal(d.kind, 'every');
  if (d.kind === 'every') {
    assert.equal(d.reminders.length, 1);
    assert.equal(d.reminders[0].record.id, 'e');
    assert.equal(d.reminders[0].occurrenceAt, '2999-01-01T09:00:00.000Z');
  }
});

/** 假 Session（支持 events/header/append）。 */
class FakeSession {
  constructor(seed = []) {
    this.header = { seedLength: 0 };
    this.events = seed;
  }
  append(type, data) {
    const seq = this.events.length;
    this.events.push({ type, seq, time: Date.now(), data });
  }
}

/**
 * 假 Agent：message 收集 + 简易 runMaintenance/whenIdle/steer。
 *
 * 投递会写入一条 `user/message`，因为宿主侧的**送达确认**正是核对该事件
 * （见 src/delivery.ts）。不 echo 的假 agent 会让确认判定失败——那是假件失真，
 * 不是实现缺陷；这里保持与真实核心一致的行为。
 */
class FakeAgent {
  constructor(session) {
    this.id = 'agent-runtime';
    this.session = session;
    this.messages = [];
    this.busy = false;
    this.steered = [];
  }
  #echo(message) {
    this.session.append('user/message', {
      content: message.content,
      source: { kind: 'user' },
      role: 'user',
      id: message.id,
    });
  }
  followup(message) {
    this.messages.push(message);
    this.#echo(message);
  }
  steer(message) {
    // 与 dsh-agent-loop 一致：busy 时也可投（排在下一个 step boundary），不 throw。
    this.steered.push(message);
    this.#echo(message);
  }
  async whenIdle() {}
  async runMaintenance(job) {
    if (this.busy) throw new Error('agent already has active work');
    this.busy = true;
    try {
      return await job();
    } finally {
      this.busy = false;
    }
  }
}

function fakeCtx(agent) {
  return {
    sessions: { flush: async () => true },
    agents: { get: () => agent, roots: () => [agent] },
    logger: { warn: () => undefined },
  };
}

/**
 * 默认插话投递设置（与 schema 默认一致）：followup + 确认开 + 未确认保留。
 *
 * 显式传参而非让 runtime 内部兜底：设置由 index 的 settings scope 提供，
 * runtime 通过闭包读取，测试里必须给出同形状的值。
 */
function settingsOf(over = {}) {
  return {
    steerDelivery: 'followup',
    confirmDelivery: true,
    onUnconfirmed: 'keep',
    ...over,
  };
}

test('runtime：到期一次性提醒被派发并注入用户消息', async () => {
  const target = Date.now() + 300;
  const record = S_AT('s1', new Date(target).toISOString());
  const session = new FakeSession([
    {
      type: 'schedule/change',
      seq: 0,
      time: 0,
      data: { version: 1, operation: 'create', schedule: record },
    },
    {
      type: 'session-scheduler/user-schedule',
      seq: 1,
      time: 0,
      data: { version: 1, operation: 'add', id: 's1' },
    },
  ]);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  runtime.requestDrive();
  // 等待目标时间 + 派发余量
  await new Promise((r) => setTimeout(r, target - Date.now() + 800));
  await runtime.dispose();

  assert.equal(agent.messages.length, 1);
  assert.match(agent.messages[0].content[0].text, /\[SCHEDULE REMINDER\]/);
  const dispatch = session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');
  assert.equal(dispatch.length, 1);
  // 已派发后 fold 里不再活动（与 dsh-schedule 一致 → 不会双触发）
  const folded = foldScheduleEvents(session.events, 0);
  assert.equal(folded.active.length, 0);
});

test('runtime：nothing 到期时不注入、不写 dispatch', async () => {
  const session = new FakeSession([
    {
      type: 'schedule/change',
      seq: 0,
      time: 0,
      data: {
        version: 1,
        operation: 'create',
        schedule: S({ id: 'far', scheduledAt: new Date(Date.now() + 60000).toISOString() }),
      },
    },
    {
      type: 'session-scheduler/user-schedule',
      seq: 1,
      time: 0,
      data: { version: 1, operation: 'add', id: 'far' },
    },
  ]);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  runtime.requestDrive();
  await new Promise((r) => setTimeout(r, 200));
  await runtime.dispose();
  assert.equal(agent.messages.length, 0);
  // 只武装了未来 timer，没有 dispatch
  const dispatch = session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');
  assert.equal(dispatch.length, 0);
});

test('runtime：P1-5 积压多条一次性合并为一条批次注入', async () => {
  // 三条在首次 drive 前就已同时过期（模拟关网页期间积压）；x1 最早
  const base = Date.now() - 1000;
  const mk = (id, offset) => S_AT(id, new Date(base + offset).toISOString());
  const session = new FakeSession(
    ['x1', 'x2', 'x3'].flatMap((id, index) => [
      {
        type: 'schedule/change',
        seq: index * 2,
        time: 0,
        data: { version: 1, operation: 'create', schedule: mk(id, index * 100) },
      },
      {
        type: 'session-scheduler/user-schedule',
        seq: index * 2 + 1,
        time: 0,
        data: { version: 1, operation: 'add', id },
      },
    ]),
  );
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  runtime.requestDrive();
  await new Promise((r) => setTimeout(r, 400));
  await runtime.dispose();

  // 一条批次消息，而非三条刷屏
  assert.equal(agent.messages.length, 1);
  assert.match(agent.messages[0].content[0].text, /\[SCHEDULE REMINDER BATCH\]/);
  const payload = JSON.parse(
    /reminders_json: (.+)/.exec(agent.messages[0].content[0].text)[1],
  );
  assert.deepEqual(payload.map((entry) => entry.schedule_id), ['x1', 'x2', 'x3']);
  // 三条 dispatch 全部落日志；fold 后不再 active（去重语义不变）
  const dispatch = session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');
  assert.equal(dispatch.length, 3);
  const folded = foldScheduleEvents(session.events, 0);
  assert.equal(folded.active.length, 0);
});

/** 构造含一条已到点 owned 一次性提醒的 session。 */
function sessionWithDueAt(id, scheduledAtIso) {
  return new FakeSession([
    {
      type: 'schedule/change',
      seq: 0,
      time: 0,
      data: { version: 1, operation: 'create', schedule: S_AT(id, scheduledAtIso) },
    },
    {
      type: 'session-scheduler/user-schedule',
      seq: 1,
      time: 0,
      data: { version: 1, operation: 'add', id },
    },
  ]);
}

test('steer：busy agent（in-flight 插话主场景）插话成功且写 dispatch', async () => {
  const due = new Date(Date.now() - 5000).toISOString(); // 已到点
  const session = sessionWithDueAt('s1', due);
  const agent = new FakeAgent(session);
  // 模拟 auto-driver 正忙：runMaintenance 会 throw，旧实现在此必然 internal_error
  agent.busy = true;
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  const result = await runtime.steerById('s1');

  assert.deepEqual(result, { ok: true, id: 's1', steered: true });
  // 默认投递方式为 followup（独立成轮）：与 next-step 是两条队列，
  // 结构上避开 turn/start 抢 claim 导致的静默丢失。
  assert.equal(agent.messages.length, 1);
  assert.equal(agent.steered.length, 0);
  assert.match(agent.messages[0].content[0].text, /\[SCHEDULE REMINDER\]/);
  // dispatch 已落日志 → fold 后不再 active（无双触发）
  const dispatch = session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');
  assert.equal(dispatch.length, 1);
  const folded = foldScheduleEvents(session.events, 0);
  assert.equal(folded.active.length, 0);
  await runtime.dispose();
});

test('steer：未到点也允许插话（QueueDock「插话发送」语义），成功即出列', async () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const session = sessionWithDueAt('s1', future);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  const result = await runtime.steerById('s1');

  assert.deepEqual(result, { ok: true, id: 's1', steered: true });
  assert.equal(agent.messages.length, 1);
  assert.equal(agent.steered.length, 0);
  // dispatch 已落日志 → 到点后不会再 fire 一次（无双触发）
  const dispatch = session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');
  assert.equal(dispatch.length, 1);
  const folded = foldScheduleEvents(session.events, 0);
  assert.equal(folded.active.length, 0);
  await runtime.dispose();
});

test('steer：不存在的 id 拒绝', async () => {
  const session = sessionWithDueAt('s1', new Date(Date.now() - 5000).toISOString());
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  const result = await runtime.steerById('ghost');

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'schedule_not_found');
  assert.equal(agent.steered.length, 0);
  assert.equal(agent.messages.length, 0);
  await runtime.dispose();
});

/* ==================== 暂停项插话（本轮新增） ==================== */
/**
 * 暂停项不在日志里（日志记录在 pause 时被删），所以插话必须改从 sidecar 留档取材。
 * 语义上"插话"= 不等倒计时立即推送，对暂停项恰恰最需要。
 */
const SID_STEER_PAUSED = 'session-paused-steer-1';

/** 带 sessionId 的 FakeSession（暂停路径需要 header.id 才能读 sidecar）。 */
class FakeSessionWithId extends FakeSession {
  constructor(seed = []) {
    super(seed);
    this.header = { id: SID_STEER_PAUSED, seedLength: 0 };
  }
}

test('暂停项插话：从 sidecar 取材投递，成功后清掉留档', async () => {
  freshOwnershipDir();
  const session = new FakeSessionWithId([]);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);

  // 造一条暂停留档（等价于用 /later 建好再暂停后的状态）
  recordPaused(SID_STEER_PAUSED, {
    uid: 'uid-paused-1',
    prompt: '暂停中的提醒内容',
    delivery: 'context',
    kind: 'after',
    remainingSeconds: 90,
    originalScheduledAt: new Date(Date.now() + 90_000).toISOString(),
    originalAfterSeconds: 120,
    lastScheduleId: 'schedule-7',
    pausedAt: Date.now(),
  });

  const result = await runtime.steerById('uid-paused-1');
  assert.deepEqual(result, { ok: true, id: 'uid-paused-1', steered: true });
  // 默认 followup 投递（与日志路径同一策略，两条路径语义不分叉）
  assert.equal(agent.messages.length, 1);
  assert.equal(agent.steered.length, 0);
  // context 形态 → 走注入防护 framing
  assert.match(agent.messages[0].content[0].text, /\[SCHEDULE REMINDER\]/);
  // 投递成功即出列
  assert.equal(getPaused(SID_STEER_PAUSED, 'uid-paused-1'), undefined, '留档应被清掉');
  // 关键：**不得补写 schedule/change**（该 id 不在日志里，补写会让 fold 抛错），
  // 也不得写 dispatch —— 暂停项的出列靠清留档，而非日志标记。
  assert.equal(
    session.events.filter((e) => e.type === 'schedule/change').length,
    0,
    '不得写 schedule/change',
  );
  // 只应出现「投递消息」本身（送达确认正是核对它）。
  assert.deepEqual(
    session.events.map((e) => e.type),
    ['user/message'],
    '暂停项插话只产生投递消息本身',
  );
  await runtime.dispose();
});

test('暂停项插话：delivery=user 时以本人身份代发', async () => {
  freshOwnershipDir();
  const session = new FakeSessionWithId([]);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  recordPaused(SID_STEER_PAUSED, {
    uid: 'uid-paused-2',
    prompt: '关火',
    delivery: 'user',
    kind: 'after',
    remainingSeconds: 30,
    originalScheduledAt: new Date(Date.now() + 30_000).toISOString(),
    originalAfterSeconds: 60,
    lastScheduleId: 'schedule-8',
    pausedAt: Date.now(),
  });
  const result = await runtime.steerById('uid-paused-2');
  assert.deepEqual(result, { ok: true, id: 'uid-paused-2', steered: true });
  assert.equal(agent.messages.length, 1);
  // user 形态：原样内容，不加 reminder framing
  assert.equal(agent.messages[0].content[0].text, '关火');
  assert.equal(agent.messages[0].source?.kind, 'user');
  assert.equal(getPaused(SID_STEER_PAUSED, 'uid-paused-2'), undefined);
  await runtime.dispose();
});

test('暂停项插话：不存在的 id 仍走日志路径并返回 schedule_not_found', async () => {
  freshOwnershipDir();
  const session = new FakeSessionWithId([]);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  const result = await runtime.steerById('ghost');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'schedule_not_found');
  assert.equal(agent.steered.length, 0);
  await runtime.dispose();
});

/* ==================== 插话：wire id 是 uid，必须换算 ==================== */
/**
 * 回归：GUI 传过来的是投影里的 id（= 稳定 uid），而日志记录用 schedule-N。
 * 此前 steerById 直接按 scheduleId 比对，导致**所有**用户工具创建的提醒
 * 插话都报 schedule_not_found（实测：uid f0fc0c90… vs 日志 id schedule-1）。
 */
const SID_STEER_UID = 'session-steer-uid-1';

class FakeSessionUid extends FakeSession {
  constructor(seed = []) {
    super(seed);
    this.header = { id: SID_STEER_UID, seedLength: 0 };
  }
}

test('回归：插话接受 wire 的 uid（而非只认日志 scheduleId）', async () => {
  freshOwnershipDir();
  const due = new Date(Date.now() - 5000).toISOString();
  const session = new FakeSessionUid(sessionWithDueAt('schedule-1', due).events);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);

  // 模拟 create 时写入的 sidecar 所有权：日志 id=schedule-1，uid=U1
  recordOwnership(SID_STEER_UID, 'schedule-1', 'context', 'uid-U1');

  // GUI 传的是 uid
  const result = await runtime.steerById('uid-U1');
  assert.deepEqual(result, { ok: true, id: 'uid-U1', steered: true }, '按 uid 插话应成功');
  assert.equal(agent.messages.length, 1);
  // dispatch 落在真正的日志 id 上
  const dispatch = session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');
  assert.equal(dispatch.length, 1);
  assert.equal(dispatch[0].data.id, 'schedule-1', 'dispatch 必须写日志 id 而非 uid');
  await runtime.dispose();
});

test('插话：直接传日志 scheduleId 仍然可用（向后兼容）', async () => {
  freshOwnershipDir();
  const due = new Date(Date.now() - 5000).toISOString();
  const session = new FakeSessionUid(sessionWithDueAt('schedule-1', due).events);
  const agent = new FakeAgent(session);
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, settingsOf);
  const result = await runtime.steerById('schedule-1');
  assert.deepEqual(result, { ok: true, id: 'schedule-1', steered: true });
  await runtime.dispose();
});

/**
 * 本地 framing 副本与上游措辞的一致性护栏。
 *
 * `src/runtime.ts` 的 `renderOneShotBatchFraming` 是上游文案的**本地副本**——
 * 上游只为「单条」与「固定间隔批次」提供渲染函数，本插件的「多条到期一次性
 * 合并」形态没有上游对应物，只能自渲染。
 *
 * 风险：上游改措辞时本地副本不会报错，只会让同一会话里单条与批次的防护语义
 * 悄悄不一致（0.2.0 正是如此：上游把长句换成固定来源行，本条护栏若缺失，
 * 只能靠人工比对发现）。
 *
 * 判据：本地批次 framing 的固定来源行必须等于上游 `renderReminderFraming`
 * 的第二行。不硬编码任何一版文案 —— 从上游实时取，故**支持任意多代**。
 */
test('本地批次 framing 的固定来源行与上游 dsh-schedule 一致', () => {
  const now = Date.now();
  const upstreamSingle = renderReminderFraming({
    id: 'probe-1',
    kind: 'after',
    prompt: 'x',
    afterSeconds: 60,
    scheduledAt: new Date(now + 60_000).toISOString(),
    title: 'x',
  });
  // 上游 framing 第二行即固定来源行（首行是 [SCHEDULE REMINDER] 标签）
  const upstreamOriginLine = upstreamSingle.split('\n')[1];

  const localBatch = renderOneShotBatchFraming([
    { id: 'x1', kind: 'after', prompt: 'a', afterSeconds: 60, scheduledAt: new Date(now).toISOString() },
  ]);
  const localLines = localBatch.split('\n');

  assert.equal(localLines[0], '[SCHEDULE REMINDER BATCH]');
  assert.equal(
    localLines[1],
    upstreamOriginLine,
    `本地批次来源行与上游不一致\n  本地: ${localLines[1]}\n  上游: ${upstreamOriginLine}`,
  );
  // payload 行仍为 JSON（防护语义：动态字段全部转义）
  assert.doesNotThrow(() => JSON.parse(/^reminders_json: (.+)$/.exec(localLines[2])[1]));
});
