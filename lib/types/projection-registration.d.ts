/** `sessionProjections` 注册面：入参在边界处擦除，返回值按运行时形状判定。 */
interface ProjectionRegistryLike {
    register(definition: never): unknown;
}
/** disposer：老代次同步、新代次异步，统一成调用方不必分辨的形状。 */
export type ProjectionDisposer = () => void | Promise<void>;
/**
 * 注册 `userSchedules` 投影，并把两代返回形状收敛成同一个 disposer。
 *
 * 行为约定（对应 issue #118 / SPEC §3.2，逐条有测试）：
 *  - thenable → `await`，**按解析值**分岔：带 `dispose` 的对象 ⇒ 新代次 handle，
 *    返回 `() => handle.dispose()`；是函数 ⇒ 老代次 disposer，返回 `() => result()`；
 *  - 非 thenable 的函数 → 纯同步 disposer（假 registry / 未来的同步实现）→ 直接包一层；
 *  - 解析值既非 handle 也非函数 / 形状未知 / thenable reject → `warn` 一次 + **空 disposer**。
 *
 * **绝不抛**：这条 effect body 跑在 `ctx.inject(['sessionProjections'], …)` 的子 fiber 里，
 * 抛出去会让整条子 fiber 失败——投影永久缺失，而失败只落在宿主 stdout，用户侧表现为
 * 「提醒列表一直是空的」。降级 + 一句 warn 至少是可诊断的。
 *
 * 注意这不是「否则会 unhandled rejection」：alpha.2 自己给未观察的 rejection 备了兜底
 * （`lib/index.js:87-93`，`ready.catch` + `setImmediate` 打 `owner.logger.error`）。我们
 * 仍然自己 await + warn，是因为那条兜底只在「没人观察」且宿主 fiber 仍活跃时才打日志，
 * 且信息不落到本插件的 logger 上下文里。
 *
 * @param registry - `ctx.sessionProjections`（两代注册面）
 * @param warn - 降级/异常的上报通道；缺省时静默（但仍不抛）
 * @returns disposer：可安全 `await`，两次调用是幂等的 `undefined`（由上游保证）
 */
export declare function registerUserSchedulesProjection(registry: ProjectionRegistryLike, warn?: (message: string) => void): Promise<ProjectionDisposer>;
export {};
