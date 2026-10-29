/**
 * 插话投递策略测试：投递队列选择 + 送达确认 + 未确认时的出列行为。
 *
 * 背景（实测复现）：`agent.steer()` 入 `next-step`，若插话恰好撞上 `turn/start`，
 * 核心 `inbox.claim('next-step', …)` 会把整批取走交给一个请求上下文已定的 step，
 * 消息落进 surface 却不进实际请求 —— **静默丢失**。且旧实现在 steer 后**无条件**
 * 写 dispatch，导致「提醒消失但消息没到」且不可重试。
 *
 * 本文件锁住修复后的三条不变量：
 *  1. 默认走 `followup`（独立成轮，结构上无竞态）；
 *  2. 未确认且 `onUnconfirmed='keep'` 时**不写 dispatch**（条目保留可重试）；
 *  3. 确认送达 / 关闭确认 / `discard` 时才写 dispatch。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserScheduleRuntime } from '../lib/runtime.js';
import { hasMessageInLog, messageIdOf, DELIVERY_CONFIRM_TIMEOUT_MS } from '../lib/delivery.js';
import { foldScheduleEvents } from '@deepseek-ai/dsh-schedule';
import { allOwnership, recordOwnership } from '../lib/ownership-store.js';
import { foldUserState } from '../lib/user-tools.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

freshOwnershipDir();

/** 假 Session：`append` 会**回写 events**（这是确认逻辑能观测到的前提）。 */
class FakeSession {
  constructor(seed = []) {
    this.header = { seedLength: 0 };
    this.events = seed;
    this.sessionId = 'session-delivery';
  }
  ownEvents() {
    return this.events;
  }
  append(type, data) {
    const seq = this.events.length;
    this.events.push({ type, seq, time: Date.now(), data });
  }
}

/**
 * 假 Agent，三种投递各自记账。
 *
 * `echoes: true` 时投递会写一条 `user/message`（模拟「真的进了日志」）；
 * 否则只记账不写日志（模拟「投出去了但没落到日志」= 未确认）。
 * `echoDelayMs > 0` 时延迟写入，用来把确认窗口拉长、以检验并发不变量。
 */
class FakeAgent {
  constructor(session, { echoes = true, echoDelayMs = 0 } = {}) {
    this.id = 'agent-delivery';
    this.session = session;
    this.echoes = echoes;
    this.echoDelayMs = echoDelayMs;
    this.followups = [];
    this.steers = [];
  }
  followup(message) {
    this.followups.push(message);
    this.#echo(message);
  }
  steer(message) {
    this.steers.push(message);
    this.#echo(message);
  }
  #echo(message) {
    if (!this.echoes) return;
    const write = () =>
      this.session.append('user/message', {
        content: message.content,
        source: { kind: 'user' },
        role: 'user',
        id: message.id,
      });
    if (this.echoDelayMs > 0) setTimeout(write, this.echoDelayMs);
    else write();
  }
}

function fakeCtx(agent) {
  return {
    sessions: { flush: async () => true },
    agents: { get: () => agent, roots: () => [agent] },
    logger: { warn: () => undefined },
  };
}

function settingsOf(over = {}) {
  return { steerDelivery: 'followup', confirmDelivery: true, onUnconfirmed: 'keep', ...over };
}

/** 造一个含单条活动的用户提醒的会话，返回 { session, agent, id, uid }。 */
function setup({ echoes = true, settings = {} } = {}) {
  const sessionId = 'session-delivery';
  const uid = 'uid-delivery-1';
  /**
   * 每个用例都要一份干净的 sidecar。原先只在模块顶部 `freshOwnershipDir()` 一次，
   * 于是所有用例共用同一张 `session-delivery` 所有权表：一旦某个用例往里多留一条
   * **同 uid** 的记录（未确认 + keep 的补偿重挂就会留一条新日志 id），下一个用例的
   * `findScheduleIdByUid` 会先撞上那条残留，返回一个本会话日志里根本不存在的 id，
   * 表现成莫名其妙的 `schedule_not_found`。`tests/helpers/ownership-state.mjs` 里
   * 记的正是同一类教训——共享状态让用例之间互相污染。
   */
  freshOwnershipDir();
  const record = {
    id: 'schedule-1',
    kind: 'after',
    prompt: '投递测试',
    afterSeconds: 600,
    scheduledAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const session = new FakeSession([
    { type: 'schedule/change', seq: 0, time: 0, data: { version: 1, operation: 'create', schedule: record } },
  ]);
  session.header.id = sessionId;
  recordOwnership(sessionId, record.id, 'user', uid);
  const agent = new FakeAgent(session, { echoes });
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, () => settingsOf(settings));
  return { session, agent, runtime, uid, sessionId, record };
}

const dispatches = (session) =>
  session.events.filter((e) => e.type === 'schedule/change' && e.data.operation === 'dispatch');

