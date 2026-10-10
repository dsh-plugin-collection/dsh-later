# 更新日志

本文件记录面向使用者的重要变更。细粒度提交历史见 git log。

## 未发布

## 1.2.0 — 2026-10-09

- **feat** 暴露跨插件「定时任务摘要」公共 API（issue #17）。
  - 新增 `src/schedule-summary.ts`（纯函数，宿主/浏览器/`node --test` 共用）：
    `buildScheduleSummary` 把 `sessions.list` 折叠成
    `Map<SessionId, { count, pausedCount, nextAt, state }>`；`summarizeScheduleGroup`
    按分组聚合（会话数/任务数/最早触发/最高优先级，`overdue > urgent > scheduled`）。
  - 新增 `src/schedule-summary-store.ts`：可订阅 store（`getSnapshot` / `subscribe` /
    `reload` / `dispose`）+ 全局登记表，**唯一数据权威**——内部负责 `sessions.list`
    订阅、30s 状态 tick 与 60s `session.list` 读 RPC（仅页面可见时）。
  - 新增 `src/client/useScheduleSummary.ts`：React 订阅 hook（`useSyncExternalStore`，
    store 迟到时自动重渲染）。
  - `lib/client.js` 导出 `getScheduleSummaryStore` / `subscribeScheduleSummaryStore` /
    `useScheduleSummary` / `buildScheduleSummary` / `schedulesOfProjection` /
    `summarizeScheduleGroup` / `createScheduleSummaryStore` 及类型；消费方（如
    dsh-group-status）声明 `dsh.client.external: ["dsh-later"]` 后
    `require('dsh-later/client')` 即可使用。契约见
    [API 参考 §7](./docs/technical/03-api-reference.md)。
  - **refactor** 侧栏 badge 不再自己读 `sessions.list` / 周期 `refresh()`，改为消费同一个
    store：外部插件读到的摘要与本插件行内 badge 必然同源，且 `session.list` 读 RPC
    不再被拉两次。
  - 新增 15 个单测：纯逻辑（数量/状态分档/暂停语义/分组聚合/判等）、store
    （列表变化、状态 tick、refresh 闸门、dispose、登记表）与构建产物契约
    （`lib/client.js` 导出面 + apply 登记/注销 store）。

- **feat** 侧栏 badge 进度环（方案 A：track + prog 双环）。
  - 新版时钟 glyph 从单环改为双环：`ss-clock-track` 恒定底环（总窗口参照），
    `ss-clock-prog` 进度弧从 12 点顺时针填充（`stroke-dashoffset` 驱动）。
  - 新增 `progressFrom` 字段（`PresenceSummary`）：窗口起点时刻（epoch ms），
    只跟随 `nextAt` 那条任务。
  - 新增 `windowStartOf` 推导逻辑，按优先级取窗口跨度：
    1. `window_seconds`（宿主/投影显式给）→ 最权威
    2. `after_seconds` / `every_seconds`（按 `kind` 推）
    3. `created_at`（`at` 类型回退）
    推不出则 `progressFrom` 缺省，视觉退回恒定整环（旧形状即退化态）。
  - `progressOf(entry, now)` 返回 0–1 比例；超时停满环（不绕出去）。
  - urgent 只脉冲底环（进度弧跟着闪会让比例不可读）。
  - 减少动效模式：进度弧位移过渡一并停。
  - 新增 11 个单测：after/every/at 窗口推导、window_seconds 优先、退化/非法值、
    多任务窗口跟随 nextAt、暂停项排除、camelCase 兼容、无窗口时形状不变。
  - `sameScheduleSummary` 补 `progressFrom` 比对（暂停→恢复窗口换了但 nextAt 未变时
    仍需通知订阅者刷新进度环）。

## 1.1.0 — 2026-10-09

- **feat** 设置页 UI 对齐官方 `SettingsForm`：从折叠卡片改为裸表单，字段直接平铺。
  - 移除 `ss-card` 容器、折叠头部、chevron、未保存徽章（`ss-card-pending`）。
  - 布尔字段改用官方 toggle switch（`role="switch"`），不再用 select + 开/关文案。
  - CSS 类名对齐官方（`ss-settings-form`、`ss-toggle-row`、`ss-toggle-switch`）。
  - 清理死代码：移除 `onKey`/`offKey` 字段声明及 `optionOn`/`optionOff`/`optionEnabled`/`optionDisabled` 字典键。

