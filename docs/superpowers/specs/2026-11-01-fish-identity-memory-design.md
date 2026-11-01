# 鱼的身份证 + CDDA 记忆命名空间

日期：2026-11-01
状态：待确认
涉及仓库：`dsh-cdda`、`dsh-fish-kin`
替代：`2026-11-01-autonomous-learning-design.md` 中“全局 memory”部分

## 目标

1. 每条鱼（父代/子代）有一个稳定、可复制的身份证编号。
2. CDDA 有身份信息时，把经验写进该身份独立目录；没有身份信息时写进 `shared`。
3. 子代鱼出生时拿到自己的身份证；父代经验**不会自动全量共享**。
4. 子代出生包只带 3 条 `skill` 经验（有损继承，符合鱼的传代设计）。
5. 删除 CDDA 自带知识库（用户已确认）。

## 身份证格式

文件：鱼家目录下 `identity.json`（父代：`<fishRoot>/identity.json`；子代：`children/<childId>/identity.json`）。

```json
{
  "v": 1,
  "identityId": "fish_01KC...",
  "childId": "kin_01KC...",
  "parentId": "fish_01KB...",
  "lineageId": "kin_01KB...",
  "generation": 2,
  "createdAt": "2026-11-01T..."
}
```

- `identityId`：`fish_` + 26 位 Crockford（复用 fish-kin `newId` 的形状），随机、opaque、稳定。
- `childId`：父代为 `null`，子代是 fish-kin 生成的 `kin_...`。
- `parentId`：父代 `null`，子代指向父代的 `identityId`。
- `lineageId`：这一脉的根 id；父代用自身 identity，子代沿用父代 lineage。
- 不是密码、不是权限凭证，不参与授权；用户可以编辑。
- 文件缺失/损坏 = 没有身份，CDDA 用 `shared`。

## fish-kin 改动

- 新增 `lib/identity.js`：`newIdentityId`、`readIdentity`、`ensureIdentity`、`identityPath`。
- `apply/boot`：对父代 `fishRoot` 调用 `ensureIdentity`：
  - 已有合法 `identity.json` 就保留；
  - 没有就生成父代身份并写入（失败只记日志，不影响她启动）。
- `birth()`：
  - 生成 `childId` 后，写子代 `identity.json`（`parentId` 取父代身份；父代没有则先生成）。
  - 出生证明增加一行“身份证编号”。
  - 返回 `identityId`。
- `childPaths()` 增加 `identity` 路径。
- 可选：`service.preview` 显示“子代身份证将生成”，不写盘。
- 测试：父代身份稳定；子代身份唯一；父子关系正确；重复 ensure 不覆盖。

## CDDA 改动

### 身份读取

- 配置：`identityFile`（绝对路径；留空则读环境变量 `CDDA_DUTY_IDENTITY_FILE`）。
- 典型值：`<fishRoot>/identity.json` 或 `children/<childId>/identity.json`。
- `lib/identity.mjs`：
  - `readIdentity(cfg)` 读取并校验 `identityId`；
  - 无文件/坏文件返回 `null`；
  - `memoryDir(stateDir, identity)`：
    - 有身份：`<DSH_HOME>/cdda-duty/memory/<identityId>/`
    - 无身份：`<DSH_HOME>/cdda-duty/memory/shared/`
- 身份只决定记忆目录，不改变游戏存档/配置/录制路径。

### 记忆

- `memory.jsonl` 每条：
  ```json
  {"scope":"world|skill|inherited","worldId":"...","text":"...","evidence":"...","confidence":0.7,"hits":1,"ts":"..."}
  ```
- 新工具 `cdda_learn`：写一条经验（`text` 必填，`scope` 默认 `skill`，`evidence`/`confidence` 可选）。
- 新工具/注入：
  - 有身份：只读 `memory/<identityId>/`；
  - 无身份：只读 `memory/shared/`；
  - 注入标题：“我自己的经验（假设，不是攻略；必须用屏幕验证）”。
- 上限：10 条 / 4000 字符；去重合并；最多 200 条。
- 删除 `data/knowledge_base`、`lib/knowledge.mjs`、`cdda_knowledge`、`knowledge*` 配置。

### 子代继承（有损）

- CDDA 在父代身份目录旁写 `cdda-lessons.json`：
  - 只写 `scope:"skill"`、`confidence>=0.6` 的最多 20 条候选。
- fish-kin `birth()` 读取父代工作区 `cdda-lessons.json`：
  - 最多挑 3 条，总字数 <=300；
  - 作为 `## 她玩过的游戏` 追加到 `pack.body` 末尾；
  - 同时把选中条目写进子代目录 `cdda-lessons.json`，供子代 CDDA 读取（`scope:"inherited"`）。
- 子代 CDDA 启动时读取自己的 `cdda-lessons.json`，作为 `inherited` 记忆注入；不读父代全量。
- 没有继承文件 = 从零开始。

## 兼容/回退

- 没有 `identityFile` → `shared`，行为等同之前的“共用信息”。
- 旧 `knowledge/` 不删用户文件，只是不再读取。
- 删除知识库后，插件仍能抓屏/按键/自动玩；只是不注入攻略。
- `cdda_learn` 和 `cdda_note` 分开：`note` 是战报，`learn` 是经验。

## 测试

CDDA：
- 无身份 → `memory/shared`；有身份 → `memory/<id>`；两者不串。
- 身份文件坏/缺失回退 shared。
- `cdda_learn` 写入/读取/去重/上限；注入带“假设”声明。
- 包内无 `data/`、`vendor/`、`.sav`；`cdda_knowledge` 不存在。

fish-kin：
- `ensureIdentity(parent)` 幂等；子代 birth 写身份；`parentId/lineageId` 正确。
- 出生证明含身份证号；测试全绿。

联调：
- 父代 CDDA 写 3 条 skill → 出生 → 子代 `cdda-lessons.json` 有 3 条 → 子代 CDDA 注入 3 条。
- 子代不读父代 `memory/<parentId>`。

## 非目标

- 不做身份认证/签名/权限。
- 不做全量继承。
- 不做跨机器同步。
- 不改鱼的事件流格式。
