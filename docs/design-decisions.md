# 关键设计决策

> 面向开发者/维护者的技术文档。记录「为什么这么做」的取舍与踩坑，改动前先读。

## 1. `source` 字段怎么做到不破坏 dsh-schedule（与 PRD 的适配）

PRD 想在 `schedule/change` 荷载里加 `source: 'user-tool'` 区分创建来源。但 dsh-schedule 对 `schedule/change` 采用**严格解码**（`hasExactKeys` 拒绝任何多余字段）——加一个 `source` 会让 dsh-schedule 自身的 fold 抛 `corrupt_schedule_log`，破坏「两者同时安装、互不干扰」（AC-20）。

**本插件解法**：`schedule/change` 荷载**保持原样**（完全兼容），另写一条本插件自有的伴生事件 `session-scheduler/user-schedule`（`{version:1, operation:'add'|'remove', id}`）记录用户来源。dsh-schedule 的 fold 会跳过非 `schedule/change` 事件，天然互不干扰；GUI 与 `user_schedule_list` 以「schedule/change 活动记录 ∩ 伴生所有权」为据展示用户任务。

## 1b. 自有事件类型的加载兼容：激活时注册（owned-event-registration.ts）

dsh-session 的持久化读路径在加载历史时逐条校验事件类型：不在核心白名单 `KNOWN_SESSION_EVENT_TYPES` 里且未标 envelope `ignorable:true` 的事件，会让**整份日志被拒读**（`SessionFormatUnsupportedError`，GUI 表现为「历史加载失败」）——而伴生事件（见 §1）恰好是插件自有词汇。当前构建的 `Session.append(type, data)` 不暴露 `ignorable` 字段、核心文档明示插件注册面暂缓提供，因此本插件在 `apply()` 最先调用 `registerOwnedSessionEventType()` 把自有类型登记进宿主集合（进程级、幂等；该模块仅限 host 端引用，client bundle 不得引入）。

> TODO(上游)：待 dsh-session 暴露 append 侧 `ignorable` 标记后，可在**确有需要**时恢复伴生事件方案并改为写入时标记。

## 1c. 所有权彻底移出会话日志：sidecar 文件（2026-09 缺口事故的根治）

**事故**：宿主持久化层在特定时序下会「seq 已消费但行未落盘」——本插件写入的伴生事件
`session-scheduler/user-schedule` 恰好命中：内存日志长度 +1，行却没写进磁盘，日志里
留下**永久 seq 缺口**。dsh-session 的读路径（含 v0→v3 格式迁移）对缺口 fail-closed，
整份历史被拒读，GUI 表现为「历史加载失败：… has seq gap (expected N, got N+1)」。
2026-09-10 已用 position-aware 重编号脚本离线修复 79 份受损日志（备份在
`~/.dsh/sessions/.seqgap-repair-backup-20260910/`），但伴生事件本身随行丢失、
不可恢复（v0→v1 迁移拒绝未知历史类型，重插即让日志再次不可读）。

**决策**：所有权 + 投递形态（`/later` 的 `delivery:'user'`）**不再写入会话日志**，
改存插件自己的 sidecar 文件：

- 路径：`<DSH_HOME>/plugin-state/later/<sessionId>.json`（2026-09-12 随插件改名自旧目录迁移）
  （解析优先级 `DSH_SESSION_SCHEDULER_STATE_DIR` > `$DSH_HOME` > `~/.dsh`；
  见 `ownership-store.ts`）。
- 原子写（tmp + rename）；损坏文件改名保留（`.corrupt-<ts>`）后按空表继续；
  进程内按 (mtime,size) 缓存，热路径零读盘。
- 写序：**sidecar 先于 `session.append`**（投影 fold 在 create 事件到达时按
  sidecar 判定归属），flush 失败则**回滚** sidecar（避免与日志漂移）；
  delete 在 **flush 成功后**才撤销（失败时保留，运行时仍可追踪该任务）。
- 投影 `init(header)` 按 sessionId 从 sidecar 装载（进程重启后恢复 GUI 归属）；
  `apply` 的 create 事件查 sidecar 缓存；日志里残留的历史伴生事件仍按原逻辑
  fold（读兼容）。投影 state 新增 `sessionId`，`stateVersion` 2 → 3。

