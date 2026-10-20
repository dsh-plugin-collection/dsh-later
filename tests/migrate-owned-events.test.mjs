/**
 * `scripts/migrate-owned-events.mjs` 的测试（issue #58 C 路线的旁路）。
 *
 * 迁移的正确性只有一条判据：**迁移后的日志满足宿主持久层的准入条件**
 * ——`KNOWN_SESSION_EVENT_TYPES.has(type) || event.ignorable === true`。
 * 所以这里不只测"字段加上去了"，而是直接拿宿主的真实集合复算那个布尔表达式。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';
import {
  OWNED_EVENT,
  defaultRoot,
  findLogs,
  migrateLog,
  parseArgs,
  planLog,
} from '../scripts/migrate-owned-events.mjs';

const OWNED_KIND = OWNED_EVENT;

/** 造一条合法的最小会话记录。 */
function event(seq, type = OWNED_KIND, extra = {}) {
  return { type, seq, time: 1758000000000 + seq, data: { version: 1, operation: 'create', id: `id-${seq}` }, ...extra };
}

/** 把事件数组拼成 JSONL（末尾带换行，和真实日志一致）。 */
function jsonl(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-later-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('planLog：只给自有事件补 ignorable，其它记录逐字节不动', () => {
  const userMessage = JSON.stringify(event(1, 'user/message', { data: { message: { role: 'user' } } }));
  const owned = JSON.stringify(event(2));
  const text = `${userMessage}\n${owned}\n`;

  const plan = planLog(text);
  assert.equal(plan.ok, true);
  assert.equal(plan.matches, 1);
  assert.equal(plan.changed, 1);

  const lines = plan.text.trimEnd().split('\n');
  assert.equal(lines[0], userMessage, '无关记录必须原样保留（包括键序）');
  const migrated = JSON.parse(lines[1]);
  assert.equal(migrated.ignorable, true);
  assert.deepEqual(Object.keys(migrated), ['type', 'seq', 'time', 'data', 'ignorable']);
  assert.equal(migrated.data.id, 'id-2', '只加字段，不许动 payload');
});

test('迁移后的记录满足宿主准入条件（真实 KNOWN 集合复算）', () => {
  const raw = JSON.parse(JSON.stringify(event(7)));
  assert.equal(
    KNOWN_SESSION_EVENT_TYPES.has(raw.type) || raw.ignorable === true,
    false,
    '前提：未迁移时宿主持久层会拒读整份日志',
  );

  const migrated = JSON.parse(planLog(`${JSON.stringify(raw)}\n`).text.trim());
  assert.equal(
    KNOWN_SESSION_EVENT_TYPES.has(migrated.type) || migrated.ignorable === true,
    true,
    '迁移后必须满足宿主的准入条件',
  );
});

test('planLog：幂等——已带 ignorable 的记录不再改动', () => {
  const text = jsonl([event(1, OWNED_KIND, { ignorable: true })]);
  const plan = planLog(text);
  assert.equal(plan.matches, 1);
  assert.equal(plan.changed, 0);
  assert.equal(plan.text, text);
});

test('planLog：解析不了的记录让整个文件被拒绝，而不是猜着改', () => {
  const plan = planLog(`${JSON.stringify(event(1))}\n{ 坏行\n`);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /解析/);
});

test('planLog：类型不匹配的记录一律不碰', () => {
  const text = jsonl([event(1, 'schedule/change'), event(2, 'user/message')]);
  const plan = planLog(text);
  assert.equal(plan.matches, 0);
  assert.equal(plan.changed, 0);
  assert.equal(plan.text, text);
});

