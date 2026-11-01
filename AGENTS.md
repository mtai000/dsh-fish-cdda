# 给 AI 助手看的（本仓库 = 一个 DSH 插件）

`dsh-cdda`：让 DSH 自己玩《Cataclysm: Dark Days Ahead》。插件开两个 screen 会话：
`cdda`（游戏）和 `cdda_log`（战报）。用户可随时 `screen -x` 旁观；DSH 也能开自动玩。

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
   dsh plugin --profile web add link:/path/to/dsh-cdda
   ```
   **没有 pnpm**（很多机器都没有）：
   ```bash
   mkdir -p ~/.dsh/profiles/web/node_modules
   ln -sfn /path/to/dsh-cdda ~/.dsh/profiles/web/node_modules/dsh-cdda
   # 然后手动把 dsh-cdda 加进 profile 的 dependencies 和 dsh.profile.bundles
   ```
3. **必须提醒用户重启一次 dsh**（bundle 层要重启才组装）。
4. 重启后进 **设置 → CDDA 陪玩**：
   - 点「开始游戏」；第一次约 30 秒（语言/校验/建局）；
   - 终端里 `screen -x cdda` 和 `screen -x cdda_log` 旁观；
   - 想自动玩就打开「自动玩」。
5. **不要**替用户把 `autoplay` 长期打开 —— 那会持续花 token。让用户自己决定。

## 关键实现位置

- `index.js` —— host 半端：Config、11 个工具、`/api/cdda-duty/*`、自动玩定时器、
  专用 profile 铺设、overlay 生成、headless 回合、会话续用。
- `client.js` —— 浏览器半端：设置页「CDDA 陪玩」（`settings.section`）。
- `lib/tools-core.mjs` —— 工具的真正实现；host 和 MCP 共用。
- `lib/game.mjs` —— 开/停游戏、bootstrap 状态机、screen 唤醒。
- `lib/screen.mjs` —— screen 会话、hardcopy 抓屏、按键、世界选择。
- `lib/state-read.mjs` —— 解析 `.sav`（第一行 `# version N` + JSON）。
- `lib/parse.mjs` —— 屏幕清洗 + 界面识别。
- `lib/logscreen.mjs` —— `cdda_log` 的实时面板（读 status/activity，不碰游戏）。
- `lib/screen-parse.mjs` —— 结构化屏幕解析：UI/菜单选项、可见物/威胁、HP 条、位置、恢复键。
- `lib/state-compose.mjs` —— 屏幕 + 存档合并、`stale`/HP 一致性/警告。
- `lib/goal.mjs` —— 目标解析（survive/acquire/reach/generic）、起点、进度、完成。
- `lib/recorder.mjs` —— 录制 mp4 + 同名 `.srt`：screen hardcopy 抓帧、ffmpeg drawtext 实时渲染、
  从 activity 生成字幕、录制索引。
- `lib/knowledge.mjs` —— CDDAi 知识库：按 state/mode 选 tag（渴/饿/血/疼/菜单/天数）、
  基础包（基础生存 + 核心按键）、tag 加载、关键词检索、首次铺到 `<家>/knowledge/`。
- `lib/mcp-server.mjs` —— headless 回合用的 MCP stdio 服务（newline JSON-RPC）。
- `prompts/duty.md` —— 自动玩章程（用户可改）。
- `recordVideo` / `recordFps` / `recordDir` / `recordFont` / `ffmpegPath` / `recordMaxMinutes` —— 录制配置。
- `knowledge` / `knowledgeMaxChars` —— 知识库注入开关/上限（默认开，12000 字符）。
- `autoUnstick` / `restartOnCrash` / `maxRestartsPerDay` —— 卡菜单兜底、崩溃重开及每日上限。
- `profile-template/cdda-duty/` —— 最小权限 profile（base + headless，关掉 fs/bash/web/subagent…）。
- `data/knowledge_base/` —— CDDAi 知识库（MIT，随包分发）；首次复制到 `<家>/knowledge/`。
- `$DSH_HOME/cdda-duty/starter-world/save/` —— 可选外部开局种子；插件包不带 `.sav`。

## 调试顺序

1. `screen -ls` —— `cdda`/`cdda_log` 在不在。
2. `cdda.log` —— 开游戏、界面识别、回合起停。
3. `mcp.log` —— 自动玩的 MCP 握手与调用。
4. `runs/round-*.log` —— 那一轮模型的推理/工具输出/最终总结。
5. `status.json` / `activity.jsonl` —— 日志屏/设置页看到的东西。
   知识注入的 tag/字符数会写进 `cdda.log`（每轮一行「知识注入：…」）。
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
- **知识库是英文**：CDDAi 原文就是英文；按 tag 注入有 12000 字符上限，
  超出会截断，别指望一轮塞下 150KB。用户改过的 `<家>/knowledge/` 不会被升级覆盖。
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