**代价与边界**：
1. 会话删除后 sidecar 文件残留（每会话 ≤100 条、每条 ~100B，可忽略；后续可在
   会话清理钩子里顺手删除）。
2. 跨进程写同一 sidecar 采用 last-writer-wins（用户工具操作按 agent 串行，
   实际无并发写）。
3. 旧版伴生事件的注册（§1b）保留：读兼容旧日志；插件本身不再产生新伴生事件。

## 2. 客户端↔宿主变更通道：slash command

在 rc.7 里客户端没有对任意插件的通用「调用宿主函数」通道（Typert Remote 需要生成器与 host service 编排，过度耦合）。本插件使用 DSH 一等公民的 **slash command**：客户端 `session.command('/user-schedule-create {json}')` 直达宿主 handler（handler 携带 `agent`，可 `agent.session.append` + `ctx.sessions.flush`），且 `command/run`/`command/done` 自动落日志（审计友好）。命令设 `recordInput: false`，避免把 GUI 载荷重复写进日志（权威载荷在 domain 事件里）。

> ⚠️ 命令名必须符合 `^[a-z][a-z0-9_-]*$`（不含冒号）——曾踩坑：`user-schedule:create` 无法通过 `parseCommand`/`COMMAND_NAME`，导致命令静默不执行（上线 E2E 实测暴露）。

读状态则用**会话投影** `userSchedules`（`useProjection`），宿主在提交事件时增量 fold、实时推送——与 `dsh-suggest-ghost` 同款机制。

## 3. fork 隔离（AC-07）

dsh-schedule 用 `seedLength` 排除派生会话继承前缀；投影框架本身按整条日志 fold。本插件投影在遇到 `session/end-seed` 事件时**重置自身状态**，因此子会话绝不继承父会话的用户提醒。

## 4. 发送方式：不操控输入框（AC-06 的取舍）

PRD/dsh-sleep-send 有「发送前草稿变更 → 自动取消」逻辑。本插件按设计采用 `followup()` 注入（提醒内容在创建时固化），草稿后文变更**不会**静默取消一个已明确排定的提醒——否则会与「关网页也要准时触发」（AC-04/AC-05，本插件核心价值）冲突。取消路径由芯片「取消全部」/ 列表「删除单个」提供。这是一个有意的产品取舍，若需要 v1.1 可加回「绑定草稿版本」的可选开关。

## 5. 用户提醒的独立调度器

dsh-schedule 的 runtime 只在其自身工具变更 / agent 转 idle 时重驱；命令创建的提醒不会被它武装 timer（线上 E2E 实测：任务显示但永不到期）。本插件因此自带 per-agent 调度器（`runtime.ts`），用户 create/delete 后重驱、到期按 dsh-schedule 语义 dispatch + followup，并借**同一份持久化日志**与 dsh-schedule 互相去重（单次触发，见集成测试与线上 E2E）。原理详见 [`architecture.md`](./architecture.md)。

## 6. 跨代兼容单点：`upstream-compat.ts`（2026-09-17）

0.1.1 ↔ 0.1.2 的 Session API / peer 枚举差异曾散落在 `user-tools.foldUserState`、
`index.ts` settings 注册与 `package.json`。现收敛为：

| 关注点 | 位置 |
|---|---|
| Session 读日志双轨 | `readOwnEvents` / `readInheritedEventCount` |
| peer 代次矩阵 | `KERNEL_GENERATIONS` + `peerMatrixEntries()` |
| 同步 package.json | `scripts/sync-peer-matrix.mjs` |
| 矩阵护栏 | `tests/upstream-compat.test.mjs` |

新 rc checklist：矩阵追加一代 → sync 脚本 → 全量测试。settings 命名空间字面量
在 `domain.SETTINGS_NAMESPACE`（注册处仍 `as SettingsNamespace`——helper 已在 0.1.2 删除）。

## 7. `ProjectionDefinition` 版本陷阱（dock 不显示的根因，已修）

