/**
 * lib/screen.mjs —— screen 会话的低层操作 + 抓屏
 * ============================================================================
 * 约定：
 *   · 游戏跑在 `cdda` 会话里（用户 `screen -x cdda` 就能看）
 *   · 战报跑在 `cdda_log` 会话里（用户 `screen -x cdda_log` 就能看）
 *   · 抓屏 = `screen -X redisplay` → `screen -X hardcopy <file>` → 洗成 ASCII
 *
 * 为什么游戏要用 `TERM=linux`：
 *   xterm/screen 的 terminfo 带 smcup（alternate screen），CDDA 一切进备用屏，
 *   `screen -X hardcopy` 抓到的就是空的（实测 screen 4.09）。linux 没有 smcup，
 *   画面留在普通屏上，hardcopy 就能读到。代价是菜单边框会变成空白/乱码，
 *   但地图、侧栏、消息全是 ASCII，足够 AI 玩。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import {
  accessSync, chmodSync, constants as fsConstants, existsSync, mkdirSync,
  readFileSync, rmSync, statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { cleanScreen, detectMode } from './parse.mjs'
import { findWorlds } from './state-read.mjs'

const DEFAULT_TIMEOUT = 12_000

export function screenBin(cfg = {}) {
  const explicit = String(cfg.screenBin || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  const candidates = [
    process.env.SCREEN_BIN,
    '/usr/bin/screen',
    '/usr/local/bin/screen',
    '/opt/homebrew/bin/screen',
    '/bin/screen',
  ].filter(Boolean)
  for (const p of candidates) {
    try { accessSync(p, fsConstants.X_OK); return p } catch { /* 下一个 */ }
  }
  return 'screen'
}

export function screenEnv(cfg = {}) {
  const env = {
    ...process.env,
    // screen 自己的控制终端只需要能跑命令；TERM 给个常见的即可
    TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  }
  if (cfg.screenDir) env.SCREENDIR = String(cfg.screenDir)
  return env
}

/** 跑一条 screen 命令（不经过 shell） */
export function runScreen(cfg, args, { timeout = DEFAULT_TIMEOUT, env = {} } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(screenBin(cfg), args, {
        env: { ...screenEnv(cfg), ...env },
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
      finish(-1, new Error('screen 命令超时'))
    }, Math.max(1000, timeout))
    timer.unref?.()
    child.stdout?.on('data', (b) => { stdout += b.toString('utf8') })
    child.stderr?.on('data', (b) => { stderr += b.toString('utf8') })
    child.on('error', (e) => finish(-1, e))
    child.on('close', (code) => finish(code ?? -1))
  })
}

/** 解析 `screen -ls`，返回 Map<name, {pid, state}> */
export async function listSessions(cfg) {
  const out = new Map()
  const r = await runScreen(cfg, ['-ls'], { timeout: 5000 })
  const text = `${r.stdout}\n${r.stderr}`
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\.(\S+)\s+\((.*?)\)\s*$/)
    if (m) out.set(m[2], { pid: Number(m[1]), state: m[3] })
  }
  return out
}

export async function hasSession(cfg, name) {
  if (!name) return false
  const all = await listSessions(cfg)
  return all.has(name)
}

/** 新建一个 detached screen 会话；command 是数组（screen 直接 exec，不经过 shell） */
export async function createSession(cfg, name, command, { env = {}, waitMs = 2500 } = {}) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (await hasSession(cfg, name)) return { ok: true, existed: true }
  const args = ['-dmS', name, ...command]
  const r = await runScreen(cfg, args, { timeout: 8000, env })
  if (r.code !== 0) {
    return { ok: false, error: `screen 起不来（exit ${r.code}）：${(r.stderr || r.stdout || '').trim().slice(0, 500)}` }
  }
  const until = Date.now() + Math.max(300, waitMs)
  while (Date.now() < until) {
    if (await hasSession(cfg, name)) return { ok: true }
    await new Promise((res) => setTimeout(res, 100))
  }
  return { ok: false, error: 'screen 会话创建后立刻消失了（命令自身失败？）' }
}

export async function quitSession(cfg, name) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (!(await hasSession(cfg, name))) return { ok: true, missing: true }
  const r = await runScreen(cfg, ['-S', name, '-X', 'quit'], { timeout: 5000 })
  return { ok: r.code === 0, error: r.code === 0 ? '' : (r.stderr || r.stdout).trim() }
}

/** 往会话送按键（screen -X stuff），输入是已经翻译好的终端字节 */
export async function stuff(cfg, name, data) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (!data) return { ok: true, empty: true }
  if (!(await hasSession(cfg, name))) return { ok: false, error: `screen 会话 ${name} 不存在` }
  const r = await runScreen(cfg, ['-S', name, '-p', '0', '-X', 'stuff', data], { timeout: 5000 })
  return { ok: r.code === 0, error: r.code === 0 ? '' : (r.stderr || r.stdout).trim().slice(0, 500) }
}

/**
 * 抓一屏。
 * @returns {Promise<{ok:true,text:string,rows:number,cols:number,mode:string,at:string}|{ok:false,error:string}>}
 */
