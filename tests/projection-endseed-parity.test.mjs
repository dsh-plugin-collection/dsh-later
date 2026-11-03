/**
 * `session/end-seed` 两通道口径一致性回归（issue #11）。
 *
 * ## 要钉住的事实
 *
 * 内核**每次冷恢复会话**都在日志尾部补一条 `session/end-seed {}`
 * （`dsh-session/lib/index.js:1428`；0.1.2-rc.1 是 `:1322`，措辞不同但同样只发
 * `{}`——不是只有 fork 才发）。旧投影见该事件即清空 active，而投递通道
 * （`foldUserState`）根本不看它，于是两条通道分叉：**提醒到点照发，dock 与侧栏
 * 却是空的**，用户看不见也就取消不掉。本文件就是这个分叉的复发防线。
 *
 * ## 为什么判据是 `inheritedEventCount`，不是事件形状
 *
 * 「丢掉继承前缀」（AC-07，fork）与「留下本会话自己的历史」（#11）这两件事必须
 * 用**同一个**判据分开，而唯一同时满足两代的判据就是 `init(header,
 * inheritedEventCount)` 的第二参数——投递通道 `readFoldInput` 吃的是同一个数字：
 *  - 0.1.5+ 的 fork 边界是 `end-seed {inherited:true}`、resume 边界是 `end-seed {}`；
 *  - **0.1.2-rc.1 两种都只发 `{}`**（那代根本没有 `inherited` 字段），按 `data`
 *    形状分派会把那一代的 fork 隔离一起弄坏；
 *  - 而 9 代的 `dsh-session-projection` 都在 `def.init(session.header,
 *    session.inheritedEventCount)` 处传这个第二参数（逐代 grep 调用点核实）。
 *
 * ## 三条判据
 *
 *  (a) 同会话重放（`create → end-seed({})`）后投影仍看得见那条提醒；
 *  (b) 真正的 fork 继承前缀（带 `inheritedEventCount` 的 header）仍被丢弃；
 *  (c) **同一份事件序列下，投递通道 `foldUserState` 的活动集合与投影 view 的活动
 *      集合相等**——这条才是牙：(a)(b) 各自看着都对，只有把它们放进同一个断言里，
 *      「两条通道各判一次」的写法才不可能再悄悄分叉。
 *
 * @module tests/projection-endseed-parity
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// 先导入 helper：它在求值时就把 sidecar 指向一次性临时目录（见该文件的历史教训）。
import { freshOwnershipDir, markOwnership } from './helpers/ownership-state.mjs';
import {
  applyUserScheduleProjection,
  initUserScheduleProjection,
  viewUserScheduleProjection,
} from '../lib/projection.js';
import { foldUserState } from '../lib/user-tools.js';
import { recordPaused } from '../lib/ownership-store.js';
import { OWNED_EVENT } from '../lib/domain.js';

const atSchedule = {
  id: 'schedule-1',
  kind: 'at',
  prompt: '检查构建结果',
  scheduledAt: '2999-01-01T06:00:00.000Z',
};
const secondSchedule = {
  id: 'schedule-2',
  kind: 'after',
  prompt: '看一眼前端构建',
  afterSeconds: 900,
  scheduledAt: '2999-01-01T07:00:00.000Z',
};
const everySchedule = {
  id: 'schedule-3',
  kind: 'every',
  prompt: '检查服务状态',
  everySeconds: 300,
  scheduledAt: '2999-01-01T07:00:00.000Z',
};

/** 一条 `schedule/change` 事件（与 dsh-schedule 完全兼容）。 */
function changeEvent(data, seq) {
  return { type: 'schedule/change', seq, time: 0, data: { version: 1, ...data } };
}
const createEvent = (schedule, seq) => changeEvent({ operation: 'create', schedule }, seq);
const deleteEvent = (id, seq) => changeEvent({ operation: 'delete', id }, seq);
const dispatchEvent = (id, seq, acceptedAt) =>
  changeEvent(
    acceptedAt === undefined ? { operation: 'dispatch', id } : { operation: 'dispatch', id, acceptedAt },
    seq,
  );
const ownedEvent = (id, seq) => ({
  type: OWNED_EVENT,
  seq,
  time: 0,
  data: { version: 1, operation: 'add', id },
});
/** 内核补的边界事件：`data` 省略即 resume 的 `{}`。 */
const endSeedEvent = (seq, data) => ({ type: 'session/end-seed', seq, time: 0, data: data ?? {} });

