import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
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
export declare const KERNEL_GENERATIONS: readonly [{
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
    readonly id: "0.1.2-rc.1";
    readonly peerRange: "^0.1.2-rc.1";
    readonly sessionApi: "own-events";
}, {
    /**
     * `0.1.5` 线：**列 rc.3，不列 rc.1**（实测结论，见下）。
     *
     * Session 形状未变（仍 `ownEvents()` + `inheritedEventCount`）；`dsh-schedule` 的导出面与
     * 0.1.7-rc.1 **逐符号相同**（`renderEveryReminderBatchFraming` / `allocateScheduleId` 两边都在），
     * 所以**符号判据区分不了这两代**，只能读版本号（issue #75）。
     *
     * 为什么 id 是 rc.3：`@deepseek-ai/dsh@0.1.5-rc.1` 的内部依赖写的是 `^0.1.5-rc.1`，
     * 按默认安装会把整条插件线解析到 **rc.3**；而 rc.1 的启动器 + rc.3 的插件混装**装不起来**
     * （实测 `verify-across-kernels --steps mount` 报多个 dsh-* 插件 load 失败，与本插件无关）。
     * 也就是说这一代用户实际拿到的是**统一的 rc.3**，能验证的形态也只有它。
     *
     * 该代还有一处 schemastery 差异：`s.object(...).volatile()` 在它装的 **3.18.2** 上不存在
     * （整条插件加载失败，`…volatile is not a function`）—— 已在 `src/index.ts` 里做能力探测降级。
     *
     * UI 侧差异（图标尺寸后缀名、`Tooltip` 无 `portal`、`fileMediaUrl` 缺失）由
     * `primitives-compat.ts` / `workspace-path-compat.ts` 兜住；它本身有 `FileTypeIcon`/`fileSizeText`。
     */
    readonly id: "0.1.5-rc.3";
    readonly peerRange: "^0.1.5-rc.3";
    readonly sessionApi: "own-events";
}, {
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
    readonly id: "0.1.7-rc.1";
    readonly peerRange: "^0.1.7-rc.1";
    readonly sessionApi: "own-events";
}, {
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
    readonly id: "0.1.7-rc.2";
    readonly peerRange: "^0.1.7-rc.2";
    readonly sessionApi: "own-events";
}, {
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
    readonly id: "0.2.0-rc.2";
    readonly peerRange: "^0.2.0-rc.2";
    readonly sessionApi: "own-events";
}, {
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
    readonly id: "0.2.1-rc.2";
    readonly peerRange: "^0.2.1-rc.2";
    readonly sessionApi: "own-events";
}];
/**
 * 随内核代次一起 bump 的 peer 包（宿主 hoisting 变化会波及这些运行时 import）。
 * cordis / schemastery 等独立 semver 包**不**列入——它们不随内核 rc 枚举。
 */
export declare const KERNEL_SCOPED_PACKAGES: readonly ["@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-commands", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-schedule", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-session-projection", "@deepseek-ai/dsh-settings", "@deepseek-ai/dsh-tools"];
/** 由 KERNEL_GENERATIONS 拼出的 peer 范围串（`a || b`）。 */
export declare function peerRangeFor(packageName: string): string;
/** 全部需逐代枚举的 `{ package, range }`（sync-peer-matrix / 矩阵测试共用）。 */
export declare function peerMatrixEntries(): ReadonlyArray<{
    packageName: string;
    range: string;
}>;
/** Session 读日志的最小结构（鸭子类型；两代公有面）。 */
export interface SessionLogSurface {
    readonly header?: {
        readonly seedLength?: unknown;
    } | undefined;
    readonly events?: readonly SessionEvent[] | undefined;
    readonly ownEvents?: (() => readonly SessionEvent[]) | undefined;
    readonly inheritedEventCount?: unknown;
}
/**
 * 读取「本会话自有」事件日志（不含 fork 继承前缀时由调用方配合 offset）。
 *
 * - 0.1.2+：`session.ownEvents()`（推荐；仅 live 段）
 * - 0.1.1：`session.events`（含 seed；配合 seedLength 切片）
 */
