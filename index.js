/**
 * dsh-cdda —— host 半端
 * ============================================================================
 * 它是什么：让 DSH 自己玩 CDDA 的插件版。
 *   1. 在 screen 里开两个会话：`cdda`（游戏终端，用户可 `screen -x cdda` 旁观）
 *      和 `cdda_log`（实时战报，显示 DSH 正在做什么）。
 *   2. 把“看屏幕 / 发按键 / 读写状态”注册成 DSH 工具，聊天里就能玩。
 *   3. 自动玩：定时起一个 headless 回合，通过插件生成的 overlay 挂上
 *      `lib/mcp-server.mjs`（MCP stdio），让另一条 DSH 会话接着玩。
 *   4. 设置页（client.js）通过 `/api/cdda-duty/*` 看状态、开关自动玩、改目标。
 *
 * 家里（`$DSH_HOME/cdda-duty/`）都有什么：见 lib/state.mjs 顶部注释。
 * ============================================================================
 */
import { loadHostDeps } from './lib/hostdeps.mjs'

const hostDeps = await loadHostDeps()
const z = hostDeps.z
const defineTool = hostDeps.defineTool

import { spawn } from 'node:child_process'
import {
  appendFileSync, cpSync, createReadStream, existsSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_CFG, clampCfg, ensureDirs, ensureDutyFile,
  logLine, pathsOf, readActivity, readDecisions, readJson, readRound, readRounds, readRuntime, readSavedCfg,
  readStatus, recordEvent, recordNote, saveCfgToDisk, stateDirOf, tailFile,
  writeJson, writeRound, writeStatus, bumpRuntime,
} from './lib/state.mjs'
import { ensureLog, inspectGame, startGame, stopGame } from './lib/game.mjs'
import { capture, hasSession } from './lib/screen.mjs'
import { modeLabel } from './lib/parse.mjs'
import { TOOL_SPECS, handleTool } from './lib/tools-core.mjs'
import { findWorlds } from './lib/state-read.mjs'
import { Recorder, readRecordings, recordDirOf, findFfmpeg, findFont } from './lib/recorder.mjs'
import { ensureKnowledge, knowledgeForState } from './lib/knowledge.mjs'
import { readIdentity, memoryDirOf } from './lib/identity.mjs'
import { selectMemories, memoryCount } from './lib/memory.mjs'
import { ensureGoal, updateGoal as updateGoalProgress, readGoal } from './lib/goal.mjs'

export const name = 'cdda-duty'
export const inject = ['tools']

/**
 * ⚠️ 每个字段都要 `.extra('volatile', true)`：DSH 的 settings.update() 只认 volatile 字段。
 *    另外两个条件：loader entry 的 id 必须等于命名空间名（cordis.patch.yml 里是 cdda-duty）
 *    + 本模块导出 Config。
 */
export const Config = !z ? undefined : z.object({
  enabled: z.boolean().default(true).extra('volatile', true),
  goal: z.string().default(DEFAULT_CFG.goal).extra('volatile', true),
  autoplay: z.boolean().default(false).extra('volatile', true),
  actionsPerRound: z.natural().default(40).extra('volatile', true),
  maxRoundsPerDay: z.natural().default(24).extra('volatile', true),
  roundGapSec: z.natural().default(20).extra('volatile', true),
  maxRoundSeconds: z.natural().default(900).extra('volatile', true),
  autoStartGame: z.boolean().default(true).extra('volatile', true),
  restartOnDeath: z.boolean().default(false).extra('volatile', true),
  cddaPath: z.string().default('').extra('volatile', true),
  userDir: z.string().default('').extra('volatile', true),
  world: z.string().default('').extra('volatile', true),
  screenGame: z.string().default('cdda').extra('volatile', true),
  screenLog: z.string().default('cdda_log').extra('volatile', true),
  logScreen: z.boolean().default(true).extra('volatile', true),
  screenBin: z.string().default('').extra('volatile', true),
  screenDir: z.string().default('').extra('volatile', true),
  dshBin: z.string().default('').extra('volatile', true),
  dutyProfile: z.string().default('cdda-duty').extra('volatile', true),
  starterWorld: z.boolean().default(false).extra('volatile', true),
  modelProvider: z.string().default('').extra('volatile', true),
  model: z.string().default('').extra('volatile', true),
  recordVideo: z.boolean().default(false).extra('volatile', true),
  recordFps: z.natural().default(2).extra('volatile', true),
  recordDir: z.string().default('').extra('volatile', true),
  recordFont: z.string().default('').extra('volatile', true),
  ffmpegPath: z.string().default('').extra('volatile', true),
  recordMaxMinutes: z.natural().default(120).extra('volatile', true),
  knowledge: z.boolean().default(true).extra('volatile', true),
  knowledgeMaxChars: z.natural().default(12000).extra('volatile', true),
  identityFile: z.string().default('').extra('volatile', true),
  memory: z.boolean().default(true).extra('volatile', true),
  memoryMaxItems: z.natural().default(10).extra('volatile', true),
  memoryMaxChars: z.natural().default(4000).extra('volatile', true),
  autoUnstick: z.boolean().default(true).extra('volatile', true),
  restartOnCrash: z.boolean().default(true).extra('volatile', true),
  maxRestartsPerDay: z.natural().default(5).extra('volatile', true),
})

const CFG_SIG = ['goal', 'actionsPerRound', 'autoplay', 'screenGame']

