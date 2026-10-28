/**
 * 上游内核跨代兼容层：把「鸭子类型双轨探测 + peer 代次矩阵 + 内核版本判定」收敛到单文件。
 *
 * ## 支持的下界是 0.1.2-rc.1（issue #95 的结论，issue #101 的兼容层补回 0.1.2/0.1.5）
 *
 * 2026-10-26 用「把整条 `@deepseek-ai/dsh*` 依赖线换成目标代次后跑本仓 tsc」量了一遍，
 * 当时 0.1.1 / 0.1.2 / 0.1.5 三代都是红的，于是先把下界收到 0.1.7-rc.1（PR #98）。
 * 随后按同一份测量把**能兼容的都补回来**（PR #101）：
 *
 *   · `0.1.5-rc.1`：图标在 0.1.7 之前叫尺寸后缀（`IconClockOutline16` / `IconChevronDownOutline14`），
 *     0.1.7 起改成 `…OutlineRegular`；`Tooltip` 的 `portal` prop 也是之后才有；
 *     `fileMediaUrl` 在那代的 `dsh-util-workspace-path` 里没有；`schemastery 3.18.2` 还缺
 *     `Schema.volatile()`（缺了会整条插件加载失败）。这些收进 `primitives-compat.ts` /
 *     `workspace-path-compat.ts` / `index.ts` 的能力探测（新名优先、缺方法则降级）。
 *     该代按 **rc.3** 验证（rc.1 的默认安装会 caret 混装 rc.3 组件、装配即失败，见该代注释）。
 *   · `0.1.2-rc.1`：除上面那些，还缺 `FileTypeIcon` / `fileSizeText`（降级为回形针图标与本地尺寸文案），
 *     宿主侧 `CommandInputDescriptor` 无 `attachments`、`dsh-llm` 无 `FileBlock`、
 *     `ContentBlock` 无 `file` 变体（文件附件降级为 `[附件] 名字` 文本块）。同样两个 tsconfig 0 条。
 *   · `0.1.1-rc.2`：**无法自证** —— `@deepseek-ai/dsh-util-workspace-path@0.1.1-rc.2` 在 registry
 *     未发布（`npm view` 404），依赖装不出；不是代码问题，任何工具都给不出结论。故不入表。
 *
 * 入表标准因此固定为「**装配功能 + 跨代 tsc 两面都过**」，见下方 KERNEL_GENERATIONS 的注释。
 *
 * 历史背景（本模块存在的原因）：0.1.1 → 0.1.2 之间有多处不兼容，此前散落在
 * user-tools / index / package.json 各处。上游每发新 rc 需要：
 *   1. package.json peer + dev 各包补一枚举项（node-semver 不把预发布算进范围）
 *   2. Session API 形状若有变化，只改本模块的 read* 函数
 *
 * 新 rc 落地 checklist：
 *   - 在 KERNEL_GENERATIONS 追加一代（id + peerRange + sessionApi）
 *   - 跑 `node scripts/sync-peer-matrix.mjs` 重写 package.json peer 枚举
 *   - 跑 `npm test`（含 tests/upstream-compat.test.mjs 矩阵护栏）
 *   - 跨代 tsc + 功能面：`node devkit/matrix.mjs --versions <代次> --steps gate,peer,typecheck`
 *     与 `node scripts/verify-across-kernels.mjs --versions <代次>`
 *
 * ## 为什么这里要读内核版本号（issue #75）
 *
 * 有些代次差异**不能靠符号存在性推断**，因为上游的两个破坏性变更不在同一个 rc 落地：
 * `kind:'plugin'` 在 **0.1.7-rc.1** 就被 v4 准入拒绝了，而 `renderEveryReminderBatchFraming`
 * 的改名要到 **rc.2** 才发生。rc.1 于是是一代「旧符号还在、旧 kind 已死」的组合代——
 * 任何按符号探测的分支都会在这里选错，且**选错是静默的**（提醒到点 100% 不投递，日志里没有
 * 一句能读的话）。0.1.5 与 0.1.7-rc.1 的 `dsh-schedule` 导出面在这两个版本上逐符号相同
 * （registry 里 `@deepseek-ai/dsh-schedule@0.1.5-rc.1` 与 `0.1.7-rc.1` 都存在，实测
 * `renderEveryReminderBatchFraming` / `allocateScheduleId` 两边都在），所以符号判据
 * 结构上不可能区分它们——只有版本号能。
 *
 * 于是规则是：**版本号优先，符号探测退居降级路径**。符号探测仍然留着，因为版本读不到时
 * 它比「猜一个」强；但那条路径必须**可见**（一次 `console.warn`），否则就是回到本次事故
 * 的成因：错得很安静。
 *
 * @module dsh-later/upstream-compat
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * 已验证的内核代次（peer 枚举的唯一事实来源）。
 *
 * 入表的标准是**两面都过**：装配/功能（`verify-across-kernels.mjs`）与**跨代类型编译**
 * （把整条 `dsh-*` 依赖线换成该代次后 tsc 双项目零错）。只有后者才拦得住「旧内核没有这个
 * 能力 / 这个符号改了名」——issue #95 就是这么把 0.1.1 / 0.1.2 / 0.1.5 三代请出表的。
 *
 * - `id`：semver 精确版本（发布 tag）
 * - `peerRange`：写入 package.json 的范围（node-semver 预发布需显式枚举）
 * - `sessionApi`：Session 读日志的形状（见 readOwnEvents / readInheritedEventCount）。
 *   现在表里**没有任何一代用 `legacy-events`**（0.1.1 已出表）；该取值与 read* 的兜底分支
 *   保留为防御——第三方伪造 Session、或未来某代悄悄改形状时，失败要可诊断而不是抛 undefined。
 */
