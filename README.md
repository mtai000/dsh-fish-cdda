# dsh-cdda ｜ 让 DSH 自己玩 CDDA

> 当前版本 **0.4.0** · [变更记录](CHANGELOG.md) · [参与开发](CONTRIBUTING.md)

> **它是什么**：一个 DSH 插件。装上后 DSH 会开两个 `screen` 会话 ——
> `cdda`（游戏终端）和 `cdda_log`（实时战报）。
> 你可以随时 `screen -x cdda` / `screen -x cdda_log` 旁观；
> DSH 自己也可以开「自动玩」，定时起 headless 回合接着玩。

这个插件把两件事拼在一起：

- **dsh-bili-scroll** 的插件形态：bundle patch、设置页、host 半端工具、headless 回合、最小权限 profile；
- **CDDAi** 的玩法思路：屏幕感知 + 存档硬状态 + 目标驱动 + 决策日志 + **knowledge_base**。
  不是把它的 Python 进程塞进来，而是把「看屏幕 / 发按键 / 读状态 / 查手册」做成 DSH 工具，
  让 DSH 模型自己决策。
- **CDDAi knowledge_base**：生存指南、饥渴/健康/疲劳/士气/温度、水/食物/工具/材料、
  早期配方、完整按键表。自动玩每轮按当前状态挑 2-6 章注入，模型也可以按 tag/关键词查。

---

## 先看三行

1. 需要 **Linux / macOS**、**GNU screen**、**CDDA 0.G（curses 版）**、**DSH ≥ 0.2.1-rc.1**。
   想录制视频还需要 **ffmpeg**（`sudo apt install ffmpeg`）和一个等宽字体（DejaVu 一般已有）。
2. 装完 **重启一次 DSH**（bundle 层要重启才组装）。之后进 **设置 → CDDA 陪玩**。
3. 第一次开局约 **30 秒**（要过一次语言/数据校验）；之后有存档，`--world` 直接进游戏，约 **8 秒**。

---

## 它长什么样

```
 screen -x cdda          screen -x cdda_log
┌──────────────────┐    ┌──────────────────────────────────────┐
│  CDDA 游戏画面    │    │ DSH × CDDA 战报                       │
│  #.###.          │    │ ● 游戏中  回合 #mvvz…  今日 4 动作     │
│  ..@...          │    │ 目标：先找水，再活下去                 │
│  {##&#.          │    │ 角色：Jody Anaya · 第 61 天 08:00 · 春 │
│  ...             │    │ 身体：HP 100% 渴 口渴 饿 有点饿        │
│                  │    │ 正在做：用 x 环视周围…                 │
│                  │    │ ────────────────────────────────────  │
│                  │    │ 13:55:48 ▶ e   按 e 查看脚下           │
│                  │    │ 13:55:53 ▶ x   用 x 环视周围           │
│                  │    │ 13:55:56 ✎ 本轮测试完成…               │
└──────────────────┘    └──────────────────────────────────────┘
```

- `cdda`：真正的 CDDA 终端。插件用 `screen -X hardcopy` 读它，用 `screen -X stuff` 按键。
- `cdda_log`：一个 Node 渲染的实时面板，读插件家里的 `status.json` / `activity.jsonl`，
  显示目标、角色状态、最近动作、DSH 正在做什么。
- 两个会话都是 detached 的，可以多端同时 `screen -x` 看，不抢控制权。
- ⭐ **录制开关**：打开后把 `cdda` 画面录成 **mp4**，同时把 `cdda_log` 同一时段的战报写成
  **同名 `.srt` 外挂字幕** —— 用播放器打开视频会自动挂上字幕。

---

## 装

### 方式 A：本地目录（开发/自用，推荐）

DSH 的插件安装走 pnpm。如果机器上没有 pnpm，可以直接把包 link 进 profile：

```bash
# 1) 建 link
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn /path/to/dsh-cdda ~/.dsh/profiles/web/node_modules/dsh-cdda

# 2) 改 profile（或让 DSH 的插件管理器替你写）
#    ~/.dsh/profiles/web/package.json
#    "dependencies": { "dsh-cdda": "link:/path/to/dsh-cdda" }
#    "dsh.profile.bundles": [..., "dsh-cdda"]

# 3) 重启 dsh
```