`@deepseek-ai/dsh-session-projection` 在 **rc.1 → rc.2** 之间把注册契约从 `{schema, view}` 改成 `{stateSchema, wire:{viewSchema, view}}`。宿主（web profile）跑 rc.2，而插件 dev 依赖一度解析到 rc.1：类型层按旧契约「通过」、运行时却按新契约把无 `wire` 的单元当 host-only 跳过 →客户端 `useProjection('userSchedules')` 永远 `undefined`，dock 静默消失。名字 `as never` 让 TS 完全没法拦截。

**教训与护栏**：
1. `domain.ts` 同时扩展 `SessionProjectionMap` 与 `SessionProjectionStateMap`；投影单元按 rc.2 形状写（`stateSchema` + `wire`）。
2. `package.json` 的 `@deepseek-ai/dsh-session-projection` 对齐 `^0.1.1-rc.2`（peer + dev）。
3. `tests/projection-unit.test.mjs` **运行时**锁定形状（旧形状会被判为 NOT client-visible），不依赖 registry 是否装得上 rc.2 类型。

## 8. dock 对齐宿主的边界：抄什么 / 不抄什么 / 为什么顶替不了宿主条目

「待发送提醒 dock 呈现对齐宿主 QueueDock」这条约束此前**只活在源码注释里**（`ScheduleDock.tsx` 文件头、`styles.ts` 的分节注释），全仓 md 无一处提及。本节把它固化，并记录 2026-10 对「能不能直接复用宿主那块」的实测结论。

> 下文宿主事实基于安装态 `@deepseek-ai/dsh-client-ui-*@0.2.0-rc.2`。引用宿主时优先用**导出名 / CSS 类语义 / 选择器**这类不随版本漂移的锚；bundle 行号只作定位辅助，rc 升级后会变。

### 8.1 三条实测结论（决定了后面的做法）

**结论一：宿主 `QueueDock` 组件本体拿不到。**

| 检查 | 结果 |
|---|---|
| 运行时导出面 | `dsh-client-ui-conversation/lib/client.js` 尾部 `exports.` 名单为 `apply / inject / Config / ConversationController / ConversationDefinitionRegistry / ConversationEventRegistry / ConversationLocationIndex / ConversationNodeAssembler / ConversationViewRegistry / UiConversation / EMPTY_CONVERSATION_SNAPSHOT / UnsupportedImageMediaTypeError / conversationPhase / inspectRequestPrompt` —— **没有 `QueueDock`，也没有 `queueDockEntry`** |
| 类型 ≠ 实现 | `lib/types/client/queue/QueueDock.d.ts` 随包发布，但同目录**没有同名运行时 `.js`**；实现只存在于 bundle 内部（深路径 import 只会拿到类型） |
| `./src/*` 导出 | `package.json` 的 `exports` 声明了 `"./src/*"`，而 `files` 只含 `lib/index.js`、`lib/client.js`、`lib/types/**/*.d.ts` → 安装包里**没有 src 目录**，该导出是 monorepo 用的死路径 |
| 类名 | CSS module 构建期哈希（`_7yHdaG_dock` 这类），唯一稳定 hook 是属性 `[data-queue-dock]` |

**结论二：插槽层面也顶替不了宿主的队列条。** `list` 槽的注册冲突判据是**「同 `id` 且同 `priority`」**（`dsh-client-ui-slots` 的 `SlotCore.register()`，`case "list"` 分支）；priority 不同则两条都收进 entries，按 `priority → order` 升序**全部渲染**。也就是说插件用 `id: 'queue'` 换个 priority 注册，得到的是**两条队列条**，不是替换。`single` / `keyed` 才有 shadow 语义，`list` 没有；也没有从外部 dispose 别家条目的 API。

**结论三：宿主自己也没在复用外壳。** 同一个 `conversation.input.dock` 里的三个宿主 occupants —— `todo`（order 0）、`goal`（order 10）、`queue`（order 20）—— 各自实现一份壳、各自一份 CSS module；`dsh-client-ui-goal` 的 dock 同样自己引用 `--dsh-composer-dock-inset` / `--dsh-composer-side-clearance`。它们只共享 **CSS 变量契约**，不共享组件。

> 由此：**插件复制一份 dock 壳，是 0.2.0-rc.2 的官方用法**，不是走偏。代价没有消失，只是转移成「宿主壳一改就得人工追平」——所以本节同时确立 8.4 的核对表与 8.5 的护栏。