export const KERNEL_GENERATIONS = [
    {
        /**
         * `0.1.2-rc.1` 代次：Session 形状已是 `ownEvents()` + `inheritedEventCount`（0.1.1 的
         * `.events` + `header.seedLength` 到这里已经改成新形状）。
         *
         * 与 0.1.7+ 的差异是**能力/命名**而不是 Session：UI 原语缺 `FileTypeIcon`/`fileSizeText`、
         * 图标用尺寸后缀名、`Tooltip` 没有 `portal`、`CommandInputDescriptor` 没有 `attachments`、
         * `dsh-llm` 没有 `FileBlock`、`ContentBlock` 没有 `file` 变体。这些全部收在
         * `src/client/primitives-compat.ts`、`src/client/workspace-path-compat.ts` 与宿主侧
         * 的兼容层里（见 issue #95 / #101），跨代 tsc 两个项目都是 0 条错误。
         */
        id: '0.1.2-rc.1',
        peerRange: '^0.1.2-rc.1',
        sessionApi: 'own-events',
    },
    {
        /**
         * `0.1.5` 线：**列 rc.3，不列 rc.1**（实测结论，见下）。
         *
         * Session 形状未变（仍 `ownEvents()` + `inheritedEventCount`）；`dsh-schedule` 的导出面与
         * 0.1.7-rc.1 **逐符号相同**（`renderEveryReminderBatchFraming` / `allocateScheduleId` 两边都在），
         * 所以**符号判据区分不了这两代**，只能读版本号（issue #75）。
         *
         * 为什么 id 是 rc.3：`@deepseek-ai/dsh@0.1.5-rc.1` 的内部依赖写的是 `^0.1.5-rc.1`，
         * 按默认安装会把整条插件线解析到 **rc.3**（实测 lockfile 里 238 个 `@deepseek-ai/dsh*`
         * 有 237 个不是 rc.1）——也就是说这一代用户实际拿到的是**统一的 rc.3**，能验证的形态也只有它。
         *
         * ⚠️ 早先这里写的是「rc.1 启动器 + rc.3 组件混装**装不起来**」，那是**误判**，别再照着它做
         * 决定。逐插件补全 peer 后同一棵树能 mount（投递 spliced=1 / dispatch=Y / at 5/5）。当时的
         * RED 来自 `scripts/verify-across-kernels.mjs` 自己的两个装配口径：① 写死顶层
         * `dsh-app-boot` 路径，而纯 rc.1 安装会把它嵌到 `dsh/node_modules` 下；② 用
         * `--legacy-peer-deps` 跳过 peer，而 `ensureBootPeers` 只补 app-boot 一棵线——
         * `dsh-session-persistence-jsonl` 是靠 **peer** 拿 `dsh-session-persistence` 的，于是报
         * `Cannot find package`。这两个洞应当修在脚本里；在此之前，脚本对 rc.1 的 RED **不构成**
         * 「该代不支持」的证据。
         *
         * 该代还有一处 schemastery 差异：`s.object(...).volatile()` 在它装的 **3.18.2** 上不存在
         * （整条插件加载失败，`…volatile is not a function`）—— 已在 `src/index.ts` 里做能力探测降级。
         *
         * UI 侧差异（图标尺寸后缀名、`Tooltip` 无 `portal`、`fileMediaUrl` 缺失）由
         * `primitives-compat.ts` / `workspace-path-compat.ts` 兜住；它本身有 `FileTypeIcon`/`fileSizeText`。
         */
        id: '0.1.5-rc.3',
        peerRange: '^0.1.5-rc.3',
        sessionApi: 'own-events',
    },
    {
        /**
         * `0.1.7-rc.1`：**必须单列的组合代**（issue #75）。
         *
         * 上游两个破坏性变更不在同一个 rc 落地：
         *  - **本代已删** 消息 `source.kind:'plugin'`——实测它的
         *    `@deepseek-ai/dsh-session-format-v3-to-v4` 在写入时刻对 `kind === 'plugin'`
         *    直接 throw `format v4 message requires a producer-owned source kind`；
         *  - **本代未改** `renderEveryReminderBatchFraming` 的名字（改名到 rc.2 才发生），
         *    `allocateScheduleId` 也**仍在**导出（rc.2 才删）。
         *
         * 于是任何按 `dsh-schedule` 符号存在性做的分代在这里必然判错：rc.1 的导出面与
         * 0.1.5 **逐符号相同**（两版都在 registry，实测 `renderEveryReminderBatchFraming`
         * 与 `allocateScheduleId` 两边都有）。区分它们只有版本号，见
         * `schedule-compat.ts:messageSourceDecision()`。
         *
         * 选错的后果是静默的：提醒到点 100% 不投递，会话日志里既没有
         * `schedule/change operation:dispatch`、也没有那句校验报错（它在宿主 stdout），
         * 用户只看到「超时未确认」。实测（devkit `func-later --case drive-gates`）：
         * rc.1 上 `fold` 由 active 1 → 0（窗口过期，不是消费），`agent/inbox/spliced`=0。
         *
         * `sessionApi` 仍是 `own-events`：Session 形状这一面本代未变，变的只是消息准入。
         */
        id: '0.1.7-rc.1',
        peerRange: '^0.1.7-rc.1',
        sessionApi: 'own-events',
    },
    {
        /**
         * `0.1.7` 代次（此处指 rc.2 起）：Session 形状仍未变（`ownEvents()` + `inheritedEventCount`）；
         * `dsh-schedule` 的三处破坏性变更（`allocateScheduleId` 删除、
         * `renderEveryReminderBatchFraming` 改名 `renderRecurringReminderBatchFraming`、
         * `createAfterScheduleRecord` 新增必填 `title`）**全部收敛在
         * `schedule-compat.ts`**——调用点 `user-tools.ts` / `runtime.ts` 不含版本分支。
         *
         * 三条差异在 bridge 里按「存在性择一」（framing）或「统一用新语义」
         * （UUID id、title 派生）处理，两代行为一致，故可安全同时声明这两个范围。
         *
         * ⚠️ 但「与 0.1.5 行为一致」这条**对消息 source kind 不成立**：`plugin` kind 的淘汰
         * 落在 rc.1，比这里登记的 rc.2 早一个 rc，所以 source kind 一律走
         * `schedule-compat.ts` 的版本判定，不走符号存在性（issue #75）。
         *
         * 不单列 0.1.6-alpha.*：alpha 线无独立兼容面，且 0.1.7 已覆盖其功能面。
         */
        id: '0.1.7-rc.2',
        peerRange: '^0.1.7-rc.2',
        sessionApi: 'own-events',
    },
    {
        /**
         * `0.2.0` 代次：内核跨了次版本号（0.1 → 0.2），但本插件依赖的 API 面
         * **全部保持**。逐项核对（见 docs/verification.md「0.2.0 兼容核对」）：
         *
         * - Session：形状未变（`ownEvents()` + `inheritedEventCount`）
         * - dsh-schedule：0.1.7 的三处破坏性变更即为 0.2.0 现状；`foldScheduleEvents`
         *   / `renderReminderFraming` / `resolveEveryOccurrence` / `decodeScheduleChange`
         *   / `scheduleView` / `ScheduleId` 导出面完整，且
         *   `renderRecurringReminderBatchFraming` 仍在 —— `schedule-compat.ts` 无需改动
         * - dsh-llm：`createUserMessage` / `boundContextSummary` 仍在；`MessageSourceMap`
         *   已无 `plugin` kind，仅剩 user/model/tool/system-prompt，而 dsh-schedule
         *   声明的 `schedule` kind 经 module augmentation 并入 —— 0.1.7 分支继续适用
         * - dsh-agent：`followup()`（next-turn）与 `steer()`（next-step）语义未变
         * - dsh-tools：`defineTool` 仍在
         *
         * 实证：以 0.2.0-rc.2 类型面对 `src/**`（host 端）跑 `tsc --noEmit` **零错误**，
         * 且本地 183 项测试全绿。
         *
         * 附带影响：0.2.0 内核开始**强制**校验本范围（peer 不满足即整插件不加载，
         * 此前只是警告）。故这一代次的缺失曾让插件在 0.2.0 上完全失效。
         */
        id: '0.2.0-rc.2',
        peerRange: '^0.2.0-rc.2',
        sessionApi: 'own-events',
    },
    {
        /**
         * `0.2.1` 代次：版本号只跳了补丁位，但**不是零差异**，逐项核对如下
         * （详见 docs/verification.md「0.2.1 兼容核对」）：
         *
         * - Session：形状未变 —— `ownEvents(): readonly SessionEvent[]` 与
         *   `inheritedEventCount: SessionLogOffset` 仍在（0.2.1-rc.2 类型声明实测），
         *   `readOwnEvents` / `readInheritedEventCount` 原样可用
         * - dsh-schedule：`renderRecurringReminderBatchFraming` 仍在导出，
         *   `scheduleMessageSource()` 的版本判定继续命中 `kind:'schedule'`（判定方式已从
         *   符号存在性换成内核版本，issue #75；本代两种口径结论一致），
         *   不新增分支；`createAfterScheduleRecord` arity 仍为 5；其余依赖的导出面完整
         * - 唯一差异：`ScheduleInputError` 多一个 `subagent_session` 码。它由上游
         *   `create` 对「委派子代理 Session」的拒绝产生，而本插件自己 append
         *   `schedule/change`、不经过该服务，故只需在 `user-tools.ts` 的错误码联合里
         *   登记（翻译器直通），业务逻辑无分支
         * - dsh-llm / dsh-tools：`createUserMessage` / `boundContextSummary` /
         *   `defineTool` 均在
         *
         * 实证：devDependencies 全量固定到 0.2.1-rc.2 后，host + client 两条
         * `tsc --noEmit` 零错误，`npm test` 407 项全绿。
         */
        id: '0.2.1-rc.2',
        peerRange: '^0.2.1-rc.2',
        sessionApi: 'own-events',
    },
];
/**
 * 随内核代次一起 bump 的 peer 包（宿主 hoisting 变化会波及这些运行时 import）。
 * cordis / schemastery 等独立 semver 包**不**列入——它们不随内核 rc 枚举。
 */
