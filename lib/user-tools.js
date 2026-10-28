import { ScheduleId, ScheduleInputError, foldScheduleEvents, scheduleView, } from '@deepseek-ai/dsh-schedule';
import { allocateScheduleIdCompat as allocateScheduleId, createAfterRecord as createAfterScheduleRecord, createAtRecord as createAtScheduleRecord, createEveryRecord as createEveryScheduleRecord, toChangePayload, asLegacySchedules, } from './schedule-compat.js';
import { OWNED_EVENT } from './domain.js';
import { allOwnership, allPaused, findPausedByScheduleId, findScheduleIdByUid, getOwnership, getPaused, ownershipGeneration, newTaskUid, recordOwnership, recordPaused, removeOwnership, removePaused, sanitizeAttachments, } from './ownership-store.js';
import { canonicalInstantString, canonicalLocalClock, canonicalLocalDate, detectTimeZone, } from './time-utils.js';
import { epochFromLocal } from './smart-window.js';
import { readLogCursor, readOwnEvents } from './upstream-compat.js';
/** 单 session 用户任务上限（PRD：防滥用）。 */
export const DEFAULT_MAX_SCHEDULES = 100;
/**
 * 经过 trim 后允许的默认最大提示字符数（P0：注入防护的保守下限）。
 *
 * 当 settings 中 `allowLongPrompts=false` 时此值始终生效；为 `true` 时
 * 由 `maxPromptChars` 字段接管实际字符上限。用户必须显式 opt-in 才解除
 * 该硬上限——保持默认安全的姿态。
 */
export const DEFAULT_MAX_PROMPT_CHARS = 1000;
/**
 * 从 settings 解析出实际生效的 PromptLimits。
 * 容错非法值（NaN / 负数 / 非数）回落 DEFAULT_MAX_PROMPT_CHARS。
 */
export function resolvePromptLimits(settings) {
    const allowLong = settings?.allowLongPrompts === true;
    const raw = settings?.maxPromptChars;
    const valid = typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && Math.floor(raw) === raw;
    if (allowLong && valid)
        return { allowLong: true, maxChars: raw };
    return { allowLong: false, maxChars: DEFAULT_MAX_PROMPT_CHARS };
}
/** 单条提示的字符校验（纯函数）。返回 trim 后的字符串或闭包错误。 */
export function validatePrompt(raw, limits) {
    const prompt = typeof raw === 'string' ? raw : '';
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
        return { ok: false, code: 'invalid_prompt', message: '提醒内容不能为空。' };
    }
    if (trimmed.length > limits.maxChars) {
        return {
            ok: false,
            code: 'invalid_prompt',
            message: `提醒内容不能超过 ${limits.maxChars} 字符。`,
        };
    }
    return { ok: true, value: trimmed };
}
/** 校验 `user_schedule_create` 参数（纯函数，含 TRIM 非空、长度、三选一）。
 *
 * `limits` 可选：未传时回落到 `DEFAULT_MAX_PROMPT_CHARS`（保持向后兼容）；
 * 命令与工具的注册路径会按当前 settings 传入实际 limits，校验消息会反映
 * 当前生效的字符上限（与模型可见的 tool description 同步）。
 */