- **feat** 新增 `schedule-compat` 兼容层：统一处理不同 DSH 内核代次的 schedule 编解码差异。
  - 新增 `src/schedule-compat.ts`（226 行）及其编译产物 `lib/schedule-compat.js`。
  - 上游跨代兼容逻辑收敛到单点维护，新 rc 落地只需改矩阵 + 重跑 sync 脚本。

- **feat** 插件列表显示专属图标：新增包根 `icon.svg`，并在 `package.json` 声明
  顶层 `icon` 字段。
  - 图形沿用侧栏「定时状态」badge 的几何（圆环 + 上/右指针），配色改为
    官方插件图标的蓝色渐变区间（`#7AC2FF → #4A65E8`），使其与官方图标同属一个家族。
  - 配色决策依据：实测 4 个带图标的官方包，**全部硬编码十六进制，无一使用
    CSS 变量或 `currentColor`**（插件图标经 `dsh-app-boot` 的 `iconOf()` 读成
    base64 data URL 以 `<img>` 渲染，因此**不执行 CSS 动画、不继承页面颜色**）。
    统一感来自「取色区间 + 画法」而非令牌系统，故采用同区间色号。
  - 侧栏 badge 保留品牌紫 `#8b5cf6`：那是插件自身语境下的**状态色**
    （紫 / warn / error 三态区分），与插件列表的外部语境不冲突。
  - `icon.svg` 已加入 `files`，避免 `npm publish` 漏发导致图标丢失。

- **fix** 支持 DSH `0.2.0`（此前在 0.2.0 上**完全失效**）。
  - 现象：升级到 DSH `0.2.0-rc.2` 后插件整体不加载 —— 无按钮、无命令、无工具。
    宿主日志：`skipping profile bundle "dsh-later": Plugin dsh-later@1.0.0 is
    incompatible with dsh 0.2.0-rc.2 …`。
  - 根因：**不是代码失效，是 peer 声明缺口**。内核自 0.2.0 起把 peer 兼容校验
    **从警告升级为硬门槛**（`dsh-app-boot` 的 `evaluatePluginCompatibility`）：
    peer 范围不满足即**整插件跳过**。而 peer 枚举止于 `^0.1.7-rc.2`，
    8 个 kernel-scoped 包对 `0.2.0-rc.2` 全部不满足（预发布版必须显式枚举）。
  - 核对结论：**API 面全部保持，无需改动任何业务代码**。Session 形状未变；
    `dsh-schedule` 导出面完整（`renderRecurringReminderBatchFraming` 仍在，
    0.1.7 的桥接照旧命中）；`dsh-llm` 的 `createUserMessage` /
    `boundContextSummary` 在，`schedule` message source 仍有效；
    `dsh-agent` 的 `followup` / `steer` 语义未变；`defineTool` 在。
  - 实证：devDependencies 固定到 `0.2.0-rc.2` 后，host + client `tsc --noEmit`
    **双端 0 错误**，`npm run build` 走 tsc 原生路径（无 esbuild 降级），测试全绿。
  - 处置：`KERNEL_GENERATIONS` 追加 `0.2.0-rc.2` → 重跑 `sync-peer-matrix.mjs`
    重写 8 个 peer 范围 → dev 推进到 `0.2.0-rc.2`。历史代次仍全部支持，
    未核对的 `0.3.0-rc.1` 仍被正确拒绝。
- **fix** 多条合并提醒的 framing 措辞对齐上游（`0.2.0` 的第二处差异）。
  - `dsh-schedule` 在 0.2.0 把 one-shot 与 recurring 的防护句统一收敛为
    `This is a scheduled message from the user`（旧句为
    `Present reminder_prompt_json … not new user instructions.`）。
  - 单条路径直接调上游函数，自动跟随；但**多条到期一次性合并**（P1-5）是上游
    不提供的形态，由插件自渲染，其来源行是上游文案的**本地副本**，需手工对齐，
    否则同一会话里单条与合并提醒的措辞会不一致。
  - 新增护栏：从上游 `renderReminderFraming` **实时取**来源行比对本地副本，
    不硬编码任何一版文案（故支持任意多代）。反向验证：改回旧长句即失败。
  - 注：该问题被 peer 缺口**掩盖**——插件不加载时 framing 根本不会执行，
    修完 peer 后测试才暴露出来。