export const KERNEL_SCOPED_PACKAGES = [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-schedule',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-tools',
];
/** dsh-commands 在 0.1.1 之前还有一代 rc.0，peer 需额外并上。 */
const EXTRA_PEER_RANGES = {
    '@deepseek-ai/dsh-commands': ['^0.0.1-rc.1'],
};
/** 由 KERNEL_GENERATIONS 拼出的 peer 范围串（`a || b`）。 */
export function peerRangeFor(packageName) {
    const extras = EXTRA_PEER_RANGES[packageName] ?? [];
    return [...extras, ...KERNEL_GENERATIONS.map((g) => g.peerRange)].join(' || ');
}
/** 全部需逐代枚举的 `{ package, range }`（sync-peer-matrix / 矩阵测试共用）。 */
export function peerMatrixEntries() {
    return KERNEL_SCOPED_PACKAGES.map((packageName) => ({
        packageName,
        range: peerRangeFor(packageName),
    }));
}
/**
 * 读取「本会话自有」事件日志（不含 fork 继承前缀时由调用方配合 offset）。
 *
 * - 0.1.2+：`session.ownEvents()`（推荐；仅 live 段）
 * - 0.1.1：`session.events`（含 seed；配合 seedLength 切片）
 */
export function readOwnEvents(session) {
    const surface = session;
    if (typeof surface.ownEvents === 'function') {
        return surface.ownEvents();
    }
    return surface.events ?? [];
}
/**
 * 读取「fork 继承前缀长度」——`foldScheduleEvents` 第二参数。
 *
 * - 0.1.2+：`session.inheritedEventCount`（SessionLogOffset 品牌数字，运行时仍是 number）
 * - 0.1.1：`session.header.seedLength`（等价物；此前实现漏了这条回退）
 * - 均缺失：0（新建会话 / 测试假 Session）
 *
 * 统一以裸 `number` 返回：cache key 可用 `===`；传入 foldScheduleEvents 时
 * 0.1.2 的 brandshape 校验接受 safe integer。
 */
