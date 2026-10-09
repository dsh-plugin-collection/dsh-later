/**
 * 已验证的内核代次（peer 枚举的唯一事实来源）。
 *
 * - `id`：semver 精确版本（发布 tag）
 * - `peerRange`：写入 package.json 的范围（node-semver 预发布需显式枚举）
 * - `sessionApi`：Session 读日志的形状（见 readOwnEvents / readInheritedEventCount）
 */
export const KERNEL_GENERATIONS = [
    {
        id: '0.1.1-rc.2',
        peerRange: '^0.1.1-rc.2',
        sessionApi: 'legacy-events',
    },
    {
        id: '0.1.2-rc.1',
        peerRange: '^0.1.2-rc.1',
        sessionApi: 'own-events',
    },
    {
        /**
         * `0.1.5` 代次：Session 形状未变（仍 `ownEvents()` + `inheritedEventCount`），
         * 且插件依赖的 `dsh-schedule` 导出面完整 —— 实测 `rc.1/rc.2/rc.3` 逐个
         * `import()` 全部 15 个 host 模块均通过（见 docs/verification.md）。
         */
        id: '0.1.5-rc.1',
        peerRange: '^0.1.5-rc.1',
        sessionApi: 'own-events',
    },
    {
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
/** 探测到的 sessionApi 代次（诊断 / 测试用；不参与业务分支）。 */
export function detectSessionApi(session) {
    return typeof session.ownEvents === 'function'
        ? 'own-events'
        : 'legacy-events';
}
