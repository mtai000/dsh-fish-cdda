# 自主学习（经验记忆）设计

日期：2026-11-01
状态：待确认
版本目标：0.5.0

## 为什么做

当前插件把 CDDAi 的攻略/机制/物品/配方作为知识库注入。用户希望**不预置知识**，
让 AI 从自己的游玩中积累经验，避免“背题库”，也让插件不携带第三方攻略内容。

## 目标

1. 删除插件自带的 `data/knowledge_base`、知识库加载器、`cdda_knowledge` 工具和相关配置。
2. AI 在游玩中能写下自己的经验（教训、发现、路线、配方条件），下一轮/下一局能读到。
3. 经验可人工查看/编辑/清空；错误经验可被降权或淘汰。
4. 经验只作为“假设”，必须用屏幕/存档验证，不能当硬事实。
5. 不改变现有抓屏、按键、结构化状态、目标、录制、回合总结。

## 非目标

- 不做联网维基/外部检索。
- 不做模型微调、向量数据库、自动真值判定。
- 不自动把经验提升为“插件内置知识”。
- 不删除用户 home 里已有的 `knowledge/` 副本（只是不再注入）。

## 经验记忆模型

文件：`$DSH_HOME/cdda-duty/memory.jsonl`（append-only + 原子重写索引）。

每条：

```json
{
  "id": "m-...",
  "ts": "ISO",
  "goal": "survive 3 days",
  "kind": "lesson|discovery|route|recipe|danger",
  "text": "晚上 22:00 前回避难所，否则疲劳和僵尸都更难处理",
  "evidence": "第 2 天 23:10 在街上被 3 只僵尸追，HP 从 100 掉到 62",
  "confidence": 0.7,
  "hits": 1,
  "lastUsedAt": null,
  "source": "selfplay|chat|human"
}
```

### 写入

- 新工具 `cdda_learn`：模型在回合中主动写一条经验。
  - 参数：`text`（必填，<=500 字）、`kind`、`evidence`、`confidence`（0-1，默认 0.5）。
  - 禁止写屏幕上看不到/无法复现的内容；`evidence` 必填或至少给观察。
- 宿主在回合总结后**不自动编经验**；只把 `decisions.jsonl` 当原始证据。
- 人工可直接编辑 `memory.jsonl`，或设置页清空。

### 去重与淘汰

- 文本归一化后相似度 >= 0.9：不新增，`hits++`，`confidence` 取较高值。
- 最多保留 200 条；超出按 `confidence * recency * (1+hits)` 淘汰。
- `confidence < 0.3` 且 14 天未命中的条目不再注入（保留文件，人工可恢复）。
- 每次注入后更新 `lastUsedAt` 和 `hits`。

### 注入

- 每轮开始按 `goal` + 当前状态关键词（UI/威胁/需求/地点）挑最多 10 条、4000 字符。
- 排序：关键词相关 > confidence > hits > 新近。
- 注入块标题明确写：
  `## 我自己的经验（假设，不是攻略；必须用屏幕验证）`
- 只注入当前 goal 或通用条目；不把一整局 200 条全塞进去。

## 工具/配置

- 删除 `cdda_knowledge`。
- 删除 `knowledge` / `knowledgeMaxChars` 配置。
- 新增：
  - `memory: true`
  - `memoryMaxItems: 10`
  - `memoryMaxChars: 4000`
- 新增工具 `cdda_learn`（host + MCP 都可用）。
- 设置页「目标与节奏」：
  - 显示记忆条数 / 最近一条。
  - 开关「注入自己的经验」。
  - 「清空经验」按钮（二次确认）。
- `cdda_status` 返回 `memoryCount`、`memoryPreview`。

## 删除清单

- `data/knowledge_base/`（含 `.version`）
- `lib/knowledge.mjs`
- `test/knowledge.test.mjs`
- `cdda_knowledge` 工具规格/处理
- `knowledge*` 配置、README/AGENTS/NOTICE/CHANGELOG 对应段落
- `package.json` 的 `data` / 知识库相关描述
- `vendor/` 保持忽略（本来就不提交）

保留：
- `prompts/duty.md` 的按键/安全/工具说明（这是操作说明，不是攻略知识）
- `cdda_note`、`decisions.jsonl`、`rounds.json`、目标、录制

## 测试

1. 记忆写入/读取/去重/淘汰/注入上限。
2. 记忆注入包含“假设，不是攻略”声明。
3. `cdda_learn` 的 host/MCP 工具存在；`cdda_knowledge` 不再存在。
4. 插件包不含 `data/`、`vendor/`、`.sav`。
5. 原有 29+ 测试全绿；新增记忆测试。
6. 实跑一轮：`cdda_learn` 写入一条，下一轮 `cdda_look`/prompt 能看到它，`memory.jsonl` 可读。

## 风险

- **模型编经验**：用 evidence/confidence/人工编辑/“假设”声明约束；不自动当事实。
- **自我强化**：错误经验命中后 hits 增加；用人工淘汰和低 confidence 过滤。
- **上下文膨胀**：硬上限 10 条 / 4000 字符。
- **删知识后开局更难**：这是用户明确要的取舍；保留操作说明和目标，不保留攻略。

## 迁移

- 升级后不再读取 `knowledge/`；用户 home 里的旧副本原样保留，可手动删。
- `memory.jsonl` 不存在时自动创建空文件；首次运行不会报错。
