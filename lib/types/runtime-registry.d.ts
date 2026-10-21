/**
 * 「每个 root agent 一份 runtime」的挂载注册表（issue #58 后抽出的可测单元）。
 *
 * ## 为什么单独成模块
 *
 * 这段逻辑原本内联在 `apply()` 里，无法在不启动宿主的情况下喂假件 —— 于是它的
 * 关键性质（**错过 `agent/created` 的会话能自愈**）只能靠读源码保证，这正是
 * `no_runtime` 事故长期没有护栏的原因。抽出后可以用假 agent/假 runtime 直接断言。
 *
 * ## 它保证什么
 *
 * - **幂等**：同一 agent 只挂一次；已存在直接返回。
 * - **只认 root**：非 root（子 agent）不挂载 —— 子 agent 的提醒本就不该由本插件投递。
 * - **水合**：`hydrate()` 对**当前已存在**的 root agent 各挂一次。cordis 重载/热更新
 *   会 teardown 再 `apply()`，而既有会话**不会重发 created**；没有水合，这些会话的
 *   提醒就"只显示、不触发"。
 * - **自愈**：`ensure()`/`drive()` 在缺挂载时按需补挂（覆盖错过事件的会话）。
 * - **失败不污染**：`attach` 抛错时只告警、不入表，调用方拿到 `undefined`。
 * - **可撤销**：`attach` **必须**交回 disposer，`unmountAll()` 在 teardown 时逐个执行
 *   （见下面"为什么这条是硬要求"）。
 * - **teardown 可辨**：`isStopping()` 为真时拒绝新挂载（避免拆到一半又挂回来）。
 *
 * 所有这些都**不吞错误**：`ensure` 返回 `undefined` 时调用方必须如实报错
 * （插件侧即 `no_runtime`），不得当成成功。
 *
 * ## 为什么「attach 必须交回 disposer」是硬要求
 *
 * 挂载的副作用（`user_schedule_*` 工具、`agent/status` 监听）注册在 **`agent.ctx`**
 * 上，生命周期跟着 **agent** 走，而不是跟着插件 fiber 走。插件重载时宿主只拆插件
 * 自己的 fiber —— 旧实例留在 agent 作用域里的那份注册**原样活着**。
 *
 * 于是新实例 `hydrate()`/`ensure()` 再 attach 一次，就会撞上内核的同名守卫
 * （`dsh-scope` 的 `NamedEntries.insert` 直接抛
 * `tool "user_schedule_create" is already registered in this scope`）→ attach 抛错
 * → 不入表 → **该会话从此永久挂不上**：提醒能建、dock 能显示、到点不响、
 * 点「插话发送」报 `no_runtime`，直到重启宿主或换一个新会话。
 *
 * 换句话说：光有「水合 + 自愈」不够，**拆的时候要把自己注册的东西带走**。
 * 这就是 `attach` 的返回值被强制、且 `unmountAll()` 存在的原因。
 *
 * @module dsh-later/runtime-registry
 */
/** 一次挂载的撤销动作（由 `attach` 交回；幂等由实现方保证）。 */
export type MountDisposer = () => void | Promise<void>;
/** 注册表需要的最小 agent 面（真实场景是宿主 Agent，测试里可以是假对象）。 */
export interface RegistryAgent {
    readonly id: string;
}
/** 注册表依赖（全部注入，便于测试）。 */
export interface RuntimeRegistryOptions<A extends RegistryAgent, R> {
    /** 当前活着的 root agent；服务未就绪时应返回空数组而非抛错。 */
    roots(): readonly A[];
    /** 构造一个 runtime（不做副作用，副作用在 attach 里）。 */
    create(agent: A): R;
    /**
     * 挂载后的接线：注册工具、监听状态。**必须交回撤销动作**（理由见模块头）。
     * 抛错即视为挂载失败。注册表保管这个 disposer，并在 `unmountAll()` 时执行。
     */
    attach(agent: A, runtime: R): MountDisposer;
    /** 重驱（用户创建/删除提醒后让调度器重算）。 */
    drive(runtime: R): void;
    /** 告警出口（插件侧是 ctx.logger.warn）。 */
    warn(message: string): void;
    /** 是否正在 teardown；为真时不得新挂载。 */
    isStopping(): boolean;
}
export interface RuntimeRegistry<A extends RegistryAgent, R> {
    /** 挂载（幂等）；非 root / teardown 中 / attach 失败时返回 undefined。 */
    mount(agent: A): R | undefined;
    /** 取已有 runtime，缺失即补挂（自愈）。 */
    ensure(agent: A): R | undefined;
    /** 对既有 root agent 逐个水合，返回新挂载数量。 */
    hydrate(): number;
    /** ensure + 立即重驱；返回是否可用。 */
    drive(agent: A): boolean;
    /** 只读查询。 */
    get(agent: A): R | undefined;
    /** 当前挂载数量。 */
    size(): number;
    /** 挂载被拆除时调用：仅当表里仍是同一实例才删除（防止旧 disposer 拆掉新实例）。 */
    forget(agent: A, runtime: R): void;
    /**
     * teardown：执行本实例交回的**全部** disposer（拆工具注册、状态监听与 runtime），
     * 清空注册表，返回拆掉的数量。单个失败只告警、不中断 —— 但绝不静默：
     * 漏拆一个，就等于给那个会话留下一个"重载后永久 no_runtime"。
     */
    unmountAll(): Promise<number>;
}
/**
 * 创建注册表。
 * @param options 注入依赖（roots / create / attach / drive / warn / isStopping）
 */
export declare function createRuntimeRegistry<A extends RegistryAgent, R>(options: RuntimeRegistryOptions<A, R>): RuntimeRegistry<A, R>;
