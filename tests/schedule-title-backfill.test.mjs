/**
 * 「上游只因 `title` 拒读」时的读路径兜底（0.1.7-rc.2 起 title 成为存量记录必填项）。
 *
 * 为什么需要这条兜底：`title` 是 **0.1.7-rc.2** 才成为必填的，而 0.1.2 / 0.1.5 /
 * 0.1.7-rc.1 写进会话日志的 `schedule/change` 记录里**没有**这个字段。上游
 * `decodeStoredTitle` 遇到缺失 / 空白 / 未 trim / 超长一律抛 `ScheduleLogError`
 * （且明确不替创建方从 prompt 派生名字）。本仓两处 `decodeScheduleChangeCompat`
 * 的失败分支是 `catch { continue; }`，于是升级内核后：
 *
 *   提醒能建、能投递、sidecar 里也有，但**旧的**提醒整条不进投影 →
 *   用户打开旧会话，自己的提醒从 dock 与定时面板上消失。
 *
 * 这是真实的产品缺陷，不是测试数据过时：删掉测试 fixture 里的 title 只是把它藏起来。
 *
 * ## 本文件钉住的三件事
 *
 *  1. **旧记录要活下来**：缺 title / title 是空白的历史记录，投影与投递两条通道
 *     都必须折得出来，且名字按 prompt 派生、逐字等于 `deriveScheduleTitle`。
 *  2. **只兜 title**：把 title 补好之后，其它任何字段的问题（缺 id / 缺 prompt /
 *     缺 scheduledAt / 多余的键 / afterSeconds 非正 / everySeconds 过短 /
 *     时间戳格式不对 / kind 未知 / 根本不是对象）**仍必须被拒**。第 2 组里每一条
 *     都是「补了 title 也不该过」的样本——这正是「不要 try 全兜住」的判据。
 *  3. **两处实现同口径**：投影（`projection.ts`）与投递（`user-tools.ts`）对同一批
 *     记录给出同一结论。只改一处就是 issue #12 那种「fold 通了、投影还是空」。
 *
 * 派生名字的具体算法不在这里重复测（那是 `deriveScheduleTitle` 自己的单测），
 * 这里只钉「等于它」，避免两处各写一份截断规则。
 * @module tests/schedule-title-backfill
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRecordTolerant, deriveScheduleTitle, SCHEDULE_TITLE_MAX } from '../lib/schedule-compat.js';
import { __decodeScheduleChangeCompatForTest as decodeChange } from '../lib/projection.js';
import { foldUserState } from '../lib/user-tools.js';
import { applyUserScheduleProjection, initUserScheduleProjection } from '../lib/projection.js';
import { freshOwnershipDir } from './helpers/ownership-state.mjs';

const FAR_FUTURE = '2999-01-01T06:00:00.000Z';

/** 一条 0.1.2 / 0.1.5 时代形状的 at 记录：**没有 title**。 */
function legacyAt(id, over = {}) {
  return { id, kind: 'at', prompt: '检查构建结果', scheduledAt: FAR_FUTURE, ...over };
}

function createEvent(record, seq = 0) {
  return { type: 'schedule/change', seq, time: 0, data: { version: 1, operation: 'create', schedule: record } };
}

// ── 1. 旧记录要活下来 ──────────────────────────────────────────────────────

test('缺 title 的历史记录：解码通过，名字按 prompt 派生', () => {
  const record = legacyAt('schedule-legacy-1');
  const decoded = decodeRecordTolerant(record);
  assert.equal(decoded.id, record.id);
  assert.equal(decoded.title, deriveScheduleTitle(record.prompt), '补齐的 title 必须与 deriveScheduleTitle 逐字一致');
  assert.equal(decoded.prompt, record.prompt, 'prompt 不得被改写');
  assert.equal(decoded.scheduledAt, record.scheduledAt);
});

test('title 只有空白的历史记录：同样按 prompt 派生（上游对「trim 后为空」与「缺失」一视同仁）', () => {
  const decoded = decodeRecordTolerant(legacyAt('schedule-legacy-2', { title: '   ' }));
  assert.equal(decoded.title, deriveScheduleTitle('检查构建结果'));
});

test('超过 120 字符的 prompt 派生出的 title 必须仍合法（否则补了也过不了上游）', () => {
  const long = '很长的提醒内容'.repeat(40);
  const decoded = decodeRecordTolerant(legacyAt('schedule-legacy-3', { prompt: long }));
  assert.ok(decoded.title.length <= SCHEDULE_TITLE_MAX, `title 长度 ${decoded.title.length} 超过上限`);
  assert.equal(decoded.title.trim(), decoded.title, 'title 必须是 trimmed');
});

test('合法的 title 原样保留（读路径不规范化用户录入的名字）', () => {
  const decoded = decodeRecordTolerant(legacyAt('schedule-legacy-4', { title: '我起的名字' }));
  assert.equal(decoded.title, '我起的名字');
});

test('投影通道：缺 title 的 create 事件仍进 active（升级内核后旧提醒不能从面板消失）', () => {
  freshOwnershipDir();
  const record = legacyAt('schedule-legacy-proj');
  let state = initUserScheduleProjection({ id: 'session-title-proj' });
  state = applyUserScheduleProjection(state, createEvent(record));
  assert.equal(state.active.length, 1, '缺 title 的历史记录被静默跳过了——旧会话的提醒会全部消失');
  assert.equal(state.active[0].title, deriveScheduleTitle(record.prompt));
});

