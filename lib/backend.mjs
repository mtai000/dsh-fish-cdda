/**
 * lib/backend.mjs —— 终端复用器的后端层（screen / tmux）
 * ============================================================================
 * 插件只通过这一层跟复用器打交道，别处不许再出现 `screen -x` 这类字符串。
 *
 * 约定：
 *   · `cfg.terminal` = 'auto' | 'screen' | 'tmux'（默认 auto）
 *   · auto：同名会话在哪个后端活着就用哪个；都没有则优先 tmux，没装 tmux 用 screen
 *   · 对上层暴露同一组原语：create / send / capture / has / list / kill
 *   · 给用户看的命令一律走 attachCommand() / listCommand()，这样 UI、工具、日志
 *     只有一个来源，换后端不会再漏改。
 *
 * 两个后端的差异（照抄会踩的坑）：
 *   · 建会话：screen `-dmS NAME cmd…`；tmux `new-session -d -s NAME -x 120 -y 42 cmd…`
 *     tmux 不指定 -x/-y 就是 80×24，CDDA 的布局会跟着变。
 *   · 送键：screen `-X stuff <bytes>`；tmux 必须 `send-keys -l --`（不加 -l 会把
 *     `C-c` 之类当键名解释）。控制字节用 argv 直接传，不能过 shell。
 *   · 抓屏：screen 只能 `-X hardcopy <file>` 落盘再洗；tmux `capture-pane -p -J`
 *     直接给文本，回滚用 `-S -<n>`。
 *   · 存在性：screen 解析 `-ls` 文本；tmux `has-session -t =NAME` 看退出码。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import {
  accessSync, existsSync, mkdirSync, readFileSync, rmSync, constants as fsConstants,
} from 'node:fs'
import { join } from 'node:path'
import { cleanScreen, detectMode } from './parse.mjs'

const DEFAULT_TIMEOUT = 12_000
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 42

/* ───────────────────────── 二进制发现 ───────────────────────── */

function firstExecutable(candidates) {
  for (const p of candidates) {
    if (!p) continue
    try { accessSync(p, fsConstants.X_OK); return p } catch { /* 下一个 */ }
  }
  return ''
}

function fromPath(names) {
  const dirs = String(process.env.PATH || '').split(':').filter(Boolean)
  return dirs.flatMap((d) => names.map((n) => join(d, n)))
}

export function screenBin(cfg = {}) {
  const explicit = String(cfg.screenBin || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  // 顺序要紧：macOS 自带的是 4.00.03（`--version` 还返回 1），homebrew 的才是 5.x
  const found = firstExecutable([
    process.env.SCREEN_BIN,
    '/opt/homebrew/bin/screen',
    '/usr/local/bin/screen',
    '/usr/bin/screen',
    '/bin/screen',
    ...fromPath(['screen']),
  ])
  return found || 'screen'
}

export function tmuxBin(cfg = {}) {
  const explicit = String(cfg.tmuxBin || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  return firstExecutable([
    process.env.TMUX_BIN,
    '/opt/homebrew/bin/tmux',
    '/usr/local/bin/tmux',
    '/usr/bin/tmux',
    '/bin/tmux',
    ...fromPath(['tmux']),
  ])
}

/* ───────────────────────── 配置 / 命令文本 ───────────────────────── */

/** 静态偏好：显式配置优先；auto 时看装了哪个（不看会话） */
export function backendName(cfg = {}) {
  const want = String(cfg.terminal || 'auto').trim().toLowerCase()
  if (want === 'screen' || want === 'tmux') return want
  return tmuxBin(cfg) ? 'tmux' : 'screen'
}

export function attachCommand(cfg, name) {
  const n = String(name || '').trim()
  if (!n) return ''
  return backendName(cfg) === 'tmux' ? `tmux attach -t ${n}` : `screen -x ${n}`
}

/** 给 spawn 用的 argv（注意：这是“打开终端后要执行的命令”，已含可执行文件） */
export function attachArgv(cfg, name) {
  const n = String(name || '').trim()
  if (!n) return []
  return backendName(cfg) === 'tmux'
    ? [tmuxBin(cfg) || 'tmux', 'attach', '-t', n]
    : [screenBin(cfg) || 'screen', '-x', n]
}

export function listCommand(cfg) {
  return backendName(cfg) === 'tmux' ? 'tmux ls' : 'screen -ls'
}

/* ───────────────────────── 跑一条命令 ───────────────────────── */

function runBin(bin, args, { timeout = DEFAULT_TIMEOUT, env = {} } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, args, {
        env: { ...baseEnv(), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e?.message ?? e), error: e })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, error })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 忽略 */ }
      finish(-1, new Error(`${bin} 命令超时`))
    }, Math.max(1000, timeout))
    timer.unref?.()
    child.stdout?.on('data', (b) => { stdout += b.toString('utf8') })
    child.stderr?.on('data', (b) => { stderr += b.toString('utf8') })
    child.on('error', (e) => finish(-1, e))
    child.on('close', (code) => finish(code ?? -1))
  })
}