- **fix** 本地开发依赖代次与运行时代次对齐（`0.1.2-rc.1` → `0.1.5-rc.1`）。
  - 起因：`devDependencies` 原先写的是**完整 peer 范围串**，包管理器因此解析到
    「满足范围的最老可用版本」= `0.1.2-rc.1`，而真实运行环境是 `0.1.5-rc.3` ——
    **测试与类型检查落后运行环境整整一代**，API 漂移在本地无从暴露。
    上一个 peer 缺口正是这样漏掉的（本地怎么测都发现不了）。
  - 处置：`devDependencies` 改为**固定到最新已验证代次**（全部 kernel-scoped 包同代次）；
    `peerDependencies` 仍为完整范围串，两者意图不同、不再混同。
  - `scripts/sync-peer-matrix.mjs` 同步改造：peer 写范围、dev 写固定代次；且只在 dev
    已是范围串或缺失时才改写，避免把有意固定的版本冲掉（保持幂等）。
  - 结果：`npm run typecheck` 通过且无新增错误；`npm test` 183 通过 / 0 失败。
  - 新增守卫：dev 必须是具体代次而非范围串、必须落在已验证列表内、全部包同代次、
    且等于最新已验证代次；另有显式登记当前 dev 代次的断言，使代次变更在 diff 中可见。
- **fix** 补 `0.1.5` 内核代次的 peer 声明：此前只声明 `^0.1.1-rc.2 || ^0.1.2-rc.1`，
  而实际运行的宿主早已是 `0.1.5-rc.3` —— 在真实 `npm install` 下**不满足声明范围**
  （`semver.satisfies` 默认预发布语义为 false）。本地经 profile symlink 加载，
  peer 不参与解析，所以一直没暴露。
  - 实测确认 `0.1.5-rc.1/rc.2/rc.3` 可支持：隔离安装后 15/15 host 模块导入通过，
    且 `apply()` 以最小假 ctx 实例化成功；与原有 `0.1.2-rc.1` 的注册顺序逐项相同。
  - **未跟进 `0.1.7`**：该代有破坏性变更，实测 15 个模块中 4 个因缺符号失败 ——
    `allocateScheduleId` 导出被删（插件 5 处调用）、`renderEveryReminderBatchFraming`
    改名为 `renderRecurringReminderBatchFraming`、`createAfterScheduleRecord` 等
    新增必填 `title` 参数。适配是独立工作项，不能靠加一行 peer 蒙混过去。
  - 代次守卫测试改为数据驱动（原先硬编码两代），并加强：`peerRange` 下界必须恰为该
    代次本身（不借用更早下界），代次表严格递增。

- **fix** 「插话发送」会**静默丢失**：提醒从列表消失，消息却没送达模型。
  - 根因：`agent.steer()` 入 `next-step`，语义是「下一个 step 边界消费」。
    若插话恰好撞上 `turn/start`，核心 `inbox.claim('next-step', …)` 会把**整批**
    取走交给一个**请求上下文已定**的 step —— 消息落进 surface，却不进实际请求。
  - 实测时序（会话日志，毫秒级）：
    ```
    t+0ms   agent/inbox/spliced  → 插入 next-step
    t+1ms   turn/start           → turn 17 开始（同一毫秒）
    t+1ms   agent/inbox/spliced  → removedCount:1, inserted:[]  ← 被 claim 吞掉
    t+17ms  request/header       → 请求已按旧上下文构造
    ```
    该轮模型回复与提醒内容无关，确认它从未读到这条消息。
  - **并有第二个独立缺陷**：旧实现在 `steer()` 之后**无条件**写 `dispatch`，
    把提醒移出 active。投递失败 = 提醒永久消失且**不可重试** ——
    虚假的成功信号掩盖了真实的投递失败。
  - 修复一（默认投递方式 `followup`）：入 `next-turn`，与 `next-step` 是两条独立
    队列，`claim('next-step', …)` 不触碰它，**竞态在结构上不存在**；语义等价于
    「正常发送」（独立成轮）。可在设置里改回 `steer`。
  - 修复二（投递确认，默认开）：投递后**读会话日志**核对 message id 是否真的落盘。
    未确认且「未确认时 = 保留条目」时**不写 dispatch**，提醒留在列表中可重试，
    并在行内明确提示 —— 不再静默。
  - 未确认处理可选「丢弃」（恢复旧语义）；选择时 UI 明示「静默丢失将重新变得可能」。
  - 确认机制**只依赖已持久化的日志格式**，不监听 `inbox/claimed` / `request/header`
    等核心运行时事件，避免与核心内部时序隐性耦合。
  - 设置 UI：新增「插话投递」三项目；选 `steer` 时常驻显示风险提示，且文案随
    「投递确认」开关切换口径（关确认时明说不会保留条目）。
