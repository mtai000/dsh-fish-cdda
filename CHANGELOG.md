# Changelog

本项目遵循“一个版本一个小节”的简单记录方式，日期用本地日期。

## 0.5.0 — 2026-11-01

- **移除自带知识库**：删除 `data/knowledge_base`、`lib/knowledge.mjs`、`cdda_knowledge`、
  `knowledge*` 配置；插件包不再包含攻略/物品/配方数据。
- **自主学习**：新增 `cdda_learn`，经验写进 `memory/<identityId>/memory.jsonl`；
  无身份写 `memory/shared`；最多注入 10 条 / 4000 字符，明确标成假设。
- **鱼的身份证**：读取 fish-kin 的 `identity.json`；不同鱼记忆隔离。
- **有损传代**：父代导出 `cdda-lessons.json`，fish-kin 出生时只带 3 条/300 字；
  子代只读自己的继承文件，不读父代全量。
- 新增身份/记忆/继承测试，总测试 40 项。

## 0.4.4 — 2026-11-01

- **知识库正文中文化**：guides、机制、物品、配方全部翻译成简体中文；
  JSON 键名、tag、item id、配方 id、按键、文件名保持不变。
- 按键表只翻译 `defaultmode` 的 68 条核心动作/分类；其他上下文保留英文原文，
  避免把 414 条不同菜单的按键一次性改坏。
- `compactKeybindings` 的注入标题改为「核心按键（defaultmode）」。
- 知识库格式器展平 recipe 的嵌套对象（不再出现 `[object Object]`）；
  旧 home 副本无 `.version` 时先备份再升级到中文版。
- 总测试 31 项。

## 0.4.3 — 2026-11-01

- 知识库从 `vendor/knowledge_base/` 移到 `data/knowledge_base/`，随包提交（MIT）；
  `vendor/` 继续整体忽略，不提交。
- 首次运行仍复制到 `<DSH_HOME>/cdda-duty/knowledge/`；`cdda_knowledge` / 自动注入恢复完整。
- 包文件包含 `data/`，不含 `vendor/`、不含 `.sav`。

## 0.4.2 — 2026-11-01

- **插件包不再携带存档**：移除 `vendor/starter-world/`（2.1MB 的 0.G 种子），
  避免用户把内置模板误认为运行时存档。第一次启动走 CDDA 自动建角色流程。
- `starterWorld` 默认改为 `false`；需要现成开局的用户可把世界放到
  `<DSH_HOME>/cdda-duty/starter-world/save/` 再打开该项，插件仍不会写回插件目录。
- 存档测试改用临时生成的 `.sav` fixture，不再依赖插件包里的存档。
- 新增开局种子/无种子测试，总测试 29 项。
- 运行时数据仍然只在 `<DSH_HOME>/cdda-duty/`：`game/save`、日志、录制、知识库副本。
- 加了一层兜底：即使 `DSH_HOME` 被误设成插件目录，`stateDirOf()` 也会把运行数据放回 `~/.dsh/cdda-duty`。
- `vendor/` 不再提交（已加入 `.gitignore`）；知识库变为可选外部资源，缺失时自动玩仍可用，只是不注入手册。

## 0.4.1 — 2026-11-01

- **修复 HTTP 404**：不再在 `apply()` 里直接 `ctx.get('webServer')` 注册路由。
  DSH 启动时 `webServer` 服务可能还没就绪，旧写法会静默跳过注册，导致设置页能打开
  但所有 `/api/cdda-duty/*` 返回 404。现在改用 `ctx.inject(['webServer'], ...)` 等待服务，
  并在 `cdda.log` 里记录「webServer 就绪，挂载 /api/cdda-duty」。
- 新增一条 404 排查文档：`/api/cdda-duty` 本身没有首页，状态接口是
  `/api/cdda-duty/status`；局域网/反代访问还会被同源检查挡住。

## 0.4.0 — 2026-10-31

- **结构化屏幕解析**：新增 `lib/screen-parse.mjs`，从 80×24 文本里识别
  UI 状态/标题/选项、可见物品、可见威胁、HP 条、位置、饥渴疲劳。
