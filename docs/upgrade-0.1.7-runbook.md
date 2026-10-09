# DSH 0.1.5-rc.3 → 0.1.7-rc.2 升级执行手册

> 本文档由 2026-09-28 的完整预检生成。所有结论均基于隔离环境实测，未在生产实例上执行任何变更。
> 生产实例：PID 50614（3080 GUI + 3081 webhook），升级前请勿停。

## 零、升级前状态（基线）

| 项 | 值 |
|---|---|
| 当前版本 | `0.1.5-rc.3` |
| 目标版本 | `0.1.7-rc.2` |
| 会话数据 | 648M / 1310 个会话文件 |
| `schedule/change` 记录 | 1335 条（离线验证：0.1.5 与 0.1.7 均可 100% 解码）|
| profile patch | `~/.dsh/profiles/web/cordis.patch.yml`（199 行）|
| 活跃插件 | 11 个（另 3 个在 patch 里 `disabled: true`）|

## 一、已完成的前置验证

全部通过，无需重做：

| 验证项 | 结果 |
|---|---|
| 4 个自研插件代码适配 | typecheck 0 错误 |
| 自研插件测试 | 183 / 63 / 4 / 265 全绿 |
| 11 个第三方插件符号面 | 0 断裂 |
| 13 个插件真实装载 | 全部成功 |
| 生产配置 0.1.7 组合 | 6/6 自定义行就位 |
| **生产复刻全量启动** | **15 项 bundles 全部启动成功** |
| **备份恢复演练** | **0.1.5 从备份启动成功，1335 条记录可读** |
| 定时任务默认关闭的影响 | 无影响（`dsh-later` 自实现调度器）|

## 二、备份（已完成，勿删）

```
~/.dsh/backups/pre-upgrade-0.1.7-20260928-170735/
├── sessions/           645M, 1310 文件（已核对字节数 + 抽样解压）
├── settings.yaml       263K
├── profiles/web/       cordis.patch.yml + package.json + cordis.yml
├── .credentials.yaml
├── secrets/
└── env.local
```

## 三、执行步骤

### 步骤 1：升级前最后确认（不停服，可随时做）

```bash
# 记录当前版本与 PID，便于回滚时核对
dsh --version                                    # 应为 0.1.5-rc.3
ss -tlnp | grep -E ':(3080|3081) '               # 应看到 PID 50614

# 确认备份仍在
ls -d ~/.dsh/backups/pre-upgrade-0.1.7-*
```

### 步骤 2：停掉生产实例（⚠️ 硬前提）

```bash
# 找到 dsh 进程（npm exec @deepseek-ai/dsh web 那一条）
ps aux | grep 'dsh@0.1.5-rc.3 web' | grep -v grep

# 优雅停止（PID 以实际为准）
kill 50007          # npm exec 包装进程
# 确认 3080/3081 都已释放
ss -tln | grep -E ':(3080|3081) ' || echo '已释放'
```

**为什么必须停：** 实测表明，不停旧实例时新实例会因 `EADDRINUSE 0.0.0.0:3081` 而**部分激活失败**。0.1.7 的表现是打印 `warning: N entries did not activate` 后**继续启动** —— GUI 看起来正常，但 webhook 链路实际是断的（`webhook-github` 会卡在 `pending`）。这种半启动状态最难排查。

### 步骤 3：升级三个第三方插件（可在停服前做）

这三个的新版本已适配 0.1.7：

```bash
dsh plugin --profile web add dsh-context@0.59.0
dsh plugin --profile web add dshmarket@1.66.3
dsh plugin --profile web add @mars-sea/dsh-commandcode-provider@0.11.17
```

| 插件 | 变更 | 为什么必须升 |
|---|---|---|
| `dsh-context` | `settings.register` → `settings.describe`（其余 API 面不变）| 旧版在 0.1.7 下设置页失效 |
| `dshmarket` | 新增 `canRegister` 守卫 + 明确告警 | 旧版无守卫 |
| `commandcode-provider` | peer 改为 `^0.1.7-rc.2` | **不升会 peer 冲突** |

### 步骤 4：升级 DSH 本体

