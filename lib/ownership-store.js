/**
 * 用户任务所有权的 sidecar 存储层。
 *
 * 为什么存在（2026-09 缺口事故的根治）：此前所有权经伴生会话事件
 * `session-scheduler/user-schedule` 写进会话日志——但该类型不在宿主事件
 * 词汇表内，持久化层在特定时序下会「seq 已消费但行未落盘」，在日志里留下
 * 永久 seq 缺口，任何读方（含格式迁移）都会拒读整份历史。根治 = 所有权
 * 完全移出会话日志，存到插件自己的 sidecar 文件：
 *
 *   <DSH_HOME>/plugin-state/later/<sessionId>.json
 *
 * 改名迁移：插件旧名 `session-scheduler` 的 sidecar 目录在首次启动时自动
 * 迁移（整个目录 rename；rename 失败则逐文件复制）。不写「一次性迁移
 * 标记」——重复执行天然幂等，且不引入新的丢失路径。
 *
 * - 原子写：临时文件 + rename；
 * - 容错读：JSON 损坏时把坏文件改名保留（.corrupt-<ts>），按空表继续；
 * - 进程内缓存：按 (mtimeMs, size) 校验，避免热路径反复读盘；
 * - 路径解析：`DSH_LATER_STATE_DIR`（测试/便携）> 旧名
 *   `DSH_SESSION_SCHEDULER_STATE_DIR`（升级过渡）> `$DSH_HOME` > `~/.dsh`
 *   （与 dsh-home-paths 的默认解析一致）。
 *
 * 注意：本模块只被 host 端引用；client bundle 不得引入（依赖 node:fs）。
 * @module dsh-later/ownership-store
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync, unlinkSync, readdirSync, copyFileSync, } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/**
 * 校验并收窄任意来源（含磁盘 JSON）的附件块数组。
 *
 * sidecar 是本地文件，可能被外部改写或被旧版本写入半成品；而附件块最终会
 * 拼进**以用户身份代发**的消息 content，故读路径必须视为不可信输入：
 * 只放行 `{type:'image'|'file', attachment:{attachmentId: string}}` 形状的块，
 * 其余一律丢弃（不抛错——单块损坏不应让整份 sidecar 不可读）。
 */
export function sanitizeAttachments(value) {
    if (!Array.isArray(value) || value.length === 0)
        return undefined;
    const blocks = [];
    for (const item of value) {
        if (typeof item !== 'object' || item === null)
            continue;
        const block = item;
        if (block.type !== 'image' && block.type !== 'file')
            continue;
        const ref = block.attachment;
        if (typeof ref !== 'object' || ref === null)
            continue;
        if (typeof ref.attachmentId !== 'string')
            continue;
        blocks.push(item);
    }
    return blocks.length > 0 ? blocks : undefined;
}
/** 当前写回的 sidecar 版本（v3 = 条目带 `scheduledAt`，供宿主级到期扫描）。 */
const CURRENT_VERSION = 3;
/**
 * 显式状态目录覆盖（测试 / 便携场景）。
 *
 * 两个变量名等价：`DSH_LATER_STATE_DIR` 是当前名，`DSH_SESSION_SCHEDULER_STATE_DIR`
 * 是插件改名前（`session-scheduler`）的旧名，保留以兼容既有脚本与文档。
 *
 * 修复记录：此前两处都写成 `DSH_LATER_STATE_DIR ?? DSH_LATER_STATE_DIR`——
 * 同一个变量自比较，旧名回退实际从未生效。旧名用户会静默落到 `$DSH_HOME`
 * 默认目录，而 `legacyStateDir()` 又因"有 override"直接返回 undefined，
 * 迁移也不会发生。
 */
