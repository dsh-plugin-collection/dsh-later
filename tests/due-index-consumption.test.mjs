/**
 * 到期索引的消化判定（GitHub issue #139）。
 *
 * ## 缺陷本体（一句话）
 *
 * 一次性提醒**投递成功之后**，它的 sidecar 条目不出列也不标记，而宿主级扫描器的到期
 * 视图只看 sidecar（冷会话的会话日志读不到：`ctx.sessions.get` 按内核定义只返回 live
 * 会话）。于是「已投递」永远被判成「到期且未消化」，5 次假失败之后 `gaveUp`，该会话
 * 此后任何新提醒都不再被冷唤醒。
 *
 * 修法不是让扫描器去读 fold（那是循环依赖：叫醒决策发生在会话还冷的时候），而是
 * **让投递真图自己落进索引面**：runtime 在 dispatch 的同一同步块里把 fold 的端态镜像
 * 进 sidecar（`ownership-store.mirrorDueIndex`），扫描器继续只读索引，但读的是带消化
 * 状态的索引（`due.readDueIndex` 的三态）。取舍与代价见 `docs/design-decisions.md` D2。
 *
 * ## 这个文件为什么分三层
 *
 *  - **纯判据层**（`readDueIndex` / `mirrorDueIndex` / `recordOwnership` 的标记生命周期）：
 *    三态里最容易出事的是 `consumed` 与 `unknown` 被合成一个 `undefined` —— 那样回算
 *    路径会把刚投完的那条从它的 `create` 事件里复活成「永久逾期」，缺陷原地复发。
 *    这一层不需要宿主，也不需要真等定时器。
 *  - **扫描器层**（`createExpirySweeper` + 注入的假时钟）：退避、`gaveUp`、以及**三条**
 *    解除路径。`gaveUp` 的清零在修复前是结构性不可达的（`settle` 里 `state.gaveUp` 的
 *    短路排在清算之前），所以三条路径必须各有断言：① 条目被删/推远 ② 条目被正常消化
 *    ③ 用户改动后显式 `rearm`。只测①不够——只钉住顺序，钉不住 #139 的主路径。
 *  - **装配层**（真 `lib/index.js` + 假宿主）：验收里那三条「现有判据看不见」的路径。
 *    这一层只能用真定时器（`apply()` 里没有注入时钟的口子），所以每条用例都在秒级；
 *    判据一律是**事件形状**：`agent/inbox/spliced` 且 `inserted[].content` 带本次 nonce，
 *    随后 `schedule/change operation:dispatch`。**绝不**按文本命中——命令回执与创建事件里
 *    也含同样的正文，按文本搜会同时制造假绿和假红。
 *
 * ## 假宿主口径（与真内核逐条对齐，别"顺手简化"）
 *
 * 同 `tests/11b-cold-delivery.test.mjs`：`agents.resume()` 返回 `{ agent, dispose }`；
 * 「会话已附着」的口径是 `ctx.sessions.get(id)` 有值（冷会话不在 `published` 里，这正是
 * 老条目回算拿不到日志的真相）；`followup` 先写 `agent/inbox/spliced` 再写 `user/message`；
 * `agent.ctx` 的 `effect/on/tools.register` 必须齐全，否则挂载会失败在 `attach` 而不是
 * 我们要测的那条缝上（那样测试会"绿得理所当然"）。
 *
 * @module tests/due-index-consumption
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as plugin from '../lib/index.js';
import { createExpirySweeper } from '../lib/expiry-sweeper.js';
import {
  getOwnership,
  listOwnershipSnapshots,
  mirrorDueIndex,
  recordOwnership,
} from '../lib/ownership-store.js';
import { readDueIndex } from '../lib/due.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

// ── 基础假件 ────────────────────────────────────────────────────────────────

/** 让微任务（含 cordis `_reload` 的 `await Promise.resolve()`）跑一轮。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** 真等一段时间（装配层的节奏是真定时器，不能加速）。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询直到 `predicate()` 为真或超时；返回是否在超时前为真。 */
async function until(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(20);
  }
  return predicate();
}

/** 假 Session：`ownEvents()` 是本插件读日志的唯一入口。 */
class FakeSession {
  constructor(id) {
    this.id = id;
    this.header = { id };
    this.events = [];
    this.seq = 0;
  }
  ownEvents() {
    return this.events;
  }
  append(type, data) {
    this.events.push({ type, seq: this.seq, time: Date.now(), data });
    this.seq += 1;
  }
}

/**
 * 假 Agent：`followup` 模拟内核投递原语——先 `agent/inbox/spliced`，再 `user/message`。
 * `status` 是真的生命周期镜像：装配层的释放判据要读它（`running` ⇒ 还没收敛）。
 */
