/**
 * 客户端错误令牌（**不是**字典）。
 *
 * 曾经这里还是 UI 微文案字典的所在地——那部分已经搬到 `src/locales/ui.ts`（8 语言单一
 * 来源），这里只剩令牌，理由有两条：
 *
 *  1. **作用域不同**。字典是文案（按语言选表、可回退），令牌是**代码契约**：hook 把
 *     `CLIENT_ERR.NO_SESSION` 抛出去、组件按令牌查表、测试断言令牌的值。它必须永不翻译、
 *     永不随语言变化，混进字典文件只会让下一个人误以为「这个也可以本地化」。
 *  2. **依赖方向**。`hooks/useSchedules.ts` 只为了这一个常量 import 本模块。字典搬走后，
 *     如果这里仍是「再导出一层 locales」，整个 8 语言词表会经这条常量镜像进宿主产物
 *     （`tsc` 对 `src/**` 全量编译），变成永远不会被执行的死文件——`check:lib-reach` 正是
 *     为此设的门禁。现在它与字典彻底无关，字典的入口就是 `src/locales/ui.ts`。
 *
 * @module dsh-later/client/strings
 */

/** 客户端本地错误令牌：hook 层抛出、组件层经字典翻译（避免 hook 依赖 locale）。 */
export const CLIENT_ERR = {
  NO_SESSION: 'SS_ERR_NO_SESSION',
  NOT_ACCEPTED: 'SS_ERR_NOT_ACCEPTED',
} as const;