- **混合状态**：新增 `lib/state-compose.mjs`，屏幕优先 + 存档兜底，
  给出 `stale`、HP 一致性和警告；`cdda_look` 返回 `ui/visible/vitals/consistency`。
- **卡菜单兜底**：连续 3 次同画面返回 `stuck` + 恢复键；第 4 次自动发一次 `Esc`，
  可用 `autoUnstick` 关掉。
- **GoalManager**：新增 `lib/goal.mjs`，支持 `survive N days` / `acquire` / `reach` /
  `generic`，记录起点、进度、完成；达成后自动玩暂停；状态页/日志屏显示进度。
- **结构化决策日志**：`decisions.jsonl`，记录动作、延迟、UI、知识 tag、前后状态、目标进度。
- **回合总结**：`rounds.json` + `runs/round-<id>.json`，含动作数、耗时、目标进度；
  新增 `/api/cdda-duty/rounds`、`/api/cdda-duty/decisions`。
- **崩溃恢复**：`restartOnCrash` + `maxRestartsPerDay`；新增 `cdda_restart` 工具；
  显式停止游戏时会关闭自动玩，避免下一跳又自动拉起。
- 新增屏幕/状态/目标测试，总测试 26 项。

## 0.3.0 — 2026-10-31

- **接入 CDDAi 知识库**：复制 `data/knowledge_base/` 到 `vendor/knowledge_base/`（MIT），
  包括基础生存、早期策略、战斗、菜单导航、饥渴/健康/疲劳/士气/温度、水/食物/工具/材料、
  早期配方、完整按键表。
- **状态驱动注入**：自动玩每轮按渴/饿/HP/疼痛/出血/菜单/天数挑 2-6 个 tag，
  加上基础生存 + 核心按键，注入提示词；默认上限 12000 字符，可在设置页调。
- **按需查询**：新增 `cdda_knowledge` 工具，支持 `tags` / `query` / 空参数看推荐；
  `cdda_look`、`cdda_status` 会带 `knowledgeTags` 建议。
- **可编辑知识库**：首次运行铺到 `<DSH_HOME>/cdda-duty/knowledge/`，升级不覆盖。
- 新增知识库测试，总测试 18 项。

## 0.2.0 — 2026-10-31

- **录制游玩过程**：设置页新增开关，把 `cdda` 的 screen 画面录成 1280×900 / 默认 2 fps 的 mp4。
- **外挂字幕**：同一时段的 `cdda_log` 战报（动作、DSH 记录、回合开始/结束）生成同名 `.srt`；
  时间轴以录制开始为 0，自动处理同瞬间事件合并与结尾收束。
- **录制历史**：`recordings.json` 索引 + 设置页历史列表，支持浏览器内播放/下载；
  `/api/cdda-duty/recording/file` 支持 Range 与路径穿越防护。
- **录制配置**：`recordFps` / `recordDir` / `recordFont` / `ffmpegPath` / `recordMaxMinutes`。
- **工具**：新增 host-only 的 `cdda_record`；MCP 自动玩回合不暴露录制工具。
- **停止/卸载收尾**：游戏停止、开关关闭、单段超时、插件重载时都尽量让 ffmpeg 写完 moov。
- 新增录制集成测试（screen → mp4 + srt），总测试 14 项。

## 0.1.0 — 2026-10-31

- 初版：把 CDDA 做成一装即用的 DSH 插件。
- 两个 screen 会话：`cdda`（游戏）与 `cdda_log`（实时战报）。
- 工具：`cdda_start` / `cdda_look` / `cdda_send` / `cdda_note` / `cdda_state` /
  `cdda_status` / `cdda_stop` / `cdda_autoplay`。
- 自动玩：headless 回合 + 专用最小权限 `cdda-duty` profile + 内置 MCP；
  支持会话续用、每日轮数/动作预算/单轮超时/死亡暂停。
- 内置 0.G 开局存档，首次运行开箱即玩；设置页支持目标、预算、screen 名、路径等。