export declare function readOwnEvents(session: SessionLogSurface | Session): readonly SessionEvent[];
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
export declare function readInheritedEventCount(session: SessionLogSurface | Session): number;
/** 探测到的 sessionApi 代次（诊断 / 测试用；不参与业务分支）。 */
export declare function detectSessionApi(session: SessionLogSurface | Session): 'own-events' | 'legacy-events';
/**
 * `kind:'plugin'` 被内核淘汰的**最早**版本。
 *
 * 实测：0.1.7-rc.1 的 `@deepseek-ai/dsh-session-format-v3-to-v4` 在消息写入时刻对
 * `kind === 'plugin'` 直接 throw `format v4 message requires a producer-owned source kind`。
 * 这一代同时**仍**导出 `renderEveryReminderBatchFraming`（改名到 rc.2 才发生），所以
 * 「符号还在」不等于「kind 还被收着」——本常量就是把这条分界线写死在版本号上。
 */
export declare const PLUGIN_KIND_RETIRED_SINCE = "0.1.7-rc.1";
/**
 * 读内核版本时依次尝试的 specifier，先命中的算。
 *
 * 顺序的理由：`@deepseek-ai/dsh` 是宿主本体，「消息由谁准入」以它为准；但插件的模块解析
 * 根里未必看得见它（pnpm 隔离布局只保证 peer 可见），于是紧跟 `@deepseek-ai/dsh-schedule`
 * ——它是本插件**静态 import** 的包，一定解析得到，且与内核各包同版本发布（实测
 * 0.1.7-rc.1 与 0.2.1-rc.2 两棵树里 `dsh` / `dsh-schedule` / `dsh-llm` 的
 * `package.json` version 逐字相同）。最后再兜 `dsh-llm` / `dsh-session`。
 */
export declare const KERNEL_VERSION_SPECIFIERS: readonly ["@deepseek-ai/dsh", "@deepseek-ai/dsh-schedule", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-session"];
/** 一次版本读取的结果：版本号，以及它是从哪个包读到的（诊断文案要报后者）。 */
export interface KernelVersion {
    readonly version: string;
    readonly specifier: string;
}
/**
 * 版本读取的可注入面——与 `kernel-identity.ts` 同一纪律：**测试不依赖真实内核安装**，
 * 探测失败一律回 `undefined`，绝不猜成某个具体代次。
 */
export interface KernelVersionSources {
    /** specifier → 入口 URL（或路径）；解析失败应当**抛**，由读取处吞掉并换下一个候选。 */
    resolve?: (specifier: string) => string;
    /** 读文本文件；不可读时抛。 */
    readFile?: (filePath: string) => string;
    /** 候选 specifier 列表，默认 {@link KERNEL_VERSION_SPECIFIERS}。 */
    specifiers?: readonly string[];
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
export declare function readKernelVersion(sources?: KernelVersionSources): KernelVersion | undefined;
/** 解析后的版本号（semver 2.0.0 的子集：`MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]`）。 */
export interface ParsedVersion {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    /** 预发布标识（`rc.1` → `['rc','1']`）；正式版为空数组。 */
    readonly pre: readonly (string | number)[];
}
/** 解析版本号；不合法时 `undefined`（**不**回落到 0.0.0——那会把「读不懂」判成「很旧」）。 */
export declare function parseVersion(raw: string | undefined): ParsedVersion | undefined;
/**
 * 版本号比较（含预发布），返回 `-1 / 0 / 1`；任一侧读不出时 `undefined`。
 *
 * 预发布这条**不能省**：本文件要判的阈值就是 `0.1.7-rc.1`，而按「预发布一律最低」的粗规则，
 * `0.1.7-rc.1` 与 `0.1.7` 之外的一串 `0.1.7-alpha.2 / rc.2` 会全被压平——正是要区分的东西被抹掉。
 */
export declare function compareVersions(left: string | undefined, right: string | undefined): number | undefined;
/** `raw >= threshold`；任一侧解析不出来返回 `undefined`（调用方决定降级方向）。 */
export declare function versionAtLeast(raw: string | undefined, threshold: string): boolean | undefined;
