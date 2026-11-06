# 1.12.0 验证证据：按 issue 组织

全部是 **real-gui**：真内核（0.2.1-rc.4 为主）+ 真会话 + 每次一个独立 `DSH_HOME`。没有组件预览，没有示意图。

修前 / 修后分别用两个 detach worktree 建实例：`pre-*` = 该修复合并前的提交，`post-*` = 合并后的提交。插件按实体副本装进 profile（不是挂仓库目录），所以两边跑的是各自真实的 `lib/` 构建产物。

判据只取**网络面**、**持久化事件**（`command/run`、`command/done`、`agent/inbox/spliced`、`schedule/change`）、**DOM 精确类名**（`ss-dock-row`），不取页面文本命中。例外见文末「未判定」。

## issue #10：七条 /user-schedule-* 手敲带不了参

| 用例 | 修前（07a5a56，1.11.0） | 修后（71db603） |
|---|---|---|
| 手敲 /user-schedule-list {} | **整行被当聊天发出**：页面出现用户气泡 + 「本轮运行失败 当前请求的额度已用尽」，无 command/run | 不产生气泡，command/run + command/done success |
| 手敲裸 id /user-schedule-delete schedule-… | 无命令事件 | command/done success {"id":"schedule-…"} |

图：issue10-1-typed-args-{FAIL,PASS}.jpg、issue10-2-bare-id-{FAIL,PASS}.jpg；判据原件 10-before.json / 10-after.json。

修前那几张里的「额度已用尽」不是插件造成的：整行真的进了模型，而测试实例没有额度。这恰好就是缺陷本身，这条命令根本不该进模型。

## issue #9：设置页改到 10000 后 /later 仍按 1000 拒

两侧都用同一份 profile 配置（allowLongPrompts: true / maxPromptChars: 10000，等同用户在设置页保存），发 1204 字 /later：

| 修前（07a5a56） | 修后（71db603） |
|---|---|
| command/done error：提醒内容不能超过 1000 字符。，sidecar 0 条 | command/done success：将于 11/5 周四 17:26 …，sidecar 1 条 |

图：issue9-long-1204-{FAIL,PASS}.jpg；原件 9-before.json / 9-after.json。

## issue #11a：重启后打开会话，dock 被 end-seed 抹空

流程：建 /later +2m → 杀进程、同 DSH_HOME 重启 → **到期前**打开该会话 → 数 dock 行。

| 修前（34b7d49） | 修后（542aa80） |
|---|---|
| 建好后 dock 1 行 → 重启打开后 **0 行** | 建好后 dock 1 行 → 重启打开后 **1 行** |

图：issue11a-1-created.jpg（两侧流程一致）、issue11a-2-reopened-dock-{FAIL,PASS}.jpg；原件 11a-before.json / 11a-after.json。

## issue #11b：重启后从未被打开的会话，到点也投递

| 步骤 | 证据 |
|---|---|
| 建 /later +2m 冷会话投递验证COLDUI11B | dock 1 行，issue-11b/real-gui-1-created-dock-PASS.jpg |
| 停进程、重启、全程不连浏览器 | 日志在 /tmp/ui11b/logs/（临时目录，未入库） |
| 过到期点再开 GUI（该会话从未被打开） | 会话自己日志 spliced=1 + dispatch=1；侧栏出现该会话，issue-11b/real-gui-2-after-restart-cold-delivered-PASS.jpg |

原件 issue-11b/result.json。这一半**只有修后**的证据：修前对照（coldSpliced=0）在 PR #133 正文与跨内核矩阵里，本轮不重复造图。

## 跨代 UI 矩阵（npm run verify:ui，6 代）

cross-kernel-ui/matrix.json 是原件。通过的 5 代：0.1.2-rc.1、0.1.7-rc.2、0.2.0-rc.2、0.2.1-rc.4、0.2.2-alpha.2（按钮在、dock 1 行、面板打开、badge 1、严格错误 0）。

0.1.5-rc.3 是**未判定**（0.1.5-rc.3-4-badge-FAIL.jpg）：该代首启的「内测声明」弹窗没被点掉，整页被遮罩挡住，dock 与 badge 取到 0。插件在该代 verify:kernels 四面是 GREEN；这一帧按 skill 要求保留，不修不裁，也不当红报。

## 未判定 / 不作数

- **0.1.5-rc.3 的 UI 面**：未判定（原因见上）。
- **chatPosts 计数恒为 0**：这些实例没配 provider，session/prompt 可能在本机就失败，计数器不是可靠判据。为诚实起见，图与 JSON 里同时留了「页面是否出现用户气泡 / 额度报错」这条直接可见的判据作为补偿——10-before 正是靠它判出「整行进聊天」。
- **Gitea CI**：/actions/runs 对这个 token 返回 403，读不到；本地等价验证是 main 上 794/794、typecheck 两面、9 代矩阵全绿。
