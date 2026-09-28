# 验证状态与验收对照

> 面向开发者/维护者的技术文档。测试、E2E 与跨代兼容的完整记录。

## 验证状态

- **单元/集成测试**：90 个全绿（host + client 双端构建通过；`npm run typecheck` 因 dev 环境双副本 `@deepseek-ai/dsh-session` 有预存依赖类型噪音，构建不受影响——本轮改动后噪音错误较基线净减 5 条，无新增）
- **独立实例线上 E2E（Playwright 无头真点 UI）**：按钮渲染→开面板→自定义时间→确认→芯片出现→任务列表可见→**到期真触发（≈计划 75s，实测 72s）→对话出现 `user/message`（source=plugin:later）**；磁盘日志逐条确认 create→owned→dispatch→followup 全持久化、无重复触发。
- **内核代次兼容（2026-09-07 实测）**：`0.1.1-rc.2` 与 `0.1.2-rc.1` 两代均通过 host 入口链接（运行时符号 17/17 存在）、headless 真实启动（停在 `MISSING_CREDENTIAL`，在插件加载之后）与 web 真实启动（`lib/client.js` HTTP 200）。跨代做法有三处：
  1. **peer 枚举完整覆盖**：除了 `dsh-schedule / dsh-session / dsh-session-projection`，把宿主直接 import 的 `@deepseek-ai/{cordis,dsh-agent,dsh-commands,dsh-llm,dsh-settings,dsh-tools,schemastery}` 全部列入 peer + dev——`0.1.1-rc.2` 经 `dsh-schedule` 传递提升到顶层 `node_modules/@deepseek-ai/` 时这些包是可达的；`0.1.2-rc.1` 的 hoisting 策略变化把它们留在 `.pnpm/`，**未声明 peer 的会运行时报 `ERR_MODULE_NOT_FOUND`**（已实测 `lib/runtime.js` import `@deepseek-ai/dsh-llm` 在 0.1.2 直接崩）。
  2. **设置命名空间**写作 `'dsh-later' as SettingsNamespace`（`settingsNamespace()` helper 在 `0.1.2` 已删除，运行时导入会让整个模块链接失败）。
  3. **设置卡片所需的 `SettingsScope`** 在 `src/client/components/SchedulerSettingsCard.tsx` 内本地声明，不从 `@deepseek-ai/dsh-client-runtime/client` 取类型——该包是 `0.1.1` 内核特有，`0.1.2` 已拆走，且同名 `SettingsScope` 在 host（`dsh-settings`）与 client 两侧成员并不相同。peer 为逐代枚举 `^0.1.1-rc.2 || ^0.1.2-rc.1`（node-semver 不把预发布版算进任何范围，除非比较符带同一 `[major.minor.patch]` 元组，故无跨代区间写法）：**上游每发布新 rc 代次就要补一个枚举项**。
- **Session API 跨代**：探测与 peer 矩阵已收敛到 `src/upstream-compat.ts`（2026-09-17）。
  - `readOwnEvents` / `readInheritedEventCount`：`0.1.1` = `.events` + `header.seedLength`；
    `0.1.2` = `ownEvents()` + `inheritedEventCount`。`foldUserState` 只调这两处。
  - `KERNEL_GENERATIONS` 是 peer 代次的唯一事实来源；改完跑
    `node scripts/sync-peer-matrix.mjs` 重写 package.json，再 `npm test`。
  - 护栏：`tests/upstream-compat.test.mjs`（两代形状一致 + peer/dev 同步 + seedLength 回归）。