export function validateCreateInput(input, limits = { allowLong: false, maxChars: DEFAULT_MAX_PROMPT_CHARS }) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, code: 'invalid_rule', message: 'create 参数必须是一个对象。' };
    }
    const args = input;
    const promptResult = validatePrompt(args['prompt'], limits);
    if (!promptResult.ok)
        return promptResult;
    const trimmed = promptResult.value;
    const selectorCount = Number(args['after_seconds'] !== undefined) +
        Number(args['at'] !== undefined) +
        Number(args['every_seconds'] !== undefined);
    if (selectorCount !== 1) {
        return {
            ok: false,
            code: 'invalid_selector',
            message: 'after_seconds / at / every_seconds 必须且只能提供一项。',
        };
    }
    const time_zone = typeof args['time_zone'] === 'string' && args['time_zone'].length > 0
        ? args['time_zone']
        : // P1-8：时区可选——缺省用检测到的会话时区，降低模型/客户端漏传导致的失败。
            detectTimeZone();
    if (!isValidIanaZone(time_zone)) {
        return { ok: false, code: 'invalid_time_zone', message: 'time_zone 必须是合法的 IANA 时区。' };
    }
    /**
     * `at` 走「**规范化后**再交给上游」，而不是原样透传（issue #76）。
     *
     * 上游 `createAtScheduleRecord` 的文法比这里严得多：本地时间必须两位小时 + 必带秒，
     * 绝对串必须 `T` 分隔 + 显式 `Z`/`±HH:mm`。而面板 `<input type="time">` 的原生输出是
     * `HH:mm`，模型也常写 `9:00:00` —— 过去原样透传的结果是**上游抛一句英文文法错**
     * （`Local at requires date YYYY-MM-DD and time HH:mm:ss …`），用户只看到「自定义时间有问题」，
     * 而插件自己的预览层（`epochFromLocal`）却判这些形状合法：同一个时刻，预览 OK、提交必挂。
     *
     * 三条规矩：
     *  1. **只补拼法，不猜语义**：补秒、`9:00` → `09:00:00`、空格分隔 → `T`、`+0800` → `+08:00`
     *     都不改变所指时刻；而**没有偏移**的串一律拒绝——替用户猜时区得到的是静默错值，
     *     比一次可读的拒绝坏得多。
     *  2. **畸形形状在这里就拒**，并给中文、可执行的文案；不要让上游的英文文法错成为用户所见。
     *  3. 交给上游的 `at` 只有本函数产出的这一份（多余键一并收掉：上游要求本地对象**恰好**
     *     `date`/`time`/`time_zone`，夹带别的键同样是一句英文拒绝）。
     */
    let atNormalized;
    if (args['at'] !== undefined) {
        const at = args['at'];
        if (typeof at === 'string') {
            atNormalized = canonicalInstantString(at);
            if (atNormalized === undefined) {
                return {
                    ok: false,
                    code: 'invalid_rule',
                    message: 'at 字符串需带显式时区：以 Z 或 ±HH:mm 结尾的 RFC 3339（如 2026-10-26T09:00:00+08:00）。'
                        + '不确定时区时请改传 {date, time, time_zone} 三元组。',
                };
            }
        }
        else if (typeof at === 'object' && at !== null && !Array.isArray(at)) {
            const obj = at;
            if (typeof obj['date'] !== 'string' || typeof obj['time'] !== 'string' || typeof obj['time_zone'] !== 'string') {
                return { ok: false, code: 'invalid_rule', message: 'at 对象必须包含 date / time / time_zone。' };
            }
            const date = canonicalLocalDate(obj['date']);
            if (date === undefined) {
                return { ok: false, code: 'invalid_rule', message: 'at.date 需为 YYYY-MM-DD（月、日各两位），且是真实存在的一天。' };
            }
            const time = canonicalLocalClock(obj['time']);
            if (time === undefined) {
                return {
                    ok: false,
                    code: 'invalid_rule',
                    message: 'at.time 需为 HH:mm 或 HH:mm:ss（可带 1–3 位毫秒），例如 09:00、9:30:15.5。',
                };
            }
            if (!isValidIanaZone(obj['time_zone'])) {
                return { ok: false, code: 'invalid_time_zone', message: 'at.time_zone 必须是合法的 IANA 时区。' };
            }
            // 形状对了还要问「这个墙钟在这一天真的存在吗」：夏令时前拨会跳过一段钟面
            // （America/New_York 2026-03-08 02:30 就没有）。上游同样拒，但给的是英文
            // `The local at time does not exist in the selected time zone.`。在这里拦一道，
            // 用户看到的就是一句中文；更重要的是**预览层用的就是同一个 `epochFromLocal`**，
            // 于是「面板不让选 ⇔ 提交被拒」也同源了。
            if (epochFromLocal(date, time, obj['time_zone']) === undefined) {
                return {
                    ok: false,
                    code: 'invalid_rule',
                    message: `${date} ${time} 在 ${obj['time_zone']} 里不是有效时间（该时区当天可能因夏令时跳过这段钟面）。`,
                };
            }
            atNormalized = { date, time, time_zone: obj['time_zone'] };
        }
        else {
            return { ok: false, code: 'invalid_rule', message: 'at 必须是字符串或 {date, time, time_zone} 对象。' };
        }
    }
    return { ok: true, value: { prompt: trimmed, time_zone, ...remainingSelectors(args, atNormalized) } };
}
/**
 * 挑出三选一的 selector。
 *
 * `at` 收**规范化后的值**（第二个入参）而不是 `args['at']`：规范化只发生在这里一次，
 * 下游 `buildScheduleRecord` 拿到的必然满足上游文法。
 */