> 有 pnpm 时更简单：
> `dsh plugin --profile web add link:/path/to/dsh-cdda`，然后重启。

### 方式 B：发布包

```bash
dsh plugin --profile web add dsh-cdda
# 重启 dsh
```

> ⚠️ **必须重启**：bundle 层在启动时组装；不重启插件不会生效。
> 如果 DSH 支持 HMR，改 `~/.dsh/profiles/web/cordis.patch.yml` 也能触发重载（实测可用）。

---

## 第一次用

进 **设置 → CDDA 陪玩**：

1. 点 **开始游戏**。
   - 第一次没有存档时，插件会把内置的 0.G 开局存档铺到
     `<DSH_HOME>/cdda-duty/game/save/`，然后用 `--world "Pena Pobre"` 启动；
   - 如果语言/数据校验挡在前面，插件会自动按键走完（约 30 秒）。
2. 在终端里看：
   ```bash
   screen -x cdda        # 看游戏
   screen -x cdda_log    # 看 DSH 在做什么
   ```
3. 想让它自己玩：打开 **自动玩**，或者直接对 DSH 说「开始自动玩，目标活过 3 天」。

> **内置开局**是 CDDA 0.G 生成的一个小世界（加油站，角色 Jody Anaya，第 61 天）。
> 它只是让你开箱即玩；想玩自己的世界，在设置里填 **CDDA userdir / 世界名**，
> 或清掉 `<DSH_HOME>/cdda-duty/game/save/` 后自己建一个角色。

---

## 设置页里有什么

| 区域 | 内容 |
|---|---|
| **现在** | 游戏/自动玩状态、今日动作数、回合、最近动作；开始 / 跑一轮 / 停止；自动玩开关 |
| **目标与节奏** | 目标（内联进提示词 + 日志屏 + 进度）、每轮动作预算、每天最多几轮、两轮间隔、自动开游戏、**注入 CDDAi 知识库**及字符上限 |
| **旁观** | `screen -x cdda` / `screen -x cdda_log` 复制按钮、家目录/存档路径 |
| **角色** | 从存档读出的 HP、饥渴、疲劳、位置、最近消息 |
| **录制游玩过程** | 开关、当前录制状态、视频/字幕下载、历史录制列表、帧率 |
| **最近动作** | 与 `cdda_log` 同步的活动流 |
| **当前屏幕** | 抓一屏（调试用） |
| **高级** | CDDA 路径、userdir、世界名、screen 名、dshBin、卡菜单兜底、崩溃自动重开 |

配置写在 `<DSH_HOME>/cdda-duty/config.json`，同时同步到 DSH 原生设置（volatile 字段）。

---

## DSH 工具（聊天里就能用）

| 工具 | 作用 |
|---|---|
| `cdda_start` | 开游戏 + 确保战报屏；有存档直接 `--world` |
| `cdda_look` | 看屏幕（ASCII）+ 界面类型 + 存档硬状态 |
| `cdda_send` | 发按键（`e` / `jj<RETURN>` / `<ESC>i`），默认返回最新屏幕；自动写战报 |
| `cdda_note` | 只写战报：说明计划/判断（不消耗动作预算） |
| `cdda_state` | 读存档：HP、渴/饿/疲劳、属性、技能、位置、最近消息 |
| `cdda_status` | 游戏/回合/今日动作/screen 状态 + 旁观命令 |
| `cdda_stop` | 优先 `S` / `Y` 存档退出，再关 screen |
| `cdda_restart` | 存档/关掉后用 `--world` 重开（崩溃或卡死时用） |
| `cdda_knowledge` | 查 CDDAi 知识库：tag / 关键词 / 当前推荐 |
| `cdda_record` | 开始/停止录制视频 + 外挂字幕（仅 host 半端） |
| `cdda_autoplay` | 开关自动玩（仅 host 半端） |

按键写法：

