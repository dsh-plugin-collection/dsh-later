/**
 * 侧栏「定时状态」badge 纯逻辑单测（src/presence.ts → lib/presence.js）。
 *
 * 覆盖：任务概要归纳（count/nextAt）、状态判定（scheduled/urgent/overdue）、
 * 相对时间标签分档（即将发送/分/小时/明天/日期/到期时钟面）。
 * @module tests/presence.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeStateFor,
  hoverScheduleStatus,
  PRESENCE_URGENT_WINDOW_MS,
  progressOf,
  relativeFireLabel,
  summarizeSchedules,
} from '../lib/presence.js';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

test('summarizeSchedules：取可解析数量与最早触发时刻', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(10 * 60_000) },
    { scheduled_at: iso(2 * 60_000) },
    { scheduled_at: 'not-a-time' },
    {},
  ]);
  assert.equal(entry.count, 2);
  assert.equal(entry.nextAt, NOW + 2 * 60_000);

  assert.deepEqual(summarizeSchedules([]), { count: 0, pausedCount: 0 });
  assert.deepEqual(summarizeSchedules(undefined), { count: 0, pausedCount: 0 });
  assert.deepEqual(summarizeSchedules([{ scheduled_at: 'not-a-time' }]), { count: 0, pausedCount: 0 });
});

test('summarizeSchedules：兼容 scheduledAt（runtime 记录形状）', () => {
  const entry = summarizeSchedules([{ scheduledAt: iso(5 * 60_000) }]);
  assert.equal(entry.count, 1);
  assert.equal(entry.nextAt, NOW + 5 * 60_000);
});

test('badgeStateFor：三态判定', () => {
  assert.equal(badgeStateFor(NOW + 2 * 60_000, NOW), 'urgent');
  assert.equal(badgeStateFor(NOW + PRESENCE_URGENT_WINDOW_MS, NOW), 'urgent');
  assert.equal(badgeStateFor(NOW + PRESENCE_URGENT_WINDOW_MS + 1, NOW), 'scheduled');
  assert.equal(badgeStateFor(NOW - 1, NOW), 'overdue');
  assert.equal(badgeStateFor(NOW, NOW), 'overdue');
  assert.equal(badgeStateFor(undefined, NOW), 'scheduled');
});

const zhLabels = {
  imminent: '即将发送',
  minutes: (m) => `${m} 分后`,
  hours: (h) => `${h} 小时后`,
  tomorrow: (time) => `明天 ${time}`,
  clock: (time) => time,
  date: (date, time) => `${date} ${time}`,
};

test('relativeFireLabel：到期/即将/分钟/小时/明天/日期 分档', () => {
  assert.equal(relativeFireLabel(NOW - 60_000, NOW, zhLabels, () => '14:00', () => '9月5日'), '14:00');
  assert.equal(relativeFireLabel(NOW + 30_000, NOW, zhLabels, () => '14:01', () => '9月5日'), '即将发送');
  assert.equal(relativeFireLabel(NOW + 5 * 60_000, NOW, zhLabels, () => '14:05', () => '9月5日'), '5 分后');
  assert.equal(relativeFireLabel(NOW + 2 * 3_600_000, NOW, zhLabels, () => '14:00', () => '9月5日'), '2 小时后');
  assert.equal(
    relativeFireLabel(NOW + 26 * 3_600_000, NOW, zhLabels, () => '14:00', () => '9月6日'),
    '明天 14:00',
  );
  assert.equal(
    relativeFireLabel(NOW + 50 * 3_600_000, NOW, zhLabels, () => '14:00', () => '9月7日'),
    '9月7日 14:00',
  );
});

const zhHover = {
  hoverScheduleStatus: '有 {n} 条定时提醒，下次 {time}',
  hoverScheduleOverdue: '有 {n} 条定时提醒已到期，等待发送',
};

test('hoverScheduleStatus：有任务时给出「条数 + 下次触发」文案', () => {
  // 30 分钟 > 5 分钟紧急窗口，故为 scheduled。
  const entry = summarizeSchedules([{ scheduled_at: iso(30 * 60_000) }]);
  const out = hoverScheduleStatus(entry, NOW, zhLabels, zhHover, () => '14:30', () => '9月5日');
  assert.equal(out.tone, 'scheduled');
  assert.equal(out.label, '有 1 条定时提醒，下次 30 分后');
});

test('hoverScheduleStatus：紧急窗口升级 tone、文案保留相对时间', () => {
  const entry = summarizeSchedules([{ scheduled_at: iso(2 * 60_000) }]);
  const out = hoverScheduleStatus(entry, NOW, zhLabels, zhHover, () => '14:02', () => '9月5日');
  assert.equal(out.tone, 'urgent');
  assert.equal(out.label, '有 1 条定时提醒，下次 2 分后');
});

test('hoverScheduleStatus：紧急窗口边界为闭区间（≤5min 为 urgent）', () => {
  const at = (ms) => hoverScheduleStatus(
    summarizeSchedules([{ scheduled_at: iso(ms) }]),
    NOW, zhLabels, zhHover, () => '14:00', () => '9月5日',
  ).tone;
  assert.equal(at(PRESENCE_URGENT_WINDOW_MS), 'urgent');
  assert.equal(at(PRESENCE_URGENT_WINDOW_MS + 1), 'scheduled');
});

test('hoverScheduleStatus：到期走 overdue 专用文案（不带时间槽）', () => {
  const entry = summarizeSchedules([{ scheduled_at: iso(-60_000) }]);
  const out = hoverScheduleStatus(entry, NOW, zhLabels, zhHover, () => '13:59', () => '9月5日');
  assert.equal(out.tone, 'overdue');
  assert.equal(out.label, '有 1 条定时提醒已到期，等待发送');
});

test('hoverScheduleStatus：多条任务汇总为总条数', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(3 * 60_000) },
    { scheduled_at: iso(30 * 60_000) },
  ]);
  const out = hoverScheduleStatus(entry, NOW, zhLabels, zhHover, () => '14:03', () => '9月5日');
  assert.equal(out.label, '有 2 条定时提醒，下次 3 分后');
});

test('hoverScheduleStatus：nextAt 缺失时退化为 overdue 文案（不出现 {time} 残留）', () => {
  const out = hoverScheduleStatus({ count: 1 }, NOW, zhLabels, zhHover, () => '14:00', () => '9月5日');
  assert.equal(out.label.includes('{time}'), false);
  assert.equal(out.label, '有 1 条定时提醒已到期，等待发送');
});

/* ==================== 暂停项不得参与「已到期」判定（本轮修复） ==================== */
/**
 * 根因：暂停项的 wire `scheduled_at` 是 `originalScheduledAt`（原目标时刻），
 * 暂停时它通常已成过去；若照常参与取最小值，侧栏会算出 nextAt <= now →
 * 显示「已到期，等待发送」，但这条提醒其实已冻结、不会触发（用户实测报告）。
 */
