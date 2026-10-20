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
 * - **teardown 可辨**：`isStopping()` 为真时拒绝新挂载（避免拆到一半又挂回来）。
 *
 * 所有这些都**不吞错误**：`ensure` 返回 `undefined` 时调用方必须如实报错
 * （插件侧即 `no_runtime`），不得当成成功。
 *
 * @module dsh-later/runtime-registry
 */
/**
 * 创建注册表。
 * @param options 注入依赖（roots / create / attach / drive / warn / isStopping）
 */
export function createRuntimeRegistry(options) {
    const runtimes = new Map();
    const safeRoots = () => {
        try {
            return options.roots();
        }
        catch {
            // apply 早期可能还没有 agents 服务；水合/挂载都应按"暂无 root"处理。
            return [];
        }
    };
    const mount = (agent) => {
        if (options.isStopping())
            return undefined;
        const existing = runtimes.get(agent);
        if (existing !== undefined)
            return existing;
        if (!safeRoots().includes(agent))
            return undefined;
        const runtime = options.create(agent);
        try {
            options.attach(agent, runtime);
        }
        catch (error) {
            options.warn(`later: agent "${agent.id}" 用户工具/调度器挂载失败: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
        runtimes.set(agent, runtime);
        return runtime;
    };
    const ensure = (agent) => runtimes.get(agent) ?? mount(agent);
    return {
        mount,
        ensure,
        hydrate() {
            let mounted = 0;
            for (const agent of safeRoots()) {
                if (mount(agent) !== undefined)
                    mounted += 1;
            }
            return mounted;
        },
        drive(agent) {
            const runtime = ensure(agent);
            if (runtime === undefined)
                return false;
            options.drive(runtime);
            return true;
        },
        get: (agent) => runtimes.get(agent),
        size: () => runtimes.size,
        forget(agent, runtime) {
            if (runtimes.get(agent) === runtime)
                runtimes.delete(agent);
        },
        drain() {
            const all = [...runtimes.values()];
            runtimes.clear();
            return all;
        },
    };
}
