#!/usr/bin/env node
/**
 * pre-1.4 会话日志里 `session-scheduler/user-schedule` 记录的一次性迁移（issue #58 C 路线）。
 *
 * ## 为什么需要它
 *
 * 1.4.0 之前本插件把「定时任务所有权」写进会话日志（自定义事件类型）。之后改存
 * sidecar，但**旧日志里那些记录还在**，而宿主读路径对「不认识的类型」是**整份拒读**：
 *
 *   dsh-session-persistence: `if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) &&
 *   event.ignorable !== true) throw unsupported(... refusing to interpret the log ...)`
 *
 * 宿主认可的兼容机制**不是**注册事件名（上游明确否决了那条路，见
 * `dsh-session/lib/types/known-event-types.d.ts` 的注释），而是 envelope 上的
 * `ignorable: true`：带这个标记的未知记录会被当作 log-only 保留、正常读过去。
 *
 * 所以迁移只做一件事：**给这些记录补一个布尔字段**。
 *
 * ## 为什么不是"删掉那几行"
 *
 * 读路径要求 seq 连续（`dsh-session/lib/index.js`：`event.seq !== expectedSeq` 即抛错），
 * 删行会造出 seq 缺口，反而让整份日志更读不了。改 type 也行不通（会被当成另一种事件解释）。
 * 加 `ignorable` 是唯一既不动 seq、也不改语义的做法。
 *
 * ## 用法
 *
 *     node scripts/migrate-owned-events.mjs                 # 只报告，不写任何东西（默认）
 *     node scripts/migrate-owned-events.mjs --apply         # 真正写入（先备份）
 *     node scripts/migrate-owned-events.mjs --root <dir>    # 指定日志根目录（默认 $DSH_HOME/sessions）
 *
 * 默认 dry-run。`--apply` 时每个被改动的文件先原样备份到
 * `<root>/../backups/migrate-owned-events-<时间戳>/`，再原子替换。重复执行是幂等的
 * （已经带 `ignorable: true` 的记录不会再被改）。
 *
 * @module dsh-later/scripts/migrate-owned-events
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** 1.4.0 之前写入的自有事件类型。 */
export const OWNED_EVENT = 'session-scheduler/user-schedule';

/** 会被扫描的会话日志文件名形态（v3/v4，压缩与否都算）。 */
export const LOG_NAME = /^session\.v\d+\.jsonl(\.zstd)?$/;

/**
 * 计划一个日志文本的迁移，**不碰文件系统**（纯函数，好测）。
 * @param {string} text 日志全文（JSONL，一行一条记录）
 * @returns {{ok: boolean, reason?: string, total: number, matches: number, changed: number, text: string}}
 *   `ok=false` 表示文本里有解析不了的记录，调用方应跳过该文件而不是猜测修复。
 */
export function planLog(text) {
  const hadTrailingNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (hadTrailingNewline) lines.pop();

  let matches = 0;
  let changed = 0;
  const out = [];

  for (const line of lines) {
    if (line.trim() === '') {
      out.push(line);
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { ok: false, reason: '存在无法解析的 JSONL 行', total: 0, matches: 0, changed: 0, text };
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      return { ok: false, reason: '存在不是对象的记录', total: 0, matches: 0, changed: 0, text };
    }
    if (event.type !== OWNED_EVENT) {
      out.push(line);
      continue;
    }
    matches += 1;
    if (event.ignorable === true) {
      out.push(line);
      continue;
    }
    // 只加这一个字段；键序按原记录在前、新字段在后，便于 diff 阅读。
    out.push(JSON.stringify({ ...event, ignorable: true }));
    changed += 1;
  }

  return {
    ok: true,
    total: lines.filter((l) => l.trim() !== '').length,
    matches,
    changed,
    text: out.join('\n') + (hadTrailingNewline ? '\n' : ''),
  };
}

/** 解出日志文本：`.zstd` 用 Node 内置 zstd，其余按明文读。
 *  `compressed` 可显式指定——迁移时的临时文件名不以 `.zstd` 结尾，靠文件名嗅探会读错。 */
export function decodeLog(file, compressed = file.endsWith('.zstd')) {
  const raw = readFileSync(file);
  return compressed ? zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8');
}

/** 写回日志字节：`.zstd` 重新压缩，其余按明文写（同样允许显式指定）。 */
export function encodeLog(file, text, compressed = file.endsWith('.zstd')) {
  return compressed ? zstdCompressSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8');
}

/** 递归找出日志文件（跳过坏目录而不是中止）。 */
export function findLogs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(path);
      else if (LOG_NAME.test(name)) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