- 单字符：`e` `i` `m` `x` `j` `k` `h` `l`
- 特殊键：`<RETURN>` `<ESC>` `<TAB>` `<BACKTAB>` `<UP>` `<DOWN>` `<LEFT>` `<RIGHT>` `<PGUP>` `<PGDN>` `<F1>`…
- 混写：`jj<RETURN>`、`<ESC>i`

---

## CDDAi 知识库

插件把 CDDAi 的 `data/knowledge_base/` 复制到了 `vendor/knowledge_base/`（MIT）：

| 类别 | 内容 |
|---|---|
| 指南 | 基础生存、早期策略、战斗、菜单/物品栏导航 |
| 机制 | 饥渴、饥饿、健康、疲劳、士气、温度 |
| 数据 | 水/食物/工具/材料、早期配方、完整按键表 |

**每轮自动注入**：按当前存档状态选 tag，例如：

- 渴了 → `thirst_mechanics` + `water_sources`
- 饿了 → `hunger_mechanics` + `food_sources`
- HP 低/疼痛/出血 → `healing`（必要时 `combat_tactics`）
- 在菜单里 → `menu_navigation`
- 第 2 天起 → `crafting`
- 基础包（基础生存 + 核心按键）始终带

注入上限默认 **12000 字符**（设置页可调），避免把 150KB 全塞进上下文。

**按需查**：`cdda_knowledge` 工具支持：

```json
{"tags": ["water_sources", "thirst_mechanics"]}
{"query": "boil water"}
{}
```

首次加载会把知识库铺到 `<DSH_HOME>/cdda-duty/knowledge/`，你可以直接改；
之后升级不会覆盖你改过的版本（插件包里的 vendor 只是首次来源）。

## 结构化屏幕 + 混合状态

`cdda_look` 不再只有一屏原文，还会返回：

```json
{
  "ui": {"state": "pickup_menu", "title": "Pickup", "options": ["Y Yes", "N No"]},
  "visible": {"items": ["water bottle"], "threats": ["feral zombie"]},
  "vitals": {"health": {"pct": 100, "source": "screen"}, "needs": {...}, "location": {...}},
  "consistency": {"score": 1, "stale": false, "warnings": []}
}
```

- **屏幕优先**：HP 条、位置、UI、可见物/威胁来自当前画面
- **存档兜底**：精确饥渴/饥饿、技能、背包来自 `.sav`
- 存档超过 10 分钟没写盘会标 `stale` 并提示“以屏幕为准”
- 菜单/物品栏/确认框/环视会被识别成 `ui.state`，知识 tag 也会因此自动加 `menu_navigation` / `combat_tactics`

## 卡菜单与崩溃恢复

- 连续 3 次画面没变：`cdda_send` 返回 `stuck: true` + 恢复键序列
- 第 4 次仍卡住：宿主自动发一次 `Esc`（可在高级里关掉）
- 自动玩开着时游戏崩溃/消失：按 `restartOnCrash` 自动重开，每天上限 `maxRestartsPerDay`
- 角色死亡不会重开，自动玩暂停等你处理

## 目标进度 / 决策日志 / 回合总结

- `goal.json`：目标解析成 `survive N days` / `acquire` / `reach` / `generic`，
  记录起点、进度、是否完成；达成后自动玩暂停
- `decisions.jsonl`：每一步动作的结构化记录（延迟、UI、知识 tag、前后状态、目标进度）
- `rounds.json` + `runs/round-<id>.json`：每轮动作数、耗时、目标进度、日志路径
- `cdda_log` 和设置页会显示「目标进度」「上一轮」

## 录制视频 + 外挂字幕

打开设置页的 **录制游玩过程** 开关（或让 DSH 调 `cdda_record`）：

```
<DSH_HOME>/cdda-duty/recordings/
  20261031-153000-a1b2.mp4      游戏画面（1280×900，默认 2 fps）
  20261031-153000-a1b2.srt      同名外挂字幕（来自 cdda_log 的战报）
  20261031-153000-a1b2.json     元数据（起止时间、时长、帧数、大小）
```

- 视频：每 0.5 秒抓一次 `cdda` 的 screen，用 ffmpeg 的 `drawtext + textfile(raw)` 实时渲染；
  纯文本界面不需要高帧率，2 fps 足够看清操作，1 小时的录像大约几十 MB。
