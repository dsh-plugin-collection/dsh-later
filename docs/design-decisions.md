# 关键设计决策

> 面向开发者/维护者的技术文档。记录「为什么这么做」的取舍与踩坑，改动前先读。

## 1. `source` 字段怎么做到不破坏 dsh-schedule（与 PRD 的适配）

PRD 想在 `schedule/change` 荷载里加 `source: 'user-tool'` 区分创建来源。但 dsh-schedule 对 `schedule/change` 采用**严格解码**（`hasExactKeys` 拒绝任何多余字段）——加一个 `source` 会让 dsh-schedule 自身的 fold 抛 `corrupt_schedule_log`，破坏「两者同时安装、互不干扰」（AC-20）。

**本插件解法**：`schedule/change` 荷载**保持原样**（完全兼容），另写一条本插件自有的伴生事件 `session-scheduler/user-schedule`（`{version:1, operation:'add'|'remove', id}`）记录用户来源。dsh-schedule 的 fold 会跳过非 `schedule/change` 事件，天然互不干扰；GUI 与 `user_schedule_list` 以「schedule/change 活动记录 ∩ 伴生所有权」为据展示用户任务。

## 1b. 自有事件类型的加载兼容：~~激活时注册~~ → **已移除**（2026-10-20，#58）

**历史背景**：dsh-session 的持久化读路径在加载历史时逐条校验事件类型 —— 不在核心白名单
`KNOWN_SESSION_EVENT_TYPES` 里、且未标 envelope `ignorable:true` 的事件，会让**整份日志被拒读**
（`SessionFormatUnsupportedError`，GUI 表现为「历史加载失败」）。伴生事件（§1）恰好是插件自有词汇，
于是早期实现在 `apply()` 最先调用 `registerOwnedSessionEventType()`，把自有类型 `add()` 进宿主的集合。

**为什么废掉**：

1. 上游**明确否决了这条路**（`known-event-types.d.ts` 的注释）：事件名注册「does not classify
   omission safety and would make reads composition-dependent」；官方认可的兼容机制是 envelope 上的
   `ignorable: true`。我们用 `Set.add()` 只因为运行时那个集合恰好没冻结。
2. 它**只在插件与宿主解析到同一份 `dsh-session` 实例**时有效 —— `link:` 开发态实测失效
   （插件侧 0.2.0 / 宿主 0.2.1，注册写进了孤岛 Set，见 #57）。
3. **没有需要救的数据**：该事件自 2026-09-10（§1c 的 sidecar 化）起不再写入，而最早 release
   `v1.0.0` 是 2026-09-12 —— 没有任何已发布版本写过它；全库按 JSON `type` 精确匹配扫 1666 份日志，
   0 份命中。

**现状**：注册模块与调用已删除。旧日志如确需读取，用 `scripts/migrate-owned-events.mjs`
（默认 dry-run；`--apply` 先备份）给这些记录补 `ignorable: true` —— 不动 `seq`、不动 `type`，
因为读路径要求 seq 连续，删行会造出缺口反而更不可读。详见 CHANGELOG「未发布」与
`docs/verification.md` 的「会话日志兼容」一节。

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

> **实现更正（2026-11-03，issue #11）**：本节当时把边界描述成「遇 `session/end-seed` 事件就重置状态」。该判据已废——内核**每次冷恢复会话**都会在日志尾部补一条 `session/end-seed {}`（`dsh-session/lib/index.js:1428`，0.1.2-rc.1 是 `:1322`），据此重置会连带抹掉本会话自己那些还没到点的提醒：投影空了，投递通道却照跑，于是用户看不见它、也就取消不掉。现判据是宿主 `init(header, inheritedEventCount)` 送进来的**继承前缀长度**（`seq < 切点` 的事件不进状态），与投递通道 `foldUserState` → `readFoldInput` 同源。为什么不按 `data.inherited` 形状判：0.1.2-rc.1 的 fork 边界也只发 `{}`。**决策本身（fork 不继承父会话提醒，AC-07）不变**，只换判据；判据边界由 `tests/projection-endseed-parity.test.mjs` 与 `tests/projection.test.mjs` 的 AC-07 用例钉住。

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