function remainingSelectors(args, at) {
    const out = {};
    if (args['after_seconds'] !== undefined)
        out['after_seconds'] = args['after_seconds'];
    if (at !== undefined)
        out['at'] = at;
    if (args['every_seconds'] !== undefined)
        out['every_seconds'] = args['every_seconds'];
    return out;
}
/** 校验 IANA 时区（与 dsh-schedule canonicalize 同源，容错）。 */
export function isValidIanaZone(value) {
    if (typeof value !== 'string' || value.length === 0)
        return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 从会话日志导出「用户创建过的 schedule id 集合」。
 *
 * 只对**已迁移**的 pre-1.4 历史日志有意义（见 #58 与 `scripts/migrate-owned-events.mjs`）；
 * 新日志不再包含该事件，本函数对它们恒为空集。
 */
export function foldOwnedIds(events) {
    const owned = new Set();
    for (const event of events) {
        if (event.type !== OWNED_EVENT)
            continue;
        const data = event.data;
        if (typeof data !== 'object' || data === null || data.version !== 1)
            continue;
        if (data.operation === 'add')
            owned.add(data.id);
        else if (data.operation === 'remove')
            owned.delete(data.id);
    }
    return owned;
}
/**
 * 从会话日志导出「schedule id → 到点注入形态」映射（默认 `context`）。
 * 供 runtime 在 dispatch 时按 `/later` 与 `/schedule` 分别注入。
 */
export function foldOwnedDelivery(events) {
    const map = new Map();
    for (const event of events) {
        if (event.type !== OWNED_EVENT)
            continue;
        const data = event.data;
        if (typeof data !== 'object' || data === null || data.version !== 1)
            continue;
        if (data.operation === 'remove') {
            map.delete(data.id);
            continue;
        }
        map.set(data.id, data.delivery ?? 'context');
    }
    return map;
}
const foldCache = new WeakMap();
/** fold 当前会话的完整用户调度状态（带缓存；调用方不得变更返回值）。
 *
 * 跨代 Session API 探测已收敛到 `upstream-compat.ts`（readOwnEvents /
 * readLogCursor）——新 rc 若再改名只动那一处。
 *
 * 判据为什么从「数组引用 + 长度」换成「游标 + sidecar 代数」：`ownEvents()` 在
 * fork / 子代理会话（`inheritedEventCount > 0`）上每次 `log.slice()` 返回**新数组**，
 * 引用比较恒不命中——缓存对这类会话完全不存在，而且光是判定一次就要先拷一份全量
 * 日志。本函数在一次派发里被调两次（`runtime.driveOnce` 预算一次、维护事务内再算
 * 一次），插话路径同样两次，于是每个 fork 会话上的每一轮都白 fold 两遍。
 * 换成零分配的 `seq` 游标后，命中路径连日志数组都不必读。
 *
 * `generation` 那一维是新加的：结果里的 `owned`/`delivery` 有一部分来自 sidecar，
 * 而 sidecar 不属于会话日志。旧判据在 root 会话上本来就有这个盲区（引用+长度都
 * 不变时 sidecar 改了读不到），只是 fork 会话上缓存从不命中、反而看不见。既然这次
 * 让 fork 会话也开始吃缓存，就把这个盲区一并封掉——代价是任一会话写 sidecar 会让
 * 全部 fold 缓存作废，而写 sidecar 只发生在用户改动提醒时，那一刻本就该重算。
 */
export function foldUserState(session) {
    const cursor = readLogCursor(session);
    const generation = ownershipGeneration();
    const cached = foldCache.get(session);
    if (cached !== undefined &&
        cached.offset === cursor.offset &&
        cached.tail === cursor.tail &&
        cached.generation === generation) {
        return cached.state;
    }
    // 只有真要重算时才读全量日志：命中路径上一次分配都没有。
    const events = readOwnEvents(session);
    // number 形式进入 foldScheduleEvents：0.1.2 brandshape 校验接受 safe integer；
    // 0.1.1 直接收 number。
    const folded = asLegacySchedules(foldScheduleEvents(events, cursor.offset));
    // 所有权与投递形态：sidecar 为准（新写入），日志中的历史 OWNED 事件作底
    // （仅对已迁移的历史日志有效，见 #58：未迁移的旧日志会被宿主整份拒读）。
    const sessionId = session.header?.id;
    const owned = foldOwnedIds(events);
    const delivery = new Map(foldOwnedDelivery(events));
    if (typeof sessionId === 'string' && sessionId.length > 0) {
        for (const [id, entry] of Object.entries(allOwnership(sessionId))) {
            owned.add(id);
            if (!delivery.has(id))
                delivery.set(id, entry.delivery);
        }
    }
    const state = {
        folded,
        owned,
        delivery,
    };
    foldCache.set(session, { offset: cursor.offset, tail: cursor.tail, generation, state });
    return state;
}
/** 稳定内部错误（不透出异常细节）。 */
export function internalError() {
    return { ok: false, code: 'internal_error', message: '定时任务操作失败，请重试。' };
}
/** 稳定持久化不确定错误。 */
export function persistenceError() {
    return {
        ok: false,
        code: 'persistence_uncertain',
        message: '任务持久化未确认，请用 user_schedule_list 复核后再依赖该结果。',
    };
}
/** 把 dsh-schedule 的 ScheduleInputError 翻译为闭包错误值。 */
export function toInputError(error) {
    if (error instanceof ScheduleInputError) {
        return { ok: false, code: error.code, message: error.message };
    }
    return internalError();
}
/** 把 dsh-schedule 的 view 序列化为 snake_case 记录。 */
export function serializeScheduleView(view) {
    return {
        id: view.id,
        kind: view.kind,
        prompt: view.prompt,
        ...(view.kind === 'after' ? { after_seconds: view.afterSeconds } : {}),
        ...(view.kind === 'every' ? { every_seconds: view.everySeconds } : {}),
        scheduled_at: view.scheduledAt,
        state: view.state,
        // 0.1.5 内核给 'session-local'，0.1.7 改名为 'host'——两者语义相同
        // （提醒永不离开所属会话）。wire 契约对外归一为 'session-local'，
        // 避免内核改名传导到客户端与已存档的对话内容。
        delivery_mode: 'session-local',
        source: 'user-tool',
    };
}
/** 每个 agent 一个事务尾，串行化用户的读改写操作。 */
const tails = new WeakMap();
/** 在当前 agent 的事务尾之后运行操作。 */
export function runUserScheduleTransaction(agent, operation) {
    const run = (tails.get(agent) ?? Promise.resolve()).then(operation);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(agent, tail);
    /**
     * 清位必须等 tail **落定之后**，而且只在仍是自己时才清。
     *
     * 原先写成 `try { return run } finally { …tails.delete(agent) }`：`finally` 紧跟
     * 在 `return run` 之后**同步**执行，那一刻 `run` 还是个 pending promise，队尾就
     * 被当场删掉了。下一个并发调用 `tails.get(agent)` 取到 undefined，于是直接起跑
     * ——模块头承诺的「按 agent 串行化」从未真正生效过。
     *
     * 为什么是「落定后 + 比对身份」两条一起：操作在跑的时候 tail 必须留在表里，第三
     * 个操作才会排到它后面；而自己已经不是队尾时不能清，那等于替后来者抹掉它正在排
     * 的位置。清早了 = 并发，清晚了 = 白占一条已落定的 promise（WeakMap 以 agent 为
     * 键不会泄漏，但没必要留着）。
     */
    tail.then(() => {
        if (tails.get(agent) === tail)
            tails.delete(agent);
    });
    return run;
}
/** 等待一个成功的持久化 barrier。 */
async function flushSession(ctx, session) {
    try {
        return (await ctx.sessions.flush(session)) === true;
    }
    catch {
        return false;
    }
}
/** 构造一条通过与 dsh-schedule 完全兼容的 `schedule/change` 记录。 */
function buildScheduleRecord(input, id, now) {
    if (input.at !== undefined) {
        return createAtScheduleRecord(id, input.prompt, input.at, now);
    }
    if (input.after_seconds !== undefined) {
        return createAfterScheduleRecord(id, input.prompt, input.after_seconds, now);
    }
    return createEveryScheduleRecord(id, input.prompt, input.every_seconds, now);
}
/** `user_schedule_create` 核心实现。 */
export async function userScheduleCreate(input, agent, ctx, maxSchedules = DEFAULT_MAX_SCHEDULES, options, limits) {
    const validated = validateCreateInput(input, limits);
    if (!validated.ok)
        return validated;
    // 只认可信通道显式声明的形态；输入载荷中的 delivery 字段不具任何效力。
    const trustedDelivery = options?.trustedDelivery === 'user' ? 'user' : 'context';
    // 附件同理：仅取选项（可信通道）传入的块，并再过一次收窄（防御纵深——
    // 命令框架的准入已保证形状，但 options 是跨模块边界，不假设上游不变式）。
    const trustedAttachments = sanitizeAttachments(options?.attachments);
    return runUserScheduleTransaction(agent, async () => {
        const now = Date.now();
        let folded;
        let owned;
        try {
            const state = foldUserState(agent.session);
            folded = state.folded;
            owned = state.owned;
        }
        catch {
            return { ok: false, code: 'internal_error', message: '会话定时日志读取失败。' };
        }
        const activeCount = folded.active.filter((record) => owned.has(record.id)).length;
        if (activeCount >= maxSchedules) {
            return {
                ok: false,
                code: 'quota_exceeded',
                message: `当前会话最多 ${maxSchedules} 个定时任务，请先删除部分任务。`,
            };
        }
        const id = allocateScheduleId(folded);
        let record;
        try {
            record = buildScheduleRecord(validated.value, id, now);
        }
        catch (error) {
            return toInputError(error);
        }
        // 所有权写 sidecar（append 之前：投影 fold 在事件到达时按 sidecar 判定归属）。
        // flush 失败则回滚，避免 sidecar 与日志漂移。
        const sessionId = agent.session.header?.id;
        recordOwnership(sessionId, id, trustedDelivery, newTaskUid(), record.kind === 'after' ? record.afterSeconds : undefined, trustedAttachments);
        try {
            agent.session.append('schedule/change', {
                version: 1,
                operation: 'create',
                schedule: toChangePayload(record),
            });
        }
        catch {
            removeOwnership(sessionId, id);
            return internalError();
        }
        if (!(await flushSession(ctx, agent.session))) {
            removeOwnership(sessionId, id);
            return persistenceError();
        }
        const view = scheduleView(record, Date.now());
        return {
            ok: true,
            ...serializeScheduleView(view),
        };
    });
}
/** `user_schedule_list` 核心实现。 */
export async function userScheduleList(agent) {
    return runUserScheduleTransaction(agent, async () => {
        let folded;
        let owned;
        try {
            const state = foldUserState(agent.session);
            folded = state.folded;
            owned = state.owned;
        }
        catch {
            return { ok: false, code: 'internal_error', message: '会话定时日志读取失败。' };
        }
        const now = Date.now();
        const schedules = folded.active
            .filter((record) => owned.has(record.id))
            .map((record) => serializeScheduleView(scheduleView(record, now)));
        return { ok: true, schedules };
    });
}
/** `user_schedule_delete` 核心实现。id 可为 scheduleId 或稳定 uid。 */
export async function userScheduleDelete(id, agent, ctx) {
    if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
        return { ok: false, code: 'invalid_rule', message: 'schedule id 必须是去空白非空字符串。' };
    }
    return runUserScheduleTransaction(agent, async () => {
        const sessionId = agent.session.header?.id;
        let folded;
        try {
            folded = foldUserState(agent.session).folded;
        }
        catch {
            return { ok: false, code: 'internal_error', message: '会话定时日志读取失败。' };
        }
        // 1) 活动任务：uid → scheduleId
        const activeId = resolveActiveScheduleId(sessionId, id);
        if (folded.active.some((record) => record.id === activeId)) {
            try {
                agent.session.append('schedule/change', {
                    version: 1,
                    operation: 'delete',
                    id: ScheduleId(activeId),
                });
            }
            catch {
                return internalError();
            }
            if (!(await flushSession(ctx, agent.session)))
                return persistenceError();
            removeOwnership(sessionId, activeId);
            return { ok: true, id, deleted: true };
        }
        // 2) 暂停项：wire id 即 uid，只清 sidecar。
        //
        // 这里**不能**像活动任务那样补一条 `schedule/change` delete 事件：
        // dsh-schedule 的 fold 要求 delete 必须命中「仍 active」的 id，而该 id 在
        // pause 时就已经被删掉了（见 userSchedulePause），补写会抛
        // `schedule delete targets inactive id`，把整份日志读坏。
        //
        // 后果：投影 cell 不会因 sidecar 变化而重算，`paused[]` 镜像会停留在快照上。
        // 因此 `viewUserScheduleProjection` 改为**以 sidecar 为准重读**（权威存储），
        // 使删除即刻对客户端可见。
        const paused = getPaused(sessionId, id);
        if (paused !== undefined) {
            removePaused(sessionId, id);
            return { ok: true, id, deleted: true };
        }
        return { ok: true, id, deleted: false, code: 'schedule_not_found' };
    });
}
/** `user_schedule_edit`（改内容）核心实现：删旧建新，保留原时刻与 delivery。 */
export async function userScheduleEditPrompt(id, newPrompt, agent, ctx, limits = { allowLong: false, maxChars: DEFAULT_MAX_PROMPT_CHARS }) {
    if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
        return { ok: false, code: 'invalid_rule', message: 'schedule id 必须是去空白非空字符串。' };
    }
    const promptResult = validatePrompt(newPrompt, limits);
    if (!promptResult.ok)
        return promptResult;
    const trimmed = promptResult.value;
    return runUserScheduleTransaction(agent, async () => {
        const sessionId = agent.session.header?.id;
        /**
         * issue #44：投影**有意**把 uid 当作 `id` 暴露给客户端
         * （`src/projection.ts:179` 的 `id: uid ?? record.id`），所以 dock 传 uid 是正确的，
         * 换算必须由 host 侧完成。这里走与 `userScheduleDelete` / `userSchedulePause`
         * **同一条** resolver —— 此前那两处都调了、唯独漏了编辑，导致同一个 uid
         * 删除能成功、改文案却静默失败。
         *
         * ⚠️ 只换算「活动项查找」。暂停项的 `getPaused(sessionId, uid)` 以 **uid**
         * 为键（`ownership-store.ts:412`），所以下面的暂停分支必须继续用原始 `id`，
         * 不能改用 `scheduleId` —— 否则是把一个 bug 换成另一个（暂停项反而改不了文案）。
         */
        const scheduleId = ScheduleId(resolveActiveScheduleId(sessionId, id));
        let folded;
        let deliveries;
        try {
            const state = foldUserState(agent.session);
            folded = state.folded;
            deliveries = state.delivery;
        }
        catch {
            return { ok: false, code: 'internal_error', message: '会话定时日志读取失败。' };
        }
        const existing = folded.active.find((record) => record.id === scheduleId);
        if (existing === undefined) {
            /**
             * 暂停项的编辑：只改 sidecar 里的 `prompt`。
             *
             * 为什么单独走一条路：暂停 = 日志 `delete` + sidecar 留档（方案 B），所以
             * 暂停项**在日志里不存在**，`folded.active` 必然找不到它。但内容本就存在
             * `PausedEntry.prompt`（resume 时用它重建记录），因此直接改写该字段即可——
             * 不动时刻、不动剩余秒数、不动 uid、不产生任何会话事件。
             *
             * 这也消掉了"暂停了就不能改文案"这个反直觉的限制。
             */
            // ⚠️ 这里**必须**用原始 `id`（= uid），不能用上面换算过的 `scheduleId`：
            // `paused` 这张表以 uid 为键（见 ownership-store.ts:412）。
            const paused = getPaused(sessionId, id);
            if (paused !== undefined) {
                // 仅替换 prompt，其余字段（remainingSeconds / pausedAt / uid / 原窗口）
                // 原样保留 → 冻结进度与恢复后的窗口都不受影响。
                recordPaused(sessionId, { ...paused, prompt: trimmed });
                // 复用与日志记录一致的序列化，避免两处形状漂移。
                return {
                    ok: true,
                    ...serializeScheduleView(scheduleView({
                        id: paused.lastScheduleId,
                        kind: 'after',
                        prompt: trimmed,
                        afterSeconds: paused.originalAfterSeconds ?? paused.remainingSeconds,
                        scheduledAt: paused.originalScheduledAt,
                    }, Date.now())),
                };
            }
            // 报**调用方传入的 id**（dock 与日志看到的就是它），而不是换算后的 scheduleId：
            // 本次 bug 之所以难查，正是因为报错里的 id 与用户手里那个对不上号。
            // 传入真 scheduleId 时两者相同，无歧义。
            return { ok: false, code: 'schedule_not_found', message: `未找到定时任务 ${id}。` };
        }
        // P0-4：已过期（overdue）的 at 任务禁止改内容——「保留原时刻」会让新记录
        // 一落日志就处于到期状态，下一次 drive 立即注入，用户会以为只是改了文案
        // 却被瞬间代发。要求先删除再重建，语义清晰可预期。
        if (existing.kind === 'at' &&
            Date.parse(existing.scheduledAt) <= Date.now()) {
            return {
                ok: false,
                code: 'already_overdue',
                message: `定时任务 ${scheduleId} 的目标时刻已过，不能修改内容；请删除后重新创建。`,
            };
        }
        const now = Date.now();
        let record;
        try {
            if (existing.kind === 'after') {
                record = createAfterScheduleRecord(allocateScheduleId(folded), trimmed, 
                // 编辑会重置从「现在」起的倒计时；保留原间隔长度
                existing.afterSeconds, now);
            }
            else if (existing.kind === 'at') {
                record = createAtScheduleRecord(allocateScheduleId(folded), trimmed, existing.scheduledAt, // ISO 字符串，保留原时刻（不重置到未来）
                now);
            }
            else {
                // 0.1.7 的 `ScheduleRecord` 联合新增 daily/weekly/cron（均无
                // `everySeconds`）。本插件只创建 every，故其余变体按 300s 默认间隔
                // 归一——它们只可能来自其他插件写入的日志，不是本插件的产物。
                const everySeconds = existing.kind === 'every' && typeof existing.everySeconds === 'number'
                    ? existing.everySeconds
                    : 300;
                record = createEveryScheduleRecord(allocateScheduleId(folded), trimmed, everySeconds, now);
            }
        }
        catch (error) {
            return toInputError(error);
        }
        const delivery = deliveries.get(scheduleId) ?? 'context';
        // 新所有权先写 sidecar（create 事件到达投影 fold 时按 sidecar 判定归属）；
        // 旧条目在 flush 成功后再撤销（失败回滚两侧）。uid 跨编辑保留。
        const previousEntry = getOwnership(sessionId, scheduleId);
        // 编辑 after 会重置倒计时 → 窗口等于新 afterSeconds，不沿用 resume 旧窗口
        recordOwnership(sessionId, record.id, delivery, previousEntry?.uid, record.kind === 'after' ? record.afterSeconds : undefined, 
        // 附件跨「删旧建新」保留：编辑只换文案，随命令提交的图片/文件仍属于这条
        // 提醒。新 id 无旧条目可回退，必须显式带上。
        previousEntry?.attachments);
        try {
            agent.session.append('schedule/change', { version: 1, operation: 'delete', id: scheduleId });
            agent.session.append('schedule/change', { version: 1, operation: 'create', schedule: toChangePayload(record) });
        }
        catch {
            removeOwnership(sessionId, record.id);
            return internalError();
        }
        if (!(await flushSession(ctx, agent.session))) {
            removeOwnership(sessionId, record.id);
            if (previousEntry !== undefined)
                recordOwnership(sessionId, scheduleId, previousEntry.delivery);
            return persistenceError();
        }
        removeOwnership(sessionId, scheduleId);
        const view = scheduleView(record, Date.now());
        return { ok: true, ...serializeScheduleView(view) };
    });
}
/** 把 wire/命令里的 id 解析为当前 active 的日志 schedule id（uid 或 scheduleId）。 */
function resolveActiveScheduleId(sessionId, id) {
    if (getOwnership(sessionId, id) !== undefined)
        return id;
    const byUid = findScheduleIdByUid(sessionId, id);
    return byUid ?? id;
}
/**
 * 暂停一条 **after** 提醒（方案 B）：sidecar 留档 + 日志 delete。
 * 仅 kind==='after' 且未到点；恢复见 {@link userScheduleResume}。
 */