- **fix** 「插话发送」对普通（非暂停）提醒报 `schedule_not_found`。
  - 根因：GUI 传的是**投影里的 id**，而它「稳定 uid 优先」
    （`wireItemOf`：`id: uid ?? record.id`）；日志记录却用 `schedule-N`。
    `steerById` 直接 `ScheduleId(id)` 后按 `r.id === scheduleId` 比对，
    **没有做 uid → 日志 id 的换算**，因此所有由用户工具创建的提醒插话都失败。
  - 实测：uid `f0fc0c90…` vs 日志 id `schedule-1`，必然不相等。
  - 删除 / 暂停路径早已用 `resolveActiveScheduleId` 做了这层换算，插话是漏网的。
  - 修复：插话先按 uid 查当前活动的日志 id（`findScheduleIdByUid`），
    找不到再当作日志 id 原样使用（兼容无 uid 的旧数据与直接传 `schedule-N`）。
    dispatch 事件仍写**日志 id**，不是 uid。
- **fix** 进度条「速度不均衡 / 每秒一跳」：相位参数被逐秒重算导致双倍计数。
  - 根因：CSS 动画挂上后会**自行推进**；而 `useNow(1000)` 每秒触发重渲染，
    每次都把 `delay = -(now - start)` 重算一遍，浏览器便把播放头又前移 1 秒
    —— 这一秒动画本已走过，于是**每秒多跳一次**。
  - 实测证据：`--ss-bar-delay` 每约 1s 精确变化 **-1000ms**；宽度增量出现
    `0.0153 → 0.3485`（约 23 倍）的周期尖刺，周期与 tick 一致。
  - 修复：把「挂载时刻」用 ref 冻结（`phaseAtRef`），delay 只由它计算。这样
    重渲染（含每秒 tick）不改变参数；重新挂载（切会话回来）时 ref 重取当前时刻，
    相位仍按绝对时间对齐。
  - 修复后实测：`--ss-bar-delay` 恒定（`delayStable: true`），增量极差
    0.3336 → **0.0061**（缩小 55 倍），周期尖刺消失。
  - 暂停 → 恢复仍正确重新锚定（10.33% → 10.72% 从冻结处继续，不归零）。
- **feat** 暂停态改为「原条 + 静止」（P1 定稿）：**移除**原有的灰色斜纹填充。
  - P1 原文（docs/ui/16）：暂停 = 原条 + 静止，**不加任何纹理、不变色**。
    状态由「动 / 静」对比表达：进行中进度条在推进，暂停时停住。
  - 实现：暂停态只有 `animation: none`；进行中仅有推进动画
    （`ss-dock-bar-progress`）。**不额外叠加流动/斜纹/冰封**——真机实测两条
    的背景与底色完全一致（`background-image: none`、同为 `rgb(249,250,251)`），
    只差动画在不在跑。
  - 修正记录：先前实现误把「进行中加流光斜纹」当作 P1 的一部分（源于
    设计探索阶段 G1 方案），但那不在 P1 定义内，已移除。教训：把**独立**的
    设计决定捆进一个已拍板的方案里，会让"已确认"的范围被悄悄放大。
  - 推进动画的参数仍由 JS 注入 `--ss-bar-duration / --ss-bar-delay`
    （duration 固定为完整窗口、delay 为负的已过去量），CSS 负责声明动画，
    JS 不写 `animationName` 简写以免覆盖。
- **feat** 暂停项支持「编辑文案」与「插话发送」（此前两者都被禁用，属实现缺口）。
  - **编辑**：暂停项不在日志里（pause 时已 delete），旧实现必然 `schedule_not_found`，
    客户端只好禁用按钮。现改为直接改写 sidecar 的 `PausedEntry.prompt`——不动时刻、
    不动剩余秒数、不动 uid、不写会话事件，因此冻结进度与恢复后的窗口都不受影响。
  - **插话发送**：语义是「不等倒计时立即推送」，对暂停项恰恰最需要。现从 sidecar 留档
    取材构造消息（`user` 代发 / `context` 注入两形态与常规路径一致），投递成功后清掉留档
    （提醒已送达、应出列）。
  - 客户端：两处按钮解除 `disabled`；因宿主**不写会话事件**、投影不会立刻刷新，
    补了本地文案覆盖（`promptOverrides`）与本地摘除复用（`dismissedPaused`），
    待投影对账后自然失效。