test('回归：暂停项不计入 nextAt（否则会误报「已到期」）', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(-60_000), status: 'paused' }, // 原目标已过去
  ]);
  assert.equal(entry.count, 1, '暂停项仍计入数量');
  assert.equal(entry.pausedCount, 1);
  assert.equal(entry.nextAt, undefined, '暂停项没有排定的触发时刻 → 不得给出 nextAt');
  // 关键：没有 nextAt 时 badgeStateFor 不再返回 overdue
  assert.equal(badgeStateFor(entry.nextAt, NOW), 'scheduled');
});

test('混合：暂停项被排除，活动项决定 nextAt', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(-120_000), status: 'paused' },  // 已过去的暂停项
    { scheduled_at: iso(10 * 60_000) },                 // 活动项
  ]);
  assert.equal(entry.count, 2, '两者都计入数量');
  assert.equal(entry.pausedCount, 1);
  assert.equal(entry.nextAt, NOW + 10 * 60_000, 'nextAt 只由活动项决定，不被暂停项拉早');
  assert.equal(badgeStateFor(entry.nextAt, NOW), 'scheduled');
});

test('回归：暂停项不会把 badge 拉成 overdue（用户报告的场景）', () => {
  // 暂停一条已过原目标时刻的提醒 → 绝不能显示"已到期"
  const entry = summarizeSchedules([{ scheduled_at: iso(-1), status: 'paused' }]);
  assert.notEqual(badgeStateFor(entry.nextAt, NOW), 'overdue');
});

test('非暂停项仍照常触发 overdue（回归保护）', () => {
  const entry = summarizeSchedules([{ scheduled_at: iso(-60_000) }]);
  assert.equal(entry.count, 1);
  assert.equal(entry.pausedCount, 0);
  assert.equal(entry.nextAt, NOW - 60_000);
  assert.equal(badgeStateFor(entry.nextAt, NOW), 'overdue', '真正的到期项仍应报 overdue');
});

/* ==================== 进度环（方案 A：track + prog 双环） ==================== */