class FakeAgent {
  constructor(id, session, defs) {
    this.id = id;
    this.session = session;
    this.status = 'idle';
    this.ctx = {
      effect(execute) {
        const ret = execute();
        return () => (typeof ret === 'function' ? ret() : undefined);
      },
      on: () => () => undefined,
      // 真宿主把用户工具注册在 **agent.ctx** 上（`registerUserScheduleTools`），
      // 所以这里必须转发到同一张 defs 表，否则用例拿不到 `user_schedule_create`。
      tools: {
        register: (tool) => {
          const sink = defs ?? new Map();
          sink.set(`tool:${tool.name}`, tool);
          return () => sink.delete(`tool:${tool.name}`);
        },
      },
    };
  }
  followup(message) {
    this.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [{ id: message.id, role: 'user', content: message.content }],
    });
    this.session.append('user/message', message);
  }
  steer(message) {
    this.followup(message);
  }
  async whenIdle() {}
  async runMaintenance(job) {
    return job();
  }
}

/** 一次装配。`options.onWake` 让用例看见"被叫起来"这件事本身。 */
function bootAssembly(options = {}) {
  const defs = new Map();
  const liveAgents = [];
  const published = new Map();
  const resumeCalls = [];
  const handles = [];
  const agentsSvc = {
    roots: () => liveAgents.slice(),
    get: (id) => liveAgents.find((agent) => agent.id === id),
    isOwnedBy: () => false,
    list: () => liveAgents.slice(),
    async resume(opts) {
      resumeCalls.push(opts.resumeSessionId);
      if (options.resume === undefined) throw new Error(`no resume support for ${opts.resumeSessionId}`);
      const agent = options.resume(opts.resumeSessionId, defs);
      const handle = {
        agent,
        dispose: async () => {
          // 真内核的 `dispose()`：停 loop、注销 agent、**移除它的 session**。
          const at = liveAgents.findIndex((entry) => entry.id === agent.id);
          if (at !== -1) liveAgents.splice(at, 1);
          if (published.get(agent.id) === agent.session) published.delete(agent.id);
          options.onDispose?.(agent.id);
        },
      };
      handles.push(handle);
      published.set(agent.id, agent.session);
      const at = liveAgents.findIndex((entry) => entry.id === agent.id);
      if (at === -1) liveAgents.push(agent);
      else liveAgents[at] = agent;
      return handle;
    },
  };
  const warned = [];
  const ctx = new Context();
  ctx.provide('agents', agentsSvc);
  ctx.provide('sessions', {
    flush: async () => true,
    get: (id) => published.get(id),
  });
  ctx.provide('tools', {
    register(tool) {
      defs.set(`tool:${tool.name}`, tool);
      return () => defs.delete(`tool:${tool.name}`);
    },
  });
  ctx.provide('commands', {
    register(definition) {
      defs.set(definition.name, definition);
      return () => defs.delete(definition.name);
    },
  });
  ctx.provide('settings', { describe: () => [{ ns: 'later', value: {} }] });
  ctx.provide('skills', { registerProvider: () => () => undefined });
  const originalWarn = ctx.logger.warn.bind(ctx.logger);
  ctx.logger.warn = (message) => {
    warned.push(String(message));
    originalWarn(message);
  };
  const fiber = ctx.plugin(
    { apply: plugin.apply, inject: plugin.inject, name: plugin.name, Config: plugin.Config },
    {},
  );
  return { ctx, defs, agentsSvc, liveAgents, published, resumeCalls, handles, warned, fiber };
}

async function shutdown(boot) {
  try {
    await boot.fiber.dispose();
  } catch {
    /* 拆除失败不改写断言结论 */
  }
}

