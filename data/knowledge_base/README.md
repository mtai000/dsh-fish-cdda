# CDDA 知识库

本知识库收录《Cataclysm: Dark Days Ahead》早期游戏的关键信息，用于支撑 AI 推理与玩家辅助。文件按便于快速查阅、JSON 解析和 Markdown 引用的方式组织。

## 目录结构

- `mechanics/` — 核心生存系统的 JSON 档案（口渴、饥饿、健康、疲劳、士气）
- `keybindings/` — 完整操作参考，含情境相关动作
- `items/` — 按用途分组的早期物品目录：
  - `water_sources.json` — 洁净与脏水的补水选项及解渴数据
  - `food_items.json` — 便携热量来源与士气说明
  - `tools_basic.json` — 基础工具、原始武器与收纳装备
  - `materials_basic.json` — 搜刮来的材料（树枝、绳索、紧固件、磨料）
- `recipes/` — 关键生存装备的制作配方
- `guides/` — 精选 Markdown 指南，涵盖生存优先级与战术

空目录请放入 `.gitkeep` 文件，这样即使数据尚未编写，目录结构也能保留在版本控制中。

## 文件格式

### 机制、按键、物品、配方

JSON 资源遵循 `docs/tech-spec-epic-2.md` 第 3.1 节的模式：

- 顶层字段：`topic`、`tags`、`summary`、`details`
- `details` 存放带类型的集合（列表或对象），供下游工具直接索引
- 键名保持 `snake_case`；值优先使用基本类型和小型嵌套对象
- 以程序方式重新生成 JSON 文件时，确保代码保持原有顺序，便于查看差异

提交 JSON 改动前，用 `python -m json.tool <file>` 或等效的模式校验确认无误。

### 指南

Markdown 指南应使用 GitHub 风格，标题清晰、要点可执行、段落简洁（每段少于 120 词）。内容聚焦早期游戏决策，并尽量引用相关的 JSON 条目。

## 贡献流程

1. 在对应目录中新建或更新 JSON/MD 文件。
2. 运行项目 linter 与测试（默认 `pytest`），确认数据质量检查通过。
3. 运行 `pytest tests/validation/test_knowledge_quality.py`，确保验收问题持续通过。
4. 用最新执行日期和汇总结果更新 `VALIDATION_REPORT.md`。
5. 在 `CHANGELOG.md` 中记录新增文件或模式变更，保留历史可追溯性。
6. 确认当前故事中的验收标准均已满足，再标记任务完成。

## 查询示例

```python
from pathlib import Path
import json

KB_ROOT = Path(__file__).resolve().parents[1] / "data" / "knowledge_base"
recipes = json.loads((KB_ROOT / "recipes" / "early_game_crafting.json").read_text())
stone_axe = next(r for r in recipes["details"]["recipes"] if r["result"] == "primitive_axe")
print(stone_axe["components"])
```

## 维护准则

- **更新节奏**：上游稳定版发布后，或游戏内配方有实质变化时，重新导入 CDDA JSON。
- **版本递增**：凡有字段增删都要补写变更日志，方便下游使用方跟进。
- **备份原始来源**：重新生成知识时记录所用的 Cataclysm 构建版本/日期，便于追溯差异。
- **严格校验**：本地验证测试未通过、或 `VALIDATION_REPORT.md` 未反映本次运行时，绝不合入改动。
