import { userSchedulesProjectionUnit } from './projection.js';
function reasonOf(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error) ?? String(error);
    }
    catch {
        return String(error);
    }
}
export async function registerUserSchedulesProjection(registry, warn) {
    const report = warn ?? (() => { });
    const prefix = 'dsh-later: userSchedules 投影注册';
    const outcome = registry.register(userSchedulesProjectionUnit);
    if (typeof outcome?.then === 'function') {
        let settled;
        try {
            settled = await outcome;
        }
        catch (error) {
            report(`${prefix}失败（宿主 register 拒绝了本次注册）：${reasonOf(error)}`);
            return () => { };
        }
        if (typeof settled?.dispose === 'function') {
            const handle = settled;
            const dispose = handle.dispose.bind(handle);
            return () => dispose();
        }
        if (typeof settled === 'function') {
            const legacyDispose = settled;
            return () => {
                void legacyDispose();
            };
        }
        report(`${prefix}的 thenable 解析结果既不是 ProjectionHandle（没有 dispose）也不是 disposer 函数，已降级为空 disposer`);
        return () => { };
    }
    if (typeof outcome === 'function') {
        const syncDispose = outcome;
        return () => {
            void syncDispose();
        };
    }
    report(`${prefix}返回值形状未知（既不是 thenable 也不是 disposer 函数，实际 ${outcome === null ? 'null' : typeof outcome}），已降级为空 disposer`);
    return () => { };
}
