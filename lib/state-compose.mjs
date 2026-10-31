/**
 * lib/state-compose.mjs —— 屏幕实时状态 + 存档地面真值
 * ============================================================================
 * CDDA 只在存档/自动存档时写 `.sav`，所以存档可能比屏幕旧几分钟。
 * 这里跟 CDDAi 的 StateComposer 一样做合并：
 *   · 屏幕优先：HP 条、位置、UI、可见物/威胁
 *   · 存档优先：精确饥渴/饥饿值、技能、背包
 *   · 两边都有 HP 时算 consistency，差太多就提示“以屏幕为准”
 *   · 存档超过 10 分钟没写盘标 stale
 * ============================================================================
 */
import { uiLabel } from './screen-parse.mjs'

function asNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function needFromSave(need, fallbackLabel) {
  if (!need) return { label: fallbackLabel || '未知', value: null, source: 'none' }
  return {
    label: String(need.label || fallbackLabel || '未知'),
    value: asNumber(need.value),
    source: 'save',
  }
}

function needFromScreen(text, fallback) {
  if (!text) return fallback
  return { label: String(text), value: null, source: 'screen' }
}

/**
 * @param {object|null} saveState - readGameState() 的返回
 * @param {object|null} parsed - parseScreen() 的返回
 * @param {object|null} capture - capture() 的返回
 * @returns {object}
 */
export function composeState(saveState, parsed, capture, { now = Date.now(), staleSec = 600 } = {}) {
  const save = saveState && saveState.ok ? saveState : null
  const p = parsed || {}
  const mode = capture?.mode || save?.mode || 'unknown'

  const saveHp = asNumber(save?.health?.pct)
  const screenHp = asNumber(p.healthFromScreen)
  const hp = screenHp != null ? screenHp : saveHp
  const hpSource = screenHp != null ? 'screen' : (saveHp != null ? 'save' : 'none')

  const delta = screenHp != null && saveHp != null ? Math.abs(screenHp - saveHp) : null
  const consistencyScore = delta == null ? (hp != null ? 1 : 0) : Math.max(0, Math.min(1, 1 - delta / 100))
  const warnings = []
  let stale = false
  let saveAgeSec = null

  if (save?.savedAt) {
    const t = Date.parse(save.savedAt)
    if (Number.isFinite(t)) {
      saveAgeSec = Math.max(0, Math.round((now - t) / 1000))
      stale = saveAgeSec > staleSec
      if (stale) warnings.push(`存档已经 ${Math.round(saveAgeSec / 60)} 分钟没写盘；HP/位置以屏幕为准`)
    }
  }
  if (delta != null && delta > 15) {
    warnings.push(`屏幕 HP ${screenHp}% 与存档 HP ${saveHp}% 差 ${delta}%；以屏幕为准`)
  }
  if (!save && !p.healthFromScreen) warnings.push('没有存档也没有解析到屏幕 HP')

  const needs = {
    thirst: needFromScreen(p.thirst, needFromSave(save?.needs?.thirst, '口渴')),
    hunger: needFromScreen(p.hunger, needFromSave(save?.needs?.hunger, '饥饿')),
    fatigue: needFromScreen(p.fatigue, needFromSave(save?.needs?.fatigue, '疲劳')),
  }

  const location = p.location
    ? { name: p.location, source: 'screen' }
    : (save?.location
      ? { name: `(${save.location.x},${save.location.y})`, source: 'save' }
      : { name: '', source: 'none' })

  const ui = p.ui || { state: null, title: null, options: [] }
  const visible = {
    items: Array.isArray(p.visibleItems) ? p.visibleItems.slice(0, 12) : [],
    threats: Array.isArray(p.visibleThreats) ? p.visibleThreats.slice(0, 8) : [],
  }

  const parts = []
  if (save?.calendar?.text) parts.push(save.calendar.text)
  if (hp != null) parts.push(`HP ${Math.round(hp)}%（${hpSource === 'screen' ? '屏幕' : '存档'}）`)
  parts.push(`渴 ${needs.thirst.label}`, `饿 ${needs.hunger.label}`, `疲劳 ${needs.fatigue.label}`)
  if (ui.state) parts.push(`界面 ${uiLabel(ui.state)}`)
  if (visible.threats.length) parts.push(`威胁 ${visible.threats.join('/')}`)

  return {
    ok: Boolean(save || p.healthFromScreen || capture?.ok),
    mode,
    health: { pct: hp == null ? null : Math.round(hp), source: hpSource, screenPct: screenHp, savePct: saveHp },
    needs,
    location,
    ui,
    visible,
    consistency: {
      score: Number(consistencyScore.toFixed(2)),
      healthDelta: delta,
      saveAgeSec,
      stale,
      warnings,
    },
    summary: parts.join(' · '),
  }
}