### 8.6 attach 式 dock 的垫底假设与管子接缝（issue #41）

**事实链（0.2.0-rc.2 实测）**：composerStack 是 flex column、gap 6px；slot outlet 渲染为 `display: contents`，不产生盒子，所以各 dock 根是**直接 DOM 兄弟**（相邻选择器 `+` 可用）。宿主 QueueDock 根的负下边距 `calc(0px - var(--dsh-composer-stack-gap) - 3px)` = **-9px**，抵掉 6px gap 后净效果是面板底边**被下一层盖住 3px** —— 这不是 bug，是刻意的**消缝手法**：attach 壳的底边本就"直角 + 开口"（`:after` 无 bottom 边），由下一层不透明底盖掉 3px，接缝处就不会出现发丝缝。由此宿主的 dock 栈有一条**没有写在任何契约里的假设**：attach 式（顶圆角 + 底开口 + 负边距）**必须垫底、直接接 composer**。order 0/10/20 里只有 queue 是 attach 式，todo/goal 都是浮卡式（全圆角、无负边距、带 elevation 阴影），所以"垫底"从未被第二条 attach 壳考验过。

**破绽与修法**：本插件逐值抄了 queue 的 attach 壳（§8.2 的既有决策），却排在 order 30 —— queue 之下。queue 不再垫底，它"底边开口 + 被盖 3px"的设计落到了提醒条的**圆角顶边 + 顶描边**上，接缝双缘重影（`dock-alignment.md` §5 G3 预言的正是这一条）。#41 选 B2「连成一根管子」：宿主零改动，插件 styles 追加两条相邻规则 —— `[data-queue-dock] + .ss-dock-root .ss-dock-body { border-radius: 0; }` 与同选择器的 `::after { border-top: none; }`，让提醒条在被队列条紧邻在上时把自己顶边管子化。**为什么保留 3px 重叠而不是拉平**：重叠是段间与段底共用的消缝手法，拉平它等于用发丝缝换掉重影（demo 初稿 B 实测可见接缝亮线，错在这两处：拉平负边距、忘去顶描边——亮线的真正来源是那条 `.5px` 顶线，不是圆角）。没有队列条时两条规则都不命中，单条 dock 观感零变化。