test('delivery：hasMessageInLog 能按 message id 命中日志', () => {
  const session = new FakeSession([
    { type: 'user/message', seq: 0, time: 0, data: { content: [], source: { kind: 'user' }, role: 'user', id: 'm1' } },
  ]);
  assert.equal(hasMessageInLog(session, 'm1'), true);
  assert.equal(hasMessageInLog(session, 'm2'), false);
});

/**
 * 跨内核代次的 Session 形状（docs/verification.md 的双轨）：
 *  - 0.1.1-rc.2：`.events` 数组 + `header.seedLength`，**无** `ownEvents()`
 *  - 0.1.2-rc.1 起（含 0.1.5 / 0.1.7）：`ownEvents()` + `inheritedEventCount`
 *
 * 送达确认是新增的读日志路径，必须与 fold 一样走 `readOwnEvents` 兼容层。
 * 若哪天有人直接读 `session.events`，0.1.2+ 上会读到空数组而**误判未确认**
 * —— 表现为插话永远提示「未确认」，是很隐蔽的退化。
 */
// 0.1.1 已按 issue #95 移出支持矩阵，但 readOwnEvents 的 `.events` 兜底**保留**：
// 第三方伪造 Session、或未来某代悄悄改形状时，失败要可诊断（误判「未确认」）而不是抛 TypeError。
test('delivery：0.1.1 legacy 形状（.events，无 ownEvents）也能确认', () => {
  const legacy = {
    header: { id: 's-legacy', seedLength: 0 },
    events: [
      { type: 'user/message', seq: 0, time: 0, data: { content: [], source: { kind: 'user' }, role: 'user', id: 'm-legacy' } },
    ],
  };
  assert.equal(hasMessageInLog(legacy, 'm-legacy'), true);
  assert.equal(hasMessageInLog(legacy, 'm-other'), false);
});

test('delivery：0.1.2+ 形状（ownEvents()）确认，且不依赖 .events', () => {
  const log = [
    { type: 'user/message', seq: 0, time: 0, data: { content: [], source: { kind: 'user' }, role: 'user', id: 'm-modern' } },
  ];
  const modern = {
    header: { id: 's-modern' },
    inheritedEventCount: 0,
    ownEvents: () => log,
  };
  assert.equal(hasMessageInLog(modern, 'm-modern'), true);
  assert.equal(hasMessageInLog(modern, 'm-other'), false);

  // fork 出的会话：ownEvents() 只给 live 段，继承前缀不在其中 —— 确认只看 live 段
  const forked = { header: { id: 's-fork' }, inheritedEventCount: 2, ownEvents: () => log };
  assert.equal(hasMessageInLog(forked, 'm-modern'), true);
});

test('delivery：读日志抛错时按「未确认」处理（不敢写 dispatch）', () => {
  const broken = {
    header: { id: 's-broken' },
    ownEvents() {
      throw new Error('storage unavailable');
    },
  };
  assert.equal(hasMessageInLog(broken, 'anything'), false);
});

test('delivery：messageIdOf 对缺失 id 返回空串', () => {
  assert.equal(messageIdOf({ id: 'x' }), 'x');
  assert.equal(messageIdOf({}), '');
  assert.equal(messageIdOf({ id: 42 }), '');
});

test('插话：默认走 followup（不入 next-step，结构上避开 turn/start 竞态）', async () => {
  const { agent, runtime, uid } = setup();
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(agent.followups.length, 1);
  assert.equal(agent.steers.length, 0, '默认不得使用 steer');
});

test('插话：steerDelivery=steer 时才走 agent.steer', async () => {
  const { agent, runtime, uid } = setup({ settings: { steerDelivery: 'steer' } });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(agent.steers.length, 1);
  assert.equal(agent.followups.length, 0);
});

test('插话：确认送达后写出列标记（dispatch）', async () => {
  const { session, runtime, uid } = setup({ echoes: true });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(dispatches(session).length, 1);
  // 出列后 fold 不再活动
  assert.equal(foldScheduleEvents(session.events, 0).active.length, 0);
});

test('插话：确认窗口里记录必须已经出列（双投递的根因）', async () => {
  // echoes:false → 确认走满 2s 预算。这个窗口正是「另一个读者再派发一次」的现场：
  // dsh-schedule 的调度器与本插件共用同一份持久化日志，去重契约从头到尾就是
  // 「日志里有没有 dispatch」，所以窗口内记录只要还 active，peer 就会重投。
  const { session, runtime, uid } = setup({ echoes: false, settings: { onUnconfirmed: 'keep' } });
  const pending = runtime.steerById(uid);

  // 落在确认窗口内部：模拟 peer 此刻 fold 同一份日志。
  await new Promise((resolve) => setTimeout(resolve, 60));
  const during = foldUserState(session);
  const stillActive = during.folded.active.some((record) => record.id === 'schedule-1');

  await pending;
  assert.equal(
    stillActive,
    false,
    '确认窗口内记录仍是 active —— 共用同一份日志的 dsh-schedule 会把它再派发一次',
  );
});

