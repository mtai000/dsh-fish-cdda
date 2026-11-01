# 给 AI 助手看的（本仓库 = 一个 DSH 插件）

`dsh-fish-cdda`：让 DSH 自己玩《Cataclysm: Dark Days Ahead》。插件开两个 screen 会话：
`cdda`（游戏）和 `cdda_log`（战报）。用户可随时 attach 旁观（screen: `screen -x`；tmux: `tmux attach -t`）；DSH 也能开自动玩。
终端后端由 `cfg.terminal`（auto/tmux/screen）选择，会话操作统一走 `lib/backend.mjs`。

## 帮用户装时，按这个顺序

1. **确认前提**：
   ```bash
   node --version          # ≥ 22
   screen --version        # GNU screen
   dsh --version           # ≥ 0.2.1-rc.1
   cataclysm --version     # 0.G，curses 版；没有就 apt install cataclysm-dda-curses
   ```
2. **装插件**（有 pnpm）：
   ```bash
   dsh plugin --profile web add link:/path/to/dsh-fish-cdda
   ```
   **没有 pnpm**（很多机器都没有）：
   ```bash
   mkdir -p ~/.dsh/profiles/web/node_modules
   ln -sfn /path/to/dsh-fish-cdda ~/.dsh/profiles/web/node_modules/dsh-fish-cdda
   # 然后手动把 dsh-fish-cdda 加进 profile 的 dependencies 和 dsh.profile.bundles
   ```
3. **必须提醒用户重启一次 dsh**（bundle 层要重启才组装）。
4. 重启后进 **设置 → CDDA 陪玩**：
   - 点「开始游戏」；第一次约 30 秒（语言/校验/建局）；
   - 终端里 attach 旁观：`tmux attach -t cddagame`（或 `screen -x cddagame`），战报同理；
   - 想自动玩就打开「自动玩」。
5. **不要**替用户把 `autoplay` 长期打开 —— 那会持续花 token。让用户自己决定。

## 关键实现位置

- `index.js` —— host 半端：Config、11 个工具、`/api/cdda-duty/*`、自动玩定时器、
  专用 profile 铺设、overlay 生成、headless 回合、会话续用。
- `client.js` —— 浏览器半端：设置页「CDDA 陪玩」（`settings.section`）。
- `lib/tools-core.mjs` —— 工具的真正实现；host 和 MCP 共用。
- `lib/game.mjs` —— 开/停游戏、bootstrap 状态机、screen 唤醒。
- `lib/backend.mjs` —— 会话后端（screen/tmux）：建/送/抓/查/杀 + attach 命令。
- `lib/screen.mjs` —— CDDA 启动脚本、世界选择、战报屏（会话原语从 backend 再导出）。
- `lib/state-read.mjs` —— 解析 `.sav`（第一行 `# version N` + JSON）。
- `lib/parse.mjs` —— 屏幕清洗 + 界面识别。
- `lib/logscreen.mjs` —— `cdda_log` 的实时面板（读 status/activity，不碰游戏）。
- `lib/screen-parse.mjs` —— 结构化屏幕解析：UI/菜单选项、可见物/威胁、HP 条、位置、恢复键。
- `lib/state-compose.mjs` —— 屏幕 + 存档合并、`stale`/HP 一致性/警告。
- `lib/goal.mjs` —— 目标解析（survive/acquire/reach/generic）、起点、进度、完成。
- `lib/recorder.mjs` —— 录制 mp4 + 同名 `.srt`：screen hardcopy 抓帧、ffmpeg drawtext 实时渲染、
  从 activity 生成字幕、录制索引。
- `lib/identity.mjs` —— 自动发现 fish `identity.json`（family/cwd/父代/唯一）→ `memory/<identityId>`。
- `lib/memory.mjs` —— 经验 JSONL：写入/去重/淘汰/注入。
- `lib/lessons.mjs` —— 父代经验导出 / 子代继承导入。
- `lib/mcp-server.mjs` —— headless 回合用的 MCP stdio 服务（newline JSON-RPC）。
- `prompts/duty.md` —— 自动玩章程（用户可改）。
- `recordVideo` / `recordMode`（pixels/text）/ `recordWindow` / `recordGeometry` / `recordDisplay` / `recordFps` / `recordDir` / `recordFont` / `ffmpegPath` / `recordMaxMinutes` —— 录制配置（像素模式不需要字体）。
- `client.js` 还注册了 `conversation.view`「cdda录制」：会话顶部「更多会话视图」里直接播放录制。
- `identityFile` / `identityAuto` / `memory` / `memoryMaxItems` / `memoryMaxChars` —— 身份自动发现与经验注入。
- `autoUnstick` / `restartOnCrash` / `maxRestartsPerDay` —— 卡菜单兜底、崩溃重开及每日上限。
- `profile-template/cdda-duty/` —— 最小权限 profile（base + headless，关掉 fs/bash/web/subagent…）。
- `$DSH_HOME/cdda-duty/starter-world/save/` —— 可选外部开局种子；插件包不带 `.sav`。

## 调试顺序

