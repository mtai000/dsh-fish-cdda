/**
 * lib/screen.mjs —— CDDA 的启动脚本 / 世界选择 / 战报屏
 * ============================================================================
 * 复用器（screen / tmux）的会话操作已经搬到 lib/backend.mjs：
 * 这里只留 CDDA 自己的事，并且把会话原语原样再导出，保持老调用点不用改 import。
 *
 * 为什么游戏要用 `TERM=linux`：
 *   xterm/screen 的 terminfo 带 smcup（alternate screen），CDDA 一切进备用屏，
 *   `screen -X hardcopy` 抓到的就是空的（实测 screen 4.09）。linux 没有 smcup，
 *   画面留在普通屏上，hardcopy 就能读到。代价是菜单边框会变成空白/乱码，
 *   但地图、侧栏、消息全是 ASCII，足够 AI 玩。
 *   （tmux 后端用 `capture-pane`，不受这个限制，但保留 TERM=linux 行为不变。）
 * ============================================================================
 */
import { accessSync, constants as fsConstants, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { findWorlds } from './state-read.mjs'
import {
  attachArgv, attachCommand, capture, createSession, hasSession, listCommand,
  listSessions, quitSession, resolveBackend, screenBin, stuff, tmuxBin,
} from './backend.mjs'

export {
  attachArgv, attachCommand, capture, createSession, hasSession, listCommand,
  listSessions, quitSession, resolveBackend, screenBin, stuff, tmuxBin,
}
export { findWorlds }

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

/** 战报屏的启动命令 */
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

/** 确保战报屏在跑（失败只返回错误，不抛） */
export async function ensureLogScreen(cfg, stateDir, pluginDir) {
  if (!cfg.logScreen) return { ok: true, disabled: true }
  const name = String(cfg.screenLog || 'cdda_log')
  if (await hasSession(cfg, name)) return { ok: true, existed: true, name }
  const { command, env } = logScreenCommand(cfg, stateDir, pluginDir)
  const r = await createSession(cfg, name, command, { env, waitMs: 2500 })
  return { ...r, name }
}
