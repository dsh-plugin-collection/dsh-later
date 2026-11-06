# 宣传视频工程

`docs/promo/` 是 dsh-later 宣传片的源码：分镜是 HTML + GSAP，界面素材是**真机截图**，`hyperframes` CLI 把它渲染成 MP4。改文案改的是 HTML，不是剪辑工程文件。

成片：`renders/dsh-later-promo.mp4`，1920×1080、30fps、42.6 秒、无音频。

## 素材从哪来

界面镜头不是画的，也不是复刻 DOM。`scripts/capture-real.mjs` 做三件事：

1. 用 `scripts/ui-matrix/instance.mjs` 起一个只装本仓当前 `lib/` 的隔离 DSH 实例（`DSH_HOME` 指向 `/tmp/dsh-promo-capture`）；
2. 用 Playwright 真敲键盘、真按回车、真等倒计时、真 hover，逐帧截图 2 倍像素；
3. 把每张图的裁切矩形和按钮锚点（相对图片的百分比）写进 `assets/real/capture.json`。

```sh
PLAYWRIGHT_MODULE=/home/wujue/.npm/_npx/86170c4cd1c5da32/node_modules \
  node scripts/capture-real.mjs --version 0.2.1-rc.4 --port 3621
```

重拍之后片子不用改：分镜读的是 `assets/real/` 里固定文件名，锚点百分比写在同一份 `capture.json` 里，改版时改这两个常量即可。

## 命令

```sh
cd docs/promo
bash scripts/hf.sh lint                       # 结构检查，应当 0 error 0 warning
bash scripts/hf.sh check                      # lint + 运行时 + 布局 + 对比度
bash scripts/hf.sh snapshot --at 4.5,18,40    # 抽帧到 .hyperframes/snaps，先看再渲染
bash scripts/hf.sh render -o renders/dsh-later-promo.mp4 -f 30 -q delivery -w 4
```

`scripts/hf.sh` 干两件事：把 CLI 版本钉在 `hyperframes@0.8.216`，以及用本机的 chrome-headless-shell 渲染（`HYPERFRAMES_BROWSER_PATH`），所以不必等 Chrome 下载。换机器时改脚本里那两个路径。

## 目录

| 路径 | 内容 |
| --- | --- |
| `index.html` | 根时间线。九个 slot 按 `data-start` 排开，总时长 42.6 秒 |
| `compositions/01` 至 `09` | 逐场分镜，一场一个文件，各自注册 `window.__timelines` |
| `assets/real/` | 真机截图与裁切产物，`capture.json` 记录来源 |
| `assets/base.css` | 配色、字体、截图卡与高亮框、像素时钟 |
| `assets/gsap.min.js` | 本地 GSAP 3.14.2，渲染时不联网 |
| `renders/` | 成片与封面 |
| `BRIEF.md`、`STORYBOARD.md`、`SCRIPT.md` | 目标、分镜、逐字文案 |

## 改文案

按场改 `compositions/NN-*.html` 里的文字，然后 `bash scripts/hf.sh lint`。两条硬约束：

- 每个带 `data-start` 的元素必须有 `data-duration`，可见元素加 `class="clip"`。
- 时间线只做确定性动画：不许 `Date.now()`、`Math.random()`、网络请求。

改片长时同时改三处：场文件的 `data-duration`、`index.html` 里该 slot 的 `data-start` 与 `data-duration`、根 `data-duration`。

## 环境

- CLI：`hyperframes@0.8.216`，`npx` 缓存里那份，脚本里写死路径。
- 采集：Playwright 1.62（`PLAYWRIGHT_MODULE` 指向其包目录）与 `~/dsh-versions/0.2.1-rc.4` 版本树。
- 浏览器：本机 Playwright 的 `chrome-headless-shell`，软件 WebGL，1080p 30fps 全片约 30 秒出片。
- 字体：`Noto Sans SC` 与 `DejaVu Sans Mono`，`base.css` 用 `local()` 声明，不下载字体文件。

## 取舍

- 无音频。原因见 `SCRIPT.md` 末节。
- 侧栏只拍到琥珀一档的真图；紫与红这一轮没有稳定复现，片子里不演。
- 第 8 场的服务端流程图与第 9 场的品牌卡是矢量重绘，不是截图；其余界面镜头都是真图。
