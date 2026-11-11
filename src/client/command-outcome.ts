/**
 * slash 命令的执行结果：**只表达「是否被受理」**。
 *
 * 为什么单独成模块并写清楚：`dsh-commands` 的 admission 语义只回
 * `RemoteResult<{matched}>`，handler 的业务结果不从这里返回（它落在会话记录 /
 * 投影里）。因此客户端**不得**用本类型判断「业务是否真的发生了」——例如删除
 * 暂停项时 host 可能返回 `deleted:false`，而这里照样是 `matched: true`。
 * 需要业务事实时以 `userSchedules` 投影为准（见 ScheduleDock 的观察窗对账）。
 *
 * 本模块**仅 client 侧使用**（本文件在 `src/client/` 下，只被 `tsconfig.client.json` 编译，
 * 不进 host 的 `lib/` 产物）。类型本身由 `dsh-commands` 的 admission 契约决定。
 *
 * @module dsh-later/client/command-outcome
 */

/** 一条命令的执行结果。 */
export interface CommandOutcome {
  /** 命令是否被受理（matched）。false 表示未受理（无会话面 / 网络异常 / 无此命令）。 */
  readonly matched: boolean;
}