function stateDirOverride() {
    for (const name of ['DSH_LATER_STATE_DIR', 'DSH_SESSION_SCHEDULER_STATE_DIR']) {
        const value = process.env[name];
        if (value !== undefined && value.trim().length > 0)
            return value;
    }
    return undefined;
}
/** 解析状态目录（优先级见模块注释）。 */
function resolveStateDir() {
    const override = stateDirOverride();
    if (override !== undefined)
        return override;
    const dshHomeEnv = process.env['DSH_HOME'];
    const home = dshHomeEnv !== undefined && dshHomeEnv.trim().length > 0 ? dshHomeEnv : join(homedir(), '.dsh');
    return join(home, 'plugin-state', 'later');
}
/**
 * 旧名 sidecar 目录（仅 `$DSH_HOME` 路径下存在；env 覆盖视为测试/便携场景，
 * 不做迁移以免污染调用方给定的目录语义）。
 */
function legacyStateDir() {
    if (stateDirOverride() !== undefined)
        return undefined;
    const dshHomeEnv = process.env['DSH_HOME'];
    const home = dshHomeEnv !== undefined && dshHomeEnv.trim().length > 0 ? dshHomeEnv : join(homedir(), '.dsh');
    return join(home, 'plugin-state', 'session-scheduler');
}
/** 把旧名目录的 sidecar 文件搬到新目录（目录 rename 优先，失败逐文件复制；幂等）。 */
function migrateLegacyState(newDir) {
    const oldDir = legacyStateDir();
    if (oldDir === undefined || !existsSync(oldDir))
        return;
    try {
        renameSync(oldDir, newDir);
        return;
    }
    catch {
        /* 目标已存在等：退化为逐文件复制 */
    }
    try {
        for (const entry of readdirSync(oldDir)) {
            if (!entry.endsWith('.json'))
                continue;
            const target = join(newDir, entry);
            if (!existsSync(target))
                copyFileSync(join(oldDir, entry), target);
        }
    }
    catch (error) {
        console.warn(`[dsh-later] 旧 sidecar 目录迁移失败（旧目录保留，可手动搬移）: ${error instanceof Error ? error.message : String(error)}`);
    }
}
let cachedDir;
/** 状态目录（懒创建；目录创建失败时返回原路径，由调用方容错）。 */
function stateDir() {
    if (cachedDir === undefined) {
        cachedDir = resolveStateDir();
        try {
            mkdirSync(cachedDir, { recursive: true });
            migrateLegacyState(cachedDir);
        }
        catch {
            /* 读写时再报错 */
        }
    }
    return cachedDir;
}
function fileOf(sessionId) {
    // sessionId 形如 session-<uuid>，字符安全；仍做一次兜底清洗。
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
    return join(stateDir(), `${safe}.json`);
}
function emptyFile() {
    return { version: CURRENT_VERSION, entries: {}, paused: {} };
}
/** 进程内缓存：sessionId → (mtime, size, file)。写路径同步更新缓存。 */
const cache = new Map();
/**
 * sidecar 变更代数（进程内单调递增）。
 *
 * 为什么需要：`foldUserState` 的结果不只由会话日志决定——`owned` / `delivery`
 * 有一部分来自这份 sidecar（`allOwnership`）。日志是 append-only，可以用尾号当
 * 缓存键；sidecar 不是，它可以在**日志一个事件都不加**的情况下被改写（暂停项插话
 * 清留档就是这种路径）。只认日志尾号的缓存会读到过期的所有权。
 *
 * 所以每次落盘都拨一次这个计数器，读侧把它一并纳入缓存判据。它是**进程全局**的：
 * 任一会话写 sidecar 会让所有会话的 fold 缓存作废，属于「宁可多算一次」的保守取舍
 * ——而写 sidecar 本来就只发生在用户改动提醒的时候，那一刻缓存失效正是我们要的。
 */
