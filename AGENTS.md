# AGENTS.md

仓库内自动化代理需要遵守的项目约定。

## 提交信息不写 AI 署名

commit message 里不写模型或 AI 的署名 trailer，也就是 `Co-authored-by` 指向
`noreply@anthropic.com` 这类机器地址的行。提交身份只来自仓库的 git 配置，人类
co-author 的 `Co-authored-by` 不受这条约束限制。

原因是 GitHub 构建 Contributors 图时会把 `Co-authored-by` 计入贡献，而
`noreply@anthropic.com` 解析到一个真实存在的 GitHub 账号，所以这类署名会把无关
账号写进仓库的贡献者列表，且事后只能靠重写历史清除。

本地拦截由 `.git/hooks/commit-msg` 负责：它剥掉命中机器地址的署名行，把被删的
内容打到 stderr，剥空后交给 git 以「空提交信息」拒绝提交。该钩子位于 `.git`
内，不进版本库，新克隆需按本节重建。
