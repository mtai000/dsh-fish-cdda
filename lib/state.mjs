/**
 * lib/state.mjs —— 插件自己的“家”、配置、活动日志、状态快照
 * ============================================================================
 * 规矩和刷B站插件一致：配置 / 存档 / 日志 / 临时抓屏全部放
 * `$DSH_HOME/cdda-duty/`，绝不写进插件包目录（装进 node_modules 后可能只读、
 * 升级也会被覆盖）。
 *
 * 家里长这样：
 *   config.json       插件自己的配置（设置页也会同步写 DSH 原生设置）
 *   runtime.json      今日动作数 / 回合数等计数器
 *   status.json       给 cdda_log 日志屏和设置页看的当前状态
 *   activity.jsonl    每一步做了什么（append-only，日志屏读它）
 *   cdda.log          host 侧的运行日志
 *   round.json        当前自动玩回合（id / 动作预算 / 起点）
 *   play-session.json 自动玩续用的 headless 会话 id
 *   game/             CDDA 的 --userdir（save / config 都在里面）
 *   screens/          抓屏临时文件
 *   runs/             每一轮 headless 的 stdout/stderr
 *   duty.md           值班章程（用户可改；第一次从插件里铺过来）
 * ============================================================================
 */
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync,
  readdirSync, renameSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const DEFAULT_CFG = {
  /** 总开关（目前只影响自动玩；工具始终可用） */
  enabled: true,
  /** 它这一局的目标；会内联进自动玩提示词、显示在日志屏 */
  goal: 'survive 3 days：先解决水、食物和安全住处，再考虑探索；不要主动送死。',
  /** 自动玩（host 定时起 headless 回合） */
  autoplay: false,
  /** 每一轮最多做几个动作（一次 cdda_send 算一个动作） */
  actionsPerRound: 40,
  /** 每天最多自动跑几轮（0 = 不限制） */
  maxRoundsPerDay: 24,
  /** 两轮之间歇多久（秒） */
  roundGapSec: 20,
  /** 单轮最长多久（秒），到点强制结束 */
  maxRoundSeconds: 900,
  /** 自动玩开跑前，游戏没开就自动开 */
  autoStartGame: true,
  /** 角色死了之后自动重开（默认关：先让你看一眼死亡画面） */
  restartOnDeath: false,
  /** CDDA 可执行文件；留空自动找 */
  cddaPath: '',
  /** CDDA 的 --userdir；留空 = <家>/game */
  userDir: '',
  /** 世界名；留空 = 最近有存档的那个 */
  world: '',
  /** 游戏终端所在的 screen 会话名 */
  screenGame: 'cdda',
  /** 战报终端所在的 screen 会话名 */
  screenLog: 'cdda_log',
  /** 是否自动开 cdda_log */
  logScreen: true,
  /** screen 可执行文件；留空自动找 */
  screenBin: '',
  /** screen 的 socket 目录；留空用系统默认（/run/screen） */
  screenDir: '',
  /** dsh CLI 的 bin.js；留空自动找 */
  dshBin: '',
  /** 自动玩用的 profile（插件会铺一份到 $DSH_HOME/profiles/cdda-duty） */
  dutyProfile: 'cdda-duty',
  /** 第一次开新家时，把内置的世界存档铺进去（开箱即玩） */
  starterWorld: false,
  /** 自动玩时给模型选哪个 provider/model；留空跟随当前设置 */
  modelProvider: '',
  model: '',
  /** 录制游玩视频（mp4），同时生成同名 .srt 外挂字幕 */
  recordVideo: false,
  /** 录制帧率（1-10）；屏幕是文本，2 帧/秒就够 */
  recordFps: 2,
  /** 录制文件放哪；留空 = <家>/recordings */
  recordDir: '',
  /** drawtext 用的字体文件；留空自动找等宽字体 */
  recordFont: '',
  /** ffmpeg 可执行文件；留空自动找 */
  ffmpegPath: '',
  /** 单次录制最长多少分钟，到点自动停（防止自动玩开一整天把盘写满） */
  recordMaxMinutes: 120,
  /** 自动玩每轮按当前状态注入 CDDAi 知识库章节 */
  knowledge: true,
  /** 身份文件（fish-kin 的 identity.json）；留空=shared 共用记忆 */
  identityFile: '',
  /** 注入自己的经验 */
  memory: true,
  memoryMaxItems: 10,
  memoryMaxChars: 4000,
  /** 注入知识的上限字符数（约 4 字符/token） */
  knowledgeMaxChars: 12000,
  /** 连续卡在同一画面时自动发一次 Esc（只兜底，不跟模型抢键盘） */
  autoUnstick: true,
  /** 游戏崩溃/消失时自动重开（只在自动玩开着时） */
  restartOnCrash: true,
  /** 每天最多自动重开几次 */
  maxRestartsPerDay: 5,
}

