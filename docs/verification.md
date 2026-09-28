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
  - ⚠️ **仍未处理**：peer 枚举只到 `^0.1.2-rc.1`，而实际运行的宿主已是 `0.1.5-rc.3`、
    上游最新已到 `0.1.7-rc.2`。按本文档既定规则「上游每发布新 rc 代次就要补一个枚举项」，
    这几代尚未补。当前本地开发经 profile symlink 加载，peer 不参与解析所以无感；
    **但真实 `npm install` 时 `0.1.5-rc.3` 不满足声明范围**（`semver.satisfies` 默认
    预发布语义下为 false，仅 `includePrerelease` 才 true）。补枚举需在
    `KERNEL_GENERATIONS` 追加代次并跑 `node scripts/sync-peer-matrix.mjs`。

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