test('进度：after 用 after_seconds 回推窗口起点，两端夹住', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(10 * 60_000), kind: 'after', after_seconds: 600 },
  ]);
  assert.equal(entry.nextAt, NOW + 10 * 60_000);
  assert.equal(entry.progressFrom, NOW, '窗口 = [触发时刻 − 600s, 触发时刻]，起点正好 NOW');
  assert.equal(progressOf(entry, NOW), 0);
  assert.equal(progressOf(entry, NOW + 5 * 60_000), 0.5);
  assert.equal(progressOf(entry, NOW + 10 * 60_000), 1);
  assert.equal(progressOf(entry, NOW + 99 * 60_000), 1, '已超时停在满环，不绕出去');
});

test('进度：every 用 every_seconds，周期推进后窗口整体前移、进度归零', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(30_000), kind: 'every', every_seconds: 300 },
  ]);
  assert.equal(entry.progressFrom, NOW + 30_000 - 300_000);
  assert.equal(progressOf(entry, NOW + 30_000 - 150_000), 0.5);
  const nextRound = summarizeSchedules([
    { scheduled_at: iso(330_000), kind: 'every', every_seconds: 300 },
  ]);
  assert.equal(nextRound.progressFrom, NOW + 330_000 - 300_000);
  assert.equal(progressOf(nextRound, NOW + 30_000), 0, '新一轮开始即归零');
});

test('进度：window_seconds 优先于按 kind 推导', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(60_000), kind: 'after', after_seconds: 600, window_seconds: 120 },
  ]);
  assert.equal(entry.progressFrom, NOW + 60_000 - 120_000, '显式总窗口更权威');
});

test('进度：at 回退到 created_at', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(3_600_000), kind: 'at', created_at: iso(-1_800_000) },
  ]);
  assert.equal(entry.progressFrom, NOW - 1_800_000);
  assert.equal(progressOf(entry, NOW), 1 / 3);
});

test('进度：推不出窗口时不给 progressFrom（退回恒定整环）', () => {
  const entry = summarizeSchedules([{ scheduled_at: iso(60_000), kind: 'at' }]);
  assert.equal(entry.nextAt, NOW + 60_000);
  assert.ok(!('progressFrom' in entry), '不得凭空造一个起点');
  assert.equal(progressOf(entry, NOW), undefined);
  assert.equal(progressOf({ count: 1, pausedCount: 0 }, NOW), undefined, '连 nextAt 都没有');
});

test('进度：窗口退化（span ≤ 0）时宁可不出环', () => {
  // created_at 晚于触发时刻：数据异常。宁可不出进度，也不出"恒满环"这种假信息。
  const entry = summarizeSchedules([
    { scheduled_at: iso(60_000), kind: 'at', created_at: iso(120_000) },
  ]);
  assert.equal(progressOf(entry, NOW), undefined);
});

test('进度：秒数字段非法（0/负数）视为没给', () => {
  assert.ok(!('progressFrom' in summarizeSchedules([
    { scheduled_at: iso(60_000), kind: 'after', after_seconds: 0 },
  ])));
  assert.ok(!('progressFrom' in summarizeSchedules([
    { scheduled_at: iso(60_000), kind: 'every', every_seconds: -5 },
  ])));
});

test('进度：窗口起点只跟随 nextAt 那条任务', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(10 * 60_000), kind: 'after', after_seconds: 600 }, // 更晚
    { scheduled_at: iso(2 * 60_000), kind: 'after', after_seconds: 120 },  // 最早 → 说了算
  ]);
  assert.equal(entry.nextAt, NOW + 2 * 60_000);
  assert.equal(entry.progressFrom, NOW + 2 * 60_000 - 120_000, '用最早那条的窗口');
});

test('进度：暂停项既不参与 nextAt，也不贡献 progressFrom', () => {
  const entry = summarizeSchedules([
    { scheduled_at: iso(-600_000), kind: 'after', after_seconds: 600, status: 'paused' },
    { scheduled_at: iso(120_000), kind: 'after', after_seconds: 60 },
  ]);
  assert.equal(entry.progressFrom, NOW + 120_000 - 60_000);
});

test('进度：兼容 runtime 记录形状（camelCase）', () => {
  const entry = summarizeSchedules([
    { scheduledAt: iso(60_000), kind: 'after', afterSeconds: 120 },
  ]);
  assert.equal(entry.progressFrom, NOW + 60_000 - 120_000);
});

test('进度：没有窗口信息时 summary 形状与改造前完全一致', () => {
  // 无进度 → 不得出现 progressFrom 键，否则既有 wire/deepEqual 契约会被打破
  assert.deepEqual(summarizeSchedules([]), { count: 0, pausedCount: 0 });
  assert.deepEqual(summarizeSchedules([{ scheduled_at: iso(60_000) }]), {
    count: 1,
    nextAt: NOW + 60_000,
    pausedCount: 0,
  });
});