1. `tmux ls`（或 `screen -ls`）—— `cddagame`/`cdda_log` 在不在；`node selfcheck.mjs` 会直接报当前后端。
2. `cdda.log` —— 开游戏、界面识别、回合起停。
3. `mcp.log` —— 自动玩的 MCP 握手与调用。
4. `runs/round-*.log` —— 那一轮模型的推理/工具输出/最终总结。
5. `status.json` / `activity.jsonl` —— 日志屏/设置页看到的东西。
   经验注入的身份/条数会写进 `cdda.log`（每轮一行「经验注入：…」）。
   `goal.json` 是目标/进度；`decisions.jsonl` 是结构化动作日志；`rounds.json` 是回合总结。
6. `recordings/` —— 录制的 mp4 / srt / json；`recording.json` 是当前录制状态。
7. `node selfcheck.mjs` —— 环境自检（含 ffmpeg/字体）。

## 容易踩的坑（都实测过）

- **`--userdir` 不隔离存档**：0.G 里它只改 data 覆盖路径；要用
  `--savedir <绝对路径> --configdir <绝对路径>`，否则会 `Requested non-existing world`。
- **`TERM=xterm` 会切 alternate screen**：`screen hardcopy` 抓到空屏。
  启动脚本固定 `TERM=linux` + `unset TERMCAP` + `unset TERMINFO`。
- **detached screen 第一帧可能抓不到**：开游戏后发一个空格“叫醒”屏幕。
- **screen hardcopy 抓不了 CJK**：`cdda_log` 别用 hardcopy 验证，直接 `screen -x` 看。
- **`ctx.get('settings').describe()` 的值有时是对象**：配置读取只接受正确类型的标量
  （见 `lib/state.mjs` 的 `coerceField`），否则会出现 `[object Object]`。
- **headless 里默认没有 credentials/auth**：overlay 里要 `disabled: false` 打开
  `credentials` / `authorization` / `deepseek-account`，并补 `agent-default-model`。
- **MCP 服务第一版可能被 SDK 探活两次**：正常；探活进程会自己退出。
- **录制必须给 ffmpeg 加 `-re`**：否则 `color` 源会瞬间把整段时间编码完，drawtext 的
  `reload=1` 根本来不及读新帧。停录要往 ffmpeg stdin 写 `q` 让它写 moov，不能直接 kill。
- **字幕时间轴以录制开始为 0**：只收 `activity.jsonl` 里 `ts >= startedAt` 的事件；
  同一瞬间的动作+记录会合并成一条 SRT，避免互相盖住。
- **经验是假设**：模型自己写的教训可能错；只注入 10 条/4000 字，错误经验人工淘汰。
- **`index.js` 里本地 `updateGoal(goal)` 与 `lib/goal.mjs` 的 `updateGoal(stateDir,state)` 重名**：
  导入时必须 alias（目前是 `updateGoalProgress`），否则 `statusPayload` 会把目标写成目录路径。
- **路由注册不要用 `ctx.get('webServer')`**：apply 时服务可能还没就绪，路由会被静默跳过，
  表现是所有 `/api/cdda-duty/*` 404。必须用 `ctx.inject(['webServer'], ...)`，
  当前代码在 `cdda.log` 里会打「webServer 就绪，挂载 /api/cdda-duty」。
- **插件改了源码后**：HMR 只认真实配置值变化，**只加注释可能不重载**；
  改一个真实字段（例如 `actionsPerRound: 40` → `41` → `40`）触发整树重载，
  或重启 dsh。client.js 改完刷新浏览器即可。

## 约定

- 配置/存档/日志都在 `$DSH_HOME/cdda-duty/`，不写进插件包目录；
- 自动玩回合没有文件系统/命令/联网；只给 CDDA MCP；
- 战报是给人看的：不写内部术语，不编屏幕上看不到的东西。

## 录制（recordMode）
- 默认 `ansi`：抓 `tmux capture-pane -p -e` 的带色输出，用 `lib/ansirender.mjs` 自己画帧
  （`assets/fonts/unifont.hex.gz`，GNU Unifont，零运行时依赖），`image2pipe` 喂给 ffmpeg。
- 宽度按终端规矩算：`charCells()`（East Asian Wide/Fullwidth=2、组合记号=0、其余=1）。
  不要用字体自带宽度推进——换语言会错行。
- `recordScale` 放大倍数，`recordLogRows` 把 cdda_log 最后几行拼在画面下面。
- `pixels`（录桌面）/`text`（纯文字重绘）保留，作为回退。

## 看实时画面 / 回放
- 没有「cdda画面」页了，也不再有 ttyd。要看实时画面用系统终端：
  回放页顶部「打开游戏终端 / 打开日志终端」→ `POST /api/cdda-duty/screens/open`。
- 回放列表 = 录制目录下每个 `<id>/`（`listCasts`，兼容老的扁平 `*.cast.jsonl.gz`）。
  一次游玩一个目录：`cast.jsonl.gz` / `events.srt` / `meta.json` / 可选 `video.mp4`。
  转视频走 `POST /recording/render` → `scripts/render-cast.mjs`；删除整目录。

## 原始帧日志（改渲染不要重开游戏）
- 录制默认同时写 `xxx.cast.jsonl.gz`（`lib/cast.mjs`）：每帧 `{t,w,h,d}`，gzip JSONL。
- 重画：`node scripts/render-cast.mjs <cast> <out.mp4> [--scale 2] [--linepad 2] [--cols 80]`。
- 测试渲染优先用这个，不要为了看一帧效果再开游戏。