/**
 * 投递通道的会话替身：现代内核形状（`ownEvents()` + `inheritedEventCount` + `seq`），
 * `ownEvents()` 每次返回**新数组**——与内核 `snapshotEvents(offset)` 一致，不许 memo。
 *
 * @param log - 整份日志（含继承前缀），绝对 seq。
 * @param inheritedEventCount - 继承前缀长度。
 */
function deliverySession(sessionId, log, inheritedEventCount) {
  return {
    header: { id: sessionId },
    inheritedEventCount,
    get seq() {
      return log.length;
    },
    ownEvents: () => Object.freeze(log.slice(inheritedEventCount)),
  };
}

/** 投影通道：把整份日志从 init 起折一遍，返回状态。 */
function foldProjection(sessionId, inheritedEventCount, log) {
  let state = initUserScheduleProjection({ id: sessionId }, inheritedEventCount);
  for (const event of log) state = applyUserScheduleProjection(state, event);
  return state;
}

/** 投影 view 里的**活动** schedule id 集合（暂停项不在日志里，不参与两通道比较）。 */
function projectionActiveIds(sessionId, inheritedEventCount, log) {
  const view = viewUserScheduleProjection(foldProjection(sessionId, inheritedEventCount, log));
  return view.schedules
    .filter((item) => item.status !== 'paused')
    .map((item) => item.schedule_id ?? item.id)
    .sort();
}

/** 投递通道的活动 schedule id 集合（与 `user_schedule_list` 的取法同一条：`folded.active ∩ owned`）。 */
function deliveryActiveIds(sessionId, inheritedEventCount, log) {
  const state = foldUserState(deliverySession(sessionId, log, inheritedEventCount));
  return state.folded.active
    .filter((record) => state.owned.has(record.id))
    .map((record) => record.id)
    .sort();
}

// ── (a) 同会话重放：end-seed({}) 之后投影仍然看得见自己的提醒 ──────────────

test('(a) create → end-seed({}) 重放后，投影 active 仍有那条提醒', () => {
  freshOwnershipDir();
  const sessionId = 'session-resume-replay';
  markOwnership(sessionId, atSchedule.id, 'user');
  const log = [createEvent(atSchedule, 0), ownedEvent(atSchedule.id, 1), endSeedEvent(2)];
  const view = viewUserScheduleProjection(foldProjection(sessionId, 0, log));
  assert.equal(view.schedules.length, 1, '尾部重放边界不该抹掉本会话的提醒（#11）');
  assert.equal(view.schedules[0].schedule_id, atSchedule.id);
  assert.equal(view.schedules[0].prompt, atSchedule.prompt);
});

test('(a+) end-seed({}) 是无关事件：fold 返回同一引用，不额外推一帧', () => {
  freshOwnershipDir();
  const sessionId = 'session-resume-identity';
  markOwnership(sessionId, atSchedule.id, 'user');
  const before = foldProjection(sessionId, 0, [createEvent(atSchedule, 0), ownedEvent(atSchedule.id, 1)]);
  assert.equal(applyUserScheduleProjection(before, endSeedEvent(2)), before);
});

test('(a) 重放边界之后新加的提醒照常进视图', () => {
  freshOwnershipDir();
  const sessionId = 'session-resume-then-create';
  markOwnership(sessionId, atSchedule.id, 'user');
  markOwnership(sessionId, secondSchedule.id, 'user');
  const log = [
    createEvent(atSchedule, 0),
    ownedEvent(atSchedule.id, 1),
    endSeedEvent(2), // 冷恢复补的边界
    createEvent(secondSchedule, 3), // 重启后用户又建了一条
    ownedEvent(secondSchedule.id, 4),
    endSeedEvent(5), // 再一次冷恢复
  ];
  const ids = projectionActiveIds(sessionId, 0, log);
  assert.deepEqual(ids, ['schedule-1', 'schedule-2'].sort(), '两条都必须在');
});

test('(a) 重放后 every 的 dispatch 仍能推进（边界没把记录折丢）', () => {
  freshOwnershipDir();
  const sessionId = 'session-resume-then-dispatch';
  markOwnership(sessionId, everySchedule.id, 'user');
  const accepted = '2999-01-01T08:00:00.000Z';
  const log = [
    createEvent(everySchedule, 0),
    ownedEvent(everySchedule.id, 1),
    endSeedEvent(2),
    dispatchEvent(everySchedule.id, 3, accepted),
  ];
  const state = foldProjection(sessionId, 0, log);
  const view = viewUserScheduleProjection(state);
  assert.equal(view.schedules.length, 1, 'every dispatch 后仍是一条活动提醒');
  const target = Date.parse(view.schedules[0].scheduled_at);
  assert.ok(target > Date.parse(accepted), '周期应推进到 accepted 之后的下一个整点间隔');
  assert.equal((target - Date.parse(everySchedule.scheduledAt)) % (everySchedule.everySeconds * 1000), 0);
});

