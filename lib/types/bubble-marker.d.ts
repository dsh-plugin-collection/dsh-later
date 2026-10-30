/**
 * 定时消息气泡标记的**纯逻辑**（issue #112）：设置解析 + 注册决策。
 *
 * 放在 host/client 共用的位置（不在 `src/client` 下）有两个理由：
 *  1. 客户端渲染器与控制器都要用同一份「档位怎么解析」的口径；
 *  2. `node --test` 能直接 import `lib/bubble-marker.js` 跑决策表，不必拉起 React 或浏览器。
 *
 * 不引任何 Node 内置模块，也不引 React。
 * @module dsh-later/bubble-marker
 */
/** 标记档位（与 host `Config.bubbleMarker` 的取值同源）。 */
export type BubbleMarkerStyle = 'off' | 'left' | 'meta' | 'hover';
/** 注册决策：不动 / 销毁 / 注册。 */
export type BubbleMarkerPlan = 'off' | 'wait' | 'register';
/**
 * 从设置快照解析档位。
 *
 * 非法/缺失回 `left`（与 host schema 的 default 同源）；`status !== 'ready'` 也回
 * `left`——它只负责「值是什么」，**不负责「没读到该不该注册」**，后者由控制器看
 * `status` 决定，否则同一份设置会有两套「没读到算什么」的规则。
 * @param snapshot - 设置 scope 快照（`value` 当不可信输入处理）。
 * @returns 四档之一。
 */
export declare function resolveBubbleMarker(snapshot: {
    readonly status: string;
    readonly value?: unknown;
}): BubbleMarkerStyle;
/** 决策输入。 */
export interface BubbleMarkerPlanInput {
    /** 解析后的档位。 */
    readonly style: BubbleMarkerStyle;
    /** `conversation.chat.node` 是否已声明。 */
    readonly nodeReady: boolean;
    /** 用户内容工厂的子槽（`conversation.chat.user.images`）是否已声明。 */
    readonly contentReady: boolean;
    /** 当前是否已有本插件的条目。 */
    readonly registered: boolean;
    /** 节点槽的 kind（未声明时 undefined）。 */
    readonly nodeSlotKind?: string;
}
/**
 * 决策表：
 *
 * | 条件 | 结果 |
 * |---|---|
 * | `off` | `off`（有注册就销毁） |
 * | 节点槽或内容工厂未就绪 | `wait` |
 * | 节点槽不是 `keyed` | `wait`（老代次，永不注册） |
 * | 已经注册过 | `wait`（不重复注册） |
 * | 其余 | `register` |
 * @param input - 当前状态。
 * @returns 下一步动作。
 */
export declare function planBubbleMarker(input: BubbleMarkerPlanInput): BubbleMarkerPlan;
