#!/usr/bin/env node
/**
 * lib/logscreen.mjs —— cdda_log 这个 screen 会话里跑的“战报屏”
 * ============================================================================
 * 它不直接碰 CDDA，只读插件家里的 status.json / activity.jsonl / config.json，
 * 每秒检查一次；内容变了才重绘（这样你滚动看历史时不会一直被拉回顶部）。
 *
 * 用法（插件会自动起）：
 *   node lib/logscreen.mjs /path/to/$DSH_HOME/cdda-duty
 * 手动看：
 *   screen -x cdda_log
 * ============================================================================
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { truncDisplay, padDisplay, displayWidth } from './parse.mjs'
import { uiLabel } from './screen-parse.mjs'

const stateDir = process.argv[2] || process.env.CDDA_DUTY_HOME || join(process.env.DSH_HOME || '', 'cdda-duty')
const statusFile = join(stateDir, 'status.json')
const activityFile = join(stateDir, 'activity.jsonl')
const configFile = join(stateDir, 'config.json')
const roundFile = join(stateDir, 'round.json')

const C = {
  reset: '\x1b[0m', dim: '\x1b[38;5;244m', gray: '\x1b[38;5;245m',
  white: '\x1b[38;5;252m', green: '\x1b[38;5;114m', blue: '\x1b[38;5;75m',
  yellow: '\x1b[38;5;179m', red: '\x1b[38;5;203m', cyan: '\x1b[38;5;116m',
  bg: '\x1b[48;5;236m', bold: '\x1b[1m',
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function readActivity(limit = 60) {
  try {
    const st = statSync(activityFile)
    const raw = readFileSync(activityFile, 'utf8')
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-limit)
    const out = []
    for (const l of lines) { try { out.push(JSON.parse(l)) } catch { /* 跳过 */ } }
    return out
  } catch { return [] }
}

function stamp(iso) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '--:--:--'
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  } catch { return '--:--:--' }
}

function termSize() {
  return {
    w: Math.max(40, Number(process.stdout.columns) || 80),
    h: Math.max(12, Number(process.stdout.rows) || 24),
  }
}

let lastHash = ''
let lastDraw = 0

