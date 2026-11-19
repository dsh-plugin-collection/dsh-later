# 文档索引

本目录是 `dsh-later` 的文档索引。按「你现在要做什么」查找，不按文件编号。

用户向的安装、用法、配置在仓库根的 [`README.md`](../README.md) / [`README.en.md`](../README.en.md)。

## 我要知道它现在支持什么、验证到什么程度

| 文档 | 内容 |
|---|---|
| [verification.md](./verification.md) | 验证状态与验收对照：跨内核代次结论、逐条证据、剩余边界。**这是「支持 / 不支持」的唯一真相源** |
| [notes/ui-matrix.md](./notes/ui-matrix.md) | UI 面跨内核代次截图矩阵：每代怎么起真 GUI、判什么 |

## 我要改代码

| 文档 | 内容 |
|---|---|
| [architecture.md](./architecture.md) | 总体架构、数据流、调度器、目录结构 |
| [technical/01-architecture-overview.md](./technical/01-architecture-overview.md) | 技术架构总览：包结构、依赖关系、加载顺序、性能预算 |
| [technical/02-data-model.md](./technical/02-data-model.md) | 数据模型（事件日志 Schema） |
| [technical/03-api-reference.md](./technical/03-api-reference.md) | API 参考：模块导出面、工具 schema、命令载荷 |
| [design-decisions.md](./design-decisions.md) | 关键设计决策与取舍（source 字段、slash 通道、fork 隔离、注入防护、facet 归属） |
| [notes/dock-stack-contract.md](./notes/dock-stack-contract.md) | dock 栈位置契约：为什么不借邻居私有钩子 |
| [upgrade-0.1.7-runbook.md](./upgrade-0.1.7-runbook.md) | 内核 0.1.5-rc.3 → 0.1.7-rc.2 的升级执行手册（历史 runbook） |

## 我要改界面

| 文档 | 内容 |
|---|---|
| [ui/01-component-specs.md](./ui/01-component-specs.md) | 组件规格 |
| [ui/06-design-tokens.md](./ui/06-design-tokens.md) | Design Tokens 现状（宿主主题变量映射） |
| [ui/08-microcopy.md](./ui/08-microcopy.md) | 微文案 |
| [ui/09-session-presence.md](./ui/09-session-presence.md) | 会话定时状态显示（侧栏 badge 与悬浮卡片） |

## 设计阶段的存档（2026-09 定稿，实现已完成）

这些是立项时的设计文档，**描述的是当时的计划，不是当前实现**。当前实现看上面两节。

- [project-overview.md](./project-overview.md) — 项目总览与目录索引
- [design/01-problem-and-goals.md](./design/01-problem-and-goals.md) — 问题定义与目标
- [design/02-user-research.md](./design/02-user-research.md) — 用户调研与场景
- [design/03-competitive-analysis.md](./design/03-competitive-analysis.md) — 竞品分析
- [design/04-information-architecture.md](./design/04-information-architecture.md) — 信息架构
- [design/05-interaction-flows.md](./design/05-interaction-flows.md) — 交互流程
- [design/06-error-strategy.md](./design/06-error-strategy.md) — 错误处理策略
- [design/07-notification-strategy.md](./design/07-notification-strategy.md) — 提醒策略
- [design/08-accessibility.md](./design/08-accessibility.md) — 无障碍与国际化
- [design/09-privacy-and-security.md](./design/09-privacy-and-security.md) — 隐私与安全
- [`../prd.md`](../prd.md) — PRD 单文件版（保留归档）

## 素材与一次性的产物

- [notes/dock-alignment.md](./notes/dock-alignment.md)、[notes/icons.md](./notes/icons.md) — dock 对齐调研、图标清单
- [notes/logo-change-summary.md](./notes/logo-change-summary.md)、[notes/logo-comparison.md](./notes/logo-comparison.md)、[notes/user-response.md](./notes/user-response.md) — Logo 更换记录
- [issues/001-hover-card-schedule-status.md](./issues/001-hover-card-schedule-status.md) — 悬浮卡片不反映定时状态（多数议题在 Gitea 上，这里是少数留档的）
- [promo/README.md](./promo/README.md) — 宣传视频工程（[brief](./promo/BRIEF.md) / [脚本](./promo/SCRIPT.md) / [分镜](./promo/STORYBOARD.md)）
- [media/](./media/) — 截图与动图；各轮采集说明见 [ui-matrix-2026-10-28](./media/ui-matrix-2026-10-28-realgui/README.md)、[ui-matrix-2026-10-30](./media/ui-matrix-2026-10-30-realgui/README.md)、[verify-1.12.0](./media/verify-1.12.0/README.md)、[hover-idle-2026-11-11](./media/hover-idle-2026-11-11/README.md)
- [`../references/`](../references/) — 上游 `dsh-schedule` / `dsh-sleep-send` 源码分析

## 约定

- **一处事实只有一份**：一个结论如果这里和别处都写了，以本索引「改代码」「支持什么」两节里的文档为准。
- 文档里的 `src/` 路径应对应真实文件；发现对不上就是文档的锅，不是代码的锅。
