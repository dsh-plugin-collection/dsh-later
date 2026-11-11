export function createRuntimeRegistry(options) {
    const runtimes = new Map();
    const disposers = new WeakMap();
    const safeRoots = () => {
        try {
            return options.roots();
        }
        catch {
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
        let dispose;
        try {
            dispose = options.attach(agent, runtime);
        }
        catch (error) {
            options.warn(`later: agent "${agent.id}" 用户工具/调度器挂载失败: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
        if (typeof dispose !== 'function') {
            options.warn(`later: agent "${agent.id}" 的 attach 未交回 disposer，本次挂载不可撤销；` +
                `插件重载后该会话将永久 no_runtime（见 runtime-registry.ts 模块头）。`);
        }
        else {
            disposers.set(agent, dispose);
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
            if (runtimes.get(agent) === runtime) {
                runtimes.delete(agent);
                disposers.delete(agent);
            }
        },
        async unmountAll() {
            const pending = [...runtimes.keys()].map((agent) => ({ agent, dispose: disposers.get(agent) }));
            runtimes.clear();
            const results = await Promise.allSettled(pending.map(({ agent, dispose }) => {
                disposers.delete(agent);
                if (dispose === undefined) {
                    options.warn(`later: agent "${agent.id}" 的挂载没有可撤销动作，跳过拆除。`);
                    return undefined;
                }
                return dispose();
            }));
            for (const result of results) {
                if (result.status === 'rejected') {
                    options.warn(`later: 拆除挂载失败（继续拆其余）: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
                }
            }
            return pending.length;
        },
    };
}