let sidecarGeneration = 0;
/** 当前 sidecar 变更代数；与上一次读取不同，说明所有权/留档可能已变。 */
export function ownershipGeneration() {
    return sidecarGeneration;
}
function readFresh(sessionId) {
    const path = fileOf(sessionId);
    let stat;
    try {
        stat = statSync(path);
    }
    catch {
        cache.delete(sessionId);
        return emptyFile();
    }
    const cached = cache.get(sessionId);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.file;
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof parsed !== 'object' ||
            parsed === null ||
            (parsed.version !== 1 &&
                parsed.version !== 2 &&
                parsed.version !== 3) ||
            typeof parsed.entries !== 'object' ||
            parsed.entries === null) {
            throw new Error('unexpected shape');
        }
        // v1 → v2：补空 paused；v2 → v3：条目补 `scheduledAt`（写回时统一升到 3）。
        // 老条目缺 `scheduledAt` 的**不在这里**回算：回算要读会话日志，而本层（`readFresh`）
        // 是纯磁盘层、没有 session 句柄。回算与「回算不出来就保守跳过」都在读侧
        // `resolveScheduledAt` 里，由需要到期时刻的消费者显式调用。
        //
        // 附件块在**读路径**收窄（sidecar 是本地文件，视同不可信输入）：旧版本
        // 写入的半成品或外部改写在此被滤掉，下游（代发拼 content）只见到合法块。
        const entries = {};
        for (const [id, entry] of Object.entries(parsed.entries)) {
            const attachments = sanitizeAttachments(entry.attachments);
            entries[id] = attachments === undefined ? entry : { ...entry, attachments };
        }
        const paused = {};
        for (const [uid, entry] of Object.entries(parsed.paused ?? {})) {
            const attachments = sanitizeAttachments(entry.attachments);
            paused[uid] = attachments === undefined ? entry : { ...entry, attachments };
        }
        const file = {
            version: CURRENT_VERSION,
            entries,
            paused,
        };
        cache.set(sessionId, { mtimeMs: stat.mtimeMs, size: stat.size, file });
        return file;
    }
    catch (error) {
        // 损坏文件：改名保留现场，按空表继续（不静默删除，方便离线排查）。
        try {
            renameSync(path, `${path}.corrupt-${Date.now()}`);
        }
        catch {
            /* 改名失败也按空表继续 */
        }
        cache.delete(sessionId);
        try {
            // eslint 由库外保证；这里用 console 而非宿主 logger（本层无 ctx 依赖）。
            console.warn(`[dsh-later] 所有权 sidecar 解析失败，已按空表继续: ${error instanceof Error ? error.message : String(error)}`);
        }
        catch {
            /* 通知失败不影响语义 */
        }
        return emptyFile();
    }
}
/** 读取某会话的全部所有权记录（缓存优先；返回副本语义，调用方不得变更）。 */
export function allOwnership(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
        return {};
    return readFresh(sessionId).entries;
}
/** 某 schedule id 是否由用户工具创建。 */
export function hasOwnership(sessionId, id) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string')
        return false;
    return Object.prototype.hasOwnProperty.call(readFresh(sessionId).entries, id);
}
/** 某条所有权记录（缺失返回 undefined）。 */
export function getOwnership(sessionId, id) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string')
        return undefined;
    return readFresh(sessionId).entries[id];
}
function writeThrough(sessionId, file) {
    const path = fileOf(sessionId);
    const dir = stateDir();
    const tmp = join(dir, `.${safeName(sessionId)}.${process.pid}.${Date.now()}.tmp`);
    const payload = `${JSON.stringify(file, null, 2)}\n`;
    writeFileSync(tmp, payload, 'utf8');
    try {
        renameSync(tmp, path);
    }
    catch {
        // 极端场景（跨设备等）：退化为直接写目标文件。
        writeFileSync(path, payload, 'utf8');
        try {
            if (existsSync(tmp))
                unlinkSync(tmp);
        }
        catch {
            /* 清理失败不影响语义 */
        }
    }
    const stat = statSync(path);
    cache.set(sessionId, { mtimeMs: stat.mtimeMs, size: stat.size, file });
    // 每一次落盘都拨一代：读侧（foldUserState 的缓存）据此知道所有权可能已变，
    // 即使会话日志一条都没加。四个 mutation 入口都汇到这里，所以只需在这一处加。
    sidecarGeneration += 1;
}
function safeName(sessionId) {
    return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}