```bash
# 方式取决于你的安装方式；npx 方式下清缓存重拉
rm -rf ~/.npm/_npx/1e7f6d9597241db0    # 建议先确认该目录确为 0.1.5 缓存
npx @deepseek-ai/dsh@0.1.7-rc.2 --version    # 确认能拉到
```

### 步骤 5：启动并立即验证（⚠️ 三项必查）

```bash
dsh web
```

**a) 会话能否打开**（V3 格式迁移后的关键验证）

打开 GUI，点开任意一个历史会话。若出现 `history unavailable` / `SessionFormatUnsupportedError` → 立即回滚。

**b) 定时提醒是否触发**

```
/schedule +2m 升级后测试提醒
```
等 2 分钟确认送达。`dsh-later` 不依赖被关闭的官方 schedule 服务，应正常。

**c) webhook 链路**

```bash
# 3081 上应有路由（而非 404）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081/api/gitea-dispatch/waiting
# 期望 200
```

## 四、回滚方案（已验证可行）

```bash
# 1. 停掉 0.1.7 实例
kill <新 PID>

# 2. 还原 sessions（V3 迁移不可逆，必须整份还原）
rm -rf ~/.dsh/sessions
cp -a ~/.dsh/backups/pre-upgrade-0.1.7-20260928-170735/sessions ~/.dsh/sessions

# 3. 还原配置
cp -a ~/.dsh/backups/pre-upgrade-0.1.7-20260928-170735/settings.yaml ~/.dsh/
cp -a ~/.dsh/backups/pre-upgrade-0.1.7-20260928-170735/profiles/web/*.yml ~/.dsh/profiles/web/

# 4. 切回 0.1.5
npx @deepseek-ai/dsh@0.1.5-rc.3 web
```

**回滚演练结论**：用上述备份在隔离环境启动 0.1.5，进程正常、1310 个会话文件与 1335 条 `schedule/change` 记录全部可解码（0 失败）。**备份确实能救回来。**

> 演练中唯一告警：`dsh-smooth-stream: could not mount /smooth-stream; falling back to a directly registered route` —— 该插件自身的降级路径，回退到直接注册路由，非致命。

## 五、已知会退化的能力（可接受）

| 项 | 影响 | 说明 |
|---|---|---|
| 自建设置卡片 UI | 退化为基础表单 | **字段仍可编辑** —— 0.1.7 从插件的 `Config` schema 自动生成表单（`autoGenerate` 默认 true）|
| `opencode2dsh` 的 IP 池设置页 + 桥接路由 | 缺失 | **provider 本身可用**（实测 `big-pickle` 调用成功）；桥接因作者在降级分支 early-return 而跳过 |
| `dsh-later` 等插件的 `settings.register` 调用 | 抛错但被 catch | 降级为静态配置，核心功能不受影响 |

## 六、注意事项

**1. 插件装了却没生效的排查顺序**

`dsh plugin add` 遇到 `ERR_PNPM_IGNORED_BUILDS` 时，包会装进 `node_modules` 但 reconcile 中止，导致**不在 `bundles` 里 → 静默不生效**。解法：

```yaml
# profiles/web/pnpm-workspace.yaml
allowBuilds:
  '@google/genai': false      # 不能是 "set this to true or false" 占位字符串
  protobufjs: false
```

**2. `dsh.bundle` 决定挂载方式**

- 有 `dsh.bundle` → 自动进 `bundles` 数组
- 无 `dsh.bundle`（如 `dsh-input-history`、`dsh-gitea-dispatch`）→ **必须走显式 `- id:` 行**；误加进 `bundles` 会被 `skipping profile bundle` 跳过

**3. 定时任务与时间上下文默认关闭**

0.1.7 的 web 模板里 `schedule` 与 `time-context` 两行是 `disabled: true`。实测对 `dsh-later` **无影响**（它自实现调度器，只复用 `dsh-schedule` 的纯函数）。如需恢复官方能力，在 patch 里：

```yaml
- id: schedule
  disabled: false
```

但要注意与 `dsh-later` 的 UI 重复问题。

**4. 每个 profile 有自己的 patch**

0.1.7 下 `web` / `headless` 等 profile 的 `cordis.patch.yml` **互不共享**。模型路由等配置需逐 profile 配置。
