# Contributing

感谢愿意一起改这个插件。它是**单人本地工具**：DSH 宿主 + GNU screen + CDDA，录制功能再调 ffmpeg。
改动尽量小而可验证，别把运行时数据提交进仓库。

## 开发环境

```bash
node --version        # >= 22
screen --version      # GNU screen
ffmpeg -version       # 只有录制功能需要
cataclysm --version   # 0.G，curses 版（只跑测试不需要）
```

插件本身**没有 npm 运行时依赖**；`@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery`
由 DSH 宿主提供（`lib/hostdeps.mjs` 会先找宿主树，再退到本地依赖/等价实现）。

## 本地装 & 调试

```bash
# 有 pnpm
dsh plugin --profile web add link:/path/to/dsh-cdda

# 没有 pnpm
./scripts/install-local.sh web
```

- **必须重启一次 DSH**（bundle 层组装）。
- 改宿主半端代码后：HMR 只认真实配置值/模块内容变化，**只加注释可能不重载**；
  改一个真实字段（如 `actionsPerRound` 40 → 41 → 40）或重启。
- 改 `client.js` 后刷新浏览器即可。
- 运行数据在 `$DSH_HOME/cdda-duty/`，不要在仓库里生成。

## 测试

```bash
npm test
node selfcheck.mjs
```

- `npm test` 包含：按键解析、屏幕清洗/界面识别、存档解析、MCP 协议、screen 集成、
  录制集成（需要 screen + ffmpeg + 等宽字体）。缺依赖的录制测试会跳过。
- 新增行为请补对应测试；不要依赖本机绝对路径，临时目录用 `mkdtemp`。

## 代码约定

- ESM，2 空格缩进；沿用现有的**不写分号**风格。
- 插件里任何写日志/写文件/定时器回调都必须自己 `try/catch` —— 不能因为插件异常杀掉宿主。
- 宿主/浏览器/MCP 共用逻辑放 `lib/`，不要复制三份。
- 屏幕抓取统一走 `lib/screen.mjs` 的 `capture()`；游戏状态统一走 `lib/state-read.mjs`。
- 录制相关改动跑一次 `test/recorder.test.mjs`，并确认 mp4 能 `ffprobe`、srt 有正确时间轴。
- 字幕/日志是给人看的：不写内部术语，不编屏幕上看不到的东西。

## 提交

建议提交信息用：

```
feat: …
fix: …
docs: …
test: …
chore: …
```

一个 PR/提交只做一件事。提交前确认：

```bash
git status --short
npm test
```

不要提交：`node_modules/`、`recordings/`、`screens/`、`runs/`、`*.log`、`*.srt`、`*.mp4`、
`config.json`、`status.json`、`activity.jsonl`（已在 `.gitignore` 里）。