export const NUMBER_FIELDS = {
  actionsPerRound: [5, 500],
  maxRoundsPerDay: [0, 200],
  roundGapSec: [5, 3600],
  maxRoundSeconds: [60, 7200],
  recordFps: [1, 10],
  recordMaxMinutes: [1, 600],
  knowledgeMaxChars: [2000, 30000],
  memoryMaxItems: [1, 50],
  memoryMaxChars: [200, 30000],
  maxRestartsPerDay: [0, 50],
}

export const BOOL_FIELDS = [
  'enabled', 'autoplay', 'autoStartGame', 'restartOnDeath', 'logScreen', 'starterWorld', 'recordVideo', 'knowledge', 'memory', 'autoUnstick', 'restartOnCrash',
]

export const STRING_FIELDS = [
  'goal', 'cddaPath', 'userDir', 'world', 'screenGame', 'screenLog',
  'screenBin', 'screenDir', 'dshBin', 'dutyProfile', 'modelProvider', 'model',
  'recordDir', 'recordFont', 'ffmpegPath',
]

export function clampCfg(patch, base = DEFAULT_CFG) {
  const out = { ...DEFAULT_CFG }
  const take = (src) => {
    if (!src || typeof src !== 'object') return
    for (const [k, v] of Object.entries(src)) {
      if (!(k in DEFAULT_CFG) || k === '_set') continue
      const c = coerceField(k, v)
      if (c.ok) out[k] = c.value
    }
  }
  take(base)
  take(patch)
  return out
}

function coerceField(k, v) {
  // 设置服务有时会把字段包成对象 / 传 schema 默认值；只认正确类型的标量。
  if (typeof v === 'string' && (v.trim() === '[object Object]' || v.trim() === 'undefined')) return { ok: false }
  if (k === 'goal') return typeof v === 'string' ? { ok: true, value: v.slice(0, 4000) } : { ok: false }
  if (BOOL_FIELDS.includes(k)) return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false }
  if (Object.prototype.hasOwnProperty.call(NUMBER_FIELDS, k)) {
    const [lo, hi] = NUMBER_FIELDS[k]
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
    if (!Number.isFinite(n)) return { ok: false }
    return { ok: true, value: Math.max(lo, Math.min(hi, Math.round(n))) }
  }
  if (STRING_FIELDS.includes(k)) {
    return typeof v === 'string' ? { ok: true, value: v.trim().slice(0, 1024) } : { ok: false }
  }
  return { ok: false }
}

/** 插件家：$DSH_HOME/cdda-duty（优先问宿主要 dshHomePath） */
export function stateDirOf(ctx) {
  let dir = ''
  try {
    const p = ctx?.get?.('dshHomePath')
    if (typeof p === 'function') {
      const v = p('cdda-duty')
      if (v) dir = String(v)
    } else if (typeof p === 'string' && p) {
      dir = join(p, 'cdda-duty')
    }
  } catch { /* 兜底 */ }
  if (!dir) dir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'cdda-duty')
  // 兜底：哪怕 DSH_HOME 被误设成插件目录，也绝不把存档/日志写进插件包
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const abs = resolve(dir)
  if (abs === pluginRoot || abs.startsWith(pluginRoot + sep)) {
    dir = join(homedir(), '.dsh', 'cdda-duty')
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

export function pathsOf(stateDir) {
  const gameDir = join(stateDir, 'game')
  return {
    home: stateDir,
    cfgFile: join(stateDir, 'config.json'),
    runtimeFile: join(stateDir, 'runtime.json'),
    statusFile: join(stateDir, 'status.json'),
    activityFile: join(stateDir, 'activity.jsonl'),
    logFile: join(stateDir, 'cdda.log'),
    roundFile: join(stateDir, 'round.json'),
    sessionFile: join(stateDir, 'play-session.json'),
    lockFile: join(stateDir, 'round-lock.json'),
    overlayFile: join(stateDir, 'headless-overlay.yml'),
    gameDir,
    saveDir: join(gameDir, 'save'),
    configDir: join(gameDir, 'config'),
    screensDir: join(stateDir, 'screens'),
    runsDir: join(stateDir, 'runs'),
    dutyFile: join(stateDir, 'duty.md'),
    knowledgeDir: join(stateDir, 'knowledge'),
    memoryRoot: join(stateDir, 'memory'),
    goalFile: join(stateDir, 'goal.json'),
    decisionsFile: join(stateDir, 'decisions.jsonl'),
    roundsIndex: join(stateDir, 'rounds.json'),
    recordingsDir: join(stateDir, 'recordings'),
    recordingFile: join(stateDir, 'recording.json'),
    recordingsIndex: join(stateDir, 'recordings.json'),
  }
}

export function ensureDirs(p) {
  for (const d of [p.home, p.gameDir, p.saveDir, p.configDir, p.screensDir, p.runsDir, p.recordingsDir]) {
    try { mkdirSync(d, { recursive: true }) } catch { /* 目录建不了让调用方报 */ }
  }
}

export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export function writeJson(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, file)
    return true
  } catch {
    // 原子写失败（跨盘 / 权限 / 杀软锁）时退回直接写；再失败就算了
    try { writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); return true } catch { return false }
  }
}