test('插话：未确认 + keep → 立即出列并补偿重挂，端态是「一条活动提醒、uid 不变」', async () => {
  const { session, runtime, uid, sessionId, record } = setup({ echoes: false, settings: { onUnconfirmed: 'keep' } });
  const result = await runtime.steerById(uid);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'delivery_unconfirmed');
  // 窗口已关：出列标记必须在确认之前就已写下（旧实现这里恰是 0，那才是 bug）。
  assert.equal(dispatches(session).length, 1, '未写出列标记 = 双投递窗口还开着');

  const creates = session.events.filter(
    (event) => event.type === 'schedule/change' && event.data.operation === 'create',
  );
  assert.equal(creates.length, 2, '缺一条补偿 create —— keep 语义要靠重挂实现，不是靠不写 dispatch');

  const active = foldScheduleEvents(session.events, 0).active;
  assert.equal(active.length, 1, '端态必须恰好一条活动提醒（多则重影，少则丢失）');
  assert.equal(active[0].prompt, record.prompt, '补偿内容应与原提醒一致');
  assert.equal(active[0].scheduledAt, record.scheduledAt, '补偿必须保留原时刻，不能重置到未来');

  // uid 跨换 id 保留，且**只对应一条**所有权：旧条目必须撤掉，否则
  // findScheduleIdByUid 会命中已派发的旧 id，用户下一次操作直接 schedule_not_found。
  const byUid = Object.entries(allOwnership(sessionId)).filter(([, entry]) => entry.uid === uid);
  assert.equal(byUid.length, 1, `同一 uid 残留 ${byUid.length} 条所有权`);
  assert.equal(byUid[0][0], active[0].id, 'uid 应指向那条活动的新记录');
});

test('插话：未确认 + discard → 保持旧语义写出列标记', async () => {
  const { session, runtime, uid } = setup({ echoes: false, settings: { onUnconfirmed: 'discard' } });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(dispatches(session).length, 1);
  assert.equal(foldScheduleEvents(session.events, 0).active.length, 0);
});

test('插话：关闭确认 → 不核对日志，直接出列（fire-and-forget）', async () => {
  const { session, runtime, uid } = setup({ echoes: false, settings: { confirmDelivery: false } });
  const result = await runtime.steerById(uid);
  assert.equal(result.ok, true);
  assert.equal(dispatches(session).length, 1);
});

test('插话：未知 id 仍报 schedule_not_found（回归保护）', async () => {
  const { runtime } = setup();
  const result = await runtime.steerById('不存在的-uid');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'schedule_not_found');
});

test('插话：确认预算为正且足够小（避免 UI 长时间挂起）', () => {
  assert.ok(DELIVERY_CONFIRM_TIMEOUT_MS > 0);
  assert.ok(DELIVERY_CONFIRM_TIMEOUT_MS <= 5000);
});

/**
 * 确认是 `await` 的，因此「投递」与「写 dispatch」之间**不再是同一个同步块** ——
 * 这给 auto-driver 留出了插入窗口（旧实现在同一同步块内 append，JS 单线程下
 * 不可能被打断）。这里锁住不变量：即便在确认窗口内反复重驱，也不得双投递。
 *
 * 该测试的**实际敏感点**是 `schedule/change: dispatch` 这个互斥标记（已实测：
 * 去掉标记写入后本用例失败）。它**不**对 `steerById` 里那次重 fold 守卫敏感
 * （去掉守卫本用例仍通过）—— 因为单线程下 `driveOnce` 要 `await flush()` 才会
 * fold，插话总有机会先写完 dispatch。保留该守卫仍是对的（防御未来的调度变化），
 * 但不要误以为本测试覆盖了它。
 */
test('插话：确认窗口内反复重驱也不双投递（dispatch 互斥回归）', async () => {
  const sessionId = 'session-race';
  const uid = 'uid-race-1';
  const record = {
    id: 'schedule-1',
    kind: 'after',
    prompt: '竞态测试',
    afterSeconds: 60,
    // 已到点：auto-driver 一旦跑到 fold 就会想派发它
    scheduledAt: new Date(Date.now() - 5000).toISOString(),
  };
  const session = new FakeSession([
    { type: 'schedule/change', seq: 0, time: 0, data: { version: 1, operation: 'create', schedule: record } },
  ]);
  session.header.id = sessionId;
  recordOwnership(sessionId, record.id, 'user', uid);

  // echo 延迟，让确认窗口足够长，给重驱留出插入机会
  const agent = new FakeAgent(session, { echoes: true, echoDelayMs: 60 });
  const runtime = new UserScheduleRuntime(fakeCtx(agent), agent, () => settingsOf());

  const pending = runtime.steerById(uid);
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 15));
    runtime.requestDrive();
  }
  const result = await pending;
  await new Promise((r) => setTimeout(r, 200));
  await runtime.dispose();

  assert.equal(result.ok, true);
  const userMessages = session.events.filter((e) => e.type === 'user/message');
  assert.equal(userMessages.length, 1, '同一提醒只能投递一次');
  assert.equal(dispatches(session).length, 1, 'dispatch 只能写一次');
  assert.equal(foldScheduleEvents(session.events, 0).active.length, 0);
});