- **插话投递改动的跨代核对（2026-09-28，静态比对 4 代产物）**：新增的投递/确认路径逐项确认
  在其声明支持的两代内可用，并额外核对到**尚未声明**的更新代次。
  - 方法：从 npm 拉取 `0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.3 / 0.1.7-rc.2` 四代 tarball 解包比对
    （而非只跑本地 devDependency 的单一版本——本地只有 `0.1.2-rc.1`）。
  - 结论：改动依赖的 4 个 API 在**四代全部存在且契约一致**：
    `agent.followup` / `agent.steer`（四代 doc comment 逐字相同）、
    `sessions.flush(session)`、`createUserMessage` / `boundContextSummary`。
    Session 形状仍是两轨：`0.1.1-rc.2` 为 `.events`+`seedLength`，`≥0.1.2-rc.1` 为
    `ownEvents()`+`inheritedEventCount` —— 与 `KERNEL_GENERATIONS` 的二元模型吻合，
    **无需新增代次**。
  - 送达确认走 `readOwnEvents` 兼容层（非直接读 `session.events`）；已加护栏
    `tests/delivery.test.mjs` 的三个形状用例，并反向验证：把 `readOwnEvents` 换回
    直接读 `.events` 后，`0.1.2+` 用例立即失败。
  - 设置枚举用 `s.union([s.const(...)])`，`schemastery@3.18.2` 具备该 API；实测非法值
    **抛错而非静默回落**，故 `getSettings` 的 `try/catch`（回落 `startSettings`）+
    逐字段精确比对（只认 `'steer'`/`'discard'`）是必要的双重保险。
  - ⚠️ **peer 代次缺口已实测定位（2026-09-28）**：peer 枚举只到 `^0.1.2-rc.1`，实际运行的
    宿主已是 `0.1.5-rc.3`。为决定「补哪些代次」做了实测，结论是**不能一次补到最新**：

    | 代次 | host 入口链接 | 结论 |
    |---|---|---|
    | `0.1.5-rc.1` / `rc.2` / `rc.3` | 15/15 模块导入通过 | ✅ **可补** |
    | `0.1.7-rc.1` | 导出仍含 `allocateScheduleId` | ✅ 可补 |
    | `0.1.7-rc.2` | **11/15 失败** | ❌ **破坏性，不可补** |

    方法：在隔离目录按代次 `npm install` 内核作用域包（`--ignore-scripts`，各代 9 个包 +
    cordis），把 `lib/` 拷入后逐个 `import()` 全部 15 个 host 模块。

  - **`0.1.7-rc.2` 的三处破坏性变更**（均已读实现确认，非猜测）：
    1. `allocateScheduleId` —— **导出被删除**，且该代无等价替代（id 分配移入
       `ScheduleService.create`）。插件在 `user-tools.ts` 有 5 处调用。
       边界精确：`0.1.7-rc.1` 仍导出（`export { …, allocateScheduleId, … }`），
       `0.1.7-rc.2` 起消失。
    2. `renderEveryReminderBatchFraming` → 重命名为
       `renderRecurringReminderBatchFraming`（**函数体逐字相同**，纯改名）。
       插件在 `runtime.ts:615` 调用。
    3. `createAfterScheduleRecord(id, prompt, afterSeconds, now)` →
       增加必填第 5 参 `title`，缺失即 `ScheduleInputError: title is required`。
       `createAtScheduleRecord` / `createEveryScheduleRecord` 同批变更。
  - 因此**本轮只补 `0.1.5` 代次**（`rc.1`），把声明范围推进到与当前宿主一致；
    `0.1.7` 需要单独的适配工作（改名 + 补 `title` + 自实现 id 分配），作为后续事项，
    不在本次范围内。

  - **`0.1.5-rc.1` 的落地验证（2026-09-28 实测）**：
    - 隔离目录安装内核作用域包（各代 9 包 + cordis，`--ignore-scripts`）后，
      **host 入口链接**：15/15 模块 `import()` 通过。
    - **运行时实例化**（不止 import —— 捕捉「导入 OK 但 `apply()` 崩」）：以最小假 ctx
      调 `apply()` 成功，注册顺序为
      `inject[sessionProjections] → inject[settings] → effect×2 → on(agent/created)`。
    - **对照 `0.1.2-rc.1`**（原有代次）：同样 15/15 + `apply()` 成功，注册顺序**逐项相同**
      —— 未因本次改动产生代次间行为分叉。
    - 运行的宿主 `0.1.5-rc.3` 现已满足新声明的 peer 范围（`semver.satisfies` 默认语义下
      亦为 true，不再依赖 `includePrerelease`）。
  - **本地开发代次已对齐到 `0.1.5-rc.1`（2026-09-28）**：
    - 起因：devDependencies 原先写的是**完整 peer 范围串**，npm/pnpm 因此解析到
      「满足范围的最老可用版本」= `0.1.2-rc.1`，而真实运行时是 `0.1.5-rc.3` ——
      **测试环境落后运行环境整整一代**，API 漂移在本地无从暴露（peer 缺口正是这样漏掉的）。
    - 处置：`devDependencies` 改为**固定到最新已验证代次** `0.1.5-rc.1`（全部
      kernel-scoped 包同代次，避免类型面自相矛盾）；`peerDependencies` 仍为完整范围串。
    - `scripts/sync-peer-matrix.mjs` 同步改造：peer 写范围、dev 写固定代次；且**只在该
      字段已是范围串或缺失时**才改写 dev，避免把有意固定的版本冲掉（幂等）。
    - 结果：`npm run typecheck` **通过且无新增错误**（0.1.2 → 0.1.5 的类型面兼容），
      `npm test` **183 通过 / 0 失败**（新增 2 条 dev 固定性守卫）。
    - 新增守卫（`tests/upstream-compat.test.mjs`）：dev 必须是**具体代次**而非范围串、
      必须落在已验证列表内、全部包同代次、且等于最新已验证代次；另有一条显式登记
      「当前 dev 代次」的断言，使代次变更在 diff 中可见而非被 install 悄悄改掉。
      反向验证两种情形均被挡下：dev 回退成范围串、dev 固定到未验证的 `0.1.7-rc.2`。
  - **代次守卫改为数据驱动**（原先硬编码「两代」，每加一代都要改测试）。
    现断言结构不变量：首代 legacy、其余 own-events、`peerRange` 下界必须**恰为该代次
    本身**（逐代留痕，不借用更早下界）、代次表严格递增。并附 `verGt` / `caretCovers`
    的自测，防止守卫自身失效。
    反向验证：把 `0.1.5-rc.1` 的范围偷写成 `^0.1.2-rc.1`，守卫立即失败。

## 验收对照（v1.0.0）

| 编号 | 场景 | 落地 |
|---|---|---|
| AC-01 | 输入内容点击 ⏰ | ✅ 线上 E2E 实测：按钮渲染、面板可开 |
| AC-02 | 智能时段确认 | ✅ 线上 E2E 实测：自定义时间→确认→芯片显示｜任务列表 |
| AC-03 | 过去时间拒绝 | 面板校验 + 宿主 `not_future` 兜底 |
| AC-04 | 到期注入消息 | ✅ 线上 E2E 实测：到期（≈计划 75s）后对话出现 user/message（source=plugin）|
| AC-05 | 关网页重开仍在 | 事件日志持久化 + `userSchedules` 投影冷恢复 |
| AC-06 | 草稿变更 | 有意取舍：不静默取消（见 [设计决策 §4](./design-decisions.md)） |
| AC-07 | fork 不继承 | `session/end-seed` 重置 |
| AC-08 | 100 并发创建 | agent 事务串行化 + 单 session 上限 100 |
| AC-20 | 与 dsh-schedule 共存 | `schedule/change` 荷载零改动（严格兼容） |