### 8.2 抄什么（有契约保障，可直接依赖）

| 可复用面 | 依据 |
|---|---|
| 插槽与位置：`conversation.input.dock`（`kind: list, scope: session`），本插件 `id: 'later-dock'`、`order: 30`，排在队列条之后 | 宿主 `SlotMap` 声明；三个宿主 occupants 的 order 构成 0/10/20 的既有梯度 |
| 外壳几何变量：`--dsh-composer-side-clearance` / `--dsh-composer-dock-inset` / `--dsh-composer-card-max-width` / `--dsh-composer-stack-gap`，含负下边距贴进 composer 栈 + 顶部圆角 + 留底边开口 | 宿主 `.dock` / `.panel` 用的就是这几个变量，插件按同一 calc 抄 |
| 设计 token：全部走 `--dsw-*`（描边、圆角、字体、菜单面、focus ring、滚动条别名），插件不自定义色值 | `styles.ts` dock 段实测只出现 `--dsw-*` / `--ds-*` / `--dsh-composer-*` 与三个 `--ss-bar-*` |
| session 标准件：`sessionId`、`useProjection` 由渲染器绑定后作为 props 下发 | `dsh-client-ui-renderer` 的 `standardKit()` |
| 基元：`@deepseek-ai/dsh-client-ui-primitives` 的图标、`Tooltip`、`projectUserText`、`FileTypeIcon` | `Tooltip` 是公共导出；其 `TooltipSuppression` context 默认值为 `null`，**无 provider 也能独立使用** |

### 8.3 不抄什么（条目模型不同，硬套会更糟）

宿主的队列是 **turn-scoped**：条目来自 `inbox["next-turn"]` 投影，在下一个 turn 边界被消费（宿主 `busyEnter` 只有 `queue` / `steer` 两档）。本插件的提醒是 **clock-scoped**，且有宿主动作面没有的状态。

- 宿主条目模型是固定的 `content blocks`，**没有 `scheduledAt` / `status` / `paused_remaining_seconds` 可挂**；`QueueAction` 只有 `edit` / `remove` / `steer` 三个动作，没有暂停/恢复。
- 宿主 `SlotMap` 里**没有任何行级插槽**（`conversation.*` 下只有 dock 级 list），所以「给宿主每一行加时间/倒计时/暂停」在现有 API 下只能靠 DOM 注水。
- 宿主 dock 的动作受 `queueMutable`（子会话地址是否可续写）与 `running` 门控；把提醒挂进去会让可用性被会话态意外接管。
- 因此**保留**插件自有的：时间显示、倒计时、`role="progressbar"` 的进度条（`bar-geometry.ts` 的窗口/冻结比与 CSS 动画相位）、暂停/恢复、投递未确认的观察窗对账。
- 同样**不**把 `locale` 绑到宿主 `conversation` NS 复用 `queue.*` 词条：那些串写着「排队消息」，语义不对，且属宿主私有 key 面（见 #28）。

### 8.4 差异核对表在哪

像素与行为级差异逐项记在 **[notes/dock-alignment.md](./notes/dock-alignment.md)**（宿主值 / 插件现值 / 处置 / 谁改）。新增 dock 样式前先查那张表；改动宿主壳的对齐项时同步更新它，不要只改代码。

### 8.5 #32 这一轮的执行分工（2026-10，避免与并行改动撞车）

Gitea #32 原是一条混合 issue，按区域归属拆开执行：

| #32 的条目 | 本轮归属 | 说明 |
|---|---|---|
| `cancelling` 死状态（只写不读，删除按钮无在途反馈）、`.ss-pending` 有 JSX 无 CSS | **动作区**（#29 Tooltip 那条分支一并处理） | 都在 `ss-dock-actions` 的按钮渲染里，与 Tooltip 替换同区 |
| 像素漂移（描边 `.5px` vs `1px`、row 圆角字面 `8px` vs `var(--dsw-radius-md)`、`corner-shape: round`、chevron 换图标 vs `rotate(180deg)`） | **Lead，集成后统一改** | 跨 `styles.ts` 与组件两处，避免三个分支各自改 CSS 造成合并冲突 |
| 词条迁移进 `locale.register` + 插槽 `locale` seat | #28 | |
| 行内编辑 textarea + IME 守卫 | #30 | |
| 折叠 / `aria-controls` / `hidden` / header 禁用 / 折叠态状态播报 | #31 | |
| 本 ADR、`notes/dock-alignment.md`、过期文档同步 | #32 文档部分（本节） | |