export function apply(ctx, config) {
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  const stateDir = stateDirOf(ctx)
  const p = pathsOf(stateDir)
  ensureDirs(p)
  const dutyFile = ensureDutyFile(pluginDir, stateDir)
  const log = (m) => { try { logLine(stateDir, String(m)) } catch { /* 忽略 */ } }
  const recorder = new Recorder({ stateDir, pluginDir, log })
  const knowledgeDir = ensureKnowledge(pluginDir, stateDir, log)
  let recReadyCache = { at: 0, ok: false }
  const recorderReady = () => {
    if (Date.now() - recReadyCache.at < 60_000) return recReadyCache.ok
    const ok = Boolean(findFfmpeg(cfg) && findFont(cfg))
    recReadyCache = { at: Date.now(), ok }
    return ok
  }

  let myVer = ''
  try { myVer = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).version || '' } catch { /* 忽略 */ }

  if (hostDeps.notes.length) log('宿主依赖：' + hostDeps.notes.join(' / '))
  log(`已加载（家=${stateDir}，version=${myVer}）`)

  /* ─────────────── 配置：插件 config.json ⇄ DSH 原生设置 ─────────────── */

  let settingsRowCache = { at: 0, row: null }
  const settingsRow = (fresh = false) => {
    const t = Date.now()
    if (!fresh && t - settingsRowCache.at < 2500) return settingsRowCache.row
    let row = null
    try {
      const rows = ctx.get('settings')?.describe?.() || []
      row = rows.find((r) => r?.value && CFG_SIG.every((k) => k in r.value)) || null
    } catch (e) { log(`读 DSH 设置表单失败（不影响玩）：${String(e?.message ?? e)}`) }
    settingsRowCache = { at: t, row }
    return row
  }

  const saved = readSavedCfg(stateDir)
  let touched = new Set(Array.isArray(saved._set) ? saved._set : [])
  let cfg = { ...DEFAULT_CFG, ...(config || {}) }

  const loadCfg = () => {
    const row = settingsRow()
    const base = { ...DEFAULT_CFG, ...((row?.value && typeof row.value === 'object') ? row.value : (config || {})) }
    const freshSaved = readSavedCfg(stateDir)
    const user = row?.user && typeof row.user === 'object' ? row.user : {}
    const out = { ...base }
    for (const k of Object.keys(DEFAULT_CFG)) {
      if (touched.has(k) && freshSaved[k] !== undefined) out[k] = freshSaved[k]
      else if (user[k] !== undefined) out[k] = user[k]
      else if (freshSaved[k] !== undefined) out[k] = freshSaved[k]
    }
    return clampCfg(out)
  }
  cfg = loadCfg()
  const refreshCfg = () => { Object.assign(cfg, loadCfg()) }

  const saveHostCfg = async (patch) => {
    const row = settingsRow(true)
    const s = ctx.get('settings')
    if (!row?.ns || typeof s?.update !== 'function') {
      return { ok: false, error: 'DSH 这边没有可写的设置表单（值只落在插件自己的 config.json 里）' }
    }
    try {
      await s.update(row.ns, patch, row.revision)
      return { ok: true, ns: row.ns }
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  }

  const persistCfg = async (patch) => {
    refreshCfg()
    const clean = clampCfg(patch, cfg)
    Object.assign(cfg, clean)
    for (const k of Object.keys(patch || {})) if (k in DEFAULT_CFG) touched.add(k)
    saveCfgToDisk(stateDir, cfg, [...touched])
    const host = await saveHostCfg(clean)
    if (!host.ok) log(`写 DSH 设置失败（config.json 已保存）：${host.error}`)
    return host
  }

  const updateGoal = (goal) => {
    if (!goal) return
    cfg.goal = String(goal).slice(0, 4000)
    touched.add('goal')
    saveCfgToDisk(stateDir, cfg, [...touched])
    saveHostCfg({ goal: cfg.goal }).catch(() => {})
  }

  /* ─────────────── 工具 ─────────────── */

  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_args, value) => [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  }
  const safe = (v) => {
    try { return JSON.parse(JSON.stringify(v ?? null)) } catch { return String(v) }
  }

  const runtime = (source = 'chat') => ({
    stateDir,
    pluginDir,
    cfg,
    source,
    log,
    getCfg: () => { refreshCfg(); return cfg },
    updateGoal,
    setAutoplay: async (on) => {
      await persistCfg({ autoplay: Boolean(on) })
      if (on) setTimeout(() => tick('autoplay-on'), 300)
      else stopRound('autoplay-off')
      return { autoplay: Boolean(on) }
    },
    knowledgeDir,
    autoUnstick: cfg.autoUnstick !== false,
    ensureRecording: () => recorder.ensure(cfg),
    stopRecording: () => recorder.stop('game-stop'),
    recordingStatus: () => recorder.status(),
    record: async (on, fps) => {
      const want = Boolean(on)
      if (fps !== undefined && Number.isFinite(Number(fps))) {
        await persistCfg({ recordFps: Number(fps) })
      }
      await persistCfg({ recordVideo: want })
      if (!want) {
        const r = await recorder.stop('switch-off')
        return r.ok ? r : { ok: true, active: false, ...r }
      }
      const g = await inspectGame(cfg, stateDir)
      if (!g.running || g.mode !== 'gameplay') {
        const started = await startGame(cfg, stateDir, pluginDir, { log })
        if (!started.ok) return { ok: false, error: started.error || '游戏没开，录制没开始' }
      }
      return recorder.start(cfg)
    },
  })

  for (const spec of TOOL_SPECS) {
    try {
      ctx.tools.register(defineTool({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: textOutput,
        async execute(args) {
          refreshCfg()
          return safe(await handleTool(spec.name, args || {}, runtime('chat')))
        },
      }))
    } catch (e) {
      log(`工具 ${spec.name} 注册失败：${String(e?.message ?? e)}`)
    }
  }

  /* ─────────────── 自动玩：headless 回合 ─────────────── */

  let roundChild = null
  let roundTimer = null
  let roundStartedAt = 0
  let lastRoundEndAt = 0
  let roundId = ''
  let ticking = false
  let stopping = false

  const pidAlive = (pid) => {
    if (!pid) return false
    try { process.kill(pid, 0); return true } catch { return false }
  }

  const acquireLock = () => {
    try {
      const lock = readJson(p.lockFile, null)
      if (lock && Number(lock.pid) !== process.pid) {
        const fresh = Number(lock.ts) > Date.now() - 15 * 60_000
        if (fresh && pidAlive(Number(lock.pid))) return false
      }
      writeJson(p.lockFile, { pid: process.pid, ts: Date.now() })
      return true
    } catch { return true }
  }
  const releaseLock = () => {
    try {
      const lock = readJson(p.lockFile, null)
      if (!lock || Number(lock.pid) === process.pid) writeJson(p.lockFile, { pid: 0, ts: 0 })
    } catch { /* 忽略 */ }
  }

  const sessionId = () => {
    const j = readJson(p.sessionFile, null)
    return j && typeof j.id === 'string' ? j.id : ''
  }
  const saveSessionId = (id) => writeJson(p.sessionFile, { id: id || '', at: Date.now() })

  const findDshCli = () => {
    const explicit = String(cfg.dshBin || '').trim()
    if (explicit && existsSync(explicit)) return explicit
    // 当前进程的入口：node <node_modules>/.bin/dsh web ⇒ realpath 到 lib/bin.js
    try {
      const argv1 = process.argv[1] ? resolve(process.argv[1]) : ''
      if (argv1 && existsSync(argv1)) {
        let real = argv1
        try { real = realpathSync(argv1) } catch { /* 用原路径 */ }
        if (real.endsWith('.js') && /(?:^|[\\/])dsh[\\/]lib[\\/]bin\.js$/.test(real)) return real
        if (real.endsWith('.js') && /(?:^|[\\/])@deepseek-ai[\\/]dsh[\\/]/.test(real)) return real
      }
    } catch { /* 忽略 */ }
    // Node 解析器（如果插件树里碰巧有）
    try {
      const req = createRequire(import.meta.url)
      for (const spec of ['@deepseek-ai/dsh/lib/bin.js', '@deepseek-ai/dsh']) {
        try { const f = req.resolve(spec); if (f && existsSync(f) && f.endsWith('.js')) return f } catch { /* 下一个 */ }
      }
    } catch { /* 忽略 */ }
    // 标准位置 / profile 树
    const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
    const candidates = [
      '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      '/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    ]
    try {
      for (const n of readdirSync(join(home, 'profiles'))) {
        candidates.push(join(home, 'profiles', n, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      }
    } catch { /* 忽略 */ }
    for (const c of candidates) { try { if (existsSync(c)) return c } catch { /* 忽略 */ } }
    return ''
  }

  const resolveDsh = () => {
    const cli = findDshCli()
    if (cli) return { command: process.execPath, args: [cli], shell: false }
    // 最后一招：PATH 里的 dsh
    const dirs = String(process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
    for (const d of dirs) {
      for (const n of ['dsh', 'dsh.cmd', 'dsh.exe']) {
        const f = join(d, n)
        try { if (existsSync(f)) return { command: f, args: [], shell: process.platform === 'win32' } } catch { /* 忽略 */ }
      }
    }
    return {
      missing: true,
      hint: '找不到 dsh。把设置里的「dshBin」填成 <...>/@deepseek-ai/dsh/lib/bin.js，或把 dsh 放进 PATH。',
    }
  }

  const dutyProfileDir = () => join(dirname(stateDir), 'profiles', String(cfg.dutyProfile || 'cdda-duty'))
  let dutyProfileState = 'unknown'
  const ensureDutyProfile = () => {
    try {
      const src = join(pluginDir, 'profile-template', 'cdda-duty')
      if (!existsSync(src)) { dutyProfileState = 'missing'; return false }
      const target = dutyProfileDir()
      mkdirSync(dirname(target), { recursive: true })
      cpSync(src, target, { recursive: true, force: true })
      dutyProfileState = existsSync(join(target, 'cordis.patch.yml')) ? 'ok' : 'failed'
      return dutyProfileState === 'ok'
    } catch (e) {
      dutyProfileState = 'failed'
      log(`铺 cdda-duty profile 失败：${String(e?.message ?? e)}（退回 stock headless，权限更大）`)
      return false
    }
  }

  const effectiveProfile = () => {
    const want = String(cfg.dutyProfile || '').trim()
    if (want && want !== 'cdda-duty') return want
    return dutyProfileState === 'ok' ? 'cdda-duty' : 'headless'
  }

  const yq = (v) => "'" + String(v).replace(/'/g, "''") + "'"
  const ensureOverlay = () => {
    const yml = []
    for (const id of ['credentials', 'authorization', 'deepseek-account']) {
      yml.push('- id: ' + id, '  disabled: false', '')
    }
    let provider = String(cfg.modelProvider || '').trim()
    let model = String(cfg.model || '').trim()
    let effort = ''
    if (!provider || !model) {
      try {
        const sel = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null
        provider = String(sel?.provider ?? sel?.providerId ?? '').trim()
        model = String(sel?.model ?? sel?.modelId ?? '').trim()
        effort = String(sel?.reasoningEffort ?? '').trim()
      } catch { /* 老版本没有这个服务 */ }
    }
    if (provider && model) {
      yml.push(
        '- id: agent-default-model',
        '  config:',
        '    provider: ' + provider,
        '    model: ' + model,
        ...(effort ? ['    reasoningEffort: ' + effort] : []),
        '',
      )
    }
    yml.push(
      '- insert:',
      '    - id: mcp-cdda-duty',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: cdda-duty',
      '        transport: stdio',
      '        command: ' + yq(process.execPath),
      '        args:',
      '          - ' + yq(join(pluginDir, 'lib', 'mcp-server.mjs')),
      '        cwd: ' + yq(stateDir),
      '        env:',
      '          CDDA_DUTY_HOME: ' + yq(stateDir),
      '          DSH_HOME: ' + yq(process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')),
      ...(process.versions.electron ? ['          ELECTRON_RUN_AS_NODE: ' + yq('1')] : []),
      '        toolCallTimeoutMs: 120000',
      '        failOnStartupError: true',
      '',
    )
    try { writeFileSync(p.overlayFile, yml.join('\n'), 'utf8'); return p.overlayFile } catch (e) {
      log(`写 overlay 失败：${String(e?.message ?? e)}`)
      return ''
    }
  }

  const workspaceDirName = () => '--' + String(stateDir).replace(/^[\\/]+/, '').replace(/:/g, '').replace(/[\\/]/g, '-') + '--'
  const discoverSession = (since) => {
    try {
      const root = join(process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'), 'sessions')
      if (!existsSync(root)) return ''
      const ws = join(root, workspaceDirName())
      let dirs = []
      try { dirs = existsSync(ws) ? readdirSync(ws) : [] } catch { dirs = [] }
      let best = ''
      let bestAt = 0
      for (const d of dirs) {
        const full = join(ws, d)
        try {
          const st = statSync(full)
          if (!st.isDirectory()) continue
          if (st.mtimeMs >= since && st.mtimeMs > bestAt) { bestAt = st.mtimeMs; best = d }
        } catch { /* 忽略 */ }
      }
      return best
    } catch { return '' }
  }

  const buildPrompt = (why, game = null) => {
    let charter = ''
    try { charter = readFileSync(dutyFile, 'utf8') } catch { /* 用内置兜底 */ }
    const worlds = (() => {
      try { return findWorlds(p.saveDir).map((w) => w.name) } catch { return [] }
    })()
    const repl = {
      '<goal>': String(cfg.goal || DEFAULT_CFG.goal),
      '<home>': stateDir,
      '<actions>': String(Number(cfg.actionsPerRound) || 40),
      '<world>': String(cfg.world || worlds[0] || '（未指定）'),
      '<screen>': String(cfg.screenGame || 'cdda'),
      '<log_screen>': String(cfg.screenLog || 'cdda_log'),
      '<why>': why === 'manual' ? '使用者手动点的一轮' : '自动玩定时的一轮',
    }
    let text = charter || '你是 CDDA 玩家。使用 mcp__cdda-duty__* 工具看屏幕、发按键、写战报。'
    for (const [k, v] of Object.entries(repl)) text = text.split(k).join(v)
    try {
      ensureGoal(stateDir, cfg.goal, game?.save)
      const gi = updateGoalProgress(stateDir, game?.save, game?.parsed)
      if (gi?.progress?.text) {
        text += `\n\n目标进度：${gi.progress.text}${gi.complete ? '（已达成）' : ''}`
      }
    } catch { /* 进度失败不影响玩 */ }
    text += `\n\n本轮信息：${repl['<why>']}；动作预算 ${repl['<actions>']} 个。`
      + `\n工具名以 mcp__cdda-duty__ 开头。第一步先调用 mcp__cdda-duty__cdda_status，再看屏幕。`
      + `\n想看更细的手册可以调用 mcp__cdda-duty__cdda_knowledge。`
      + `\n做完预算就结束这一轮，简短总结你做了什么、下一步打算。`
    if (cfg.memory !== false) {
      try {
        const id = readIdentity(cfg)
        const mem = selectMemories(memoryDirOf(stateDir, id), {
          goal: cfg.goal,
          worldId: game?.save?.world || '',
          maxItems: Number(cfg.memoryMaxItems) || 10,
          maxChars: Number(cfg.memoryMaxChars) || 4000,
        })
        if (mem.text) text += `\n\n${mem.text}`
      } catch { /* 经验读不到不影响玩 */ }
    }
    if (cfg.knowledge !== false) {
      try {
        const k = knowledgeForState(knowledgeDir, game?.save, game?.mode || 'unknown', {
          maxChars: Number(cfg.knowledgeMaxChars) || 12000,
          screen: game?.parsed || null,
        })
        if (k.text) {
          log(`知识注入：${k.tags.join(', ')}（${k.text.length} 字符）`)
          text += `\n\n## 相关手册（CDDAi 知识库，按当前状态挑选）`
            + `\n标签：${k.tags.join(', ')}`
            + `\n（英文原文；优先按这些机制行动，别凭印象编）\n\n${k.text}`
        }
      } catch (e) { log('注入知识库失败：' + String(e?.message ?? e)) }
    }
    return text.slice(0, 36_000)
  }

  const runRound = async (why = 'auto', { retry = false } = {}) => {
    if (stopping) return { ok: false, error: '正在停止' }
    if (roundChild) {
      try {
        if (roundChild.exitCode === null && !roundChild.killed) return { ok: false, busy: true, error: '上一轮还没结束' }
      } catch { /* 忽略 */ }
      roundChild = null
    }
    refreshCfg()
    if (why === 'auto') {
      if (!cfg.enabled || !cfg.autoplay) return { ok: false, disabled: true, error: '自动玩没开' }
      const rt = readRuntime(stateDir)
      const max = Number(cfg.maxRoundsPerDay) || 0
      if (max > 0 && Number(rt.roundsToday || 0) >= max) {
        log(`今天已经跑了 ${rt.roundsToday} 轮（上限 ${max}）⇒ 自动玩暂停`)
        return { ok: false, limit: true, error: '今天轮数到上限了' }
      }
    }
    if (!acquireLock()) { log('另一轮正在跑（锁）⇒ 这一跳跳过'); return { ok: false, busy: true } }

    try {
      // 先确保游戏在跑；死亡 / 失败就停在这
      const g = await inspectGame(cfg, stateDir)
      if (!g.running || g.mode !== 'gameplay') {
        if (g.mode === 'death') {
          await persistCfg({ autoplay: false })
          recordEvent(stateDir, 'death', '角色死了 ⇒ 自动玩暂停')
          releaseLock()
          return { ok: false, dead: true, error: '角色死了' }
        }
        if (!cfg.autoStartGame && why === 'auto') {
          releaseLock()
          return { ok: false, error: '游戏没开，且 autoStartGame 关着' }
        }
        if (!g.running && why === 'auto') {
          if (!cfg.restartOnCrash) {
            await persistCfg({ autoplay: false })
            recordEvent(stateDir, 'crash', '游戏不在了，且 restartOnCrash 关着 ⇒ 自动玩暂停')
            releaseLock()
            return { ok: false, error: '游戏不在了，且自动重开关着' }
          }
          const rtState = readRuntime(stateDir)
          const maxRestarts = Number(cfg.maxRestartsPerDay) || 0
          if (maxRestarts > 0 && Number(rtState.restartsToday || 0) >= maxRestarts) {
            await persistCfg({ autoplay: false })
            recordEvent(stateDir, 'crash', `今天自动重开次数已到上限 ${maxRestarts} ⇒ 自动玩暂停`)
            releaseLock()
            return { ok: false, error: '今天自动重开次数到上限' }
          }
          bumpRuntime(stateDir, { restartsToday: Number(rtState.restartsToday || 0) + 1 })
          log(`游戏不在了（崩溃/被关）⇒ 自动重开第 ${Number(rtState.restartsToday || 0) + 1} 次`)
        }
        log(`游戏当前是「${g.modeLabel}」⇒ 先开游戏`)
        const started = await startGame(cfg, stateDir, pluginDir, { log })
        if (!started.ok) {
          recordEvent(stateDir, 'start_failed', started.error || '开游戏失败')
          releaseLock()
          return { ok: false, error: started.error || '开游戏失败' }
        }
        try { await recorder.ensure(cfg) } catch (e) { log('录制没起来：' + String(e?.message ?? e)) }
      }

      // 目标进度 / 达成后不再开新回合
      let promptGame = null
      try {
        promptGame = await inspectGame(cfg, stateDir)
        ensureGoal(stateDir, cfg.goal, promptGame.save)
        const gi = updateGoalProgress(stateDir, promptGame.save, promptGame.parsed)
        if (gi?.complete) {
          await persistCfg({ autoplay: false })
          recordEvent(stateDir, 'goal_complete', `目标已达成：${gi.progress?.text || cfg.goal}`)
          log(`目标已达成 ⇒ 自动玩暂停：${gi.progress?.text || cfg.goal}`)
          releaseLock()
          return { ok: false, goalComplete: true, goal: gi }
        }
      } catch { /* 进度读不到就照常跑 */ }

      const dsh = resolveDsh()
      if (dsh.missing) { releaseLock(); return { ok: false, error: dsh.hint } }
      if (!ensureDutyProfile()) log('⚠️ 专用 profile 没铺上 ⇒ 用 stock headless（权限更大）')
      const overlay = ensureOverlay()
      if (!overlay) { releaseLock(); return { ok: false, error: '写 overlay 失败' } }

      const sid = sessionId()
      const args = [...(dsh.args || []), '--profile', effectiveProfile(), '--patch', overlay]
      if (sid) args.push('--session-id', sid)
      if (!promptGame) {
        try { promptGame = await inspectGame(cfg, stateDir) } catch { /* 用 null，至少给 baseline */ }
      }
      const prompt = buildPrompt(why, promptGame)
      args.push(prompt)

      roundId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
      roundStartedAt = Date.now()
      const runLog = join(p.runsDir, `round-${roundId}.log`)
      writeRound(stateDir, {
        id: roundId, active: true, startedAt: new Date().toISOString(),
        actionsLimit: Number(cfg.actionsPerRound) || 40, actions: 0, source: why,
      })
      bumpRuntime(stateDir, { roundsToday: Number(readRuntime(stateDir).roundsToday || 0) + (why === 'auto' ? 1 : 0) })
      recordEvent(stateDir, 'round_start', `第 ${roundId} 轮开始（${why}）`, { roundId })
      writeStatus(stateDir, {
        running: true,
        round: { id: roundId, active: true, actions: 0, actionsLimit: Number(cfg.actionsPerRound) || 40, source: why },
        actionsThisRound: 0,
      })
      const header = `# dsh-cdda round ${roundId}\n# ${new Date().toISOString()}\n# profile=${effectiveProfile()} session=${sid || '(new)'}\n# args=${JSON.stringify(args.slice(0, 5))}\n\n`
      try { writeFileSync(runLog, header, 'utf8') } catch { /* 忽略 */ }
      log(`自动玩开跑（${why}）：round=${roundId} profile=${effectiveProfile()} session=${sid || 'new'}`)

      const child = spawn(dsh.command, args, {
        cwd: stateDir,
        shell: Boolean(dsh.shell),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CDDA_DUTY_HOME: stateDir,
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        },
      })
      const writeRun = (buf) => {
        try { appendFileSync(runLog, buf, 'utf8') } catch { /* 忽略 */ }
      }
      child.stdout?.on('data', writeRun)
      child.stderr?.on('data', writeRun)
      child.on('error', (e) => {
        log(`回合起不来：${String(e?.message ?? e)}`)
        releaseLock()
        try { writeRound(stateDir, null) } catch { /* 忽略 */ }
        if (roundChild === child) roundChild = null
      })
      child.on('exit', (code, signal) => {
        const took = Math.round((Date.now() - roundStartedAt) / 1000)
        lastRoundEndAt = Date.now()
        const roundInfo = readRound(stateDir) || {}
        const goalInfo = readGoal(stateDir)
        const summary = {
          id: roundId,
          code,
          signal: signal || '',
          durationSec: took,
          actions: Number(roundInfo.actions || 0),
          actionsLimit: Number(roundInfo.actionsLimit || 0),
          source: roundInfo.source || why,
          session: sid || '',
          goal: goalInfo?.goal || cfg.goal,
          goalProgress: goalInfo?.progress?.text || '',
          goalComplete: Boolean(goalInfo?.complete),
          endedAt: new Date().toISOString(),
          log: runLog,
        }
        try {
          writeJson(join(p.runsDir, `round-${roundId}.json`), summary)
          const list = readRounds(stateDir, 200).filter((x) => x && x.id !== roundId)
          list.unshift(summary)
          writeJson(p.roundsIndex, list.slice(0, 100))
        } catch { /* 摘要失败不影响 */ }
        log(`回合结束：round=${roundId} code=${code} signal=${signal || ''} 用时=${took}s 动作=${summary.actions}`)
        try { appendFileSync(runLog, `\n# exit code=${code} signal=${signal || ''} took=${took}s\n`, 'utf8') } catch { /* 忽略 */ }
        releaseLock()
        try { if (roundTimer) clearTimeout(roundTimer) } catch { /* 忽略 */ }
        roundTimer = null
        try { writeRound(stateDir, null) } catch { /* 忽略 */ }
        try { writeStatus(stateDir, { round: null, actionsThisRound: 0, lastRound: summary }) } catch { /* 忽略 */ }
        recordEvent(stateDir, 'round_end', `第 ${roundId} 轮结束（code=${code}，${took}s）`, { roundId, code })
        if (roundChild === child) roundChild = null
        // 第一次开出来的会话 id 认领下来，下一轮接着聊
        if (!sid) {
          const id = discoverSession(roundStartedAt - 2000)
          if (id) { saveSessionId(id); log(`自动玩会话已记录：${id.slice(0, 28)}…`) }
          else log('⚠️ 没找到这一轮开出来的会话 id ⇒ 下一轮还是新会话（不影响玩，只是没上下文）')
        }
        // 会话坏了 / 被删了：清掉再重试一次
        if (sid && code !== 0 && !retry && took < 60) {
          saveSessionId('')
          log('⚠️ 续会话失败 ⇒ 清掉 id，5 秒后用新会话重试一次')
          setTimeout(() => { runRound(why, { retry: true }).catch((e) => log('重试失败：' + String(e?.message ?? e))) }, 5000)
          return
        }
        // 死了就别再自动开
        setTimeout(async () => {
          try {
            if (!cfg.autoplay) return
            const g2 = await inspectGame(cfg, stateDir)
            if (g2.mode === 'death' && !cfg.restartOnDeath) {
              await persistCfg({ autoplay: false })
              recordEvent(stateDir, 'death', '角色死了 ⇒ 自动玩已暂停')
              log('角色死了 ⇒ 自动玩已暂停（设置里可以清档重开）')
            }
          } catch { /* 忽略 */ }
        }, 1500)
      })
      if (Number(cfg.maxRoundSeconds) > 0) {
        roundTimer = setTimeout(() => {
          if (roundChild) {
            log(`单轮超过 ${cfg.maxRoundSeconds}s ⇒ 结束它`)
            try { roundChild.kill('SIGTERM') } catch { /* 忽略 */ }
          }
        }, Number(cfg.maxRoundSeconds) * 1000)
        roundTimer.unref?.()
      }
      roundChild = child
      roundStartedAt = Date.now()
      return { ok: true, started: true, roundId, profile: effectiveProfile(), session: sid || 'new', log: runLog }
    } catch (e) {
      releaseLock()
      log(`开一轮失败：${String(e?.stack ?? e)}`)
      return { ok: false, error: String(e?.message ?? e) }
    }
  }

  const stopRound = (why = 'manual') => {
    try { if (roundTimer) clearTimeout(roundTimer) } catch { /* 忽略 */ }
    roundTimer = null
    const hadChild = Boolean(roundChild)
    if (roundChild) {
      log(`停止当前回合（${why}）`)
      try { roundChild.kill('SIGTERM') } catch { /* 忽略 */ }
    }
    // 有子进程时别先清 round.json —— exit 处理器还要读 actions 写 summary
    if (!hadChild) {
      try { writeRound(stateDir, null) } catch { /* 忽略 */ }
      try { writeStatus(stateDir, { round: null, actionsThisRound: 0 }) } catch { /* 忽略 */ }
    }
    releaseLock()
  }

  const tick = (why = 'tick') => {
    if (ticking) return
    ticking = true
    ;(async () => {
      try {
        refreshCfg()
        if (!cfg.enabled || !cfg.autoplay) return
        const g = readGoal(stateDir)
        if (g?.complete) {
          await persistCfg({ autoplay: false })
          log(`目标已达成（${g.progress?.text || g.goal}）⇒ 自动玩暂停`)
          return
        }
        if (stopping) return
        if (roundChild) return
        const gap = Math.max(0, Number(cfg.roundGapSec) || 0) * 1000
        if (lastRoundEndAt && gap > 0 && Date.now() - lastRoundEndAt < gap) return
        const rt = readRuntime(stateDir)
        const max = Number(cfg.maxRoundsPerDay) || 0
        if (max > 0 && Number(rt.roundsToday || 0) >= max) return
        await runRound('auto')
      } catch (e) {
        log(`自动玩跳失败（已兜住）：${String(e?.message ?? e)}`)
      } finally {
        ticking = false
      }
    })()
  }

  const tickTimer = setInterval(() => tick('timer'), 15_000)
  tickTimer.unref?.()
  ctx.effect(() => () => {
    try { clearInterval(tickTimer) } catch { /* 忽略 */ }
    try { if (roundTimer) clearTimeout(roundTimer) } catch { /* 忽略 */ }
    stopping = true
    try { if (roundChild) roundChild.kill('SIGTERM') } catch { /* 忽略 */ }
    try { recorder.dispose() } catch { /* 忽略 */ }
    releaseLock()
  }, 'cdda-duty: 定时器与回合子进程')

  // 启动战报屏（稍等，别拖慢宿主启动）
  const logTimer = setTimeout(() => {
    ensureLog(cfg, stateDir, pluginDir, log).catch((e) => log('战报屏启动失败：' + String(e?.message ?? e)))
  }, 1500)
  logTimer.unref?.()
  const recordTimer = setTimeout(async () => {
    try {
      if (!cfg.recordVideo) return
      const g = await inspectGame(cfg, stateDir)
      if (g.running && g.mode === 'gameplay') await recorder.ensure(cfg)
    } catch (e) { log('恢复录制失败：' + String(e?.message ?? e)) }
  }, 3000)
  recordTimer.unref?.()
  ctx.effect(() => () => { try { clearTimeout(logTimer) } catch { /* 忽略 */ } }, 'cdda-duty: 战报屏定时器')
  ctx.effect(() => () => { try { clearTimeout(recordTimer) } catch { /* 忽略 */ } }, 'cdda-duty: 录制恢复定时器')

  if (cfg.autoplay) setTimeout(() => tick('startup'), 4000).unref?.()

  /* ─────────────── HTTP API（设置页） ─────────────── */

  const sendJson = (res, code, obj) => {
    try {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(obj))
    } catch { /* 连接断了 */ }
  }

  const readBody = (req, limit = 1024 * 1024) => new Promise((resolveBody) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { try { req.destroy() } catch { /* 忽略 */ } resolveBody({}) ; return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { resolveBody({}) }
    })
    req.on('error', () => resolveBody({}))
  })

  const sameOriginOk = (req) => {
    try {
      const host = String(req.headers.host || '')
      if (!host) return true
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return false
      const pick = String(req.headers.origin || req.headers.referer || '')
      if (!pick) return true
      try {
        const u = new URL(pick)
        const originAuthority = String(u.host || '').toLowerCase()
        return originAuthority === String(host).toLowerCase()
      } catch { return false }
    } catch { return false }
  }

  let fenceWarned = false
  const fenceReject = (req, res) => {
    let conn = null
    try { conn = typeof ctx.get === 'function' ? ctx.get('connection') : null } catch { /* 忽略 */ }
    if (!conn || typeof conn.requestRejection !== 'function') {
      if (!fenceWarned) { fenceWarned = true; log('⚠️ 拿不到 DSH 信任栅栏 ⇒ 退回本机同源这一道') }
      return false
    }
    try {
      const rejection = conn.requestRejection({ headers: req.headers })
      if (rejection === undefined) return false
      res.statusCode = typeof rejection === 'number' ? rejection : 403
      try { res.end() } catch { /* 忽略 */ }
      return true
    } catch {
      res.statusCode = 403
      try { res.end() } catch { /* 忽略 */ }
      return true
    }
  }

  const attachPaths = () => ({
    home: stateDir,
    log: p.logFile,
    activity: p.activityFile,
    gameDir: p.gameDir,
    saveDir: p.saveDir,
    duty: dutyFile,
    overlay: p.overlayFile,
    knowledge: p.knowledgeDir,
  })

  const statusPayload = async () => {
    refreshCfg()
    const g = await inspectGame(cfg, stateDir)
    const st = readStatus(stateDir)
    const rt = readRuntime(stateDir)
    const gameRunning = await hasSession(cfg, String(cfg.screenGame || 'cdda'))
    const logRunning = await hasSession(cfg, String(cfg.screenLog || 'cdda_log'))
    const saveSummary = g.save?.ok ? {
      name: g.save.name, calendar: g.save.calendar, needs: g.save.needs, health: g.save.health,
      location: g.save.location, summary: g.save.summary, lastMessage: g.save.lastMessage,
    } : null
    ensureGoal(stateDir, cfg.goal, g.save)
    const goalInfo = updateGoalProgress(stateDir, g.save, g.parsed)
    const identity = readIdentity(cfg)
    const mDir = memoryDirOf(stateDir, identity)
    const memInfo = { identityId: identity?.identityId || null, memoryCount: memoryCount(mDir), memoryDir: mDir }
    const recording = recorder.status()
    const recDir = recordDirOf(stateDir, cfg)
    const recordings = readRecordings(stateDir, 12).map((r) => ({
      ...r,
      videoName: basename(String(r.video || '')),
      srtName: basename(String(r.srt || '')),
      exists: Boolean(r.video && existsSync(r.video)),
    }))
    // 让 cdda_log（只读 status.json）也跟着设置页轮询刷新，不必等下一次动作。
    try {
      writeStatus(stateDir, {
        running: gameRunning,
        mode: g.capture?.ok ? g.mode : (st.mode || 'not_running'),
        goal: cfg.goal,
        goalProgress: goalInfo?.progress || null,
        goalComplete: Boolean(goalInfo?.complete),
        identityId: memInfo.identityId,
        memoryCount: memInfo.memoryCount,
        memoryDir: memInfo.memoryDir,
        ui: g.view?.ui || g.parsed?.ui || null,
        visible: g.view?.visible || null,
        vitals: g.view ? { health: g.view.health, needs: g.view.needs, location: g.view.location } : null,
        consistency: g.view?.consistency || null,
        recording,
        ...(g.save?.ok ? { state: g.save } : {}),
        ...(g.capture?.ok ? { screenPreview: g.capture.text.split('\n').filter(Boolean).slice(-8).join('\n') } : {}),
      })
    } catch { /* 忽略 */ }
    return {
      ok: true,
      version: myVer,
      home: stateDir,
      config: cfg,
      round: readRound(stateDir),
      goal: goalInfo,
      identity: identity || null,
      memoryCount: memInfo.memoryCount,
      goalProgress: goalInfo?.progress || null,
      goalComplete: Boolean(goalInfo?.complete),
      runtime: rt,
      status: {
        running: gameRunning,
        mode: g.capture?.ok ? g.mode : (st.mode || 'not_running'),
        modeLabel: g.capture?.ok ? g.modeLabel : modeLabel(st.mode || 'not_running'),
        hint: g.hint,
        lastAction: st.lastAction || null,
        lastNote: st.lastNote || null,
        actionsToday: Number(st.actionsToday || rt.actionsToday || 0),
        actionsThisRound: Number(st.actionsThisRound || 0),
        updatedAt: st.updatedAt || '',
        goalProgress: goalInfo?.progress || null,
        goalComplete: Boolean(goalInfo?.complete),
        identityId: memInfo.identityId,
        memoryCount: memInfo.memoryCount,
        memoryDir: memInfo.memoryDir,
        ui: g.view?.ui || g.parsed?.ui || null,
        visible: g.view?.visible || null,
        vitals: g.view ? { health: g.view.health, needs: g.view.needs, location: g.view.location } : null,
        consistency: g.view?.consistency || null,
        screenPreview: g.capture?.ok ? (g.capture.text.split('\n').filter(Boolean).slice(-8).join('\n')) : '',
        save: saveSummary,
      },
      sessions: {
        game: { name: g.screen, running: gameRunning },
        log: { name: g.logScreen, running: logRunning },
      },
      attach: {
        game: `screen -x ${g.screen}`,
        log: `screen -x ${g.logScreen}`,
        list: 'screen -ls',
      },
      activity: readActivity(stateDir, 20),
      lastRound: readRounds(stateDir, 1)[0] || null,
      paths: attachPaths(),
      busy: Boolean(roundChild),
      recording,
      recordings,
      recordDir: recDir,
      recorderReady: recorderReady(),
      logTail: tailFile(p.logFile, 40),
    }
  }

  try {
    // 关键：不能在 apply 里直接 ctx.get('webServer') —— 启动时服务可能还没就绪，
    // 那样路由会被静默跳过，表现就是设置页能开、所有 /api/cdda-duty/* 都 404。
    // 用 ctx.inject 等 webServer 服务可用后再注册（服务替换时 effect 会重挂）。
    ctx.inject(['webServer'], (webCtx) => {
      const webServer = webCtx.webServer || webCtx.get('webServer')
      if (!webServer?.register) {
        log('webServer 服务没有 register；HTTP API 不挂载（设置页会报 404）')
        return
      }
      log('webServer 就绪，挂载 /api/cdda-duty')
      webCtx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/api/cdda-duty',
        handler: async (req, res) => {
          if (fenceReject(req, res)) return
          if (!sameOriginOk(req)) { sendJson(res, 403, { ok: false, error: '只接受本机同源请求' }); return }
          const url = new URL(req.url, 'http://127.0.0.1')
          const path = url.pathname
          try {
            if (req.method === 'GET' && path === '/api/cdda-duty/status') {
              return sendJson(res, 200, await statusPayload())
            }
            if (req.method === 'GET' && path === '/api/cdda-duty/screen') {
              const cap = await capture(cfg, String(cfg.screenGame || 'cdda'), { stateDir })
              return sendJson(res, 200, cap.ok ? { ok: true, ...cap } : { ok: false, error: cap.error })
            }
            if (req.method === 'GET' && path === '/api/cdda-duty/log') {
              return sendJson(res, 200, { ok: true, tail: tailFile(p.logFile, 120) })
            }
            if (req.method === 'GET' && path === '/api/cdda-duty/decisions') {
              return sendJson(res, 200, { ok: true, decisions: readDecisions(stateDir, 20) })
            }
            if (req.method === 'GET' && path === '/api/cdda-duty/rounds') {
              return sendJson(res, 200, { ok: true, rounds: readRounds(stateDir, 20) })
            }
            if (req.method === 'GET' && path === '/api/cdda-duty/recordings') {
              return sendJson(res, 200, {
                ok: true,
                recording: recorder.status(),
                recordings: readRecordings(stateDir, 50).map((r) => ({
                  ...r,
                  videoName: basename(String(r.video || '')),
                  srtName: basename(String(r.srt || '')),
                  exists: Boolean(r.video && existsSync(r.video)),
                })),
                recordDir: recordDirOf(stateDir, cfg),
              })
            }
            if (req.method === 'GET' && path === '/api/cdda-duty/recording/file') {
              const name = String(url.searchParams.get('name') || '')
              const ext = extname(name).toLowerCase()
              const dir = resolve(recordDirOf(stateDir, cfg))
              const full = resolve(dir, name)
              if (!name || basename(name) !== name || !['.mp4', '.srt'].includes(ext) || !full.startsWith(dir + sep)) {
                return sendJson(res, 400, { ok: false, error: '文件名不合法' })
              }
              let st
              try { st = statSync(full) } catch { return sendJson(res, 404, { ok: false, error: '文件不存在' }) }
              if (!st.isFile()) return sendJson(res, 404, { ok: false, error: '不是文件' })
              const type = ext === '.mp4' ? 'video/mp4' : 'application/x-subrip; charset=utf-8'
              res.setHeader('content-type', type)
              res.setHeader('accept-ranges', 'bytes')
              res.setHeader('cache-control', 'no-store')
              res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(name)}"`)
              const range = String(req.headers.range || '')
              const m = range.match(/^bytes=(\d*)-(\d*)$/)
              if (m) {
                const start = m[1] ? Number(m[1]) : 0
                const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1
                if (!Number.isFinite(start) || start < 0 || start > end) {
                  res.statusCode = 416
                  res.setHeader('content-range', `bytes */${st.size}`)
                  return res.end()
                }
                res.statusCode = 206
                res.setHeader('content-range', `bytes ${start}-${end}/${st.size}`)
                res.setHeader('content-length', String(end - start + 1))
                createReadStream(full, { start, end }).on('error', () => { try { res.end() } catch { /* 忽略 */ } }).pipe(res)
                return
              }
              res.statusCode = 200
              res.setHeader('content-length', String(st.size))
              createReadStream(full).on('error', () => { try { res.end() } catch { /* 忽略 */ } }).pipe(res)
              return
            }
            if (req.method === 'POST' && path === '/api/cdda-duty/record') {
              const body = await readBody(req)
              const on = Boolean(body.on)
              if (body.fps !== undefined && Number.isFinite(Number(body.fps))) {
                await persistCfg({ recordFps: Number(body.fps) })
              }
              await persistCfg({ recordVideo: on })
              let r
              if (on) {
                const g = await inspectGame(cfg, stateDir)
                if (!g.running || g.mode !== 'gameplay') {
                  const started = await startGame(cfg, stateDir, pluginDir, { log })
                  if (!started.ok) {
                    await persistCfg({ recordVideo: false })
                    return sendJson(res, 200, { ok: false, error: started.error || '游戏没开，录制没开始', recording: recorder.status() })
                  }
                }
                r = await recorder.start(cfg)
                if (!r.ok) await persistCfg({ recordVideo: false })
              } else {
                r = await recorder.stop('switch-off')
                if (!r.ok && r.error) r = { ok: true, active: false, note: r.error }
              }
              return sendJson(res, 200, {
                ok: Boolean(r.ok),
                error: r.error,
                recording: recorder.status(),
                recordings: readRecordings(stateDir, 50).map((x) => ({ ...x, videoName: basename(String(x.video || '')), srtName: basename(String(x.srt || '')) })),
                recordDir: recordDirOf(stateDir, cfg),
              })
            }
            if (req.method === 'POST' && path === '/api/cdda-duty/config') {
              const body = await readBody(req)
              const patch = body.patch && typeof body.patch === 'object' ? body.patch : body
              const host = await persistCfg(patch)
              if ('recordVideo' in (patch || {})) {
                if (cfg.recordVideo) {
                  const g = await inspectGame(cfg, stateDir)
                  if (g.running && g.mode === 'gameplay') await recorder.start(cfg)
                } else {
                  await recorder.stop('switch-off')
                }
              }
              return sendJson(res, 200, { ...host, ok: true, config: cfg })
            }
            if (req.method === 'POST' && path === '/api/cdda-duty/start') {
              const body = await readBody(req)
              if (body.goal) updateGoal(body.goal)
              const r = await startGame(cfg, stateDir, pluginDir, { world: body.world, log })
              recordEvent(stateDir, r.ok ? 'start' : 'start_failed', r.ok ? '设置页启动了游戏' : (r.error || '启动失败'))
              try {
                const g2 = await inspectGame(cfg, stateDir)
                writeStatus(stateDir, { running: Boolean(g2.capture?.ok), mode: g2.capture?.ok ? g2.mode : 'not_running', goal: cfg.goal })
              } catch { /* 忽略 */ }
              if (r.ok) { try { await recorder.ensure(cfg) } catch { /* 忽略 */ } }
              return sendJson(res, 200, { ...(await statusPayload()), ...r })
            }
            if (req.method === 'POST' && path === '/api/cdda-duty/stop') {
              const body = await readBody(req)
              const r = await stopGame(cfg, stateDir, { save: body.save !== false, log })
              await persistCfg({ autoplay: false })
              try { await recorder.stop('game-stop') } catch { /* 忽略 */ }
              recordEvent(stateDir, 'stop', r.ok ? '设置页停止了游戏' : '停止失败')
              return sendJson(res, 200, { ...r, ok: Boolean(r.ok) })
            }
            if (req.method === 'POST' && path === '/api/cdda-duty/round') {
              const r = await runRound('manual')
              return sendJson(res, 200, { ...r, ok: Boolean(r.ok) })
            }
            if (req.method === 'POST' && path === '/api/cdda-duty/autoplay') {
              const body = await readBody(req)
              const on = Boolean(body.on)
              await persistCfg({ autoplay: on })
              if (on) setTimeout(() => tick('api-on'), 300)
              else stopRound('api-off')
              return sendJson(res, 200, { ok: true, autoplay: on })
            }
            if (req.method === 'POST' && path === '/api/cdda-duty/note') {
              const body = await readBody(req)
              if (body.note) recordNote(stateDir, String(body.note), { source: 'ui' })
              return sendJson(res, 200, { ok: true })
            }
            return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
          } catch (e) {
            log(`HTTP 处理失败：${String(e?.stack ?? e)}`)
            return sendJson(res, 500, { ok: false, error: String(e?.message ?? e) })
          }
        },
      }), 'cdda-duty: /api/cdda-duty 路由')
    })
  } catch (e) {
    log(`HTTP 路由没挂上：${String(e?.message ?? e)}`)
  }

  // 初始化 status（别把已有的覆盖掉，只补字段）
  try {
    writeStatus(stateDir, { running: Boolean(readStatus(stateDir).running) })
  } catch { /* 忽略 */ }

  try { if (!existsSync(p.cfgFile)) saveCfgToDisk(stateDir, cfg, [...touched]) } catch { /* 忽略 */ }
  if (dutyProfileState === 'unknown') {
    try { ensureDutyProfile() } catch { /* 已记录 */ }
  }
  log(`挂载完成：profile=${cfg.dutyProfile}（${dutyProfileState}），autoplay=${cfg.autoplay ? '开' : '关'}，screen=${cfg.screenGame}/${cfg.screenLog}`)
}