export function readInheritedEventCount(session) {
    const surface = session;
    const modern = surface.inheritedEventCount;
    if (typeof modern === 'number' && Number.isSafeInteger(modern) && modern >= 0) {
        return modern;
    }
    const seed = surface.header?.seedLength;
    if (typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0) {
        return seed;
    }
    return 0;
}
export function readLogCursor(session) {
    const surface = session;
    const offset = readInheritedEventCount(session);
    const seq = surface.seq;
    if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0) {
        return { offset, tail: seq };
    }
    return { offset, tail: readOwnEvents(session).length };
}
/**
 * 给 `foldScheduleEvents` 备一份**成对**的输入：日志数组 + 该传的前缀长度。
 *
 * 为什么这两者必须一起决定、不能各查各的：
 *
 * 上游契约写的是 `@param events - Complete ordered session log`，第二参数是
 * 「继承前缀长度」，函数体里就是 `events.slice(inheritedEventCount)`，并且
 * `inheritedEventCount > events.length` 直接抛 `ScheduleLogError`
 * （dsh-schedule/lib/index.js:918-926）。内核自己唯一的调用是
 * `foldScheduleEvents(session.ownEvents())`——**不带第二参数**
 * （dsh-schedule/lib/index.js:2034）。
 *
 * 而 `ownEvents()` 返回的**已经是去掉继承前缀的自有段**
 * （`snapshotEvents(inheritedEventCount)` → `log.slice(inheritedEventCount)`）。
 * 所以「自有段 + 非零 offset」= 前缀被排除两次：
 *  - 自有段比前缀短 → 上游抛错 → 该会话每个 `user_schedule_*` 都变
 *    `internal_error`，调度器每次 drive 都在 fold 处 return，**一条提醒都不触发**；
 *  - 自有段比前缀长 → 静默跳过最早的那几条自有事件，用户建好的提醒既不出现也不响。
 *
 * 这里把配对规则收成一处：走 `ownEvents()` 就传 0，走旧代含 seed 的 `.events`
 * 整表才传前缀长度。调用方不再自己拼这两个值，也就没法再拼错。
 */