**护栏**：`[data-queue-dock]` 是宿主唯一稳定的选择器 hook。做任何 dock 对齐改动时，把真队列条与提醒条**同屏**截图比对（`scripts/capture/` 可复用），而不是只对着单条 dock 调 —— 上一轮「1px vs .5px 描边」这类漂移就是这么漏掉的。

## 9. 分组徽标的「定时任务」：由本插件注册 facet，而不是让对方继续适配（issue #36）

折叠分组的徽标由 dsh-group-status 画。此前它 `require('dsh-later/client')` 读我们的摘要 store，
按具名字段（`scheduledSessions` / `scheduleState`）加一份色档反推把「定时任务」画进去。语义归我们，
实现归对方：任一方改口径，另一方既不报错也不报警，只静默显示成旧读数。现在方向反过来——本插件按
[facet 协议 v1](http://192.168.4.77:3000/dsh-plugins/dsh-group-status/src/branch/main/docs/facet-protocol.md)
登记 `dsh-later.schedule`，交出 fold / merge / label / renderIcon，对方只认协议形状。

四条取舍，改这块代码前先读完：

1. **同名 id 而不是新 id**。`dsh-later.schedule` 与对方过渡适配器同名，同 id 冲突**由来源决胜**
   （provider 恒胜 legacy），与两家 apply 的先后无关。于是我们一注册，代管那份自动让位，既不重复
   计数，也不需要协调发布顺序；换成新 id 会让徽标同时出现两份。
2. **基线优先于「更该显示什么」**。`count` 的口径（会话数而非任务数）、色档、脉冲、文案、图标尺寸
   逐项对齐过渡适配器：迁移的验收标准是「注册前后徽标逐字不变」，任何一处不同都算 bug（要么是这里
   语义写错，要么是对方 bug），而不是顺手改设计。文案要不要说清「N 会话 · M 条任务」是另一个决定，
   它得连对方的基线一起改，见 issue #36 的评论。
3. **可选依赖绝不变成硬依赖**。dsh-group-status 缺席时 `require('dsh-group-status/client')` 抛错，
   必须兜住；它**既不进** `dsh.client.external`，**也不进** client 的模块级 `inject`——顶层 inject 是
   fiber 激活门控（issue #34 那次 P0 就是 host 入口列了 client 服务导致整插件 pending），写死一个可选
   搭档等于用整个定时功能去换一只徽标。
4. **逻辑与宿主图标集分层**。`src/schedule-facet.ts` 零 React、零 DOM，fold / merge / 文案 / 取色都在
   这里，`node --test` 直接跑；`src/client/group-status-facet.ts` 只负责容错 require 与画图标（宿主
   图标集的 `require` 图在本仓测试里解析不了）。分层的收益是可验证性：`tests/group-status-facet.test.mjs`
   把过渡适配器的算法**照抄成 oracle** 与实现对拍，对方删掉 `legacy/` 之后这条回归线仍留在本仓——
   以后想改显示口径必须先过它，改动不再能静默生效。

**容错的三种形态，只有一种该出声**：未安装 / 未启用（`require` 抛）、对端旧版还没有登记面 → 静默跳过
（旧版仍由它的适配器画徽标，行为与迁移前一致；每次启动刷一条没人能处理的警告只会淹掉真问题）；对端有
登记面但协议版本对不上 → 一条 `console.warn`，因为「我注册了为什么没显示」必须能查出原因，这正是协议
文档点名要避免的不可诊断失败。

**顺带**：`STATE_RANK` 从 `schedule-summary.ts` 导出复用，分组聚合与 facet 跨层合并认同一套「谁更紧急」；
两处各写一遍就是徽标与行内读数漂移的起点。取色函数对**未知 tone 回落 info**——协议允许「新增 tone 取值
不升版本」，直接下标取值会拿到 `undefined`，于是徽标跟着主题变色且无任何报错。