/** 生成稳定插件 uid（pause/resume 跨日志 id 变更）。 */
export function newTaskUid() {
    return globalThis.crypto?.randomUUID?.() ?? `uid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/**
 * 记录（新增或覆盖）一条所有权；幂等。仅显式传入 `uid` 时写入稳定身份。
 *
 * `scheduledAt` 与 `uid`/`windowSeconds`/`attachments` **同一条保留语义**：不传就沿用旧条目
 * 里的值。这不是省事，是正确性——`pause` 回填 uid、`flush` 失败回滚这类「覆盖写」只关心
 * 一个字段，若把其余字段当 `undefined` 抹掉，宿主级扫描器（`src/expiry-sweeper.ts`）就会
 * 突然看不见这条提醒的到期时刻，而那正是「到点了却没人叫醒会话」的静默失败。
 */
export function recordOwnership(sessionId, id, delivery, uid, windowSeconds, attachments, scheduledAt) {
    const safeAttachments = sanitizeAttachments(attachments);
    const safeScheduledAt = validTimestamp(scheduledAt);
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string' || id.length === 0) {
        const bare = {
            delivery,
            createdAt: Date.now(),
            ...(uid !== undefined ? { uid } : {}),
            ...(typeof windowSeconds === 'number' ? { windowSeconds } : {}),
            ...(safeAttachments !== undefined ? { attachments: safeAttachments } : {}),
            ...(safeScheduledAt !== undefined ? { scheduledAt: safeScheduledAt } : {}),
        };
        return bare;
    }
    const file = readFresh(sessionId);
    const entries = { ...file.entries };
    const nextUid = uid ?? entries[id]?.uid;
    const nextWindow = windowSeconds ?? entries[id]?.windowSeconds;
    // 附件与 uid/window 同语义：未显式传入时保留旧条目值，保证「pause 回填 uid」
    // 与「flush 失败回滚」等覆盖写不丢附件；显式传入（含 undefined 清空语义由
    // 调用方用 previousEntry?.attachments 表达）以传入值为准。
    const nextAttachments = attachments !== undefined ? safeAttachments : entries[id]?.attachments;
    const nextScheduledAt = safeScheduledAt ?? entries[id]?.scheduledAt;
    /**
     * 消化标记与 `scheduledAt` **反向**联动：显式写了新时刻（create / edit / resume /
     * 补偿重挂）就是「这条重新成为待投递」，标记必须清掉——留着它，扫描器就永远看不见
     * 这条提醒，那正是 #139 的镜像缺陷（一边是永不消化，一边是永不排上）。
     * 没写新时刻的覆盖写（pause 回填 uid 那一类）沿用旧值。
     */
    const nextDispatchedAt = safeScheduledAt === undefined ? entries[id]?.dispatchedAt : undefined;
    const entry = {
        delivery,
        createdAt: Date.now(),
        ...(nextUid !== undefined ? { uid: nextUid } : {}),
        ...(typeof nextWindow === 'number' ? { windowSeconds: nextWindow } : {}),
        ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
        ...(nextScheduledAt !== undefined ? { scheduledAt: nextScheduledAt } : {}),
        ...(nextDispatchedAt !== undefined ? { dispatchedAt: nextDispatchedAt } : {}),
    };
    entries[id] = entry;
    writeThrough(sessionId, { version: CURRENT_VERSION, entries, paused: file.paused ?? {} });
    return entry;
}
/**
 * 收窄一个「到期时刻」：只接受**有限且非负**的毫秒数。
 *
 * sidecar 可能在进程外被改坏（本层一贯把磁盘内容视作不可信输入，见 `sanitizeAttachments`）。
 * `NaN`/`Infinity`/负数/非数字一律当缺失——扫描器据此走「回算或跳过」，而不是把 `NaN`
 * 当到期时刻去比大小（那样比较恒为 false，条目会永远被判成"未到期"，也就是静默丢失）。
 */
function validTimestamp(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
/** 扫描时单文件容量上限：超过这个尺寸的 sidecar 属异常，读它只会拖住整轮扫描。 */
const MAX_SIDECAR_BYTES = 8 * 1024 * 1024;
/**
 * 枚举**全部**会话的 sidecar 条目（宿主级到期扫描的数据源，issue #11b）。
 *
 * 这是本层唯一的「跨会话」读接口：扫描器不知道有哪些会话（冷启动时一个 agent 都没有，
 * `ctx.agents.roots()` 是空数组），只能从持久化面自己枚举。两个失败面都**不抛**：
 *  - 目录读不了 → 返回空数组（首启/临时目录被删属正常）；
 *  - 单个文件读不了 / 坏了 → 跳过该文件并 `warn`，绝不让一个坏文件吃掉整轮扫描
 *    （「整轮失败」等于所有会话的提醒一起停摆，那正是要消灭的失败形态）。
 *
 * 返回值是快照：调用方可以边扫描边改，不会看到半更新。
 * @param warn - 告警出口（插件侧是 `ctx.logger.warn`；缺省走 console）。
 * @returns 每个可读 sidecar 的会话 id 与条目快照。
 */
export function listOwnershipSnapshots(warn) {
    const notify = warn ?? ((message) => console.warn(`[dsh-later] ${message}`));
    const dir = stateDir();
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return [];
    }
    const snapshots = [];
    for (const name of names) {
        if (!name.endsWith('.json') || name.startsWith('.'))
            continue;
        const sessionId = name.slice(0, -'.json'.length);
        try {
            const path = join(dir, name);
            const stat = statSync(path);
            if (stat.size > MAX_SIDECAR_BYTES) {
                notify(`sidecar "${name}" 体积异常（${stat.size} 字节），本轮扫描跳过该会话。`);
                continue;
            }
            // 走 readFresh 而不是自己解析：缓存、损坏改名、附件收窄都在那一处，扫描面不该有
            // 第二套解析口径（两套口径迟早对同一份文件给出不同结论）。
            const file = readFresh(sessionId);
            if (Object.keys(file.entries).length === 0)
                continue;
            snapshots.push({ sessionId, entries: file.entries });
        }
        catch (error) {
            notify(`sidecar "${name}" 读取失败，本轮扫描跳过该会话: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return snapshots;
}
/** 撤销一条所有权；幂等（不存在时无操作）。 */
export function removeOwnership(sessionId, id) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof id !== 'string' || id.length === 0)
        return;
    const file = readFresh(sessionId);
    if (!Object.prototype.hasOwnProperty.call(file.entries, id))
        return;
    const entries = { ...file.entries };
    delete entries[id];
    writeThrough(sessionId, { version: CURRENT_VERSION, entries, paused: file.paused ?? {} });
}
/**
 * 把 fold 的端态镜像进索引面（issue #139 的唯一写入口）。
 *
 * ## 为什么需要一个专门的镜像函数
 *
 * 扫描器的到期视图只能读 sidecar（冷会话的日志读不到：`ctx.sessions.get` 按内核定义只
 * 返回 live 会话，而「要不要叫醒」的判定恰好发生在会话还冷的时候）。所以「投递真相同源」
 * 只能反过来落地：**由能读日志的那一方（runtime）在 dispatch 之后，把日志端态写回索引**。
 * 本函数就是那一处写回，它自己**不折日志、不推 occurrence**——端态由调用方从已有的 fold
 * 结果里取（本仓两条 fold 通道口径一致，见 `user-tools.ts` 的 `foldScheduleEventsCompat`
 * 与 `projection.ts`；再算第三遍就是这两个月最贵的那类错误）。
 *
 * 每个 id 只有两种端态：
 *  - `number` —— 日志里这条仍 active，它的下一次到期时刻（`every` 的 dispatch 已经把
 *    日志记录推到下一次，所以这个值天然是「下一次」）；
 *  - `undefined` —— 日志里已经没有它（一次性投完出列 / 被删除）⇒ 打消化标记。
 *
 * **只在真的不同时才落盘**：`driveOnce` 每轮都会调这里，无条件写会把 sidecar 变成
 * 每次投递一次的固定磁盘写，并且——更要紧的——每次 `writeThrough` 都拨一代
 * `sidecarGeneration`，而那是 fold 缓存的失效键，无条件写等于让 fold 缓存每轮自毁。
 * 未出现在 `targets` 里的条目**一律不动**：那是别的读者的条目，或本方无法判定的条目，
 * 保守跳过与 `resolveScheduledAt` 那一侧的「绝不猜」是同一条纪律。
 *
 * @param sessionId - 目标会话。
 * @param targets - 日志 id → 端态（见上）。
 * @returns 实际改动的条目数（`0` 表示没碰磁盘）。
 */