export function readFoldInput(session) {
    const surface = session;
    if (typeof surface.ownEvents === 'function') {
        // 自有段：前缀已经被内核切掉，再切一次就是双重排除。
        return { events: surface.ownEvents(), inheritedEventCount: 0 };
    }
    // 旧代 `.events` 含 seed 全长，前缀由 fold 自己切。
    return { events: surface.events ?? [], inheritedEventCount: readInheritedEventCount(session) };
}
/**
 * 按**绝对 seq** 读单条事件（零分配，配合 {@link readLogCursor} 做增量扫描）。
 *
 * 表内六代都导出 `eventAt(seq)`，实测一致；它是内核推荐的面（`ownEvents()` 已被标
 * `@deprecated`，理由正是「同步读整份日志」）。
 *
 * 回落面的索引口径要分清，否则会读错一条：
 * - 内核有 `eventAt` → 参数是绝对 seq，内核自己处理继承前缀
 * - 只有 `ownEvents()`（假 session）→ 它返回的是**不含前缀**的自有段，所以要
 *   `seq - offset` 才能对上
 * - 只有 `.events`（0.1.1 那代）→ 数组含 seed 全长，绝对 seq 直接索引
 */
export function readEventAt(session, seq) {
    const surface = session;
    if (typeof surface.eventAt === 'function') {
        return surface.eventAt(seq);
    }
    const events = readOwnEvents(session);
    const index = typeof surface.ownEvents === 'function'
        ? seq - readInheritedEventCount(session)
        : seq;
    return index >= 0 ? events[index] : undefined;
}
/** 探测到的 sessionApi 代次（诊断 / 测试用；不参与业务分支）。 */
export function detectSessionApi(session) {
    return typeof session.ownEvents === 'function'
        ? 'own-events'
        : 'legacy-events';
}
// ── 内核版本判定（issue #75）───────────────────────────────────────────────────────
/**
 * `kind:'plugin'` 被内核淘汰的**最早**版本。
 *
 * 实测：0.1.7-rc.1 的 `@deepseek-ai/dsh-session-format-v3-to-v4` 在消息写入时刻对
 * `kind === 'plugin'` 直接 throw `format v4 message requires a producer-owned source kind`。
 * 这一代同时**仍**导出 `renderEveryReminderBatchFraming`（改名到 rc.2 才发生），所以
 * 「符号还在」不等于「kind 还被收着」——本常量就是把这条分界线写死在版本号上。
 */