export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function timeText(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function nowIso() { return new Date().toISOString() }

/** 读 config.json（含 _set）；给 host 的 loadCfg 用 */
export function readSavedCfg(stateDir) {
  const raw = readJson(pathsOf(stateDir).cfgFile, {})
  return raw && typeof raw === 'object' ? raw : {}
}

/** 没有 ctx 的时候（MCP / selfcheck）用：默认值 + config.json */
export function loadCfgFromDisk(stateDir, base = {}) {
  const raw = readSavedCfg(stateDir)
  return clampCfg({ ...raw, ...base }, DEFAULT_CFG)
}

export function saveCfgToDisk(stateDir, cfg, touched) {
  const clean = clampCfg(cfg)
  const old = readSavedCfg(stateDir)
  const set = Array.isArray(touched) ? touched : (Array.isArray(old._set) ? old._set : [])
  return writeJson(pathsOf(stateDir).cfgFile, { ...clean, _set: [...new Set(set)] })
}

/** 追加一行 cdda.log（插件内部任何写日志的地方都不许抛） */
export function logLine(stateDir, text) {
  try {
    const p = pathsOf(stateDir)
    mkdirSync(p.home, { recursive: true })
    // 日志别无声地长：> 2MB 就滚一次
    try {
      if (existsSync(p.logFile) && statSync(p.logFile).size > 2 * 1024 * 1024) {
        renameSync(p.logFile, p.logFile + '.1')
      }
    } catch { /* 滚不动就继续写 */ }
    appendFileSync(p.logFile, `[${new Date().toISOString()}] ${String(text).replace(/\s+$/, '')}\n`, 'utf8')
  } catch { /* 绝不能抛 */ }
}

export function tailFile(file, maxLines = 80, maxBytes = 128 * 1024) {
  try {
    const st = statSync(file)
    const start = Math.max(0, st.size - maxBytes)
    const buf = readFileSync(file)
    const text = buf.subarray(start).toString('utf8')
    return text.split(/\r?\n/).slice(-maxLines).join('\n')
  } catch { return '' }
}

export function readActivity(stateDir, limit = 40) {
  const p = pathsOf(stateDir)
  try {
    const raw = readFileSync(p.activityFile, 'utf8')
    const lines = raw.split(/\r?\n/).filter(Boolean)
    const out = []
    for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
      try { out.push(JSON.parse(lines[i])) } catch { /* 跳过坏行 */ }
    }
    return out
  } catch { return [] }
}

export function appendActivity(stateDir, event) {
  try {
    const p = pathsOf(stateDir)
    mkdirSync(p.home, { recursive: true })
    try {
      if (existsSync(p.activityFile) && statSync(p.activityFile).size > 4 * 1024 * 1024) {
        renameSync(p.activityFile, p.activityFile + '.1')
      }
    } catch { /* 滚不动就继续写 */ }
    const e = { ts: nowIso(), ...event }
    appendFileSync(p.activityFile, JSON.stringify(e) + '\n', 'utf8')
    return e
  } catch { return null }
}

/** 结构化决策日志（比 activity 更适合复盘/统计） */
export function appendDecision(stateDir, decision) {
  try {
    const p = pathsOf(stateDir)
    mkdirSync(p.home, { recursive: true })
    try {
      if (existsSync(p.decisionsFile) && statSync(p.decisionsFile).size > 4 * 1024 * 1024) {
        renameSync(p.decisionsFile, p.decisionsFile + '.1')
      }
    } catch { /* 滚不动继续写 */ }
    appendFileSync(p.decisionsFile, JSON.stringify({ ts: nowIso(), ...decision }) + '\n', 'utf8')
  } catch { /* 忽略 */ }
}