/** 直接落一份 sidecar JSON（模拟某个版本写下的文件）。 */
function writeSidecar(sessionId, payload) {
  writeFileSync(join(process.env.DSH_LATER_STATE_DIR, `${sessionId}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * 造一条创建事件。记录字段**逐键精确**：上游 `applyScheduleChanges` 用 `hasExactKeys`
 * 校验，`at` 记录多一个键就整条 fold 失败。
 */
function createEvent({ id, kind, title = '提醒', prompt, scheduledAt, afterSeconds, everySeconds }) {
  const base = { id, kind, title, prompt, scheduledAt: new Date(scheduledAt).toISOString() };
  return {
    version: 1,
    operation: 'create',
    schedule: kind === 'after' ? { ...base, afterSeconds } : kind === 'every' ? { ...base, everySeconds } : base,
  };
}

/** 读某个会话日志里的投递证据（只看事件形状）。 */
function deliveryOf(session, nonce) {
  const spliced = session.events.filter(
    (e) =>
      e.type === 'agent/inbox/spliced' &&
      (e.data?.inserted ?? []).some((message) =>
        (message?.content ?? []).some((block) => typeof block?.text === 'string' && block.text.includes(nonce)),
      ),
  );
  const dispatched = session.events.filter((e) => e.type === 'schedule/change' && e.data?.operation === 'dispatch');
  return { spliced, dispatched };
}

/** 播一条**已到期**的一次性提醒：日志 create + sidecar 条目（可选带消化标记）。 */
function seedDueReminder(sessionId, nonce, { dispatchedAt, overdueMs = 2500, kind = 'at', everySeconds } = {}) {
  const session = new FakeSession(sessionId);
  const target = Date.now() - overdueMs;
  const id = 'schedule-1';
  session.append('schedule/change', createEvent({ id, kind, prompt: nonce, scheduledAt: target, everySeconds }));
  const entry = {
    delivery: 'context',
    createdAt: target - 60_000,
    uid: `uid-${nonce}`,
    scheduledAt: target,
    ...(dispatchedAt === undefined ? {} : { dispatchedAt }),
  };
  writeSidecar(sessionId, { version: 3, entries: { [id]: entry }, paused: {} });
  return { session, id, target, nonce };
}

// ── 1. 纯判据层：`readDueIndex` 的三态 ──────────────────────────────────────

test('readDueIndex：消化标记优先于时刻，也优先于"缺时刻 ⇒ 去回算"那条路', () => {
  const past = Date.now() - 1000;
  assert.deepEqual(readDueIndex({ scheduledAt: past }), { kind: 'due', target: past });
  // 已消化：条目**留着**、时刻**留着**，但到期视图必须是"不到期"。
  assert.deepEqual(readDueIndex({ scheduledAt: past, dispatchedAt: past + 50 }), { kind: 'consumed' });
  // 三态不能塌成一个 undefined：`unknown`（v1/v2 老条目）要能被读侧认出来去回算。
  assert.deepEqual(readDueIndex({}), { kind: 'unknown' });
  assert.deepEqual(readDueIndex(undefined), { kind: 'unknown' });
  // 非法标记 = 没标过（磁盘内容按不可信输入处理）；非法时刻 = unknown，不是"到期"。
  assert.deepEqual(readDueIndex({ scheduledAt: past, dispatchedAt: Number.NaN }), { kind: 'due', target: past });
  assert.deepEqual(readDueIndex({ scheduledAt: 'not-a-time' }), { kind: 'unknown' });
});

test('mirrorDueIndex：镜像两种端态、幂等、不碰无关条目', () => {
  freshOwnershipDir();
  const sessionId = 'session-mirror';
  const now = Date.now();
  recordOwnership(sessionId, 'schedule-1', 'context', 'uid-1', undefined, undefined, now - 5000);
  recordOwnership(sessionId, 'schedule-2', 'context', 'uid-2', undefined, undefined, now + 60_000);
  recordOwnership(sessionId, 'schedule-3', 'context', 'uid-3', undefined, undefined, now - 5000);

  assert.equal(mirrorDueIndex(sessionId, new Map([['schedule-1', undefined], ['schedule-2', now + 120_000]])), 2);
  // ① 不在 active ⇒ 打消化标记，条目**不删**（uid/时刻都得留着给补偿重挂读）
  const consumed = getOwnership(sessionId, 'schedule-1');
  assert.equal(typeof consumed?.dispatchedAt, 'number', '投完的条目必须带消化标记');
  assert.equal(consumed?.uid, 'uid-1', '消化不能丢掉稳定身份');
  assert.equal(consumed?.scheduledAt, now - 5000, '消化不篡改历史时刻');
  // ② 还在 active 但时刻被 fold 推进 ⇒ 索引跟着走（`every` 的那一半）
  assert.equal(getOwnership(sessionId, 'schedule-2')?.scheduledAt, now + 120_000);
  // ③ 没进镜像表的条目一律不动（"绝不猜"与读侧回算是同一条纪律）
  assert.equal(getOwnership(sessionId, 'schedule-3')?.dispatchedAt, undefined);

  // 幂等：同一个端态再镜像一次必须是 0 改动——每次投递都重写 sidecar 会拨
  // `sidecarGeneration`，而那是 fold 缓存的失效键，无条件写等于让 fold 缓存每轮自毁。
  assert.equal(mirrorDueIndex(sessionId, new Map([['schedule-1', undefined], ['schedule-2', now + 120_000]])), 0);
  assert.equal(mirrorDueIndex(sessionId, new Map([['schedule-4', undefined]])), 0, '索引里没有的 id 不新增条目');
});

test('recordOwnership：显式写新时刻就清消化标记（用户改动 = 重新排上）', () => {
  freshOwnershipDir();
  const sessionId = 'session-rearm';
  const now = Date.now();
  recordOwnership(sessionId, 'schedule-1', 'context', 'uid-1', undefined, undefined, now - 5000);
  assert.equal(mirrorDueIndex(sessionId, new Map([['schedule-1', undefined]])), 1);
  assert.equal(typeof getOwnership(sessionId, 'schedule-1')?.dispatchedAt, 'number');
  // 带着消化标记做一次**不写时刻**的覆盖写（pause 回填 uid 那一类）：标记留着。
  recordOwnership(sessionId, 'schedule-1', 'user', 'uid-1');
  assert.equal(typeof getOwnership(sessionId, 'schedule-1')?.dispatchedAt, 'number', '没写时刻就不该解标记');
  // 显式写新时刻（edit / resume / 补偿重挂）：标记清掉，否则这条永远不被叫醒——
  // 那是 #139 的镜像缺陷（一边永不消化，一边永不排上）。
  recordOwnership(sessionId, 'schedule-1', 'user', 'uid-1', undefined, undefined, now + 30_000);
  const entry = getOwnership(sessionId, 'schedule-1');
  assert.equal(entry?.dispatchedAt, undefined, '写了新时刻必须解除消化状态');
  assert.equal(entry?.scheduledAt, now + 30_000);
});

// ── 2. 扫描器层：退避、gaveUp 与三条解除路径（假时钟，可精确驱动）──────────

/**
 * 造一个只依赖注入面的扫描器：快照由用例直接给，时钟是数的。
 * @returns { sweeper, clock, wakeCalls, warned, snapshots }
 */
function fakeSweeper(initial, options = {}) {
  let clock = 1_000_000;
  const timers = [];
  const wakeCalls = [];
  const warned = [];
  const snapshots = { value: initial };
  /**
   * `options.consumeOnWake`（默认开）把真接线的另一半也模拟出来：**叫醒之后 runtime
   * 会投递，并把 fold 的端态镜像进索引**。少了这一半，假件就只会"永远投不出去"，
   * 用它断言"不再攒失败"是没有意义的（攒不攒取决于快照会不会变，而快照由投递决定）。
   * 需要失败梯子的用例显式关掉它（`throwOnWake`）。
   */
  const consumeDue = (sessionId) => {
    snapshots.value = snapshots.value.map((snapshot) => {
      if (snapshot.sessionId !== sessionId) return snapshot;
      const entries = {};
      for (const [id, entry] of Object.entries(snapshot.entries)) {
        const reading = readDueIndex(entry);
        entries[id] = reading.kind === 'due' && reading.target <= clock
          ? { ...entry, dispatchedAt: clock }
          : entry;
      }
      return { sessionId, entries };
    });
  };
  const sweeper = createExpirySweeper({
    snapshots: () => snapshots.value,
    wake: (sessionId) => {
      wakeCalls.push({ at: clock, sessionId });
      if (options.throwOnWake) throw new Error('resume 不通');
      if (options.consumeOnWake !== false) consumeDue(sessionId);
      return undefined;
    },
    wakeable: () => true,
    resolveScheduledAt: () => undefined,
    warn: (message) => warned.push(String(message)),
    now: () => clock,
    // 假定时器：只记录到期时刻，由 `advance` 决定什么时候真的到。
    setTimeout: (handler, delay) => {
      const entry = { at: clock + delay, handler };
      timers.push(entry);
      return entry;
    },
    clearTimeout: (handle) => {
      const at = timers.indexOf(handle);
      if (at !== -1) timers.splice(at, 1);
    },
    setInterval: () => undefined,
    clearInterval: () => undefined,
    intervalMs: 60_000,
  });
  /**
   * 把假时钟往前推 `ms`，途中按序触发所有到点的定时器。
   *
   * **必须是 async**：`setTimeout` 的 handler 里跑的是 `void sweep()`，而 sweep 在
   * `await Promise.resolve()` 之后才真正扫并重新排 timer——同步触发只会拿到"上一轮的
   * 那一个定时器"，退避梯子一层都走不完（测试于是假绿：它以为等了 20s，其实只走了一步）。
   * 每轮之间让出一个宏任务，上一轮的 `reschedule` 才落在表里。
   */
  const advance = async (ms, steps = 40) => {
    const endAt = clock + ms;
    for (let i = 0; i < steps; i += 1) {
      await flush();
      const due = timers.filter((t) => t.at <= endAt).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers.splice(timers.indexOf(due), 1);
      clock = due.at;
      due.handler();
    }
    clock = endAt;
    await flush();
  };
  return { sweeper, wakeCalls, warned, snapshots, advance, now: () => clock };
}

/** 一条已过期的条目（`consumed` 由 `dispatchedAt` 表达）。 */
const dueEntry = (target, extra = {}) => ({ delivery: 'context', createdAt: target - 1, scheduledAt: target, ...extra });

test('一次性提醒投完（索引被镜像成已消化）：扫描器不再攒失败、不告警', async () => {
  freshOwnershipDir();
  const sessionId = 'session-swept';
  const target = 900_000;
  const { sweeper, wakeCalls, warned, snapshots, advance } = fakeSweeper([
    { sessionId, entries: { 'schedule-1': dueEntry(target) } },
  ]);
  await sweeper.sweepNow();
  await flush();
  assert.equal(wakeCalls.length, 1, '起步应当正好叫醒一次');

  // 镜像落地（等价于 runtime 在 dispatch 的同一同步块里做的事）。
  snapshots.value = [{ sessionId, entries: { 'schedule-1': dueEntry(target, { dispatchedAt: target + 10 }) } }];
  await advance(60_000);
  await sweeper.sweepNow();
  await flush();
  assert.equal(wakeCalls.length, 1, '已消化的条目不得再被叫醒');
  assert.equal(sweeper.failuresOf(sessionId), 0, '一次成功的投递绝不能被记成失败');
  assert.equal(warned.filter((w) => /冷唤醒失败|已停止自动唤醒/.test(w)).length, 0, '不许出现假失败告警');
  await sweeper.dispose();
});

test('投完之后同会话再来一条新提醒：仍然被叫醒并投递（#139 的核心回归）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-next';
  const first = 900_000;
  const { sweeper, wakeCalls, snapshots, advance } = fakeSweeper([
    { sessionId, entries: { 'schedule-1': dueEntry(first) } },
  ]);
  await sweeper.sweepNow();
  await flush();
  snapshots.value = [{ sessionId, entries: { 'schedule-1': dueEntry(first, { dispatchedAt: first + 10 }) } }];
  await advance(60_000);
  await sweeper.sweepNow();
  await flush();
  assert.equal(wakeCalls.length, 1);
  // 第二条到期
  snapshots.value = [
    {
      sessionId,
      entries: {
        'schedule-1': dueEntry(first, { dispatchedAt: first + 10 }),
        'schedule-2': dueEntry(1_100_000),
      },
    },
  ];
  sweeper.reschedule();
  await advance(300_000);
  await sweeper.sweepNow();
  await flush();
  assert.equal(wakeCalls.length, 2, '第一条投完不影响第二条：新条目必须再叫一次');
  assert.equal(sweeper.failuresOf(sessionId), 0);
  await sweeper.dispose();
});

test('gaveUp 解除路径①：条目被删除 / 推远 ⇒ 退避清零，不再永久沉默', async () => {
  freshOwnershipDir();
  const sessionId = 'session-gaveup-1';
  const target = 900_000;
  const { sweeper, wakeCalls, warned, snapshots, advance, now } = fakeSweeper(
    [{ sessionId, entries: { 'schedule-1': dueEntry(target) } }],
    { throwOnWake: true },
  );
  // 攒满 5 次失败（退避梯子 1s→2s→4s→8s）⇒ gaveUp + 告警一次
  await advance(20_000, 24);
  await flush();
  assert.equal(warned.filter((w) => /已停止自动唤醒/.test(w)).length, 1, '应当已经放弃');
  const attemptsAtGiveUp = wakeCalls.length;

  // 解除：条目被**推远**到未来（等价于用户把它改晚）。修复前这条路走不到——
  // `settle` 里 `state.gaveUp` 的短路排在清算之前，清零分支对已放弃的会话结构性不可达。
  // 断言必须在"推远之后、到达新时刻之前"这一档做：那才是「被推远」的判定面
  // （`earliest > at`），一旦让它到新时刻，条目又回到到期状态，判的就不是这条路径了。
  const pushedOut = 9_000_000;
  snapshots.value = [{ sessionId, entries: { 'schedule-1': dueEntry(pushedOut) } }];
  sweeper.reschedule();
  // 清算排在**退避窗口之后**：放弃那一刻排下的 `nextAttempt` 还在未来，早于它的扫描
  // 一律 skip（这是既有语义——宽限期/退避的判定必须走在结论之前，否则会把成功的唤醒
  // 算成失败）。所以这里先跨过最后一档退避（16s）再扫。
  await advance(40_000, 8);
  await sweeper.sweepNow();
  await flush();
  assert.equal(sweeper.failuresOf(sessionId), 0, '条目被推远必须清零退避（连 gaveUp 一起解）');
  assert.equal(wakeCalls.length, attemptsAtGiveUp, '推远之后还没到点，不该有新的叫醒');
  // 清零不等于永久沉默：到了新的时刻仍然要能叫醒。
  await advance(pushedOut - now() + 1000, 6);
  await sweeper.sweepNow();
  await flush();
  assert.ok(wakeCalls.length > attemptsAtGiveUp, '推远到点之后应当重新能叫醒');
  await sweeper.dispose();
});

test('gaveUp 解除路径②：条目被**正常消化** ⇒ 同样清零（修复前两条路径都不可达）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-gaveup-2';
  const target = 900_000;
  const { sweeper, warned, snapshots, advance } = fakeSweeper(
    [{ sessionId, entries: { 'schedule-1': dueEntry(target) } }],
    { throwOnWake: true },
  );
  await advance(20_000, 24);
  await flush();
  assert.match(warned.join('\n'), /已停止自动唤醒/, '前置条件：必须已经放弃');
  assert.equal(sweeper.failuresOf(sessionId) >= 5, true);

  // 解除：条目还在文件里，但被镜像成「已消化」——这正是 #139 修完之后会发生的形态。
  snapshots.value = [{ sessionId, entries: { 'schedule-1': dueEntry(target, { dispatchedAt: target + 10 }) } }];
  sweeper.reschedule();
  await advance(60_000);
  await sweeper.sweepNow();
  await flush();
  assert.equal(sweeper.failuresOf(sessionId), 0, '已消化必须清零退避，而不只是"不再攒"');
  await sweeper.dispose();
});

test('gaveUp 解除路径③：用户改动 → 显式 rearm（重排定时器不清退避，这是接线侧的活）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-gaveup-3';
  const target = 900_000;
  const { sweeper, warned, advance } = fakeSweeper(
    [{ sessionId, entries: { 'schedule-1': dueEntry(target) } }],
    { throwOnWake: true },
  );
  await advance(20_000, 24);
  await flush();
  assert.match(warned.join('\n'), /已停止自动唤醒/);
  sweeper.reschedule();
  await sweeper.sweepNow();
  await flush();
  assert.ok(sweeper.failuresOf(sessionId) >= 5, 'reschedule 是纯重排，不该顺手清退避（否则退避形同虚设）');
  sweeper.rearm(sessionId);
  assert.equal(sweeper.failuresOf(sessionId), 0, '用户动了这条提醒 = 唯一合法的显式解除');
  await sweeper.dispose();
});

test('sidecar 文件整个消失也要清算退避（条目不在任何快照里 = 没有任何失败判据支撑它）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-gone';
  const target = 900_000;
  const { sweeper, warned, snapshots, advance } = fakeSweeper(
    [{ sessionId, entries: { 'schedule-1': dueEntry(target) } }],
    { throwOnWake: true },
  );
  await advance(20_000, 24);
  await flush();
  assert.match(warned.join('\n'), /已停止自动唤醒/);
  snapshots.value = []; // 文件删了：`listOwnershipSnapshots` 根本不会给出这个会话
  sweeper.reschedule();
  await advance(60_000);
  await sweeper.sweepNow();
  await flush();
  assert.equal(sweeper.failuresOf(sessionId), 0, '会话从快照里消失 ⇒ 退避必须被清算（否则 gaveUp 是单向门）');
  await sweeper.dispose();
});

test('读快照失败**不**清算退避（"读不到"不是"条目都消失了"）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-ioerr';
  const target = 900_000;
  let failing = false;
  let clock = 1_000_000;
  const timers = [];
  const wakeCalls = [];
  const sweeper = createExpirySweeper({
    snapshots: () => {
      if (failing) throw new Error('sidecar 目录不可读');
      return [{ sessionId, entries: { 'schedule-1': dueEntry(target) } }];
    },
    wake: () => {
      wakeCalls.push(clock);
      throw new Error('resume 不通');
    },
    wakeable: () => true,
    resolveScheduledAt: () => undefined,
    warn: () => undefined,
    now: () => clock,
    setTimeout: (handler, delay) => {
      const entry = { at: clock + delay, handler };
      timers.push(entry);
      return entry;
    },
    clearTimeout: (handle) => {
      const at = timers.indexOf(handle);
      if (at !== -1) timers.splice(at, 1);
    },
    setInterval: () => undefined,
    clearInterval: () => undefined,
  });
  await sweeper.sweepNow();
  const before = wakeCalls.length;
  assert.ok(before > 0, '前置：先攒一点失败');
  failing = true;
  await sweeper.sweepNow();
  await flush();
  assert.ok(sweeper.failuresOf(sessionId) >= 1, '瞬时读失败不该把退避清零，否则等于自己造重试风暴');
  await sweeper.dispose();
});

test('v1/v2 老条目（缺时刻）仍然回算，且回算不出时保守跳过只告警一次', async () => {
  const target = 900_000;
  const { sweeper, wakeCalls, warned } = fakeSweeper([
    { sessionId: 's-old', entries: { 'schedule-1': { delivery: 'context', createdAt: target - 60_000 } } },
  ]);
  await sweeper.sweepNow();
  await flush();
  assert.equal(wakeCalls.length, 0, '回算不出时刻就不该叫醒（宁可不投，也别把坏时刻当永久逾期反复拉）');
  assert.equal(warned.filter((w) => /无法从会话日志回算/.test(w)).length, 1, '必须留痕，且不刷日志');
  await sweeper.dispose();
});

// ── 3. 装配层：真 `apply()` + 假宿主，判据只用事件形状 ──────────────────────

test('验收②·新数据：重启后带着"已投递"条目，一次都不该被拉起', async () => {
  freshOwnershipDir();
  const sessionId = 'session-restart-fresh';
  const stale = `STALE-${Math.random().toString(36).slice(2, 8)}`;
  // 形状与 1.13+ 写下的文件一致：条目还在、带消化标记；日志里 create + dispatch 都在。
  const { session } = seedDueReminder(sessionId, stale, { dispatchedAt: Date.now() - 1000 });
  const boot = bootAssembly({ resume: () => { throw new Error('不该被唤醒'); } });
  try {
    await boot.fiber;
    await sleep(1200); // 覆盖起步扫描 + 一个退避梯子
    assert.equal(boot.resumeCalls.length, 0, '已消化的条目不得触发任何冷唤醒');
    assert.equal(deliveryOf(session, stale).spliced.length, 0, '更不能重复投递同一条');
    assert.equal(boot.warned.filter((w) => /已停止自动唤醒|冷唤醒失败/.test(w)).length, 0, '不该有任何假失败');
  } finally {
    await shutdown(boot);
  }
});

test('验收②·遗留数据：1.12.1 写下的无标记条目，最多白拉一次，之后永不再拉', async () => {
  freshOwnershipDir();
  const sessionId = 'session-restart-legacy';
  const legacy = `LEGACY-${Math.random().toString(36).slice(2, 8)}`;
  // 1.12.1 的形态：日志里 create+dispatch 都写过了，sidecar 却只有裸的 `scheduledAt`。
  const { session } = seedDueReminder(sessionId, legacy);
  session.append('schedule/change', { version: 1, operation: 'dispatch', id: 'schedule-1' });
  const boot = bootAssembly({ resume: (id) => new FakeAgent(id, session) });
  try {
    await boot.fiber;
    const first = await until(() => boot.resumeCalls.length >= 1, 3000);
    assert.ok(first, '遗留条目在修复后第一次仍会被判成到期（索引里没有可依据的事实）');
    // 自愈：唤醒把会话附着上，runtime 在 drive 开头对账，标记落进索引。
    const healed = await until(() => typeof getOwnership(sessionId, 'schedule-1')?.dispatchedAt === 'number', 5000);
    assert.ok(healed, '这次唤醒之后必须把消化标记补上（遗留数据自愈点，见 D2）');
    const calls = boot.resumeCalls.length;
    await sleep(1500);
    assert.equal(boot.resumeCalls.length, calls, '补上标记之后不得再为同一条目拉起会话');
    assert.equal(boot.warned.filter((w) => /已停止自动唤醒/.test(w)).length, 0, '遗留数据也不该攒出 gaveUp');
    assert.equal(deliveryOf(session, legacy).spliced.length, 0, '遗留条目一次都不该重投');
  } finally {
    await shutdown(boot);
  }
});

test('验收③·every：dispatch 之后索引被推进到下一次，两次 occurrence 之间不攒失败', async () => {
  freshOwnershipDir();
  const sessionId = 'session-every-advance';
  const nonce = `EVERY-${Math.random().toString(36).slice(2, 8)}`;
  // 目标时刻在过去两个间隔之外：fold 只算**最近**那次 occurrence（过期多久都只算一次），
  // 并把日志里的记录推到下一次；索引必须跟着走，否则同一条 every 永远"到期未消化"。
  const everySeconds = 300;
  const { session } = seedDueReminder(sessionId, nonce, { kind: 'every', everySeconds, overdueMs: everySeconds * 1000 + 1000 });
  const boot = bootAssembly({ resume: (id) => new FakeAgent(id, session) });
  try {
    await boot.fiber;
    const delivered = await until(() => deliveryOf(session, nonce).spliced.length >= 1, 4000);
    assert.ok(delivered, `every 第一次 occurrence 应当被投出去：${JSON.stringify(boot.warned).slice(0, 300)}`);
    assert.equal(deliveryOf(session, nonce).dispatched.length >= 1, true, '必须有 dispatch 记账');
    const entry = getOwnership(sessionId, 'schedule-1');
    assert.equal(entry?.dispatchedAt, undefined, 'every 不是"已消化"，它还有下一次');
    assert.ok(
      typeof entry?.scheduledAt === 'number' && entry.scheduledAt > Date.now(),
      `索引的到期时刻必须被推进到未来（实测 ${entry?.scheduledAt} vs now ${Date.now()}）`,
    );
    const calls = boot.resumeCalls.length;
    await sleep(1500);
    assert.equal(boot.resumeCalls.length, calls, '下一次还没到点，不该再被拉起');
    assert.equal(boot.warned.filter((w) => /冷唤醒失败|已停止自动唤醒/.test(w)).length, 0, '两次 occurrence 之间不许攒失败');
  } finally {
    await shutdown(boot);
  }
});

test('验收①·同会话第二条：第一条投完不影响第二条被冷唤醒并投递（事件形状）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-second';
  const first = `FIRST-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder(sessionId, first);
  // `resume` 回调收到 `(sessionId, defs)`：假宿主把 defs 交给新建的 agent，它的
  // `ctx.tools.register` 才转发得回来——工具是**挂载时**注册在 agent.ctx 上的。
  const boot = bootAssembly({ resume: (id, defs) => new FakeAgent(id, session, defs) });
  try {
    await boot.fiber;
    const gotFirst = await until(() => deliveryOf(session, first).spliced.length === 1, 4000);
    assert.ok(gotFirst, `第一条必须投出去：${JSON.stringify(boot.warned).slice(0, 300)}`);
    const callsAfterFirst = boot.resumeCalls.length;

    // 第二条**走真工具路径**创建（直接写 sidecar 只能等 60s 兜底 tick；真工具路径会经
    // `notifyUserChange` → `rearm` → 精确 timer，这才是用户实际会遇到的时序）。
    // 用的是第一次唤醒时真被挂载起来的那个 agent：它的 attach 已经把工具注册进 defs。
    const agent = boot.liveAgents[0];
    assert.ok(agent, '前置：第一次唤醒应当已经把会话挂起来（工具才注册得出来）');
    const createTool = boot.defs.get('tool:user_schedule_create');
    assert.ok(createTool, '前置：挂载之后 defs 里应当有 user_schedule_create');
    const second = `SECOND-${Math.random().toString(36).slice(2, 8)}`;
    const created = JSON.parse(await createTool.execute({ prompt: second, after_seconds: 1 }, { agent }));
    assert.equal(created.ok, true, `第二条提醒应当建起来：${JSON.stringify(created).slice(0, 200)}`);
    // 会话重新变冷：模拟"投完之后没人开着这条会话"。
    boot.liveAgents.length = 0;
    const gotSecond = await until(() => deliveryOf(session, second).spliced.length === 1, 6000);
    assert.ok(
      gotSecond,
      `第二条必须仍能被冷唤醒投递（实测 spliced=${deliveryOf(session, second).spliced.length}、` +
        `唤醒 ${boot.resumeCalls.length} 次、告警 ${JSON.stringify(boot.warned).slice(0, 400)}）`,
    );
    assert.equal(deliveryOf(session, second).dispatched.length >= 1, true, '第二条也要有 dispatch 记账');
    assert.ok(boot.resumeCalls.length > callsAfterFirst, '第二条应当产生新的唤醒，而不是复用第一条的那次');
  } finally {
    await shutdown(boot);
  }
});

test('投递之后条目仍在索引里但不再算到期——"摘条目"不是这次的修法（防回归到 A）', async () => {
  freshOwnershipDir();
  const sessionId = 'session-keep-entry';
  const nonce = `KEEP-${Math.random().toString(36).slice(2, 8)}`;
  const { session } = seedDueReminder(sessionId, nonce);
  const boot = bootAssembly({ resume: (id) => new FakeAgent(id, session) });
  try {
    await boot.fiber;
    assert.ok(await until(() => deliveryOf(session, nonce).spliced.length === 1, 4000));
    const entry = getOwnership(sessionId, 'schedule-1');
    // 条目**必须还在**：补偿重挂（`rearmOneShot`）在 dispatch 之后才回读 uid/附件/窗口，
    // 先摘条目就丢稳定身份 —— 这是不选「投递时同步摘 sidecar 条目」的实证理由。
    assert.ok(entry, '已投递的条目不该从索引里消失（uid/附件是补偿路径的输入）');
    assert.equal(typeof entry?.uid, 'string', '稳定身份必须留着');
    assert.deepEqual(readDueIndex(entry), { kind: 'consumed' }, '但它必须被判成已消化');
    // 而快照仍然枚举得到它（所有权语义还在），只是到期视图为空。
    const snapshot = listOwnershipSnapshots().find((s) => s.sessionId === sessionId);
    assert.ok('schedule-1' in (snapshot?.entries ?? {}), 'sidecar 的所有权语义不因为投递而失效');
  } finally {
    await shutdown(boot);
  }
});