function baseEnv() {
  return {
    ...process.env,
    TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  }
}

function screenEnv(cfg = {}) {
  const env = baseEnv()
  if (cfg.screenDir) env.SCREENDIR = String(cfg.screenDir)
  return env
}

/* ───────────────────────── screen 后端 ───────────────────────── */

async function screenList(cfg) {
  const out = new Map()
  const r = await runBin(screenBin(cfg), ['-ls'], { timeout: 5000, env: screenEnv(cfg) })
  const text = `${r.stdout}\n${r.stderr}`
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\.(\S+)\s+\((.*?)\)\s*$/)
    if (m) out.set(m[2], { pid: Number(m[1]), state: m[3] })
  }
  return out
}

async function screenHas(cfg, name) {
  if (!name) return false
  return (await screenList(cfg)).has(name)
}

async function screenCreate(cfg, name, command, { env = {}, waitMs = 2500 } = {}) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (await screenHas(cfg, name)) return { ok: true, existed: true }
  const r = await runBin(screenBin(cfg), ['-dmS', name, ...command],
    { timeout: 8000, env: { ...screenEnv(cfg), ...env } })
  if (r.code !== 0) {
    return { ok: false, error: `screen 起不来（exit ${r.code}）：${(r.stderr || r.stdout || '').trim().slice(0, 500)}` }
  }
  const until = Date.now() + Math.max(300, waitMs)
  while (Date.now() < until) {
    if (await screenHas(cfg, name)) return { ok: true }
    await new Promise((res) => setTimeout(res, 100))
  }
  return { ok: false, error: 'screen 会话创建后立刻消失了（命令自身失败？）' }
}

async function screenQuit(cfg, name) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (!(await screenHas(cfg, name))) return { ok: true, missing: true }
  const r = await runBin(screenBin(cfg), ['-S', name, '-X', 'quit'], { timeout: 5000, env: screenEnv(cfg) })
  return { ok: r.code === 0, error: r.code === 0 ? '' : (r.stderr || r.stdout).trim() }
}

async function screenStuff(cfg, name, data) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (!data) return { ok: true, empty: true }
  if (!(await screenHas(cfg, name))) return { ok: false, error: `screen 会话 ${name} 不存在` }
  const r = await runBin(screenBin(cfg), ['-S', name, '-p', '0', '-X', 'stuff', data],
    { timeout: 5000, env: screenEnv(cfg) })
  return { ok: r.code === 0, error: r.code === 0 ? '' : (r.stderr || r.stdout).trim().slice(0, 500) }
}

