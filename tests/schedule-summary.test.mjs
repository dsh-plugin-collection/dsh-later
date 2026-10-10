/**
 * 定时摘要纯逻辑单测（src/schedule-summary.ts → lib/schedule-summary.js）。
 *
 * 覆盖 issue #17 的契约形状：
 *  - `buildScheduleSummary`：会话 id → { count, nextAt, state }（无任务不出现）
 *  - `sameScheduleSummary`：内容等价的引用稳定性判据（React 重渲染的前提）
 *  - `summarizeScheduleGroup`：分组聚合（会话数 / 任务数 / 最早触发 / 最高优先级）
 *
 * @module tests/schedule-summary.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScheduleSummary,
  schedulesOfProjection,
  sameScheduleSummary,
  summarizeScheduleGroup,
} from '../lib/schedule-summary.js';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const listOf = (byId) => ({ byId });

test('schedulesOfProjection：形状非法一律当作无任务', () => {
  assert.equal(schedulesOfProjection(undefined), undefined);
  assert.equal(schedulesOfProjection({}), undefined);
  assert.equal(schedulesOfProjection({ userSchedules: null }), undefined);
  assert.equal(schedulesOfProjection({ userSchedules: { schedules: 'nope' } }), undefined);
  assert.deepEqual(schedulesOfProjection({ userSchedules: { schedules: [] } }), []);
});

test('buildScheduleSummary：取数量/最早触发/状态，无任务会话不出现', () => {
  const summary = buildScheduleSummary(
    listOf({
      'session-a': {
        projectionValues: {
          userSchedules: { schedules: [{ scheduled_at: iso(30 * 60_000) }, { scheduled_at: iso(10 * 60_000) }] },
        },
      },
      'session-b': { projectionValues: { userSchedules: { schedules: [] } } },
      'session-c': {},
      'session-d': undefined,
    }),
    NOW,
  );
  assert.equal(summary.size, 1);
  const a = summary.get('session-a');
  assert.equal(a.count, 2);
  assert.equal(a.nextAt, NOW + 10 * 60_000);
  assert.equal(a.pausedCount, 0);
  assert.equal(a.state, 'scheduled');
});

test('buildScheduleSummary：状态按快照时刻分档（urgent ≤5min / overdue 已过期）', () => {
  const build = (offsetMs) =>
    buildScheduleSummary(listOf({ s: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(offsetMs) }] } } } }), NOW).get('s')?.state;
  assert.equal(build(6 * 60_000), 'scheduled');
  assert.equal(build(5 * 60_000), 'urgent');
  assert.equal(build(1_000), 'urgent');
  assert.equal(build(-1_000), 'overdue');
});

test('buildScheduleSummary：暂停项计入 count/pausedCount 但不参与 nextAt', () => {
  const summary = buildScheduleSummary(
    listOf({
      s: {
        projectionValues: {
          userSchedules: {
            schedules: [
              { scheduled_at: iso(-60_000), status: 'paused', remaining_seconds: 600 },
              { scheduled_at: iso(20 * 60_000) },
            ],
          },
        },
      },
      onlyPaused: {
        projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(-60_000), status: 'paused' }] } },
      },
    }),
    NOW,
  );
  const s = summary.get('s');
  assert.equal(s.count, 2);
  assert.equal(s.pausedCount, 1);
  assert.equal(s.nextAt, NOW + 20 * 60_000);
  assert.equal(s.state, 'scheduled');

  const onlyPaused = summary.get('onlyPaused');
  assert.equal(onlyPaused.count, 1);
  assert.equal(onlyPaused.pausedCount, 1);
  assert.equal(onlyPaused.nextAt, undefined);
  // 全暂停没有排定时刻：状态退化为中性 scheduled（消费方另看 pausedCount）。
  assert.equal(onlyPaused.state, 'scheduled');
});

test('sameScheduleSummary：逐字段判等，键集合不同即不等', () => {
  const base = buildScheduleSummary(
    listOf({ s: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60_000) }] } } } }),
    NOW,
  );
  const same = buildScheduleSummary(
    listOf({ s: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60_000) }] } } } }),
    NOW,
  );
  const later = buildScheduleSummary(
    listOf({ s: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60_000) }] } } } }),
    NOW + 60_000,
  );
  const extra = buildScheduleSummary(
    listOf({
      s: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60_000) }] } } },
      t: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60_000) }] } } },
    }),
    NOW,
  );
  assert.equal(sameScheduleSummary(base, base), true);
  assert.equal(sameScheduleSummary(base, same), true);
  assert.equal(sameScheduleSummary(base, later), false, '状态变化必须判为不等');
  assert.equal(sameScheduleSummary(base, extra), false, '键集合变化必须判为不等');
});

test('summarizeScheduleGroup：聚合会话数/任务数/最早触发/最高优先级', () => {
  const summary = buildScheduleSummary(
    listOf({
      a: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(30 * 60_000) }] } } },
      b: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(2 * 60_000) }, { scheduled_at: iso(60 * 60_000), status: 'paused' }] } } },
      c: { projectionValues: { userSchedules: { schedules: [] } } },
    }),
    NOW,
  );
  const group = summarizeScheduleGroup(summary, ['a', 'b', 'c', 'missing']);
  assert.equal(group.sessions, 2);
  assert.equal(group.count, 3);
  assert.equal(group.pausedCount, 1);
  assert.equal(group.nextAt, NOW + 2 * 60_000);
  assert.equal(group.state, 'urgent');
});

test('summarizeScheduleGroup：空组返回零值且无 state', () => {
  const group = summarizeScheduleGroup(new Map(), ['x']);
  assert.deepEqual(group, { sessions: 0, count: 0, pausedCount: 0, state: undefined });
});

test('summarizeScheduleGroup：overdue 优先级高于 urgent', () => {
  const summary = buildScheduleSummary(
    listOf({
      urgent: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(60_000) }] } } },
      overdue: { projectionValues: { userSchedules: { schedules: [{ scheduled_at: iso(-60_000) }] } } },
    }),
    NOW,
  );
  assert.equal(summarizeScheduleGroup(summary, ['urgent', 'overdue']).state, 'overdue');
});
