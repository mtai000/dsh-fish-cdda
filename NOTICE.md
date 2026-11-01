# NOTICE

`dsh-cdda` 是 MIT 许可的 DSH 插件。它参考/复用了以下项目的思路或少量代码：

## dsh-bili-scroll

- 仓库：https://github.com/c1overzz/dsh-bili-scroll
- 许可证：MIT（Copyright (c) 2026 c1overzz）
- 用途：DSH 插件的 bundle patch / client 自注册 / host 半端工具 /
  `lib/hostdeps.mjs`（从宿主树取 `@deepseek-ai/*` 的兜底方案）/
  headless 回合与设置页 HTTP 的写法参考。
- 本项目对上述代码做了改写与裁剪，未包含它的 Python MCP、B站 业务逻辑。

## CDDAi

- 仓库：本目录同级的 `CDDAi/`（MIT）
- 许可证：MIT
- 用途：CDDA 的屏幕感知 / 菜单状态机 / 存档硬状态 / 目标驱动玩法的思路参考。
- 本项目是独立实现（Node/JS），没有直接把 Python 代码打包进来。
- 本项目的 `data/knowledge_base/` 来自 CDDAi 的 `data/knowledge_base/`（MIT），
  包含生存指南、机制说明、物品/配方/按键表；首次运行会复制到
  `<DSH_HOME>/cdda-duty/knowledge/`。请保留 CDDAi 的 MIT 许可与来源说明。

## Cataclysm: Dark Days Ahead

- 仓库：https://github.com/CleverRaven/Cataclysm-DDA
- 许可证：CC-BY-SA 3.0
- 用途：游戏本体；插件不随包分发任何存档。运行时存档由用户本地 CDDA 生成，
  只写到 `<DSH_HOME>/cdda-duty/game/save/`。
  如果分发本项目，请保留本说明与 CDDA 的许可信息。

## @deepseek-ai/*

DSH 宿主与 `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery` 由宿主提供，
本项目仅在运行时按宿主的实际安装位置解析，不重新分发它们。

## 其它

`screen` 是 GNU Screen（GPLv3+），本项目只调用它，不重新分发。

## ffmpeg

录制功能通过命令行调用系统的 `ffmpeg`（LGPL/GPL，取决于发行版编译选项）把文本帧编码成 mp4；
本项目不重新分发 ffmpeg。
