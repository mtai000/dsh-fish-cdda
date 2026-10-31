/**
 * lib/goal.mjs —— 把“目标”从一段提示词变成可追踪的状态
 * ============================================================================
 * 参考 CDDAi 的 GoalManager（MIT），但把“只认 survive 3 days / find vehicle”
 * 扩成几类：
 *   · survive N days（中英文都认）
 *   · acquire/find <东西>（从屏幕可见物或最近消息里找关键词）
 *   · reach <地点>（先从消息/位置里找关键词）
 *   · 其它目标：只记“开始第几天”，不假装知道进度
 *
 * 状态存在 <家>/goal.json；换目标会重置起点，完成会写 completedAt。
 * ============================================================================
 */
import { readJson, writeJson, pathsOf } from './state.mjs'

export const GOAL_TYPES = ['survive', 'acquire', 'reach', 'generic']

export function parseGoal(text) {
  const raw = String(text || '').trim()
  const s = raw.toLowerCase()
  const survive = s.match(/survive\s+(\d+(?:\.\d+)?)\s*days?/) || s.match(/活过\s*(\d+(?:\.\d+)?)\s*天/) || s.match(/生存\s*(\d+(?:\.\d+)?)\s*天/)
  if (survive) {
    const days = Number(survive[1])
    return { type: 'survive', days: Number.isFinite(days) && days > 0 ? days : 3, raw }
  }
  const acquire = s.match(/(?:find|get|acquire)\s+(.+)/) || s.match(/(?:找到|拿到|取得)\s*(.+)/)
  if (acquire) return { type: 'acquire', target: acquire[1].trim().slice(0, 80), raw }
  const reach = s.match(/(?:reach|go to|travel to)\s+(.+)/) || s.match(/(?:到达|前往)\s*(.+)/)
  if (reach) return { type: 'reach', target: reach[1].trim().slice(0, 80), raw }
  return { type: 'generic', raw }
}

export function readGoal(stateDir) {
  const g = readJson(pathsOf(stateDir).goalFile, null)
  return g && typeof g === 'object' ? g : null
}

function dayOf(state) {
  if (!state || !state.ok) return null
  const d = Number(state.calendar?.day)
  const h = Number(state.calendar?.hour) || 0
  const m = Number(state.calendar?.minute) || 0
  if (Number.isFinite(d)) return d + h / 24 + m / 1440
  const turn = Number(state.turn)
  return Number.isFinite(turn) ? turn / 86400 : null
}

function turnOf(state) {
  const t = Number(state?.turn)
  return Number.isFinite(t) ? t : null
}

/** 目标文本没变就保留起点；变了就重置 */
export function ensureGoal(stateDir, goalText, state = null, { now = Date.now() } = {}) {
  const text = String(goalText || '').trim()
  const spec = parseGoal(text)
  let cur = readGoal(stateDir)
  let changed = false
  if (!cur || cur.goal !== text) {
    cur = {
      goal: text,
      spec,
      startedAt: new Date(now).toISOString(),
      startDay: dayOf(state),
      startTurn: turnOf(state),
      complete: false,
      completedAt: null,
      progress: null,
    }
    changed = true
  } else {
    if (cur.startDay == null && dayOf(state) != null) { cur.startDay = dayOf(state); changed = true }
    if (cur.startTurn == null && turnOf(state) != null) { cur.startTurn = turnOf(state); changed = true }
    if (!cur.spec || cur.spec.type !== spec.type) { cur.spec = spec; changed = true }
  }
  if (changed) writeJson(pathsOf(stateDir).goalFile, cur)
  return cur
}

function textHas(text, target) {
  const t = String(target || '').toLowerCase().trim()
  if (!t) return false
  const hay = String(text || '').toLowerCase()
  if (hay.includes(t)) return true
  const words = t.split(/\s+/).filter((w) => w.length >= 3)
  return words.length > 0 && words.every((w) => hay.includes(w))
}

function fmtPct(n) {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * 按当前存档/屏幕更新进度。
 * @returns {object|null} {goal, spec, startedAt, progress:{text, percent, complete, ...}}
 */
export function updateGoal(stateDir, state, screen = null, { now = Date.now() } = {}) {
  let cur = readGoal(stateDir)
  if (!cur) return null
  let changed = false
  if (cur.startDay == null) { cur.startDay = dayOf(state); changed = true }
  if (cur.startTurn == null) { cur.startTurn = turnOf(state); changed = true }

  const spec = cur.spec && cur.spec.type ? cur.spec : parseGoal(cur.goal)
  const day = dayOf(state)
  const turn = turnOf(state)
  let elapsedDays = 0
  if (cur.startTurn != null && turn != null) elapsedDays = Math.max(0, (turn - cur.startTurn) / 86400)
  else if (cur.startDay != null && day != null) elapsedDays = Math.max(0, day - cur.startDay)

  let progress = { text: '', percent: null, complete: false, elapsedDays }
  if (spec.type === 'survive') {
    const target = Math.max(0.1, Number(spec.days) || 3)
    const percent = fmtPct((elapsedDays / target) * 100)
    progress = {
      text: `第 ${elapsedDays.toFixed(1)} / ${target.toFixed(1)} 天（${percent}%）`,
      percent,
      complete: elapsedDays >= target,
      targetDays: target,
      elapsedDays,
    }
  } else if (spec.type === 'acquire' || spec.type === 'reach') {
    const msg = [state.lastMessage, ...(Array.isArray(state.messages) ? state.messages.slice(-6).map((m) => m.message) : [])]
      .filter(Boolean).join(' ')
    const items = Array.isArray(screen?.visibleItems) ? screen.visibleItems.join(', ') : ''
    const found = textHas(msg + ' ' + items, spec.target)
    progress = {
      text: found ? `已找到/到达：${spec.target}` : `还没找到/到达：${spec.target}`,
      percent: found ? 100 : null,
      complete: found,
      target: spec.target,
      elapsedDays,
    }
  } else {
    progress = {
      text: `已进行第 ${elapsedDays.toFixed(1)} 天（未识别具体目标）`,
      percent: null,
      complete: false,
      elapsedDays,
    }
  }

  if (!cur.progress || JSON.stringify(cur.progress) !== JSON.stringify(progress)) {
    cur.progress = progress
    changed = true
  }
  if (progress.complete && !cur.complete) {
    cur.complete = true
    cur.completedAt = new Date(now).toISOString()
    changed = true
  }
  if (changed) writeJson(pathsOf(stateDir).goalFile, cur)
  return { ...cur, spec, progress }
}

export function goalProgressText(info) {
  return info?.progress?.text || ''
}