- **fix** 暂停 / 恢复后进度条长度会变（**两处根因**）：
  - **窗口缩水（宿主）**：resume 用 `after_seconds = remaining` 重建日志记录，原窗口
    另存 `ownership.windowSeconds`；而 pause 却从日志的 `afterSeconds` 取窗口，
    于是每「恢复→再暂停」一轮窗口就缩水一次（2 分钟任务 → 暂停(120) → 恢复(85)
    → 再暂停(窗被记成 85)…）。进度条比例随之失真，实测塌缩到 2.3%。
    修复：pause 优先取 `ownership.windowSeconds`，仅首次暂停回退日志值。
  - **冻结帧基准（客户端）**：冻结比过去用 `scheduled_at` 反推，而暂停后该字段会
    换成 `originalScheduledAt`，窗口基准整体跳变。改为纯算术
    `(窗口 − 剩余) / 窗口`，并抽出 `src/bar-geometry.ts` 供两侧共用 + 单测覆盖。
  - **教训**：中途曾用「客户端墙钟」做冻结上界，导致上界随时间前进、条越缩越短
    （29% → 2.9%）；现上界仅在宿主 `paused_at` 晚于点击时补回往返耗时，
    且不影响主算式。`tests/bar-geometry.test.mjs` 锁死这两类回归。
- **fix** 删除暂停项后 dock 行不消失（**根因修复**）：投影 view 改为**以 sidecar 为准**重读 `paused`，不再信任可能陈旧的 `state.paused` 镜像。
  - 根因：删除暂停项只清 sidecar、不写会话事件——**也不能写**：该 id 在 pause 时已被
    `dsh-schedule` 删除，补写 `delete` 会抛 `schedule delete targets inactive id`，让整份
    日志读失败。
  - 而投影 cell 只在事件到达时由 `apply` 推进，且会持久化进 projection cache；客户端又按
    seq「更高者胜」消费控制帧 → 没有新事件就没有修正帧。宿主那份 `paused[]` 快照因此永久
    陈旧，**刷新页面也会被缓存恢复**（此前表现为「删不掉、且刷新后复活」）。
  - 修复：`viewUserScheduleProjection` 在 `sessionId` 可用时从 sidecar（留档的权威存储）
    重读，`readFresh` 按 mtime/size 失效，删除即刻可见。旧快照不再可能让已删行复活。
  - 客户端摘除相应收敛为「粘性直到投影变化」：仅当同 uid 以 active 复现（resume）才解除，
    不再按时间过期——过期只会让陈旧投影里的已删行复活。
- **fix** resume 先清 sidecar `paused` 再 append `create`，消除「已暂停 + 新活动」双行。
- **fix** delete 支持 wire `uid`：活动任务先映射 scheduleId；暂停项直接清 sidecar（此前 `deleted:false`）。
- **feat** 移除右下角 ⏰ 到达 toast；到点以对话消息为准。
- **feat** 暂停 / 恢复（仅 `after` + 类提醒）：dock 原地斜纹冻结，不拆分区。
  - `/user-schedule-pause` / `/user-schedule-resume`；sidecar v2 存 `uid` + `paused` 草稿。
  - 暂停 = 日志 `delete` + sidecar 留档；恢复 = `after_seconds=remaining` 重建（日志 id 会变，uid 不变）。
  - 投影 `stateVersion: 4`，wire 带 `status` / `remaining_seconds`；非 after / 已到点不显示暂停。
  - 进度条定稿 hatch（斜纹停放）。
- **chore** 上游跨代兼容收敛到 `src/upstream-compat.ts`：Session API 双轨探测
  （`ownEvents` / `events` + `seedLength`）与 peer 代次矩阵（`KERNEL_GENERATIONS`）
  单点维护。新 rc 落地：改矩阵 → `node scripts/sync-peer-matrix.mjs` → `npm test`。
  - **fix** 0.1.1 路径补上 `header.seedLength` 回退（此前恒传 `inheritedEventCount=0`，
    fork 子会话可能把继承前缀误算进用户任务）。
  - 护栏：`tests/upstream-compat.test.mjs` 锁两代形状 + package.json peer 同步。
