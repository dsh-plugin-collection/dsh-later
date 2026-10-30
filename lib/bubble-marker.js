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
/**
 * 从设置快照解析档位。
 *
 * 非法/缺失回 `left`（与 host schema 的 default 同源）；`status !== 'ready'` 也回
 * `left`——它只负责「值是什么」，**不负责「没读到该不该注册」**，后者由控制器看
 * `status` 决定，否则同一份设置会有两套「没读到算什么」的规则。
 * @param snapshot - 设置 scope 快照（`value` 当不可信输入处理）。
 * @returns 四档之一。
 */
export function resolveBubbleMarker(snapshot) {
    if (snapshot.status !== 'ready')
        return 'left';
    const value = snapshot.value;
    if (value === null || typeof value !== 'object')
        return 'left';
    const raw = value['bubbleMarker'];
    return raw === 'off' || raw === 'meta' || raw === 'hover' ? raw : 'left';
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
export function planBubbleMarker(input) {
    if (input.style === 'off')
        return 'off';
    if (!input.nodeReady || !input.contentReady)
        return 'wait';
    if (input.nodeSlotKind !== undefined && input.nodeSlotKind !== 'keyed')
        return 'wait';
    if (input.registered)
        return 'wait';
    return 'register';
}