test('findLogs：只挑 v3/v4 日志，压缩与否都算', (t) => {
  const root = tempDir(t);
  const s1 = join(root, 'a');
  mkdirSync(s1, { recursive: true });
  writeFileSync(join(s1, 'session.v3.jsonl.zstd'), zstdCompressSync(Buffer.from(jsonl([event(1)]))));
  writeFileSync(join(s1, 'session.v4.jsonl'), jsonl([event(2)]));
  writeFileSync(join(s1, 'session.lock'), '');
  writeFileSync(join(s1, 'notes.md'), 'session-scheduler/user-schedule');

  const logs = findLogs(root).map((f) => f.replace(root, ''));
  assert.deepEqual(logs.sort(), ['/a/session.v3.jsonl.zstd', '/a/session.v4.jsonl']);
});

test('migrateLog：dry-run 不写文件；--apply 写入并先备份；再次执行无改动', (t) => {
  const root = tempDir(t);
  const plain = join(root, 'session.v4.jsonl');
  const packed = join(root, 'session.v3.jsonl.zstd');
  const plainText = jsonl([event(1, 'user/message'), event(2), event(3)]);
  writeFileSync(plain, plainText);
  writeFileSync(packed, zstdCompressSync(Buffer.from(jsonl([event(9)]))));

  const before = { plain: readFileSync(plain), packed: readFileSync(packed) };

  // dry-run：报告有改动，但字节不变
  const dry = migrateLog(plain, { apply: false });
  assert.equal(dry.changed, 2);
  assert.equal(dry.written, false);
  assert.deepEqual(readFileSync(plain), before.plain);

  // apply：先备份，再原子替换
  const backupDir = join(root, '..', `backup-${process.pid}`);
  t.after(() => rmSync(backupDir, { recursive: true, force: true }));
  const applied = migrateLog(plain, { apply: true, backupDir });
  assert.equal(applied.written, true);
  assert.equal(applied.changed, 2);
  assert.ok(existsSync(join(backupDir, 'session.v4.jsonl')), '备份必须存在');
  assert.deepEqual(readFileSync(join(backupDir, 'session.v4.jsonl')), before.plain, '备份必须是迁移前的字节');

  const migratedLines = readFileSync(plain, 'utf8').trimEnd().split('\n');
  assert.equal(migratedLines[0], JSON.stringify(event(1, 'user/message')), '无关记录不动');
  for (const line of migratedLines.slice(1)) assert.equal(JSON.parse(line).ignorable, true);

  // 压缩日志同样处理，且解出来是合法 JSONL
  const packedApplied = migrateLog(packed, { apply: true, backupDir });
  assert.equal(packedApplied.written, true);
  const unpacked = zstdDecompressSync(readFileSync(packed)).toString('utf8');
  assert.equal(JSON.parse(unpacked.trim()).ignorable, true);

  // 幂等：第二次执行没有改动
  const again = migrateLog(plain, { apply: true, backupDir });
  assert.equal(again.changed, 0);
  assert.equal(again.written, false);
});

test('migrateLog：坏文件被跳过且一字未改', (t) => {
  const root = tempDir(t);
  const bad = join(root, 'session.v4.jsonl');
  const broken = `${JSON.stringify(event(1))}\n{oops\n`;
  writeFileSync(bad, broken);

  const result = migrateLog(bad, { apply: true });
  assert.equal(result.ok, false);
  assert.equal(result.written, false);
  assert.match(result.reason, /解析/);
  assert.equal(readFileSync(bad, 'utf8'), broken);
});

test('defaultRoot 与 parseArgs：默认 $DSH_HOME/sessions，未知参数直接报错', () => {
  assert.equal(defaultRoot({ HOME: '/home/x' }), join('/home/x', '.dsh', 'sessions'));
  assert.equal(defaultRoot({ HOME: '/home/x', DSH_HOME: '/tmp/dsh' }), join('/tmp/dsh', 'sessions'));

  assert.deepEqual(parseArgs([]), { apply: false, root: undefined });
  assert.deepEqual(parseArgs(['--apply', '--root', '/tmp/s']), { apply: true, root: '/tmp/s' });
  assert.throws(() => parseArgs(['--aply']), /未知参数/);
  assert.throws(() => parseArgs(['--root']), /需要一个目录参数/);
});
