/**
 * smart-window 智能时段纯函数测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SMART_WINDOW,
  MINUTE_MS,
  SMART_MIN_DELAY_MS,
  epochFromLocal,
  floorToMinute,
  hhmmToMinutes,
  isValidHhmm,
  isValidWindow,
  localFieldsOf,
  minutesToHhmm,
  nextSmartAt,
  nextSmartTarget,
  sanitizeSmartWindowConfig,
} from '../lib/smart-window.js';

const TZ = 'Asia/Shanghai';

test('hhmmToMinutes / minutesToHhmm 往返', () => {
  assert.equal(hhmmToMinutes('09:00'), 540);
  assert.equal(hhmmToMinutes('23:59'), 1439);
  assert.equal(hhmmToMinutes('24:00'), undefined);
  assert.equal(hhmmToMinutes('9:00'), undefined);
  assert.equal(minutesToHhmm(540), '09:00');
  assert.equal(minutesToHhmm(0), '00:00');
});

test('isValidWindow 默认配置合法', () => {
  assert.equal(isValidWindow(DEFAULT_SMART_WINDOW), true);
  assert.equal(isValidWindow({ ...DEFAULT_SMART_WINDOW, workStart: '12:00' }), false);
  assert.equal(isValidWindow({ ...DEFAULT_SMART_WINDOW, lunchEnd: '25:00' }), false);
});

test('本地墙钟解析（Asia/Shanghai，无 DST）', () => {
  // 2026-08-19 14:00 Asia/Shanghai = 2026-08-19T06:00:00Z
  const epoch = epochFromLocal('2026-08-19', '14:00', TZ);
  assert.ok(epoch !== undefined);
  assert.equal(new Date(epoch).toISOString(), '2026-08-19T06:00:00.000Z');
});

test('nextSmartTarget 工作时段内 → 下一窗口起点（至少 2 分钟后）', () => {
  // 2026-08-19 15:00 Asia/Shanghai（工作时间内）→ 候选 18:00 最早
  const now = Date.parse('2026-08-19T07:00:00.000Z'); // 15:00 +08
  const target = nextSmartTarget(now, TZ);
  assert.equal(new Date(target).toISOString(), '2026-08-19T10:00:00.000Z'); // 18:00 +08
});

test('nextSmartTarget 午休时段内 → now + 2 分钟', () => {
  const now = Date.parse('2026-08-19T05:00:00.000Z'); // 13:00 +08 午休
  const target = nextSmartTarget(now, TZ);
  assert.ok(target >= now + SMART_MIN_DELAY_MS - 1000 && target <= now + SMART_MIN_DELAY_MS + 1000);
});

test('nextSmartTarget 夜间静默 → 次日 09:00', () => {
  const now = Date.parse('2026-08-19T18:00:00.000Z'); // 次日02:00 +08（8/20）
  const target = nextSmartTarget(now, TZ);
  const f = localFieldsOf(target, TZ);
  assert.equal(f.hour, 9);
  assert.equal(f.minute, 0);
  assert.equal(f.day, 20);
});

test('nextSmartTarget 至少滞后 2 分钟', () => {
  const now = Date.now();
  const target = nextSmartTarget(now, TZ);
  assert.ok(target - now >= SMART_MIN_DELAY_MS - 1000);
});

test('nextSmartAt 返回可用的 at 对象', () => {
  const at = nextSmartAt(Date.parse('2026-08-19T07:00:00.000Z'), TZ);
  assert.ok(at !== null);
  assert.equal(at.time_zone, TZ);
  assert.match(at.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(at.time, /^\d{2}:\d{2}:\d{2}$/);
  // 回解析一致
  const back = epochFromLocal(at.date, at.time, TZ);
  assert.equal(back, at.epoch);
});

test('floorToMinute', () => {
  const now = Date.parse('2026-08-19T07:00:42.500Z');
  assert.equal(floorToMinute(now), Date.parse('2026-08-19T07:00:00.000Z'));
  assert.equal(floorToMinute(Math.floor(now / MINUTE_MS) * MINUTE_MS), Math.floor(now / MINUTE_MS) * MINUTE_MS);
});

// ─── sanitizeSmartWindowConfig：设置面板输入清洗 ─────────────────────

test('sanitizeSmartWindowConfig：全合法值透传', () => {
  const got = sanitizeSmartWindowConfig({ workStart: '08:30', workEnd: '17:30', lunchStart: '12:00', lunchEnd: '13:30', eveningEnd: '21:30' });
  assert.equal(got.workStart, '08:30');
  assert.equal(got.eveningEnd, '21:30');
});

test('sanitizeSmartWindowConfig：非法/缺失字段逐项回落默认', () => {
  const got = sanitizeSmartWindowConfig({ workStart: '25:00', lunchEnd: '下午一点', eveningEnd: undefined });
  assert.equal(got.workStart, DEFAULT_SMART_WINDOW.workStart);
  assert.equal(got.lunchEnd, DEFAULT_SMART_WINDOW.lunchEnd);
  assert.equal(got.eveningEnd, DEFAULT_SMART_WINDOW.eveningEnd);
  // 合法的同批字段仍保留
  assert.equal(got.workEnd, DEFAULT_SMART_WINDOW.workEnd);
  assert.equal(got.lunchStart, DEFAULT_SMART_WINDOW.lunchStart);
});

test('sanitizeSmartWindowConfig：空/null 输入返回全默认', () => {
  assert.deepEqual(sanitizeSmartWindowConfig(undefined), DEFAULT_SMART_WINDOW);
  assert.deepEqual(sanitizeSmartWindowConfig(null), DEFAULT_SMART_WINDOW);
});

test('isValidHhmm：边界与格式校验', () => {
  assert.equal(isValidHhmm('00:00'), true);
  assert.equal(isValidHhmm('23:59'), true);
  assert.equal(isValidHhmm('24:00'), false);
  assert.equal(isValidHhmm('9:00'), false); // 必须两位
  assert.equal(isValidHhmm('foo'), false);
  assert.equal(isValidHhmm(900), false);
});

// ── 跨时区墙钟解析（P1 暴露出的既有 bug 回归）───────────────────────────────
/**
 * 旧实现把 `Date.UTC(年,月,日)`（UTC 零点）当「当天」探针交给 resolveWallClock，
 * 后者再用 localFieldsOf 反推日期——在 UTC 负偏移时区那个瞬间读出来的是**前一天**，
 * 于是 `epochFromLocal('2026-11-01','09:00','America/Los_Angeles')` 解成 10-31 09:00，
 * 面板自定义日期与 `/later 明天9点` 整体错一天；正偏移 ≤ +11 的时区恰好看不出来，
 * 而本文件此前**只测 Asia/Shanghai**，所以一直没被发现。
 */