async function screenCapture(cfg, name, { stateDir } = {}) {
  const dir = stateDir ? join(stateDir, 'screens') : join(process.env.DSH_HOME || process.cwd(), 'cdda-duty', 'screens')
  try { mkdirSync(dir, { recursive: true }) } catch { /* 用默认目录 */ }
  const file = join(dir, `${sanitize(name)}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.txt`)
  let raw = ''
  let lastErr = ''
  const env = screenEnv(cfg)
  // detached screen 第一帧偶尔是空的（刚 stuff 完 / 刚启动）⇒ 最多抓两次
  for (let attempt = 0; attempt < 2; attempt++) {
    await runBin(screenBin(cfg), ['-S', name, '-p', '0', '-X', 'redisplay'], { timeout: 4000, env })
    await new Promise((r) => setTimeout(r, 80 + attempt * 150))
    try { rmSync(file, { force: true }) } catch { /* 忽略 */ }
    const r = await runBin(screenBin(cfg), ['-S', name, '-p', '0', '-X', 'hardcopy', file], { timeout: 6000, env })
    try { if (existsSync(file)) raw = readFileSync(file, 'utf8') } catch { /* 读不到当空 */ }
    try { rmSync(file, { force: true }) } catch { /* 忽略 */ }
    if (raw && cleanScreen(raw).trim()) break
    lastErr = `hardcopy 没拿到内容（exit ${r.code}）：${(r.stderr || r.stdout || '').trim().slice(0, 300)}`
  }
  return raw ? { ok: true, raw } : { ok: false, error: lastErr || 'hardcopy 没拿到内容' }
}

/* ───────────────────────── tmux 后端 ───────────────────────── */

function tmuxArgs(cfg) {
  return tmuxBin(cfg) || 'tmux'
}

/**
 * 会话目标：`=name` 精确匹配，避免前缀撞名（tmux 默认按前缀匹配）。
 * 面板目标（capture-pane / send-keys）要在会话后面加冒号，`=name` 单独用
 * 会报 "can't find pane"（3.7c 实测）。
 */
function sessionTarget(name) {
  return `=${name}`
}

function paneTarget(name) {
  return `=${name}:`
}

function isMissingServer(text) {
  return /no server running|no sessions|can't find session|session not found/i.test(String(text || ''))
}

async function tmuxList(cfg) {
  const out = new Map()
  const r = await runBin(tmuxArgs(cfg),
    ['list-sessions', '-F', '#{session_name}\t#{pid}\t#{session_attached}'], { timeout: 5000 })
  if (r.code !== 0) {
    if (!isMissingServer(r.stderr || r.stdout)) {
      // 服务在但列不出来：交给上层当空处理，错误写进 state 里也无从消化
    }
    return out
  }
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const [name, pid, attached] = line.split('\t')
    if (!name) continue
    out.set(name, { pid: Number(pid) || 0, state: attached === '1' ? 'attached' : 'detached' })
  }
  return out
}

async function tmuxHas(cfg, name) {
  if (!name) return false
  const r = await runBin(tmuxArgs(cfg), ['has-session', '-t', sessionTarget(name)], { timeout: 5000 })
  return r.code === 0
}

async function tmuxCreate(cfg, name, command, { env = {}, waitMs = 2500 } = {}) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (await tmuxHas(cfg, name)) return { ok: true, existed: true }
  const cols = Number(cfg.paneCols) > 0 ? Number(cfg.paneCols) : DEFAULT_COLS
  const rows = Number(cfg.paneRows) > 0 ? Number(cfg.paneRows) : DEFAULT_ROWS
  const args = ['new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows), ...command]
  const r = await runBin(tmuxArgs(cfg), args, { timeout: 8000, env: { ...baseEnv(), ...env } })
  if (r.code !== 0) {
    return { ok: false, error: `tmux 起不来（exit ${r.code}）：${(r.stderr || r.stdout || '').trim().slice(0, 500)}` }
  }
  const until = Date.now() + Math.max(300, waitMs)
  while (Date.now() < until) {
    if (await tmuxHas(cfg, name)) return { ok: true }
    await new Promise((res) => setTimeout(res, 100))
  }
  return { ok: false, error: 'tmux 会话创建后立刻消失了（命令自身失败？）' }
}

async function tmuxQuit(cfg, name) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (!(await tmuxHas(cfg, name))) return { ok: true, missing: true }
  const r = await runBin(tmuxArgs(cfg), ['kill-session', '-t', sessionTarget(name)], { timeout: 5000 })
  return { ok: r.code === 0, error: r.code === 0 ? '' : (r.stderr || r.stdout).trim() }
}