**耦合与退出**：规则借的 `[data-queue-dock]` 是宿主私有属性（其唯一稳定 hook，§8.1 结论一），属**有记录的耦合**——宿主 rc 升级 checklist 因此追加一项：确认 queue 仍是 attach 式且该属性仍在 dock 根上，**具体两条可执行检查与判据见 [`docs/notes/dock-alignment.md` §8 第 10 项](notes/dock-alignment.md#8-怎么复核)**（此前这里只写了"已追加"却没给落点，等于声明悬空；现已补实）。失配的后果是静默退化为修复前观感（圆角相撞），不会更糟。长期解法不是插件侧继续猜，而是宿主提供 dock 栈契约（谁是段、如何收口），见 #43。

### 8.7 接缝判据换成「我在 dock 栈里排第几」：能自己表达的那一半先做掉

**决定**：§8.6 的接缝规则不再问「上面紧邻的那条是不是宿主队列条」，改问「我在 dock 栈里排第几」—— 选择器只依赖渲染器给每个插槽出口的公开标记 `[data-slot="conversation.input.dock"]` 与我们自己的 `.ss-dock-root`（`:not(:first-child)` 管子化顶边，`:not(:last-child)` 让出末位）。**本次没有新增抄宿主的几何值**：§8.2 那套 `--dsh-composer-*` 变量与 `-9px` 负下边距原样留着，换的只是判据来源。三条规则的文本与特指度算账以 [notes/dock-stack-contract.md](notes/dock-stack-contract.md) §2 为唯一事实来源，本节不复述选择器全文；下面只留「次序是不是载荷」这一句，因为它决定后人改规则时该看什么。**本节 supersede §8.6 的「耦合与退出」段**（那段的垫底假设、3px 消缝手法、为什么不拉平，仍然成立）。

**机制（别记错，错了会把后人带偏）**：两条规则盖过基础规则靠的是**特指度** —— 基础 `.ss-dock-root` / `.ss-dock-body` 只有 (0,1,0)、`.ss-dock-body::after` 是 (0,1,1)，而 A 是 (0,3,0)、B 是 (0,4,0)（`::after` 那一支 (0,4,1)）。A 改的是 `.ss-dock-root` 的 `margin-bottom`、B 改的是 `.ss-dock-body` 的顶边，**两者命中不同元素的不同声明、互不争优先级**；源码次序 A→B 只是阅读因果，不承载正确性。

> 下列三条理由里的宿主值复查于本机安装态 `0.2.1-rc.2`（2026-10-23）。`$H = ~/.npm/_npx/*/node_modules/@deepseek-ai`，与 [notes/dock-alignment.md](notes/dock-alignment.md) §8 同一个变量；它是**通配**，本机展开成两份安装（`0.2.1-rc.2` 与 `0.1.5-rc.3`），所以下面每条取法的命中数一律**按每份安装**计，别把两份相加当结论，判期望值时也要认 GUI 实际加载的那一份。宿主 bundle 的哈希前缀随构建漂移，**一律用后缀匹配**。

**为什么换（三条理由，每条给取法）**：

1. **旧判据耦合邻居身份**。`[data-queue-dock]` 是宿主 QueueDock 根上的**私有属性**（§8.1 结论一：类名构建期哈希，它是唯一稳定 hook），宿主改名不违反任何契约 —— 于是每次 rc 升级都要人工复查它还在不在（那次复查就记在 dock-alignment.md §8 第 10 项）。取法：`grep -o 'data-queue-dock' $H/dsh-client-ui-conversation/lib/client.js` → 每份安装各 1 处（`0.2.1-rc.2` 仍在；"仍在"不是好消息，代价就是每次升级都得再问一遍）。
2. **邻居身份对了，位置也可能错**。紧邻在我们上方的有四种可能：todo / goal / queue / 比我们先注册的第三方。取法：`grep -h -A3 'slots.inject("conversation.input.dock"' $H/dsh-client-ui-{conversation,goal}/lib/client.js | grep -E '"(todo|queue|goal)"|order:'` → todo 0、goal 10、queue 20；本仓 `src/client/index.tsx:499-500` 是 `id: 'later-dock'` / `order: 30`。旧判据只认 queue 那一家的属性名，上方换成 goal / todo / 第三方 dock 时该画方角仍是圆角。
3. **规模上不止我们一家**。「谁是栈底」是四个 occupants 共用、却**没有任何 API 声明**的隐含前提：宿主自家 todo/goal/queue 各自实现一份壳（§8.1 结论三），而把壳写成 attach 式的有两家 —— 宿主的 queue 与我们的 `order: 30`，我们一插，宿主自己的 queue 就不再垫底。实测（取法：`grep -o '_dock{[^}]*margin:[^;]*' $H/dsh-client-ui-{conversation,goal}/lib/client.js` 给出 queue 的 `margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)` 与 goal 的 `margin:0 auto`；todo 在 conversation 包里那个类叫 `_root`，`grep -o '_root{[^}]*box-shadow:var(--dsw-elevation-panel)[^}]*}' …conversation/lib/client.js` 恰好 1 处，同为 `margin:0 auto` + 全圆角 `var(--dsw-radius-lg)`）：**attach 式目前只有 queue 与我们两家**，浮卡那两家不参与收口这件事，但"垫底"这个前提从 #41 起就再没有被第二条 attach 壳考验过（§8.6 事实链末句），现在正是被考验的那一次。宿主三家的上下位置是**注册时定死的**（order 0/10/20 互不重叠），所以壳能画死；插件这一家的邻居取决于别人装了什么、order 多少，画不死 —— 只能读自己的位置。

**边界（设计里明确保留的两条，不是待办）**：

- **仍然耦合 `[data-slot]` 这一手出口结构**。它比私有属性公开得多（渲染器给**所有**插槽的通用锚点，不是某一家 dock 的身份牌），但判据成立的前提是 `.ss-dock-root` 直接挂在 `[data-slot="conversation.input.dock"]` 下面。取法（`$H/dsh-client-ui-renderer/lib/client.js`）：`grep -o 'const ANCHOR_STYLE = [^;]*'` → `{ display: "contents" }`（出口自己不进布局），出口渲染为 `<div data-slot={slotKey} style={ANCHOR_STYLE}>`；list 分支把每条条目 `guarded()` 之后放进一个 Fragment 当锚点的 children，而 `guarded` 的边界组件在成功路径 `return this.props.children`（不多包一层 DOM）→ 条目根互为兄弟、且都是锚点的直接子元素。**这条直接子代关系在 worktree 里静态 grep 不到**（conversation / renderer 两个包不在插件依赖树里，读到的是渲染器源码不是现场 DOM），只能靠隔离实例真机测 —— 它是 dock-stack-contract §3 的判据 5，测完之前本节的状态是**按源码推定**，不是实测。
- **崩溃的空锚点会占一个兄弟位**。上方某条 dock 抛错时，渲染器在同一父节点下留一个带 `data-slot-error` 的空 div，两条路径都会出这个形态：条目错误边界的失败分支（`SlotErrorBoundary` / `StrictSessionEntry` 渲染锚点 + `data-slot-error`），以及 list 分支里条目已退场的那一格（`guarded` 之外直接渲染锚点）。取法：`grep -o '"data-slot-error": [^)]*' $H/dsh-client-ui-renderer/lib/client.js` → 每份安装 4 处（其中两条带条目 key，正是 list 出口里的那一格）。于是我们 `:not(:first-child)` 成立而上方并无可见内容 → 顶边画成方角。这是「已经在降级」场景里的次级观感问题，本方案不为此引入 `:nth-child(… of …)` 那类脆弱写法。

**fail-open 方向（刻意如此）**：任何一条新选择器若在真实宿主里永不命中（出口结构与我们理解的不一致就属于这一类），观感退回 §8.6 修复前（接缝多一条描边），**不会更糟**。基础态因此**敢**保留末位 attach（顶圆角 + 底开口 + `-9px`）：只有明确「不是末位」时才让位。最常见的 solo 现场（这条 dock 自己占满栈）里新旧规则同样一条都不命中，注入的 CSS 在那个状态下与 §8.6 逐字相同 —— 所以「单条 dock 观感不变」是**代码级可推**的；但把它当成实测结论要靠像素比对，那是 dock-stack-contract §3 的判据 6，尚未做（[notes/dock-alignment.md](notes/dock-alignment.md) §5 的 G3 因此标 ❌）。

**换判据咬到的地方（本轮真实代价，别省）**：#42 留下的反向守卫「任何声明 margin 的 `.ss-dock-root` 规则都必须带 `-9px`」与新方案**天然冲突** —— 规则 A 恰恰是把下边距收回 0，不收窄就把它永久判红。尺子最终在 `tests/dock-tube-seam.test.mjs`（现 9 条）里拆成三块：**「反向守卫 1」** 数 `styles.ts` 里 `data-queue-dock` 出现 **0 次**（守"本仓不再以任何形式引用那个私有属性"）；**「反向守卫 2」** 用 `deepEqual(所有把 .ss-dock-root 下边距归零的规则, [§2 A 那一条逐字文本])` —— 豁免不是"含 `:not(:last-child)` 就放行"，而是逐字比对，所以无前缀的 `.ss-dock-root { margin-bottom: 0 }`、写成 `:last-child` 的反向形态、把落点换成 `margin` 简写，三种都照样报红，守的还是 attach 态（栈底）那 3px 消缝重叠不许丢；**「反向自证」** 在内存里把嗅探规则或别的 margin 覆盖塞回 `styles.ts`，两条守卫必须立刻变红（防永真，手法同 `client-class-guard.test.mjs`）。

这一轮现学的三条，比"改了几条 CSS"值钱：

1. **改判据要连守护判据的那把尺一起改**，且收窄时别顺手放宽 —— 豁免只给那一条规则，不给那一类写法。
2. **说不出防什么的断言就删掉，别留成永真**。原「源序」断言（管子规则必须排在 `.ss-dock-body` / `::after` 基础规则**之后**）的前提本身就是错的：新 B 是 (0,4,0)、基础只有 (0,1,0)，盖过靠**特指度**，把管子规则挪到基础规则前面观感一个字都不变 —— 它在任何真实改动下恒为真，是一条假装在守护什么的断言，删（文件头「删掉的一条：原第 4 条『源序』」记的就是这个）。上面「机制（别记错）」那段是它的替身；真正要防"后写的规则反过来盖掉契约"的，是「基线仍在」与「反向守卫」两条，它们都还在。
3. **同源判据的基准必须是产物，不是测试常量**。原「demo 与 `styles.ts` 同源」比的是 demo ↔ 测试里的 `TUBE` 常量，两边当时**同时**写着旧选择器，所以绿，真实产物根本不在比较链上；现在**以 `styles.ts` 为唯一基准**反查 demo 的 B3 段。判据 1 那条用例还顺带加了「**恰好三条**」：把挂在 `[data-slot]` 锚点上的 `.ss-dock-root` 规则收成集合与 §2 三条做 `deepEqual` —— 少一条是契约被动过，**多一条是有人绕过 §2 私自补规则改观感**（§2 明写不要再加，尤其别给"非末位"发明闭合底边），而第四条的破绽只在两条 dock 同屏时才暴露，单人回归根本抓不到。

**上游那一半与退出路径**：真正的收口靠 #43 的两个方案 —— a：宿主给每个 dock 根标 `data-dock-attach="first|mid|last"`；b：共享壳公共导出。**a 单独落地不解决壳复用**：几何仍是四家各抄一遍（理由 3 的实测就是四份实现），§8.1 结论三那条「宿主壳一改就得人工追平」的代价不会消失。所以本仓把 a 视为**止血**（判据不用再猜位置）、b 视为**收口**（连抄都省掉）。宿主若落地 a，本节两条 `:first-child` / `:last-child` 换成 `[data-dock-attach]`，rc 升级复查项从「那个私有属性还在不在」变成「attach 标记值与 order 是否一致」（落点仍是 dock-alignment.md §8 第 10 项）；若长期不做，本节方案就是**终态** —— 它已不依赖任何邻居身份。

**关联**：#41 是现状修法（本节替换它的判据来源，机制不变）、#42 把接缝像素判据从散文变成可执行（`scripts/seam-check/`、`tests/seam-pixel-criteria.test.mjs`、采样帧 `docs/media/seam-matrix/`）、#43 是上游 dock 栈契约、#62 是遗留复测（那批像素判据目前只在 DPR=1 采过：`docs/media/seam-matrix/manifest.json` 8 帧全部 `"dpr": 1`；本节不动任何几何，对 #62 既不利也不弊）。规则文本与验收判据的唯一事实来源：[notes/dock-stack-contract.md](notes/dock-stack-contract.md)。

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


## 10. #11b 的三条决策：叫起来的会话归谁（D1）、到期视图的事实源（D2）、叫醒走哪条路（D3）

`src/expiry-sweeper.ts` 与 `src/index.ts` 的注释里一直用 D1/D2/D3 编号引用这三条，但**条目一直
没写进本文件**（issue #140 的验收第 4 条点名的就是这个空档）。下面按代码里现有的编号补齐；
`expiry-sweeper.ts` 模块头那句「唤醒是有代价的（D1：接受）」就是这里的 D1 的前半。

### D1 · 冷唤醒有代价，代价的收尾是「投递收敛之后释放句柄」

**决定**：接受唤醒的代价（`agents.resume` 真建 agent、真跑一轮 turn，无 provider 时那轮以
`turn/end` 的 `has no provider` 错误收尾），并**在投递收敛之后释放本插件自己叫起来的那个句柄**。

为什么不释放不行：`AgentHandle.dispose()` 是**能力型**句柄——只有持有者能让这个 agent 倒下，
而 resume 会**以写者身份**打开那份持久会话。丢弃句柄有两个可观察后果：① 被叫醒过的会话在宿主
重启前永久常驻 `ctx.agents`（原本它是冷的、不占 agent 资源），数量只增不减；② 那条会话被本插件
占着写者位，web profile 的 `sessionController.resolveAgent` 对「写者持有」直接拒绝——用户反而
打不开自己那条被"帮忙"叫醒过的会话。而 `README.md` 承诺的正是"服务端重启、会话从没被打开过也会
自己拉起来投递"，所以这条边界必须被决定，不能被继承。

释放的三个条件与另外两种选择的代价：

1. **等投递收敛再拆**（判据两条同时成立：agent 不在跑 turn，**且**索引面里这个会话已无到期条目）。
   不等的替代方案是"叫起来、drive 一下就走"，那是把 `driveOnce` 的维护事务连根端掉——**用户那条
   提醒不会进会话**，用一份内存去换一次丢投递，方向反了。反过来"永远不拆"就是上面那两个后果。
2. **超时就留着**（30s 上限）。投不出去/回合卡住时会话留在表里，是本仓一贯的「宁热不丢」：
   这条边界写在代码里并带一条 warn，不静默。上限那一支在单测里**没驱动**（见
   `docs/verification.md` 的「未判定」）。
3. **只拆自己叫起来的**。路径一（`sessionController`）交回的 agent 归会话控制器所有，本插件没有
   句柄也没有资格拆——那会拆掉用户正看着的会话。释放前还要核验 `ctx.agents.get(sessionId)` 仍是
   本次唤醒拿到的那个实例，被用户或宿主接管过就放弃。

与「同会话第二条又到点」怎么共存：会撞上，但撞上的后果只是**多叫醒一次**，不是丢提醒。释放的前提
是索引面已无到期条目，于是任何后续到期都必然来自新建或新推进的提醒，扫描器对已变冷的会话会重新走
`wakeColdSession`。残留窗口只有「检查之后、`dispose()` 之前刚好到点」这一小段，落进扫描器已有的
退避重叫路径。释放之后会顺手清掉本插件自己写进静默期的标记——我们自己的 `agent/disposed` 不是
用户动作。

算不算一个 turn 成本：释放本身不产生 turn；唤醒那一轮的 turn 成本是 D1 前半已经接受的既有代价。

**测试**：`tests/cold-wake-release.test.mjs`（四条：收敛即释放、busy 时不释放、控制器路径不释放、
释放之后第二条仍能冷唤醒并投递）。

### D2 · 到期视图的事实源：镜像 fold 的端态进 sidecar

**决定**：扫描器继续**只读 sidecar**，但 sidecar 里多一个**消化标记**——由 runtime 在 `dispatch`
的同一同步块里把 fold 的端态镜像进去（`ownership-store.mirrorDueIndex`），判据是 `due.readDueIndex`
的三态（`due` / `consumed` / `unknown`）。

要修的是这条链：一次性提醒投递成功之后，日志里那条记录已经出列，而 sidecar 里仍留着创建时那个
过去的时刻；扫描器只看 sidecar，于是把它**永远判成「到期且未消化」**，5 次假失败之后 `gaveUp`，
该会话此后任何新提醒都不再被冷唤醒（issue #139）。

三种候选里为什么是这一种：

- **「扫描器去读 fold」（把真相同源理解成读日志）不成立**：`ctx.sessions.get(id)` 按内核定义只返回
  **已发布（live）**的会话（`SessionStore.get`：*"Look up a live session … undefined when no live
  session has that id"*，`SessionStore` 全类没有 load/restore 入口），而「要不要叫醒这条冷会话」的
  判定恰恰发生在会话还冷的时候——**读不到自己的判据，是循环依赖**。退一步只在清算时读也不行：
  那必须先把会话叫醒才读得到，#139 验收里「重启后带历史已投条目不该被白白拉起」这一条就永远做不到。
- **「投递时同步摘 sidecar 条目」不选，有实证代价**：`runtime.ts` 的 `rearmOneShot` 在 `dispatch`
  **之后**才 `getOwnership(dispatchedId)` 回读 `uid` / `windowSeconds` / `attachments`（补偿重挂要
  保住稳定身份与附件）。先摘条目就把这条提醒的稳定身份弄丢——面板上换一行、`delete`/`pause` 按 uid
  找不到、附件消失。而且每条投递路径都要补一遍，漏一处就复发。
- **只推进 `every` 的 `scheduledAt`** 只解决周期那一半，一次性提醒照样复发。

`every` 的 `scheduledAt` **推进**，但**不是**扫描器或索引层自己算下一次：日志面本来就已经推进了
（内核 `applyScheduleChanges` 把带 `acceptedAt` 的 dispatch 应用成 `nextScheduledAt`，本仓两条
fold 通道同口径——`user-tools.ts` 的 `foldScheduleEventsCompat` 与 `projection.ts`，
`tests/schedule-change-decode-parity.test.mjs` 钉着）。镜像只做「把 fold 的端态抄进索引」，
**不存在第三次 occurrence 计算**，这是 `src/due.ts` 模块头那条「不要把 occurrence 解析搬进判定层」
的纪律的延续。

`gaveUp` 的解除条件因此变成三条，都可被测试驱动：① 条目被删/推远（这条以前**结构性不可达**——
`settle()` 把 `state.gaveUp` 的短路排在清算之前，用户删干净也解不开，会话到进程重启都是哑的）；
② 条目被正常消化（修复后的主路径）；③ 用户改动之后 `rearm(sessionId)` 显式解除（模块头一直写着
「用户动了这条提醒才重新武装」，但接线侧此前只调 `reschedule()`，那是纯重排、不碰退避）。

**遗留数据的边界**（必须说清，否则下一个读文档的人会以为修复追溯一切）：1.12.1 及以下写下的条目
没有标记，冷会话又读不到日志，所以重启后**最多再白拉一次**；那一次唤醒里会话被附着，runtime 在
`driveOnce` 开头对账补上标记，此后同一条目永不再叫。测试把这一面单独钉住（`验收②·遗留数据`），
不与"新数据 0 次唤醒"混写成一条。

**测试**：`tests/due-index-consumption.test.mjs`（三态判据与镜像的幂等、三条 `gaveUp` 解除路径、
以及 #139 验收里那三条现有判据看不见的路径）。

### D3 · 叫醒走哪条路：惰性取 `sessionController`，缺席回退 `agents.resume`

**决定**：先 `ctx.get('sessionController')`（web profile 才有），拿到就用它的 `resolveAgent`；
没有该服务或它交回 `{ error }`（子会话 / 不存在 / 写者持有）就回退 `ctx.agents.resume(...)`。

为什么不写进顶层 `inject`：`sessionController` 只由 `dsh-web-app` 挂载，顶层 `inject` 是整个入口
的**激活门控**——把它列进去，非 web profile 上整条 fiber 永久 pending（`waiting for service:
sessionController`），插件整体消失，`/later` 与 `/schedule` 全体不见。这与 issue #34 那次 P0 是同
一类错误：拿一个可选面去当激活门控。惰性取的代价是失败要自己兜住，所以两条路都不通时记
`undelivered` 并告警一次，不抛出去变成没头没尾的异常。

为什么两条路都要留：`resolveAgent` 是 web profile 里唯一**不与 GUI 抢会话生命周期**的入口（它自己
管附着与释放，也正是 D1 里"路径一不释放"的依据）；`agents.resume` 是 CLI/ACP 那类 profile 唯一的
出路。顺序反过来的话，web 上每次冷唤醒都会绕过控制器的写者校验，实测会撞出「用户打不开刚被叫醒的
会话」那一类问题。

## 11. 悬浮卡片状态区：从「纯追加」改成「只合并 idle 这一档」（issue #153）

**现在的规则**（`src/client/session-presence.ts` 的 `applyHoverCard`）：宿主状态行是**空闲**时，把这一行的
**文案**换成定时读数，状态点复用宿主那个节点，不新增行；宿主是任何其他档位（进行中、等待审批、计划待审、
等待回答、已完成）时，宿主自己的行一字不改，插件行追加在它后面；没有活动提醒时一个节点都不碰。边界只有一句：
**只覆盖 idle 这一档，其余档位的一切宿主信息原样保留**。

**决定**：撤掉 issue #4 定下的「纯追加、绝不改写宿主行」（那条只写在模块头注释里，本文此前没有对应条目，
这也是它被当成「顺手加一行」的原因之一）。破例有两条理由，第二条是这次才查出来的。

1. **读感**：#153 的截图里卡片写着「● 空闲」，而侧栏同一行挂着时钟徽标。两条并排，用户读到的是「这个会话
   空闲，另外有个东西在定时」；实际含义是「它现在空闲，到点才会被叫醒」。空闲是本语境下唯一真实的状态，
   留着它等于让卡片说出一个不成立的事实。#4 那条护栏原本为了不与 `dsh-group-status` 抢同一行，而它管的场景里
   宿主行确实是别人的内容。
2. **纯追加其实一直没生效**：`findHoverCard()` 过去只看 `card.firstElementChild` 的直接子节点。真 GUI 实测
   （3080 上悬停会话行）卡片是 React portal：`body > span._portal_* > div._card_* > div.hoverContent`，中间
   多一层包装，于是老代码永远定位不到状态区。老判据还要求状态点是 `SPAN`，而宿主按档位换标签：空闲实测是
   `span[data-state="idle"]`，进行中实测是 `svg[data-state="ongoing"]`（spinner 是 `<svg>`）。两处任一命中都
   足以让整条追加静默失效；`reportSidebarDrift()` 只盯侧栏，悬浮卡片没有对应的漂移告警，所以 #153 能一直潜伏。

**判「是不是空闲」用结构化档位，不用文案**：状态点上的 `data-state` 是与界面语言无关的判据，且宿主
`sessionStatuses` 里 idle 分支只有一处，带 `data-state="idle"` 的行最多一条，替换它不会撞上歧义。文案白名单
（八种语言的 `status.idle`，从 `@2.0.0` 底本抽出）只在 `data-state` 缺席时兜底，且只对**标题之后**的行生效：
会话标题完全可能正好等于 `Idle` 这类普通英文词。代价明说：宿主改了文案、或新档位不带 `data-state`，兜底就
按「非空闲」处理，结果是多一行而不是覆盖错行，宁可多一行。

**可逆性**：被接管的宿主行只打 `data-ss-adopted` / `data-ss-idle-label` / `data-ss-state` 三个自有标记，原文案
存在标记里；`restoreAdoptedRow` 逐行还原，卸载与「任务删完」都走它，还原后的卡片与宿主自己渲染的一致。不删
宿主节点（删了就是在改宿主结构），插件文案也不带专属色或专属样式，`styles.ts` 没动。

**耦合与退出**：认行的形状集中在 `HOST_DOM` 一处；portal 包装层、层级深度、状态点标签都不作依赖，hash 类名
（`_card_*` / `_portal_*`）一律不认。若宿主把状态区搬得更深，唯一要调的是 `statusHostMaxDepth`。

**别把它改回去**：现有 `tests/hover-card.test.mjs` 仍按旧口径断言，它的桩写的是小写 `idle` 且不带 `data-state`，
所以新旧两版实现都能通过，它不构成这条规则的回归线；「空闲 / 非空闲 / 无提醒」三档的 DOM 级用例尚未在本仓落地，
在补齐之前，这条规则只有代码注释与本条兜着。