- **fix** 悬浮卡片现在反映定时状态（修复 #4）。此前侧栏行内 badge 显示
  「有提醒」，而同一行悬浮卡片的状态区只说「空闲」，两者自相矛盾：卡片正文
  由宿主的 `sessionStatuses` 硬编码状态链生成，不认识本插件的定时任务，且
  宿主未暴露任何 hover 卡片插槽。
  - 实现方式（纯插件，零宿主改动）：在宿主已有卡片的状态区**追加**一行
    与宿主 `.hoverStatus` 同构的状态行，内容为「N 条定时提醒 + 下次触发
    时间」（到期走「等待发送」文案）。
  - 关联方式：卡片是 `body` 级 portal，与会话行无 DOM 祖先关系，改用与行内
    badge 同源的 React fiber 反查（`memoizedProps.node.id`）关联会话。
  - **纯追加**语义：不改写、不替换、不重排宿主既有状态行，`pendingInteraction`
    / `running` 等状态优先级不变；无活动定时任务的会话卡片行为完全不变。
  - 抗重渲染：卡片每次悬浮由 React 重建，依赖既有的 MutationObserver 重扫
    重插，与 badge 同一机制。
  - 探测不到宿主结构时安静跳过（绝不误标）；不依赖任何构建期 hash 类名。

## 2026-09-12

- **chore!** 插件改名 `dsh-session-scheduler` → **`dsh-later`**：消除与核心
  引擎 `dsh-schedule` 的命名撞车，贴合 `/later` 用户心智。变更范围：
  包名、cordis 条目 id（`later`）、settings 命名空间（`dsh-later`）、
  sidecar 目录（`plugin-state/later/`）、client 端 localStorage key。
  - sidecar 自动迁移：首次启动把旧目录 `plugin-state/session-scheduler/`
    的所有权文件搬到新目录（rename 优先，失败逐文件复制，幂等），
    已设定提醒不丢失。
  - 升级前已暂存在浏览器 localStorage 的离线任务不再读取（量级通常为
    0；如需找回，手动把 key `dsh-session-scheduler:pending` 改名为
    `dsh-later:pending`）。
  - 历史会话日志中的 `session-scheduler/user-schedule` 事件键与环境变量
    `DSH_SESSION_SCHEDULER_STATE_DIR` 保持读兼容（后者仍被识别，新名为
    `DSH_LATER_STATE_DIR`）。
  - 已装旧版的机器需先 `dsh plugin remove` 旧插件再 add 新版（包名已变）。

## 2026-09-10

- **fix!** 用户任务所有权移出会话日志，改存插件 sidecar 文件
  （`~/.dsh/plugin-state/session-scheduler/<sessionId>.json`），根治「宿主
  持久化静默丢行 → 历史 seq 缺口 → 整份会话拒读」事故。`/later` 的代发
  形态、GUI 面板归属、fork 隔离语义不变。
  ⚠️ 降级单向门：本版本后新建的任务无伴生事件行，回退旧版插件时这些任务
  在面板不显示（引擎触发不受影响）。整机备份请包含
  `plugin-state/session-scheduler/` 目录。
- **chore!** 仓库结构对齐项目布局：插件包移入 `dsh-session-scheduler/`
  子目录，设计工作区（PRD / 设计文档 / 源码分析）入库。
- docs: 根 README 恢复为插件版；项目总览留档 `docs/project-overview.md`
  （仓库根）。

## 2026-09-09

- docs+tooling: README 媒体刷新，新增截图采集流水线（`scripts/capture/`）。

## 2026-09-08

- feat: 会话状态图标添加动画效果。
- docs: README 全面改版为用户向介绍/展示/使用，技术内容移入 docs/。

## 2026-09 及更早（v1.0.0）

- 用户工具 `user_schedule_create/list/delete/edit` + `/later`、`/schedule`
  slash 命令；`userSchedules` 会话投影（GUI 面板 + dock + 输入框按钮）。
- 独立调度器（`runtime.ts`）：用户创建的提醒到点 dispatch + followup 注入，
  与 dsh-schedule 共用日志互不双触发。
- 智能时段排期（工作时间/午休/晚间静默）、时区处理、注入防护 framing。