async function tmuxStuff(cfg, name, data) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (!data) return { ok: true, empty: true }
  if (!(await tmuxHas(cfg, name))) return { ok: false, error: `tmux 会话 ${name} 不存在` }
  // -l：字面量，别让 tmux 把 "C-c" 之类的字符串当键名；--：结束选项，防止数据以 - 开头
  const r = await runBin(tmuxArgs(cfg), ['send-keys', '-t', paneTarget(name), '-l', '--', data], { timeout: 5000 })
  return { ok: r.code === 0, error: r.code === 0 ? '' : (r.stderr || r.stdout).trim().slice(0, 500) }
}

async function tmuxCapture(cfg, name, { scrollback = 0 } = {}) {
  const args = ['capture-pane', '-p', '-t', paneTarget(name), '-J']
  if (Number(scrollback) > 0) args.push('-S', `-${Math.min(Number(scrollback), 20000)}`)
  const r = await runBin(tmuxArgs(cfg), args, { timeout: 6000 })
  if (r.code !== 0) {
    return { ok: false, error: `capture-pane 失败（exit ${r.code}）：${(r.stderr || r.stdout).trim().slice(0, 300)}` }
  }
  return { ok: true, raw: r.stdout }
}

/* ───────────────────────── 统一入口 ───────────────────────── */

/**
 * 这个会话该由哪个后端管。
 * 显式配置优先；auto 时先看同名会话是否已经活在某个后端里（这样你手动开的
 * screen/tmux 会话不会被无视），都没有再按“装了谁”选。
 */
export async function resolveBackend(cfg, name = '') {
  const want = String(cfg.terminal || 'auto').trim().toLowerCase()
  if (want === 'screen') return 'screen'
  if (want === 'tmux') return 'tmux'
  const t = tmuxBin(cfg)
  const s = screenBin(cfg)
  if (name) {
    if (t && await tmuxHas(cfg, name)) return 'tmux'
    if (s && await screenHas(cfg, name)) return 'screen'
  }
  if (t) return 'tmux'
  return 'screen'
}

const impl = {
  screen: {
    list: screenList, has: screenHas, create: screenCreate,
    quit: screenQuit, stuff: screenStuff, capture: screenCapture,
  },
  tmux: {
    list: tmuxList, has: tmuxHas, create: tmuxCreate,
    quit: tmuxQuit, stuff: tmuxStuff, capture: tmuxCapture,
  },
}

async function pick(cfg, name) {
  const backend = await resolveBackend(cfg, name)
  return { backend, fn: impl[backend] }
}

export async function listSessions(cfg) {
  const backend = await resolveBackend(cfg)
  return impl[backend].list(cfg)
}

export async function hasSession(cfg, name) {
  if (!name) return false
  const { fn } = await pick(cfg, name)
  return fn.has(cfg, name)
}

export async function createSession(cfg, name, command, opts = {}) {
  const { fn } = await pick(cfg, name)
  return fn.create(cfg, name, command, opts)
}

export async function quitSession(cfg, name) {
  const { fn } = await pick(cfg, name)
  return fn.quit(cfg, name)
}

export async function stuff(cfg, name, data) {
  const { fn } = await pick(cfg, name)
  return fn.stuff(cfg, name, data)
}

/**
 * 抓一屏。
 * @returns {Promise<{ok:true,text:string,rows:number,cols:number,mode:string,at:string,backend:string}|{ok:false,error:string}>}
 */
export async function capture(cfg, name, { stateDir, scrollback = 0 } = {}) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  const { backend, fn } = await pick(cfg, name)
  if (!(await fn.has(cfg, name))) {
    return { ok: false, error: `${backend} 会话 ${name} 不存在（游戏没开？）`, missing: true }
  }
  const r = await fn.capture(cfg, name, { stateDir, scrollback })
  if (!r.ok) return { ok: false, error: r.error }
  const text = cleanScreen(r.raw)
  const rows = text ? text.split('\n').length : 0
  const cols = text ? Math.max(...text.split('\n').map((l) => l.length)) : 0
  return { ok: true, text, rows, cols, mode: detectMode(text), at: new Date().toISOString(), backend }
}

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40)
}