test('(a) 暂停项不因重放边界多出第三种状态（paused 以 sidecar 重读为准）', () => {
  freshOwnershipDir();
  const sessionId = 'session-resume-paused';
  recordPaused(sessionId, {
    uid: 'uid-replay-1',
    prompt: atSchedule.prompt,
    delivery: 'user',
    kind: 'after',
    remainingSeconds: 300,
    originalScheduledAt: atSchedule.scheduledAt,
    originalAfterSeconds: 900,
    lastScheduleId: atSchedule.id,
    pausedAt: 1700000000000,
  });
  const log = [endSeedEvent(0)];
  const schedules = viewUserScheduleProjection(foldProjection(sessionId, 0, log)).schedules;
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].status, 'paused', '暂停项必须仍是 paused，不能变成 active 或消失');
});

// ── (b) 真 fork 继承前缀：仍必须丢（AC-07，别放宽）────────────────────────

test('(b) fork 继承前缀按 inheritedEventCount 丢弃，子会话看不见父提醒', () => {
  freshOwnershipDir();
  const childSessionId = 'session-fork-child';
  // 父会话自己的日志：一条用户提醒 + 它的重放边界
  const parentLog = [
    createEvent(atSchedule, 0),
    ownedEvent(atSchedule.id, 1),
    endSeedEvent(2), // 父会话冷恢复补的 {}
  ];
  const inheritedEventCount = parentLog.length; // 3
  const childLog = [
    ...parentLog,
    endSeedEvent(3, { inherited: true }), // 0.1.5+ 的 fork 切点标记
    createEvent(secondSchedule, 4),
    ownedEvent(secondSchedule.id, 5),
  ];
  // 子会话的 sidecar 只有子会话的归属；父 id 在子的键下不存在
  markOwnership(childSessionId, secondSchedule.id, 'user');

  const ids = projectionActiveIds(childSessionId, inheritedEventCount, childLog);
  assert.deepEqual(ids, ['schedule-2'], '前缀里的父提醒必须整段丢掉（AC-07）');
});

test('(b) fork 切点标记换成 0.1.2-rc.1 的形状（只有 {}）结论不变', () => {
  freshOwnershipDir();
  const childSessionId = 'session-fork-child-rc1';
  markOwnership(childSessionId, secondSchedule.id, 'user');
  const childLog = [
    createEvent(atSchedule, 0), // 父前缀
    ownedEvent(atSchedule.id, 1),
    endSeedEvent(2), // 0.1.2-rc.1：fork 边界也只发 {}
    createEvent(secondSchedule, 3),
    ownedEvent(secondSchedule.id, 4),
  ];
  // 那代的 inheritedEventCount 同样是 2（构造器按 header.isSeeded 校验）
  assert.deepEqual(projectionActiveIds(childSessionId, 2, childLog), ['schedule-2']);
});

test('(b) 前缀长度给错也不漏：切点之前的每一条都不进状态', () => {
  freshOwnershipDir();
  const sessionId = 'session-fork-guard';
  markOwnership(sessionId, atSchedule.id, 'user');
  markOwnership(sessionId, secondSchedule.id, 'user');
  // 前缀 = 4 条（含一条 delete 与一条 dispatch），自有段只有 schedule-2
  const log = [
    createEvent(atSchedule, 0),
    ownedEvent(atSchedule.id, 1),
    deleteEvent(atSchedule.id, 2),
    createEvent(secondSchedule, 3),
    endSeedEvent(4, { inherited: true }),
    ownedEvent(secondSchedule.id, 5),
  ];
  // 切点取 4：schedule-2 的 create 在前缀里 → 丢；父的 schedule-1 也在前缀 → 丢。
  assert.deepEqual(projectionActiveIds(sessionId, 4, log), []);
  // 切点取 3：schedule-2 的 create 属于自有段 → 留；父的 schedule-1 被前缀里的 delete 打掉。
  assert.deepEqual(projectionActiveIds(sessionId, 3, log), ['schedule-2']);
});

// ── (c) 两通道一致性：同一份序列，两个 active 集合必须相等 ────────────────