/**
 * 迁移一个日志文件。
 * @param {string} file 日志路径
 * @param {{apply?: boolean, backupDir?: string}} options `apply=false` 只报告
 * @returns {{file: string, ok: boolean, matches: number, changed: number, written: boolean, reason?: string}}
 */
export function migrateLog(file, options = {}) {
  const { apply = false, backupDir } = options;
  const compressed = file.endsWith('.zstd');
  let text;
  try {
    text = decodeLog(file, compressed);
  } catch (error) {
    return { file, ok: false, matches: 0, changed: 0, written: false, reason: `解压/读取失败: ${error.message}` };
  }

  const plan = planLog(text);
  if (!plan.ok) {
    return { file, ok: false, matches: 0, changed: 0, written: false, reason: plan.reason };
  }
  if (plan.changed === 0 || !apply) {
    return { file, ok: true, matches: plan.matches, changed: plan.changed, written: false };
  }

  try {
    if (backupDir !== undefined) {
      mkdirSync(backupDir, { recursive: true });
      copyFileSync(file, join(backupDir, basename(file)));
    }
    const tmp = `${file}.migrate-${process.pid}.tmp`;
    writeFileSync(tmp, encodeLog(file, plan.text, compressed));
    // 回读自检：迁移后的内容必须能解回、且所有该类型记录都带上了标记。
    const check = planLog(decodeLog(tmp, compressed));
    if (!check.ok || check.changed !== 0 || check.matches !== plan.matches) {
      rmSync(tmp, { force: true });
      return { file, ok: false, matches: plan.matches, changed: plan.changed, written: false, reason: '写后自检失败，已保留原文件' };
    }
    renameSync(tmp, file);
  } catch (error) {
    return { file, ok: false, matches: plan.matches, changed: plan.changed, written: false, reason: `写入失败: ${error.message}` };
  }

  return { file, ok: true, matches: plan.matches, changed: plan.changed, written: true };
}

/** 默认日志根目录：`$DSH_HOME/sessions`（DSH_HOME 缺省为 `~/.dsh`）。 */
export function defaultRoot(env = process.env) {
  const home = env['DSH_HOME'] ?? join(env['HOME'] ?? '.', '.dsh');
  return join(home, 'sessions');
}

/** CLI 参数解析（只认三个开关，未知参数直接报错，避免"以为跑了 --apply"）。 */
export function parseArgs(argv) {
  const options = { apply: false, root: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--root') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--root 需要一个目录参数');
      options.root = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法: node scripts/migrate-owned-events.mjs [--apply] [--root <会话日志目录>]');
    return 0;
  }

  const root = options.root ?? defaultRoot();
  const backupDir = options.apply
    ? join(dirname(root), 'backups', `migrate-owned-events-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    : undefined;

  console.log(`[扫描] ${root}`);
  const files = findLogs(root);
  if (files.length === 0) {
    console.log('没有找到会话日志；检查 --root 是否指向 $DSH_HOME/sessions。');
    return 0;
  }

  let affectedFiles = 0;
  let affectedRecords = 0;
  let changedRecords = 0;
  const failures = [];

  for (const file of files) {
    const result = migrateLog(file, { apply: options.apply, backupDir });
    if (!result.ok) {
      failures.push(result);
      continue;
    }
    if (result.matches === 0) continue;
    affectedFiles += 1;
    affectedRecords += result.matches;
    changedRecords += result.changed;
    const action = options.apply ? (result.written ? '已迁移' : '无需改动') : '待迁移';
    console.log(`  ${action}  ${file}  记录=${result.matches} 本次改=${result.changed}`);
  }

  console.log('');
  console.log(`[汇总] 扫描 ${files.length} 个日志；受影响 ${affectedFiles} 个；该类型记录 ${affectedRecords} 条；本次改动 ${changedRecords} 条`);

  if (failures.length > 0) {
    console.error('');
    for (const failure of failures) console.error(`[跳过] ${failure.file}: ${failure.reason}`);
    console.error(`[失败] ${failures.length} 个文件未能处理（以上文件一字未改）`);
    return 1;
  }

  if (!options.apply) {
    console.log('这是 dry-run，没有写任何文件。确认无误后加 --apply 执行（会先备份到 backups/）。');
  } else if (changedRecords > 0) {
    console.log(`[备份] ${backupDir}`);
    console.log('迁移完成。现在这些日志可以被当前宿主正常读取；已带 ignorable 的记录不会重复改动。');
  } else {
    console.log('没有需要迁移的记录（已经是幂等状态）。');
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