export function mirrorDueIndex(sessionId, targets) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || targets.size === 0)
        return 0;
    const file = readFresh(sessionId);
    const entries = { ...file.entries };
    let changed = 0;
    for (const [id, target] of targets) {
        const entry = entries[id];
        // 条目不在索引里：它不属于本插件的提醒面（或已经被摘掉），没有任何东西可镜像。
        if (entry === undefined)
            continue;
        if (target === undefined) {
            // 已消化：补标记。已有标记（含被外部改坏成非法值的）不重复写盘；非法标记由
            // `readDueIndex` 按「没标过」处理，所以这里要把它改写成合法的，不能留着坏值。
            if (validTimestamp(entry.dispatchedAt) !== undefined)
                continue;
            entries[id] = { ...entry, dispatchedAt: Date.now() };
            changed += 1;
            continue;
        }
        const safe = validTimestamp(target);
        if (safe === undefined)
            continue; // 端态本身不可信 ⇒ 不动索引（宁可不镜像，也别写坏）
        if (safe === entry.scheduledAt && validTimestamp(entry.dispatchedAt) === undefined)
            continue;
        const { dispatchedAt: _stale, ...rest } = entry;
        entries[id] = { ...rest, scheduledAt: safe };
        changed += 1;
    }
    if (changed === 0)
        return 0;
    writeThrough(sessionId, { version: CURRENT_VERSION, entries, paused: file.paused ?? {} });
    return changed;
}
/** 按 uid 找当前仍 active 的 schedule id（缺失 undefined）。 */
export function findScheduleIdByUid(sessionId, uid) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof uid !== 'string')
        return undefined;
    for (const [id, entry] of Object.entries(readFresh(sessionId).entries)) {
        if (entry.uid === uid)
            return id;
    }
    return undefined;
}
/** 全部暂停留档（uid → entry）。 */
export function allPaused(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
        return {};
    return readFresh(sessionId).paused ?? {};
}
/** 一条暂停留档。 */
export function getPaused(sessionId, uid) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof uid !== 'string')
        return undefined;
    return (readFresh(sessionId).paused ?? {})[uid];
}
/** 按暂停前 schedule id 找留档（pause 刚写完、投影 fold 见 delete 时用）。 */
export function findPausedByScheduleId(sessionId, scheduleId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof scheduleId !== 'string')
        return undefined;
    for (const entry of Object.values(readFresh(sessionId).paused ?? {})) {
        if (entry.lastScheduleId === scheduleId)
            return entry;
    }
    return undefined;
}
/** 写入/覆盖一条暂停留档。 */
export function recordPaused(sessionId, entry) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof entry.uid !== 'string')
        return;
    const file = readFresh(sessionId);
    writeThrough(sessionId, {
        version: CURRENT_VERSION,
        entries: file.entries,
        paused: { ...(file.paused ?? {}), [entry.uid]: entry },
    });
}
/** 移除一条暂停留档；幂等。 */
export function removePaused(sessionId, uid) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof uid !== 'string')
        return;
    const file = readFresh(sessionId);
    const paused = { ...(file.paused ?? {}) };
    if (!Object.prototype.hasOwnProperty.call(paused, uid))
        return;
    delete paused[uid];
    writeThrough(sessionId, { version: CURRENT_VERSION, entries: file.entries, paused });
}
/** 测试辅助：清空进程内缓存（不删文件）。 */
export function resetCacheForTests() {
    cache.clear();
    cachedDir = undefined;
}