/**
 * (c) 的口径：投影 view 与投递通道 `foldUserState` 看到的**活动 schedule id 集合**
 * 逐场景相等。暂停项排除在外——pause 不写日志（见 `projection.ts` 的 view 注释），
 * 投递通道本来就看不见它，拿它进比较会把「两边都看不见」误判成一致或误判成分叉。
 */
const parityScenarios = [
  {
    name: '普通一条提醒（无边界）',
    events: (base) => [createEvent(atSchedule, base), ownedEvent(atSchedule.id, base + 1)],
  },
  {
    name: '冷恢复重放边界（#11 的现场）',
    events: (base) => [
      createEvent(atSchedule, base),
      ownedEvent(atSchedule.id, base + 1),
      endSeedEvent(base + 2),
    ],
  },
  {
    name: '重放边界之后再建一条',
    events: (base) => [
      createEvent(atSchedule, base),
      ownedEvent(atSchedule.id, base + 1),
      endSeedEvent(base + 2),
      createEvent(secondSchedule, base + 3),
      ownedEvent(secondSchedule.id, base + 4),
      endSeedEvent(base + 5),
    ],
  },
  {
    name: 'every 到点 dispatch',
    events: (base) => [
      createEvent(everySchedule, base),
      ownedEvent(everySchedule.id, base + 1),
      endSeedEvent(base + 2),
      dispatchEvent(everySchedule.id, base + 3, '2999-01-01T08:00:00.000Z'),
    ],
  },
  {
    name: '重放后被删除（用户取消）',
    events: (base) => [
      createEvent(atSchedule, base),
      ownedEvent(atSchedule.id, base + 1),
      endSeedEvent(base + 2),
      deleteEvent(atSchedule.id, base + 3),
    ],
  },
];

for (const scenario of parityScenarios) {
  test(`(c) 两通道一致 · ${scenario.name}`, () => {
    freshOwnershipDir();
    const sessionId = 'session-parity';
    markOwnership(sessionId, atSchedule.id, 'user');
    markOwnership(sessionId, secondSchedule.id, 'user');
    markOwnership(sessionId, everySchedule.id, 'user');
    const log = scenario.events(0);
    const projection = projectionActiveIds(sessionId, 0, log);
    const delivery = deliveryActiveIds(sessionId, 0, log);
    assert.deepEqual(
      projection,
      delivery,
      `同一份日志上两通道的 active 集合分叉了：投影=${JSON.stringify(projection)} 投递=${JSON.stringify(delivery)}`,
    );
  });
}

test('(c) 两通道一致 · fork 继承前缀（两侧都必须只剩子会话自己的）', () => {
  freshOwnershipDir();
  const childSessionId = 'session-parity-fork';
  markOwnership(childSessionId, secondSchedule.id, 'user');
  const log = [
    createEvent(atSchedule, 0), // 父前缀（父的归属在父的 sidecar 键下，子键没有）
    ownedEvent(atSchedule.id, 1),
    endSeedEvent(2, { inherited: true }),
    createEvent(secondSchedule, 3),
    ownedEvent(secondSchedule.id, 4),
    endSeedEvent(5), // 子会话冷恢复补的尾部边界
  ];
  const projection = projectionActiveIds(childSessionId, 3, log);
  const delivery = deliveryActiveIds(childSessionId, 3, log);
  assert.deepEqual(projection, ['schedule-2']);
  assert.deepEqual(delivery, ['schedule-2']);
  assert.deepEqual(projection, delivery);
});

test('(c) 一致性判据本身有牙：伪造一个「见 end-seed 就清空」的投影会判红', () => {
  freshOwnershipDir();
  const sessionId = 'session-parity-teeth';
  markOwnership(sessionId, atSchedule.id, 'user');
  const log = [createEvent(atSchedule, 0), ownedEvent(atSchedule.id, 1), endSeedEvent(2)];
  // 旧口径的等价实现：在尾部把 active 抹掉。用它证明上面那条断言真的会红，
  // 而不是两边恰好都空。
  let poisoned = foldProjection(sessionId, 0, log);
  poisoned = { ...poisoned, active: [] };
  const oldView = viewUserScheduleProjection(poisoned)
    .schedules.filter((item) => item.status !== 'paused')
    .map((item) => item.schedule_id ?? item.id)
    .sort();
  assert.deepEqual(oldView, [], '构造旧口径：投影为空');
  assert.deepEqual(deliveryActiveIds(sessionId, 0, log), ['schedule-1'], '投递通道不受影响');
  assert.notDeepEqual(oldView, deliveryActiveIds(sessionId, 0, log));
});