- 字幕：每秒从 `activity.jsonl` 读取这一时段的动作/记录/回合事件，按时间生成 SRT；
  条目形如 `动作：e — 按 e 查看脚下地形`、`DSH：准备找水`。
- 用 `mpv` / VLC / 浏览器打开 mp4 会自动加载同名 `.srt`；设置页里也能直接点「看视频 / 下字幕」。
- 视频是**文本渲染**，不包含颜色/菜单边框（这些本来也抓不到）；字幕是中文。
- 停止游戏/关闭插件时会自动收尾（ffmpeg 写 moov）；单段默认最长 120 分钟。
- 录制依赖 ffmpeg 和等宽字体；`node selfcheck.mjs` 会检查。

## 自动玩是怎么跑的

```
宿主定时器 (每 15s)
  └─ 到点 → 起一个 dsh headless 回合
       profile = cdda-duty（无 fs / bash / web / subagent / skill / goal）
       overlay = <家>/headless-overlay.yml
       MCP     = lib/mcp-server.mjs（stdio，工具名 mcp__cdda-duty__*）
       提示词  = prompts/duty.md + 目标 + 动作预算 + 世界
  └─ 回合结束 → 记录会话 id → 下一轮 --session-id 续上（有上下文）
```

- 回合里模型只有 CDDA 工具，**没有文件系统、没有命令、没有联网**；
- 每轮动作预算（默认 40）由 MCP 的 `cdda_send` 计数；用完会提示收尾；
- 单轮超时（默认 900s）会 SIGTERM；
- 每天轮数上限（默认 24）、两轮间隔（默认 20s）都在设置里；
- 角色死亡 → 自动玩暂停（不会自己清档）；想重开就自己新建角色或清 `game/save`。

> 回合共用同一个 headless 会话，所以模型能记得上一轮干了什么。
> 会话 id 存在 `<家>/play-session.json`；会话失效会自动清掉并重开一次。

---

## 目录

```
<DSH_HOME>/cdda-duty/
  config.json        插件配置（设置页也写这里）
  runtime.json       今日动作/轮数
  status.json        日志屏读的当前状态
  activity.jsonl     活动流（动作/记录/回合事件）
  cdda.log           host 日志
  mcp.log            自动玩 MCP 日志
  round.json         当前/上一轮
  play-session.json  自动玩续用的会话 id
  game/
    save/            CDDA 存档（内置开局也铺在这里）
    config/          CDDA 配置
  recordings/        录制的 mp4 / 同名 .srt / .json
  knowledge/         CDDAi 知识库副本（可改）
  goal.json          目标与进度
  decisions.jsonl    结构化决策日志
  rounds.json        回合总结索引
  screens/           抓屏临时文件
  runs/              每轮 headless 的 stdout/stderr
  duty.md            值班章程（用户可改）
```

---

## 开发 / 测试

```bash
npm test                 # 26 项：按键/解析/存档/知识库/屏幕结构化/目标/MCP/screen/录制
node selfcheck.mjs       # 环境自检（含 ffmpeg/字体）
```

改宿主半端后，HMR 只认真实模块/配置变化；只加注释可能不重载。改一个真实字段
（如 `actionsPerRound` 40 → 41 → 40）或重启 DSH。`client.js` 改完刷新浏览器即可。
详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 仓库结构