export function readDecisions(stateDir, limit = 20) {
  try {
    const raw = readFileSync(pathsOf(stateDir).decisionsFile, 'utf8')
    return raw.split(/\r?\n/).filter(Boolean).slice(-limit).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

export function readRounds(stateDir, limit = 20) {
  const list = readJson(pathsOf(stateDir).roundsIndex, [])
  return Array.isArray(list) ? list.slice(0, limit) : []
}

export function readStatus(stateDir) {
  const p = pathsOf(stateDir)
  return readJson(p.statusFile, {
    running: false,
    mode: 'unknown',
    updatedAt: '',
    actionsToday: 0,
    actionsThisRound: 0,
    round: null,
    lastAction: null,
    lastNote: null,
    state: null,
  })
}

export function writeStatus(stateDir, patch) {
  const p = pathsOf(stateDir)
  const prev = readStatus(stateDir)
  const next = { ...prev, ...(patch || {}), updatedAt: nowIso() }
  writeJson(p.statusFile, next)
  return next
}

export function readRuntime(stateDir) {
  const p = pathsOf(stateDir)
  const today = dayKey()
  const st = readJson(p.runtimeFile, {})
  if (st.day !== today) {
    const fresh = { day: today, actionsToday: 0, roundsToday: 0, restartsToday: 0, totalActions: Number(st.totalActions || 0), lastActionAt: 0 }
    writeJson(p.runtimeFile, fresh)
    return fresh
  }
  return { totalActions: 0, actionsToday: 0, roundsToday: 0, restartsToday: 0, ...st }
}

export function bumpRuntime(stateDir, patch) {
  const p = pathsOf(stateDir)
  const st = readRuntime(stateDir)
  const next = { ...st, ...(patch || {}) }
  writeJson(p.runtimeFile, next)
  return next
}

export function readRound(stateDir) {
  return readJson(pathsOf(stateDir).roundFile, null)
}

export function writeRound(stateDir, round) {
  const p = pathsOf(stateDir)
  if (round == null) {
    writeJson(p.roundFile, { endedAt: nowIso(), active: false })
    return null
  }
  writeJson(p.roundFile, round)
  return round
}

/** 记一次游戏动作（cdda_send）：更新今日/本回合计数 + 活动流 + status */
export function recordAction(stateDir, { keys = '', note = '', mode = '', source = 'chat', extra = {} } = {}) {
  const rt = readRuntime(stateDir)
  const round = readRound(stateDir)
  const active = Boolean(round && round.active)
  const nextRt = bumpRuntime(stateDir, {
    actionsToday: Number(rt.actionsToday || 0) + 1,
    totalActions: Number(rt.totalActions || 0) + 1,
    lastActionAt: Date.now(),
  })
  const actionsThisRound = active ? Number(round.actions || 0) + 1 : 0
  if (active) writeRound(stateDir, { ...round, actions: actionsThisRound, lastActionAt: nowIso() })
  const at = nowIso()
  appendActivity(stateDir, { kind: 'action', keys: String(keys).slice(0, 120), note: String(note || '').slice(0, 1000), mode, source, ...extra })
  writeStatus(stateDir, {
    running: true,
    mode,
    lastAction: { keys: String(keys).slice(0, 120), note: String(note || '').slice(0, 1000), at, mode, source },
    actionsToday: nextRt.actionsToday,
    actionsThisRound,
  })
  return { actionsToday: nextRt.actionsToday, actionsThisRound, roundActive: active, actionsLimit: active ? Number(round.actionsLimit || 0) : 0 }
}

export function recordNote(stateDir, text, { source = 'chat', mode = '' } = {}) {
  const at = nowIso()
  appendActivity(stateDir, { kind: 'note', note: String(text || '').slice(0, 2000), mode, source })
  writeStatus(stateDir, { lastNote: { text: String(text || '').slice(0, 2000), at, source }, ...(mode ? { mode } : {}) })
}

export function recordEvent(stateDir, kind, text, extra = {}) {
  appendActivity(stateDir, { kind, text: String(text || '').slice(0, 2000), ...extra })
  logLine(stateDir, `[${kind}] ${text}`)
}

/** 把 prompts/duty.md 铺到家里（用户改过就保留） */
export function ensureDutyFile(pluginDir, stateDir) {
  const p = pathsOf(stateDir)
  try {
    if (existsSync(p.dutyFile)) return p.dutyFile
    const src = join(pluginDir, 'prompts', 'duty.md')
    if (existsSync(src)) {
      mkdirSync(p.home, { recursive: true })
      copyFileSync(src, p.dutyFile)
    }
    return existsSync(p.dutyFile) ? p.dutyFile : src
  } catch { return join(pluginDir, 'prompts', 'duty.md') }
}

/** 可选外部 starter world 的世界名（<家>/starter-world/save） */
export function starterWorldNames(stateDir) {
  const base = join(stateDir, 'starter-world', 'save')
  try {
    return readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch { return [] }
}
