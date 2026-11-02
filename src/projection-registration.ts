/**
 * `userSchedules` 投影单元的**注册**跨代收敛点（issue #118）。
 *
 * 两代注册契约——⚠️ **注意：两代的返回值都是「可调用 + thenable」，区别在 await 出来的是什么**：
 *  - **≤0.2.1**：`register()` 直接返回 `ctx.effect(…)` 的结果，即 cordis 的 `AsyncDisposable`：
 *    一个可调用的同步 disposer，同时带 `then`
 *    （`@deepseek-ai/cordis/lib/index.js:1238` 的 `wrapper`，`:1274` 的 `wrapper.then`——
 *    resolve 出来就是 disposer 本身）。所以 `await` 它得到的是 **disposer 函数**。
 *  - **0.2.2-alpha.2+**：返回 `Object.assign(dispose, { then, catch, finally,
 *    [Symbol.toStringTag]: 'Promise' })`，`await` 它得到的是 **`ProjectionHandle` 对象**
 *    （`{ dispose, stateOf, readerFor }`），且契约明确要求
 *    *Callers must await registration before publishing consumers*（先完成注册，再对外
 *    发布消费方）。
 *
 * 于是判定必须两步：**先判 thenable，再按 await 出来的解析值分岔**（函数 ⇒ 老代次的
 * disposer；带 `dispose` 的对象 ⇒ 新代次 handle）。只看 await 之前的形状是**分不出来**的
 * ——两代都是 `typeof === 'function'` 且 thenable，这也是本文件最容易写错的地方：
 * 只判 `typeof === 'function'` 会静默丢掉 await，只处理 await 后的 handle 会让老代次
 * 拿不到 disposer（注册永不释放，外加每条 warn）。
 *
 * 为什么单独抽一个模块：这两个形态在类型层不可能同时表达（旧 dev 依赖那一代的
 * `register` 参数带 `SessionProjectionStateMap` 约束，而该接口在新代已被删除），
 * 于是把「唯一一次类型擦除 + 唯一一次形状判定」关进本文件，调用点
 * （`src/index.ts`）只看到一个 `async` 函数。
 *
 * 范围限定：说的是**投影注册这条边界**只剩这一处 `as never`。仓库里另有几处 `as never`
 * 属于别的契约面（`runtime.ts` 的消息 source、`schedule-compat.ts` 的记录形状、
 * `user-tools.ts` 的 fold 入参、client 侧 `scope()`），与本边界无关，别拿本条去统一它们。
 *
 * ## 为什么按**返回值实际形状**判定，而不是按版本号
 *
 * 本仓既有的政策是「版本号优先，符号探测退居降级路径」（见 `upstream-compat.ts`
 * 的模块头与 issue #75）。这里**故意**不照做，原因有两条：
 *  1. 拿不到——注册发生在 `ctx.inject(['sessionProjections'], …)` 的子 fiber 回调里，
 *     那里没有宿主版本号可读，硬要读就得把 `upstream-compat` 的版本探测再穿一层进来；
 *  2. 不需要——这个契约变化点上，**返回值的形状就是契约本身**（上游把 callable 形态
 *     标了 deprecated，只作兜底保留），形状判定与版本判定的结果等价，而形状判定
 *     连「同代但实现漂移」也一并覆盖。
 *
 * ## ⚠️ 判定顺序不能反：thenable 优先于 function
 *
 * 0.2.2-alpha.2 的 `register()` 返回的是
 * `Object.assign(dispose, { then, catch, finally, [Symbol.toStringTag]: 'Promise' })`
 * （`@deepseek-ai/dsh-session-projection/lib/index.js:80-109`）——它**既能当函数调用，
 * 又是 thenable**。如果先判 `typeof outcome === 'function'`，alpha.2 会命中兜底
 * disposer 分支并**静默跳过 await**：注册其实还没完成就对外发布了消费方，正是
 * 本 issue 要修的时序契约被原样保留下来。而且这个 bug 不会在装配面暴露
 * （mount 面不观测 client 读投影的先后），会一路绿到用户那里。
 * 所以：**thenable 分支必须写在前面**，且注释里这条不许被"简化"掉。
 *
 * @module dsh-later/projection-registration
 */
import { userSchedulesProjectionUnit } from './projection.js';

/**
 * 新代次（0.2.2-alpha.2+）`register()` resolve 出来的句柄——只声明本仓用到的面。
 *
 * 不用 `import type { ProjectionHandle }`：那个类型在旧 dev 依赖（0.2.1-rc.2）里不存在，
 * 直接 import 会让本地 tsc 报「找不到导出」，把跨代问题搬到编译期。这里用结构化
 * 最小面，两代都能编译。
 */
interface ProjectionHandleLike {
  /** 注销本次注册；调用后该单元不再参与全局 drive 与 snapshot。 */
  dispose?: () => Promise<void> | void;
}