function draw() {
  const { w, h } = termSize()
  const status = readJson(statusFile, null)
  const cfg = readJson(configFile, {})
  const round = readJson(roundFile, null)
  const acts = readActivity(80)
  const running = Boolean(status && status.running)
  const mode = status?.mode || (status?.running ? 'unknown' : 'not_running')
  const save = status?.state && status.state.ok ? status.state : null
  const now = status?.lastAction?.at || status?.updatedAt || new Date().toISOString()

  const lines = []
  const sep = C.dim + '─'.repeat(w) + C.reset
  const title = ' DSH × CDDA 战报 '
  const auto = cfg.autoplay ? '自动玩: 开' : '自动玩: 关'
  const head = ` ${C.bold}${C.cyan}${title}${C.reset}${' '.repeat(Math.max(0, w - displayWidth(title) - displayWidth(auto) - 4))}${cfg.autoplay ? C.green : C.gray}${auto}${C.reset}`
  lines.push(head)
  lines.push(sep)

  const statusLine = running
    ? ` ${C.green}● ${modeLabel(mode)}${C.reset}` +
      (round?.active ? `  ${C.yellow}回合 #${String(round.id || '').slice(-6)} 进行中${C.reset}` : '') +
      `  ${C.gray}今日 ${Number(status?.actionsToday || 0)} 动作${C.reset}`
    : ` ${C.red}● 未运行${C.reset}  ${C.gray}等 DSH 开始（cdda_start / 设置页「开始游戏」）${C.reset}`
  lines.push(statusLine)

  const goal = String(cfg.goal || status?.goal || '').replace(/\s+/g, ' ').trim()
  const gp = String(status?.goalProgress?.text || '').replace(/\s+/g, ' ').trim()
  lines.push(` ${C.gray}目标${C.reset} ${truncDisplay(goal || '（没填）', Math.max(10, w - 8 - (gp ? gp.length + 3 : 0)))}${gp ? `  ${C.yellow}${truncDisplay(gp, 28)}${C.reset}` : ''}`)

  const ui = status?.ui
  const vis = status?.visible
  if (ui?.state || vis?.threats?.length) {
    const u = ui?.state ? uiLabel(ui.state) : ''
    const t = vis?.threats?.length ? `威胁 ${vis.threats.join('/')}` : ''
    lines.push(` ${C.gray}界面${C.reset} ${truncDisplay([u, t].filter(Boolean).join(' · '), w - 8)}`)
  }

  if (save) {
    lines.push(` ${C.gray}角色${C.reset} ${truncDisplay(`${save.name}  ·  ${save.calendar?.text || ''}`, w - 8)}`)
    const hp = save.health ? `HP ${save.health.pct}%` : 'HP ?'
    const needs = save.needs
      ? `渴 ${save.needs.thirst?.label || '?'}  饿 ${save.needs.hunger?.label || '?'}  疲劳 ${save.needs.fatigue?.label || '?'}`
      : ''
    const loc = save.location ? `(${save.location.x},${save.location.y})` : ''
    lines.push(` ${C.gray}身体${C.reset} ${hp}   ${C.gray}${needs}${C.reset}  ${C.gray}${loc}${C.reset}`)
    if (save.lastMessage) lines.push(` ${C.gray}消息${C.reset} ${truncDisplay(save.lastMessage, w - 8)}`)
  } else {
    lines.push(` ${C.gray}角色${C.reset} ${C.dim}还没有存档/状态（第一次开局中，或还没保存）${C.reset}`)
  }

  const doing = status?.lastNote?.text || status?.lastAction?.note || ''
  if (doing) lines.push(` ${C.gray}正在做${C.reset} ${C.cyan}${truncDisplay(doing.replace(/\s+/g, ' '), w - 9)}${C.reset}`)

  const lastRound = status?.lastRound
  if (lastRound) {
    lines.push(` ${C.gray}上一轮${C.reset} ${Number(lastRound.actions || 0)} 动作 · ${Number(lastRound.durationSec || 0)}s${lastRound.goalProgress ? ' · ' + truncDisplay(String(lastRound.goalProgress), 28) : ''}`)
  }

  const rec = status?.recording
  if (rec?.active) {
    const name = String(rec.video || '').split('/').pop()
    lines.push(` ${C.red}● 录制中${C.reset} ${C.gray}${truncDisplay(name, Math.max(8, w - 30))}  ${Number(rec.durationSec || 0)}s  ${Number(rec.frames || 0)} 帧${C.reset}`)
  }

  lines.push(sep)

  // 活动区：给底部留 3 行（分隔线 + 两个旁观提示）
  const room = Math.max(3, h - lines.length - 3)
  const show = acts.slice(-room)
  if (!show.length) {
    lines.push(` ${C.dim}（还没有动作。DSH 发第一步后这里会实时滚动。）${C.reset}`)
  } else {
    for (const a of show) {
      const t = C.gray + stamp(a.ts) + C.reset
      if (a.kind === 'action' || a.kind === 'sent') {
        const keys = a.keys || ''
        const note = a.note || ''
        lines.push(` ${t} ${C.green}▶${C.reset} ${C.bold}${truncDisplay(keys, 18)}${C.reset} ${truncDisplay(note, Math.max(8, w - 35))}`)
      } else if (a.kind === 'note') {
        lines.push(` ${t} ${C.blue}✎${C.reset} ${C.cyan}${truncDisplay(a.note || '', w - 24)}${C.reset}`)
      } else if (a.kind === 'error') {
        lines.push(` ${t} ${C.red}!${C.reset} ${C.red}${truncDisplay(a.text || a.note || '', w - 24)}${C.reset}`)
      } else if (a.kind === 'start' || a.kind === 'stop' || a.kind === 'round_start' || a.kind === 'round_end') {
        lines.push(` ${t} ${C.yellow}◆${C.reset} ${C.gray}${truncDisplay(a.text || a.kind, w - 24)}${C.reset}`)
      } else {
        lines.push(` ${t} ${C.dim}·${C.reset} ${truncDisplay(a.text || a.note || a.kind || '', w - 24)}`)
      }
    }
  }

  // 补齐到底部，再画页脚
  while (lines.length < h - 2) lines.push('')
  lines.push(sep)
  const foot = ` screen -x ${cfg.screenGame || 'cdda'}  看游戏    screen -x ${cfg.screenLog || 'cdda_log'}  看战报    ${stamp(status?.lastAction?.at || status?.lastNote?.at || status?.updatedAt || now)}`
  lines.push(C.gray + truncDisplay(foot, w) + C.reset)

  // 裁到终端高度（防止超屏滚动）
  const out = lines.slice(0, h).join('\n')
  const hash = out
  if (hash === lastHash) return
  lastHash = hash
  lastDraw = Date.now()
  process.stdout.write('\x1b[H\x1b[2J' + out + '\n')
}

function modeLabel(mode) {
  return ({
    gameplay: '游戏中', main_menu: '主菜单', char_select: '选角色', char_create: '建角色',
    world_create: '建世界', language: '选语言', dialog: '确认框', death: '死亡',
    saving: '存档中', loading: '加载中', not_running: '未启动', unknown: '未知',
  })[mode] || mode || '未知'
}

process.stdout.write('\x1b[?25l') // 隐藏光标
process.on('SIGTERM', () => { process.stdout.write('\x1b[?25h\x1b[0m\n'); process.exit(0) })
process.on('SIGINT', () => { process.stdout.write('\x1b[?25h\x1b[0m\n'); process.exit(0) })
process.on('SIGWINCH', () => { lastHash = ''; draw() })
try { draw() } catch (e) { process.stdout.write('cdda_log 渲染失败：' + String(e?.message ?? e) + '\n') }
setInterval(() => { try { draw() } catch { /* 渲染失败不能死 */ } }, 1000)
