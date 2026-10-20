/**
 * 上游内核跨代兼容层：把「鸭子类型双轨探测 + peer 代次矩阵」收敛到单文件。
 *
 * 背景（docs/verification.md）：DSH 内核 0.1.1 → 0.1.2 之间有多处不兼容，
 * 此前散落在 user-tools / index / package.json 各处。上游每发新 rc 需要：
 *   1. package.json peer + dev 各包补一枚举项（node-semver 不把预发布算进范围）
 *   2. Session API 形状若有变化，只改本模块的 read* 函数
 *
 * 新 rc 落地 checklist：
 *   - 在 KERNEL_GENERATIONS 追加一代（id + peerRange + sessionApi）
 *   - 跑 `node scripts/sync-peer-matrix.mjs` 重写 package.json peer 枚举
 *   - 跑 `npm test`（含 tests/upstream-compat.test.mjs 矩阵护栏）
 *
 * @module dsh-later/upstream-compat
 */
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * 已验证的内核代次（peer 枚举的唯一事实来源）。
 *
 * - `id`：semver 精确版本（发布 tag）
 * - `peerRange`：写入 package.json 的范围（node-semver 预发布需显式枚举）
 * - `sessionApi`：Session 读日志的形状（见 readOwnEvents / readInheritedEventCount）
 */
export declare const KERNEL_GENERATIONS: readonly [{
    readonly id: "0.1.1-rc.2";
    readonly peerRange: "^0.1.1-rc.2";
    readonly sessionApi: "legacy-events";
}, {
    readonly id: "0.1.2-rc.1";
    readonly peerRange: "^0.1.2-rc.1";
    readonly sessionApi: "own-events";
}, {
    /**
     * `0.1.5` 代次：Session 形状未变（仍 `ownEvents()` + `inheritedEventCount`），
     * 且插件依赖的 `dsh-schedule` 导出面完整 —— 实测 `rc.1/rc.2/rc.3` 逐个
     * `import()` 全部 15 个 host 模块均通过（见 docs/verification.md）。
     */
    readonly id: "0.1.5-rc.1";
    readonly peerRange: "^0.1.5-rc.1";
    readonly sessionApi: "own-events";
}, {
    /**
     * `0.1.7` 代次：Session 形状仍未变（`ownEvents()` + `inheritedEventCount`）；
     * `dsh-schedule` 的三处破坏性变更（`allocateScheduleId` 删除、
     * `renderEveryReminderBatchFraming` 改名 `renderRecurringReminderBatchFraming`、
     * `createAfterScheduleRecord` 新增必填 `title`）**全部收敛在
     * `schedule-compat.ts`**——调用点 `user-tools.ts` / `runtime.ts` 不含版本分支。
     *
     * 三条差异在 bridge 里按「存在性择一」（framing）或「统一用新语义」
     * （UUID id、title 派生）处理，两代行为一致，故可安全同时声明这两个范围。
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
     *   `scheduleMessageSource()` 的 `isV17` 存在性探测继续命中 `kind:'schedule'`，
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