test('投递通道：缺 title 的 create 事件仍能 fold（否则到点不投递）', () => {
  freshOwnershipDir();
  const record = legacyAt('schedule-legacy-fold');
  const log = [createEvent(record)];
  const session = {
    header: { id: 'session-title-fold' },
    ownEvents: () => log,
    inheritedEventCount: 0,
  };
  const { folded } = foldUserState(session);
  assert.equal(folded.active.length, 1, '缺 title 的历史记录在投递通道里被丢了');
  assert.equal(folded.active[0].title, deriveScheduleTitle(record.prompt));
});

// ── 2. 只兜 title：其余坏数据照旧拒绝 ──────────────────────────────────────

/** 一条记录「除了 title 之外」的毛病 → 补了 title 也必须抛。 */
const STILL_REJECTED = [
  ['缺 id', { kind: 'at', prompt: '检查构建结果', scheduledAt: FAR_FUTURE }],
  ['缺 prompt', { id: 's', kind: 'at', scheduledAt: FAR_FUTURE }],
  ['缺 scheduledAt', { id: 's', kind: 'at', prompt: '检查构建结果' }],
  ['多一个未知键', { id: 's', kind: 'at', prompt: '检查构建结果', scheduledAt: FAR_FUTURE, extra: 1 }],
  ['非对象（字符串）', 'not-a-record'],
  ['非对象（数组）', []],
  ['null', null],
];

for (const [name, record] of STILL_REJECTED) {
  test(`补了 title 也不该过：${name}`, () => {
    assert.throws(() => decodeRecordTolerant(record), Error, `${name} 被放行了——兜底越界成了「什么都接受」`);
    // 两处实现同口径：投影通道同样拒。
    assert.throws(() => decodeChange({ version: 1, operation: 'create', schedule: record }), Error);
  });
}

/**
 * 这些样本**带了 title**，被拒的理由根本与 title 无关——兜底不该被它们触发，
 * 更不该把它们补成合法记录。它们同时证明「兜底只认 title 那几条诊断」。
 */
const REJECTED_FOR_OTHER_REASONS = [
  ['afterSeconds 非正', { id: 's', kind: 'after', title: 't', prompt: 'x', afterSeconds: 0, scheduledAt: FAR_FUTURE }],
  ['everySeconds 过短', { id: 's', kind: 'every', title: 't', prompt: 'x', everySeconds: 5, scheduledAt: FAR_FUTURE }],
  ['scheduledAt 不是 RFC3339', { id: 's', kind: 'at', title: 't', prompt: 'x', scheduledAt: 'tomorrow' }],
  ['kind 未知', { id: 's', kind: 'whenever', title: 't', prompt: 'x', scheduledAt: FAR_FUTURE }],
  ['prompt 未 trim', { id: 's', kind: 'at', title: 't', prompt: ' x ', scheduledAt: FAR_FUTURE }],
];

for (const [name, record] of REJECTED_FOR_OTHER_REASONS) {
  test(`与 title 无关的拒读照旧抛：${name}`, () => {
    assert.throws(() => decodeRecordTolerant(record), Error);
    assert.throws(() => decodeChange({ version: 1, operation: 'create', schedule: record }), Error);
  });
}

test('「缺 title + 缺别的字段」必须拒（补完 title 会暴露真正的问题，不能吞掉）', () => {
  // 这条是兜底最容易越界的一格：上游先校 title 再校键集，若不看补齐后重试的错误，
  // 就会把「补了 title 但仍不合法」的记录也当成可读。
  assert.throws(
    () => decodeRecordTolerant({ id: 's', kind: 'at', prompt: '检查构建结果' }),
    /must contain exactly/,
  );
  assert.throws(
    () => decodeChange({ version: 1, operation: 'create', schedule: { id: 's', kind: 'at', prompt: 'x' } }),
    /must contain exactly/,
  );
});

test('「缺 title + 多余的键」必须拒（补 title 不能顺手把键集放宽）', () => {
  assert.throws(
    () => decodeRecordTolerant(legacyAt('s', { bogus: true })),
    /must contain exactly/,
  );
});

// ── 3. 两处实现同口径 ─────────────────────────────────────────────────────

test('投影与投递对同一批记录给出同一结论（含一条坏记录）', () => {
  freshOwnershipDir();
  const good = legacyAt('schedule-ok');
  const bad = { id: 'schedule-bad', kind: 'at', prompt: '坏记录' }; // 缺 scheduledAt，且缺 title
  const events = [createEvent(good, 0), createEvent(bad, 1)];

  let state = initUserScheduleProjection({ id: 'session-title-both' });
  for (const event of events) state = applyUserScheduleProjection(state, event);
  const projectionIds = state.active.map((entry) => entry.id).sort();

  const session = { header: { id: 'session-title-both' }, ownEvents: () => events, inheritedEventCount: 0 };
  const foldIds = foldUserState(session).folded.active.map((entry) => entry.id).sort();

  assert.deepEqual(projectionIds, ['schedule-ok'], '投影通道：只该留下合法那条');
  assert.deepEqual(foldIds, projectionIds, '两条通道结论分叉——只改了一处');
});