export async function capture(cfg, name, { stateDir } = {}) {
  if (!name) return { ok: false, error: '会话名不能为空' }
  if (!(await hasSession(cfg, name))) {
    return { ok: false, error: `screen 会话 ${name} 不存在（游戏没开？）`, missing: true }
  }
  const dir = stateDir ? join(stateDir, 'screens') : join(process.env.DSH_HOME || process.cwd(), 'cdda-duty', 'screens')
  try { mkdirSync(dir, { recursive: true }) } catch { /* 用默认目录 */ }
  const file = join(dir, `${sanitize(name)}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.txt`)
  let raw = ''
  let lastErr = ''
  // detached screen 第一帧偶尔是空的（尤其刚刚 stuff 完 / 刚启动）⇒ 最多抓两次
  for (let attempt = 0; attempt < 2; attempt++) {
    // 1) 强制屏幕重绘（detached 会话不 redisplay 时 hardcopy 可能拿到空屏）
    await runScreen(cfg, ['-S', name, '-p', '0', '-X', 'redisplay'], { timeout: 4000 })
    await new Promise((r) => setTimeout(r, 80 + attempt * 150))
    // 2) hardcopy 到临时文件
    try { rmSync(file, { force: true }) } catch { /* 忽略 */ }
    const r = await runScreen(cfg, ['-S', name, '-p', '0', '-X', 'hardcopy', file], { timeout: 6000 })
    try {
      if (existsSync(file)) raw = readFileSync(file, 'utf8')
    } catch { /* 读不到当空 */ }
    try { rmSync(file, { force: true }) } catch { /* 忽略 */ }
    if (raw && cleanScreen(raw).trim()) break
    lastErr = `hardcopy 没拿到内容（exit ${r.code}）：${(r.stderr || r.stdout || '').trim().slice(0, 300)}`
  }
  if (!raw) return { ok: false, error: lastErr || 'hardcopy 没拿到内容' }
  const text = cleanScreen(raw)
  const rows = text ? text.split('\n').length : 0
  const cols = text ? Math.max(...text.split('\n').map((l) => l.length)) : 0
  return { ok: true, text, rows, cols, mode: detectMode(text), at: new Date().toISOString() }
}

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40)
}

/** 找 CDDA 可执行文件 */
export function findCdda(cfg = {}) {
  const explicit = String(cfg.cddaPath || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  const names = ['cataclysm', 'cataclysm-dda', 'cataclysm-tiles']
  const dirs = String(process.env.PATH || '').split(':').filter(Boolean)
  const candidates = [
    '/usr/games/cataclysm',
    '/usr/games/cataclysm-dda',
    '/usr/local/games/cataclysm',
    '/usr/bin/cataclysm',
    '/opt/homebrew/bin/cataclysm',
    // macOS app bundle（cddai 的老路径）
    join(process.env.HOME || '', 'Applications/Cataclysm.app/Contents/Resources/cataclysm'),
    join(process.env.HOME || '', 'Applications/Cataclysm.app/Contents/MacOS/cataclysm'),
    ...dirs.flatMap((d) => names.map((n) => join(d, n))),
  ]
  for (const p of candidates) {
    try { accessSync(p, fsConstants.X_OK); return p } catch { /* 下一个 */ }
  }
  return ''
}

/** 给 CDDA 的启动脚本（bash -lc 执行） */
export function buildLaunchScript(cfg, stateDir, world) {
  const cdda = findCdda(cfg)
  if (!cdda) return { ok: false, error: '找不到 CDDA 可执行文件：在设置里填 cddaPath，或安装 cataclysm-dda-curses' }
  const gameDir = String(cfg.userDir || '').trim() || join(stateDir, 'game')
  const saveDir = join(gameDir, 'save')
  const configDir = join(gameDir, 'config')
  for (const d of [gameDir, saveDir, configDir]) {
    try { mkdirSync(d, { recursive: true }) } catch { /* 让 CDDA 自己报 */ }
  }
  const w = String(world || '').trim()
  const q = shellQuote
  // ⚠️ 不要用 --userdir：0.G 里它只改 data 覆盖路径，存档仍然去默认 save 根找，
  //    结果就是 `Requested non-existing world`（2026-10-31 实测）。--savedir /
  //    --configdir 用绝对路径才是真正把存档/配置隔离到插件家里。
  const script = [
    'unset TERMCAP',
    'unset TERMINFO',
    'export TERM=linux',
    'export LANG=C.UTF-8',
    'export LC_ALL=C.UTF-8',
    `cd ${q('/tmp')} 2>/dev/null || true`,
    `exec ${q(cdda)} --savedir ${q(saveDir)} --configdir ${q(configDir)}${w ? ` --world ${q(w)}` : ''}`,
  ].join('; ')
  return { ok: true, script, cdda, gameDir, saveDir, configDir, world: w }
}

export function shellQuote(s) {
  const v = String(s ?? '')
  return "'" + v.replace(/'/g, `'\\''`) + "'"
}

/** 选世界：显式配置 > starter > 最近有存档 */
export function pickWorld(cfg, saveDir, starterNames = []) {
  const explicit = String(cfg.world || '').trim()
  if (explicit) return explicit
  const worlds = findWorlds(saveDir)
  if (worlds.length) return worlds[0].name
  if (starterNames.length) return starterNames[0]
  return ''
}

/** cdda_log 的启动命令 */
export function logScreenCommand(cfg, stateDir, pluginDir) {
  const script = join(pluginDir, 'lib', 'logscreen.mjs')
  return {
    command: [process.execPath, script, stateDir],
    env: {
      CDDA_DUTY_HOME: stateDir,
      DSH_HOME: process.env.DSH_HOME || '',
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  }
}

/** 确保 cdda_log 在跑（失败只返回错误，不抛） */
export async function ensureLogScreen(cfg, stateDir, pluginDir) {
  if (!cfg.logScreen) return { ok: true, disabled: true }
  const name = String(cfg.screenLog || 'cdda_log')
  if (await hasSession(cfg, name)) return { ok: true, existed: true, name }
  const { command, env } = logScreenCommand(cfg, stateDir, pluginDir)
  const r = await createSession(cfg, name, command, { env, waitMs: 2500 })
  return { ...r, name }
}

export { findWorlds }