```
index.js                 host 半端：工具、HTTP API、自动玩、录制调度
client.js                浏览器半端：设置页「CDDA 陪玩」
cordis.patch.yml         DSH bundle patch
lib/
  hostdeps.mjs           从宿主树取 @deepseek-ai/*
  state.mjs              家目录/配置/活动流/状态
  screen.mjs             screen 会话、抓屏、按键
  parse.mjs              屏幕清洗、界面识别
  screen-parse.mjs       结构化屏幕解析（UI/菜单/可见物/威胁/HP）
  state-compose.mjs      屏幕 + 存档合并、stale/一致性
  goal.mjs               目标解析、进度、完成判断
  state-read.mjs         解析 CDDA .sav
  game.mjs               开/停游戏、bootstrap
  tools-core.mjs         host 与 MCP 共用的工具实现
  logscreen.mjs          cdda_log 实时面板
  knowledge.mjs          CDDAi 知识库加载/筛选/检索
  recorder.mjs           mp4 + 外挂 srt 录制
  mcp-server.mjs         自动玩回合的 MCP stdio 服务
prompts/duty.md          自动玩值班章程
profile-template/        最小权限 cdda-duty profile
vendor/knowledge_base/   CDDAi 知识库（MIT）
vendor/starter-world/    内置 0.G 开局存档
test/                    node:test 测试
scripts/                 无 pnpm 时的本地安装/卸载
.github/workflows/ci.yml  GitHub Actions
```

`.gitignore` 已经把运行数据、录制产物、`node_modules`、`.env` 排除；提交前不用手动清。
变更记录见 [CHANGELOG.md](CHANGELOG.md)，许可与第三方署名见 [LICENSE](LICENSE) / [NOTICE.md](NOTICE.md)。

---

## 已知限制

- **菜单边框会变成空白**：CDDA 菜单用 CP437/ACS 线框，`screen hardcopy` 拿不到；
  地图、侧栏、消息都是 ASCII，AI 玩没问题，但菜单里的选中高亮只能靠描述文字推断。
- **第一次开局慢**：语言/数据校验 + 建局约 30 秒；有存档后约 8 秒。
- **CDDA 版本**：内置开局是 0.G 存档；其它版本可能拒绝或迁移。用自己的存档请填 userdir / 世界名。
- **中文**：游戏本身用英文（`LANG=C.UTF-8`），战报是中文；`screen hardcopy` 抓不了 CJK，
  但 `cdda_log` 是直接给终端看的，中文正常。
- **死亡**：不会自动重开；自动玩暂停。
- **screen 会话名**：默认 `cdda` / `cdda_log`；如果和别的 session 重名，在设置里改。
- **录制是文本视频**：没有颜色、没有光标、菜单边框会缺失；2 fps 是为了省 CPU/磁盘。
  中文只出现在外挂字幕里；游戏画面本身是英文 ASCII。
- **录制目录**：默认 `<DSH_HOME>/cdda-duty/recordings/`；可以改到别的盘。
- **知识库是英文原文**：CDDAi 的指南/机制是英文；模型能读，但别期待中文翻译。
  注入有字符上限，超出会截断；需要完整内容用 `cdda_knowledge` 按 tag 查。
- **屏幕解析是尽力而为**：菜单边框/颜色抓不到，部分数值（0.G 侧栏的饥渴）只显示空值，
  这时会回退存档；没有解析到的字段会明确标 `source: save` 或 `null`。
- **目标进度依赖游戏内时间**：`survive 3 days` 从第一次看到游戏状态开始算；
  重新载入存档/换目标会重置起点。

---

## 环境自检

```bash
node selfcheck.mjs
# 或
npm test
```

自检会检查：node、screen、CDDA 可执行文件、内置开局、目录权限、当前 screen 会话，
以及录制需要的 ffmpeg / 等宽字体（缺失只影响录制）。

---

## 依赖与致谢

- **dsh-bili-scroll**（MIT）—— 插件形态、hostdeps、设置页/HTTP/headless 回合的写法参考；
- **CDDAi**（MIT）—— 屏幕感知 / 存档解析 / 目标驱动玩法，以及
  `vendor/knowledge_base/`（生存指南 / 机制 / 物品 / 配方 / 按键）；
- **Cataclysm: Dark Days Ahead**（CC-BY-SA 3.0）—— 游戏本体与内置开局存档；
- **@xterm/headless** 没有用到（我们最终用 screen hardcopy + ASCII 清洗，少一个依赖）。

详见 [NOTICE.md](NOTICE.md)。本项目 MIT。

---

## 交流

遇到问题先看 `cdda.log` / `mcp.log` / `runs/round-*.log` 的最后几十行。
真正像 bug 的，带上 DSH 版本、插件版本、`screen -ls`、日志原文。