export const PLUGIN_KIND_RETIRED_SINCE = '0.1.7-rc.1';
/**
 * 读内核版本时依次尝试的 specifier，先命中的算。
 *
 * 顺序的理由：`@deepseek-ai/dsh` 是宿主本体，「消息由谁准入」以它为准；但插件的模块解析
 * 根里未必看得见它（pnpm 隔离布局只保证 peer 可见），于是紧跟 `@deepseek-ai/dsh-schedule`
 * ——它是本插件**静态 import** 的包，一定解析得到，且与内核各包同版本发布（实测
 * 0.1.7-rc.1 与 0.2.1-rc.2 两棵树里 `dsh` / `dsh-schedule` / `dsh-llm` 的
 * `package.json` version 逐字相同）。最后再兜 `dsh-llm` / `dsh-session`。
 */
export const KERNEL_VERSION_SPECIFIERS = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-schedule',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
];
/** 默认解析器：`import.meta.resolve`，与本模块真实 import 走同一套 ESM 语义。 */
function resolveSpecifierDefault(specifier) {
    return import.meta.resolve(specifier);
}
/** specifier 的包名（`@scope/name` 或 `name`；子路径取前两段）。 */
function packageNameOf(specifier) {
    return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}
/**
 * 从入口文件向上找「`name` 等于该包」的 `package.json`，取其 `version`。
 *
 * 为什么不直接 `require('<pkg>/package.json>')`：实测 `@deepseek-ai/dsh@0.1.5-rc.1` 的
 * `exports` 里**没有** `./package.json` 这一条（0.1.7 起才有），直接 require 在旧代次会
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`。跨代次都站得住的做法是解析到入口再向上走目录找
 * name 匹配的那一份——`kernel-identity.ts:readVersionDefault` 用的正是同一手法。
 */