test('epochFromLocal：UTC 负偏移时区不得退到前一天（LA / NY）', () => {
  assert.equal(
    new Date(epochFromLocal('2026-11-01', '09:00', 'America/Los_Angeles')).toISOString(),
    '2026-11-01T17:00:00.000Z',
  );
  assert.equal(
    new Date(epochFromLocal('2026-11-01', '09:00', 'America/New_York')).toISOString(),
    '2026-11-01T14:00:00.000Z',
  );
});

test('epochFromLocal：极端正偏移（+14 Kiritimati / 新西兰）同样对齐请求日期', () => {
  assert.equal(
    new Date(epochFromLocal('2026-11-01', '09:00', 'Pacific/Kiritimati')).toISOString(),
    '2026-10-31T19:00:00.000Z',
  );
  assert.equal(
    new Date(epochFromLocal('2026-01-01', '00:30', 'Pacific/Kiritimati')).toISOString(),
    '2025-12-31T10:30:00.000Z',
  );
  assert.equal(
    new Date(epochFromLocal('2026-11-01', '09:00', 'Pacific/Auckland')).toISOString(),
    '2026-10-31T20:00:00.000Z',
  );
});

test('epochFromLocal：回拨日同一墙钟出现两次 → 取较早的瞬点', () => {
  // 2026-11-01 美国回拨：01:30 先后以 PDT(-7) 与 PST(-8) 各出现一次
  const epoch = epochFromLocal('2026-11-01', '01:30', 'America/Los_Angeles');
  assert.equal(new Date(epoch).toISOString(), '2026-11-01T08:30:00.000Z');
});

test('epochFromLocal：前拨跳过的墙钟返回 undefined（不静默挪到别处）', () => {
  // 2026-03-08 02:00→03:00 前拨，LA 的 02:30 不存在
  assert.equal(epochFromLocal('2026-03-08', '02:30', 'America/Los_Angeles'), undefined);
});

test('epochFromLocal：既有无 DST 时区行为不变', () => {
  assert.equal(new Date(epochFromLocal('2026-08-19', '14:00', TZ)).toISOString(), '2026-08-19T06:00:00.000Z');
  assert.equal(new Date(epochFromLocal('2026-08-19', '14:00:30', 'UTC')).toISOString(), '2026-08-19T14:00:30.000Z');
});