/** `sessionProjections` 注册面：入参在边界处擦除，返回值按运行时形状判定。 */
interface ProjectionRegistryLike {
  register(definition: never): unknown;
}

/** disposer：老代次同步、新代次异步，统一成调用方不必分辨的形状。 */
export type ProjectionDisposer = () => void | Promise<void>;

/** 把任意 catch 到的值变成一句可读的原因（reject 的原因类型不可控）。 */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

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
export async function registerUserSchedulesProjection(
  registry: ProjectionRegistryLike,
  warn?: (message: string) => void,
): Promise<ProjectionDisposer> {
  const report = warn ?? (() => {});
  const prefix = 'dsh-later: userSchedules 投影注册';

  // ── 本仓**唯一**允许 `as never` 的地方 ────────────────────────────────────
  // 单元对象本身的运行时形状（`key`/`stateSchema`/`init`/`apply`/`wire{viewSchema,view}`
  // /`stateVersion`）两代都是正确的——`tests/projection-unit.test.mjs` 在运行时锁死它。
  // 冲突只在**类型层**：旧 dev 依赖的 `register` 参数是 `ProjectionDefinition<K, S>`，
  // 而 `S` 受已删除的 `SessionProjectionStateMap` 约束；新代次反过来没有那张表、
  // 靠泛型推断。两代参数类型交集写不出来，所以这里对**入参**做一次显式擦除，
  // 语义是「运行时契约以宿主为准」。**投影注册这条边界上不许再出现第二处 `as never`**
  // （尤其不许把它加回 `src/index.ts` 的注册调用点——那等于把边界又摊回调用方）。
  // 仓库其它 `as never` 属别的契约面，不在本条约束内。
  const outcome: unknown = registry.register(userSchedulesProjectionUnit as never);

  // 第一步：thenable 判定必须在前，理由见模块头「判定顺序不能反」。
  // 两代的返回值都同时满足 `typeof === 'function'` 和 thenable
  // （≤0.2.1 是 cordis 的 AsyncDisposable，alpha.2 是 Object.assign 出来的复合对象），
  // 所以这个顺序对**两代**都是必需的，不是只为 alpha.2 打的补丁。
  if (typeof (outcome as { then?: unknown } | null | undefined)?.then === 'function') {
    let settled: unknown;
    try {
      // 对 ≤0.2.1，await 它同时是「等 effect 建立完成」，语义与 alpha.2 的
      // 「等注册完成」一致——两代都因此拿到同一个时序保证。
      settled = await outcome;
    } catch (error) {
      report(`${prefix}失败（宿主 register 拒绝了本次注册）：${reasonOf(error)}`);
      return () => {};
    }

    // 第二步：按**解析值**分岔。
    //  - alpha.2：`await` 出 `ProjectionHandle` 对象（`{dispose, stateOf, readerFor}`）；
    //  - ≤0.2.1：`await` 出 cordis `AsyncDisposable` 解析的 **disposer 函数本身**
    //    （`cordis/lib/index.js:1274`：`wrapper.then = … .then(() => disposeAsync)`）。
    // 实测（2026-10-30，本机 9 个内核树，真 registry 打点）：
    //    0.2.1-rc.2 / rc.4 → awaited: typeof function, .dispose undefined
    //    0.2.2-alpha.2    → awaited: typeof object,   .dispose function
    // 先判函数会怎样：老代次被当「缺 dispose 的 handle」，warn + 空 disposer ⇒ 注册永不
    // 释放（泄漏一个 registration）且每次加载都喊一句。这就是为什么必须判解析值而不是
    // 只判是否存在 then。
    if (typeof (settled as { dispose?: unknown } | null | undefined)?.dispose === 'function') {
      const handle = settled as ProjectionHandleLike;
      const dispose = handle.dispose!.bind(handle);
      return () => dispose();
    }
    if (typeof settled === 'function') {
      const legacyDispose = settled as () => unknown;
      return () => {
        void legacyDispose();
      };
    }
    // 防御：既不是 handle 也不是 disposer。报一次并降级，绝不因此抛。
    report(
      `${prefix}的 thenable 解析结果既不是 ProjectionHandle（没有 dispose）也不是 disposer 函数，已降级为空 disposer`,
    );
    return () => {};
  }

  if (typeof outcome === 'function') {
    // 非 thenable 的函数：纯同步 disposer（假 registry，或未来某个同步实现）。
    // 包装一层是为了让调用方不必区分同步/异步，也避免把 disposer 的返回类型漏进 effect 签名。
    const syncDispose = outcome as () => unknown;
    return () => {
      void syncDispose();
    };
  }

  report(
    `${prefix}返回值形状未知（既不是 thenable 也不是 disposer 函数，实际 ${outcome === null ? 'null' : typeof outcome}），已降级为空 disposer`,
  );
  return () => {};
}