function versionNearEntry(specifier, entry, readFile) {
    const url = entry.startsWith('file:') ? fileURLToPath(entry) : entry;
    const packageName = packageNameOf(specifier);
    let dir = dirname(url);
    // 上溯层数上限与 kernel-identity 一致：够穿过 pnpm 的 `.pnpm/<pkg>@<ver>/node_modules/<pkg>`
    // 深链，又不会一路走到文件系统根去读别人的 package.json。
    for (let depth = 0; depth < 12; depth += 1) {
        let raw;
        try {
            raw = readFile(join(dir, 'package.json'));
        }
        catch {
            /* 这一层没有可读的 package.json，继续向上 */
        }
        if (raw !== undefined) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed.name === packageName && typeof parsed.version === 'string')
                    return parsed.version;
            }
            catch {
                /* 不是合法 JSON（或不是我们要的那份），继续向上 */
            }
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return undefined;
}
/**
 * 读当前内核的版本号。
 *
 * 三条刻意的取舍：
 *  - **依次尝试**多个 specifier，任一读到就用，全部读不到才 `undefined`；单押 `@deepseek-ai/dsh`
 *    会在 pnpm 隔离布局下必然读不到，于是每次投递都走降级路径。
 *  - 不做任何缓存策略上的花活：结果在本进程里不会变，但本函数的调用点在**每次投递**，
 *    所以缓存留在调用方（`schedule-compat.ts` 的 memo），这里保持纯探测、可注入、好测。
 *  - 抛错一律吞掉换下一个候选：解析不到是「这一路不通」，不是「内核坏了」。
 */
export function readKernelVersion(sources = {}) {
    const resolve = sources.resolve ?? resolveSpecifierDefault;
    const readFile = sources.readFile ?? ((filePath) => readFileSync(filePath, 'utf8'));
    for (const specifier of sources.specifiers ?? KERNEL_VERSION_SPECIFIERS) {
        let entry;
        try {
            entry = resolve(specifier);
        }
        catch {
            continue;
        }
        const version = versionNearEntry(specifier, entry, readFile);
        if (typeof version === 'string' && version.length > 0)
            return { version, specifier };
    }
    return undefined;
}
const VERSION_PATTERN = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;
/** 解析版本号；不合法时 `undefined`（**不**回落到 0.0.0——那会把「读不懂」判成「很旧」）。 */
export function parseVersion(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const m = VERSION_PATTERN.exec(raw);
    if (m === null)
        return undefined;
    const pre = m[4] === undefined
        ? []
        : m[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}
/** semver §11 的单个预发布标识比较：数字 < 非数字；数字按值；字符串按 ASCII。 */
function comparePreIdentifier(a, b) {
    const aNum = typeof a === 'number';
    const bNum = typeof b === 'number';
    if (aNum && bNum)
        return a < b ? -1 : a > b ? 1 : 0;
    if (aNum)
        return -1;
    if (bNum)
        return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * 版本号比较（含预发布），返回 `-1 / 0 / 1`；任一侧读不出时 `undefined`。
 *
 * 预发布这条**不能省**：本文件要判的阈值就是 `0.1.7-rc.1`，而按「预发布一律最低」的粗规则，
 * `0.1.7-rc.1` 与 `0.1.7` 之外的一串 `0.1.7-alpha.2 / rc.2` 会全被压平——正是要区分的东西被抹掉。
 */
export function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (a === undefined || b === undefined)
        return undefined;
    for (const key of ['major', 'minor', 'patch']) {
        if (a[key] !== b[key])
            return a[key] < b[key] ? -1 : 1;
    }
    // 同版本号：无预发布 > 有预发布。
    if (a.pre.length === 0 || b.pre.length === 0) {
        if (a.pre.length === b.pre.length)
            return 0;
        return a.pre.length === 0 ? 1 : -1;
    }
    const shared = Math.min(a.pre.length, b.pre.length);
    for (let i = 0; i < shared; i += 1) {
        const c = comparePreIdentifier(a.pre[i], b.pre[i]);
        if (c !== 0)
            return c;
    }
    // 前缀相同：标识多的一方更大（semver §11）。
    if (a.pre.length === b.pre.length)
        return 0;
    return a.pre.length > b.pre.length ? 1 : -1;
}
/** `raw >= threshold`；任一侧解析不出来返回 `undefined`（调用方决定降级方向）。 */
export function versionAtLeast(raw, threshold) {
    const c = compareVersions(raw, threshold);
    return c === undefined ? undefined : c >= 0;
}