export async function userSchedulePause(id, agent, ctx) {
    if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
        return { ok: false, code: 'invalid_rule', message: 'schedule id 必须是去空白非空字符串。' };
    }
    return runUserScheduleTransaction(agent, async () => {
        const sessionId = agent.session.header?.id;
        let folded;
        let owned;
        let deliveryMap;
        try {
            const state = foldUserState(agent.session);
            folded = state.folded;
            owned = state.owned;
            deliveryMap = state.delivery;
        }
        catch {
            return { ok: false, code: 'internal_error', message: '会话定时日志读取失败。' };
        }
        const scheduleId = resolveActiveScheduleId(sessionId, id);
        const existing = folded.active.find((record) => record.id === scheduleId);
        if (existing === undefined || !owned.has(scheduleId)) {
            return { ok: false, code: 'schedule_not_found', message: `未找到可暂停的定时任务 ${id}。` };
        }
        if (existing.kind !== 'after') {
            return { ok: false, code: 'unsupported_kind', message: '仅支持暂停「再等 N 分钟」类（after）提醒。' };
        }
        const now = Date.now();
        const target = Date.parse(existing.scheduledAt);
        if (!Number.isFinite(target) || target <= now) {
            return {
                ok: false,
                code: 'already_overdue',
                message: '任务已到点，无法暂停；请删除或等待发送。',
            };
        }
        const remainingSeconds = Math.max(1, Math.ceil((target - now) / 1000));
        const ownership = getOwnership(sessionId, scheduleId);
        const uid = ownership?.uid ?? newTaskUid();
        const delivery = deliveryMap.get(scheduleId) ?? ownership?.delivery ?? 'context';
        // 旧条目无 uid 时补写，保证 pause 后有稳定身份
        if (ownership?.uid === undefined) {
            recordOwnership(sessionId, scheduleId, delivery, uid);
        }
        /**
         * 进度条总窗口（原间隔），**不能**用 `existing.afterSeconds`。
         *
         * resume 会用 `after_seconds = remaining` 重建记录（日志里的 afterSeconds
         * 只是剩余），而把原窗口另行保存在 ownership.windowSeconds。若这里读日志的
         * afterSeconds，每「恢复→再暂停」一轮窗口就缩水一次：
         *   2 分钟任务 → 暂停(窗 120) → 恢复(日志 85) → 再暂停(窗被记成 85) …
         * 表现为暂停后进度条比例越来越离谱（实测 29% → 2.3% 塌缩）。
         * 故优先取 ownership 里保留的窗口，再回退日志值（首次暂停时两者相同）。
         */
        const windowSeconds = ownership?.windowSeconds ?? existing.afterSeconds;
        const pausedEntry = {
            uid,
            prompt: existing.prompt,
            delivery,
            kind: 'after',
            remainingSeconds,
            originalScheduledAt: existing.scheduledAt,
            ...(windowSeconds !== undefined ? { originalAfterSeconds: windowSeconds } : {}),
            lastScheduleId: scheduleId,
            pausedAt: now,
            // 附件随条目冻结：pause 会把日志记录删除，留档是暂停项唯一的素材来源，
            // 不带附件会让「暂停→恢复/插话」静默丢图。
            ...(ownership?.attachments !== undefined ? { attachments: ownership.attachments } : {}),
        };
        // sidecar 先写（投影 delete 后按 lastScheduleId 挂回 paused 列表）
        recordPaused(sessionId, pausedEntry);
        try {
            agent.session.append('schedule/change', {
                version: 1,
                operation: 'delete',
                id: ScheduleId(scheduleId),
            });
        }
        catch {
            removePaused(sessionId, uid);
            return internalError();
        }
        if (!(await flushSession(ctx, agent.session))) {
            removePaused(sessionId, uid);
            return persistenceError();
        }
        removeOwnership(sessionId, scheduleId);
        return {
            ok: true,
            uid,
            schedule_id: scheduleId,
            remaining_seconds: remainingSeconds,
            scheduled_at: existing.scheduledAt,
        };
    });
}
/** 恢复一条暂停中的 after 提醒：`after_seconds = remaining` 重建；uid 不变。 */
export async function userScheduleResume(uid, agent, ctx, maxSchedules = DEFAULT_MAX_SCHEDULES) {
    if (typeof uid !== 'string' || uid.length === 0 || uid.trim() !== uid) {
        return { ok: false, code: 'invalid_rule', message: 'uid 必须是去空白非空字符串。' };
    }
    return runUserScheduleTransaction(agent, async () => {
        const sessionId = agent.session.header?.id;
        const paused = getPaused(sessionId, uid);
        if (paused === undefined) {
            return { ok: false, code: 'not_paused', message: `未找到暂停中的任务 ${uid}。` };
        }
        let folded;
        let owned;
        try {
            const state = foldUserState(agent.session);
            folded = state.folded;
            owned = state.owned;
        }
        catch {
            return { ok: false, code: 'internal_error', message: '会话定时日志读取失败。' };
        }
        const activeCount = folded.active.filter((record) => owned.has(record.id)).length;
        if (activeCount >= maxSchedules) {
            return {
                ok: false,
                code: 'quota_exceeded',
                message: `当前会话最多 ${maxSchedules} 个定时任务，请先删除部分任务。`,
            };
        }
        const now = Date.now();
        let record;
        try {
            record = createAfterScheduleRecord(ScheduleId(allocateScheduleId(folded)), paused.prompt, Math.max(1, paused.remainingSeconds), now);
        }
        catch (error) {
            return toInputError(error);
        }
        // 先清 paused：投影 fold 在 append(create) 时读 sidecar；若 create 落地后才
        // removePaused，视图会短暂同时出现「已暂停」+ 新活动行（实测重复行根因）。
        removePaused(sessionId, uid);
        // 保留原 after 窗口：日志 afterSeconds 只是 remaining，进度条需要原窗口才能接着跑
        recordOwnership(sessionId, record.id, paused.delivery, uid, paused.originalAfterSeconds ?? paused.remainingSeconds, paused.attachments);
        try {
            agent.session.append('schedule/change', {
                version: 1,
                operation: 'create',
                schedule: toChangePayload(record),
            });
        }
        catch {
            removeOwnership(sessionId, record.id);
            recordPaused(sessionId, paused);
            return internalError();
        }
        if (!(await flushSession(ctx, agent.session))) {
            removeOwnership(sessionId, record.id);
            recordPaused(sessionId, paused);
            return persistenceError();
        }
        return {
            ok: true,
            uid,
            schedule_id: record.id,
            remaining_seconds: Math.max(1, paused.remainingSeconds),
        };
    });
}
/** 测试/投影辅助：某会话全部暂停留档。 */
export function listPausedForSession(sessionId) {
    return allPaused(sessionId);
}
/** 测试辅助：按 pause 前 schedule id 查留档。 */
export function findPausedEntry(sessionId, scheduleId) {
    return findPausedByScheduleId(sessionId, scheduleId);
}
