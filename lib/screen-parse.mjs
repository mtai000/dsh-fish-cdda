/**
 * lib/screen-parse.mjs —— 把 80×24 的 CDDA 屏幕解析成结构化信息
 * ============================================================================
 * 参考 CDDAi 的 perception/screen_parser.py（MIT），但按我们这里实际抓到的
 * `screen hardcopy` 文本做了适配：
 *   · 游戏内 HP 是 `L ARM |||||` 这种 ASCII 条（不是 `Head: 84/84`）
 *   · 菜单/物品栏的标题和选项不固定，先做“识别 + 尽力列出”
 *   · 解析不到就返回 null/空数组，让 StateComposer 回退到存档
 *
 * 输出（给模型看的结构化版本）：
 *   ui: {state, title, options}
 *   visible: {items, threats}
 *   healthFromScreen, thirst, hunger, fatigue, morale, location
 * ============================================================================
 */

const BODY_PARTS = ['Head', 'Torso', 'L Arm', 'R Arm', 'L Leg', 'R Leg']
const BODY_RE = /(Head|Torso|L Arm|R Arm|L Leg|R Leg)\s*[:\-]?\s*(\d+)\s*\/\s*(\d+)/gi
const HP_RE = /\bHP\s*:\s*(\d+)\s*\/\s*(\d+)/i
const BODY_BAR_RE = /^(Head|Torso|L Arm|R Arm|L Leg|R Leg)\s*[:\-]?\s*([|#^+=._*\-]+)$/i
const BODY_NAME_RE = /^(Head|Torso|L Arm|R Arm|L Leg|R Leg)$/i
const BAR_RE = /^[|#^+=._*\-]+$/
const BAR_CHARS = new Set(['|', '#', '+', '=', '^', '*'])

const ITEM_PATTERNS = [
  /You see here[:\s]+(.+)/i,
  /There is (.+?) here/i,
  /Nearby(?: items)?[:\s]+(.+)/i,
]

const THREAT_WORDS = [
  'zombie', 'feral human', 'feral zombie', 'giant spider', 'spider', 'bear', 'moose', 'wolf', 'dog',
  'ant', 'triffid', 'mi-go', 'robot', 'turret', 'brute', 'crawler', 'skeletal', 'fungus', 'wasp',
  'hulk', 'shocker', 'acidic', 'runner', 'hunter', 'prowler', 'manhack', 'drone', 'sentinel', 'blob',
]
const THREAT_RE = new RegExp(`\\b(${THREAT_WORDS.map((x) => x.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`, 'gi')

const STATUS_BAR_CHARS = new Set(['|', '#', '^', '+', '=', '.', '_', '-', '*', '\'', '"', '`', '~'])

function splitColumns(line) {
  return line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean)
}

function normalizeStatusValue(value) {
  let s = String(value || '').trim()
  if (!s) return null
  // 去掉 CDDA 的颜色/字符集控制残渣
  s = s.replace(/\([0-9A-Za-z]{1,3}\(B/g, '').replace(/[\x00-\x1f]/g, '').trim()
  if (!s) return null
  if (/^(unknown|n\/a|na)$/i.test(s)) return 'Unknown'
  const candidate = s.replace(/\s+/g, '')
  if (candidate && [...candidate].every((ch) => STATUS_BAR_CHARS.has(ch))) {
    const filled = [...candidate].filter((ch) => ch !== '.').length
    return `${Math.round((filled / candidate.length) * 100)}% (${s})`
  }
  return s.slice(0, 80)
}

function parseHealth(lines) {
  const values = []
  for (const line of lines) {
    for (const m of line.matchAll(BODY_RE)) {
      const cur = Number(m[2])
      const max = Number(m[3])
      if (max > 0) values.push((cur / max) * 100)
    }
    const hp = line.match(HP_RE)
    if (hp && Number(hp[2]) > 0) values.push((Number(hp[1]) / Number(hp[2])) * 100)
  }
  if (!values.length) {
    // ASCII bars：可能是 "L ARM   |||||  HEAD |||||" 这种被空格拆开的
    for (const line of lines) {
      const cols = splitColumns(line)
      for (let i = 0; i < cols.length; i++) {
        let bars = null
        const one = cols[i].match(BODY_BAR_RE)
        if (one) bars = one[2]
        else if (BODY_NAME_RE.test(cols[i]) && i + 1 < cols.length && BAR_RE.test(cols[i + 1])) {
          bars = cols[i + 1]
          i++
        }
        if (!bars) continue
        const chars = [...bars].filter((ch) => ch !== ' ')
        if (!chars.length) continue
        const filled = chars.filter((ch) => BAR_CHARS.has(ch)).length
        values.push((filled / chars.length) * 100)
      }
    }
  }
  if (!values.length) return null
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
}

function parseSidebar(lines) {
  const out = { thirst: null, hunger: null, fatigue: null, morale: null }
  for (const line of lines) {
    for (const seg of splitColumns(line)) {
      const m = seg.match(/^(Thirst|Hunger|Fatigue|Morale|Mood)\s*[:\s]\s*(.*)$/i)
      if (!m) continue
      const key = m[1].toLowerCase()
      const raw = m[2].trim()
      if (key === 'morale' || key === 'mood') {
        const n = Number(raw)
        if (Number.isFinite(n)) out.morale = n
        continue
      }
      const v = normalizeStatusValue(raw)
      if (v) out[key] = v
    }
  }
  return out
}

function parseLocation(lines) {
  for (const line of lines) {
    const m = line.match(/(?:Place|Location)\s*[:\s]\s*(.+)$/i)
    if (!m) continue
    const first = splitColumns(m[1])[0] || m[1]
    const value = first.replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '')
    if (value) return value.slice(0, 60)
  }
  return null
}

function parseItems(lines) {
  const out = []
  const seen = new Set()
  for (const line of lines) {
    const text = line.trim()
    if (!text) continue
    for (const re of ITEM_PATTERNS) {
      const m = text.match(re)
      if (!m) continue
      for (const raw of m[1].replace(/ and /gi, ', ').split(',')) {
        const item = raw.trim().replace(/^[.\s]+|[.\s]+$/g, '')
        const key = item.toLowerCase()
        if (!item || seen.has(key) || /^(nothing|unknown|saving game|moving)/.test(key)) continue
        seen.add(key)
        out.push(item.slice(0, 80))
      }
      break
    }
  }
  return out.slice(0, 12)
}

function parseThreats(lines) {
  const out = []
  const seen = new Set()
  for (const line of lines) {
    for (const m of line.matchAll(THREAT_RE)) {
      const t = m[1].toLowerCase()
      if (seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
  }
  return out.slice(0, 8)
}

function parseUiState(text) {
  const lower = text.toLowerCase()
  const lines = text.split('\n')
  if (lower.includes('inventory organization') || lower.includes('modify pocket settings')) return 'inventory_organization'
  if (lower.includes('<tab> items') || /^\s*inventory\s{2,}/m.test(text) || lower.includes('items worn') || (lower.includes('sort: dist') && lower.includes('examine') && lower.includes('compare'))) return 'inventory'
  if (lower.includes('advanced inventory management')) return 'advanced_inventory'
  if (lower.includes('select an item from nearby') || lower.includes('pick up from nearby') || lower.includes('pick up which items') || /^\s*pickup\s*$/mi.test(text)) return 'pickup_menu'
  if (/are you sure|\(y\)es\s+\(n\)o|save and quit\?/i.test(text)) return 'confirmation_dialog'
  if (lower.includes('contents of this item') || lower.includes('can be stored in') || /\bprice:\s*/i.test(text)) return 'item_description'
  if ((lower.includes('main menu') && lower.includes('view help')) || lower.includes('[motd]') || (lower.includes('new game') && lower.includes('load'))) return 'main_menu'
  if (/<\s*look around\s*>/i.test(text) || lower.includes('look around') && lower.includes('cover:')) return 'look_around'
  if (lower.includes('pickup') && /\[.*\]\s*(pick|take)/i.test(text)) return 'pickup_menu'
  // generic menu: 至少两行 “字符 + 描述”
  const optionLines = lines.filter((l) => /^\s*([0-9A-Za-z@#$%\-+])\s{1,}\S/.test(l))
  if (optionLines.length >= 3 && !/press \} for sidebar/i.test(text)) return 'generic_menu'
  return null
}

function parseUiTitle(text, state) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!state) return null
  if (state === 'main_menu') return 'Main Menu'
  if (state === 'look_around') {
    const l = lines.find((x) => /<\s*look around\s*>/i.test(x))
    return l ? l.replace(/[<>]/g, '').trim() : 'Look around'
  }
  if (state === 'inventory') {
    const l = lines.find((x) => /<tab>\s*items/i.test(x) || /^\s*inventory\s{2,}/i.test(x))
    return l ? (/<tab>/i.test(l) ? 'Items' : 'Inventory') : 'Inventory'
  }
  if (state === 'inventory_organization') return 'Inventory Organization'
  if (state === 'pickup_menu') return 'Pickup'
  if (state === 'advanced_inventory') return 'Advanced Inventory'
  if (state === 'confirmation_dialog') {
    const l = lines.find((x) => /are you sure|save and quit\?/i.test(x))
    return l ? l.replace(/\s+/g, ' ').slice(0, 100) : 'Confirmation'
  }
  if (state === 'item_description') return lines[0] ? lines[0].slice(0, 100) : 'Item'
  return lines[0] ? lines[0].slice(0, 100) : null
}

function parseUiOptions(text, state) {
  if (!state) return []
  const out = []
  const seen = new Set()
  const push = (s) => {
    const v = String(s || '').replace(/\s+/g, ' ').trim()
    if (v && !seen.has(v)) { seen.add(v); out.push(v) }
  }
  if (state === 'confirmation_dialog') {
    if (/\(y\)es/i.test(text)) push('Y Yes')
    if (/\(n\)o/i.test(text)) push('N No')
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([0-9A-Za-z@#$%\-+])\s{1,}(.+)$/)
    if (!m) continue
    const key = m[1]
    const desc = m[2].replace(/\s+/g, ' ').trim()
    if (!desc) continue
    // 避免把地图/侧栏的数字行当成菜单项
    if (state === 'inventory' && /^[0-9]+$/.test(key)) continue
    push(`${key} ${desc}`.slice(0, 120))
    if (out.length >= 20) break
  }
  return out
}

/** 给 UI 卡住时用的恢复按键（尽量只退出，不确认危险操作） */
export function recoveryKeysFor(uiState) {
  switch (uiState) {
    case 'inventory':
    case 'inventory_organization':
    case 'advanced_inventory':
      return ['<ESC>', '<ESC>']
    case 'pickup_menu':
    case 'item_description':
    case 'confirmation_dialog':
    case 'look_around':
    case 'generic_menu':
      return ['<ESC>']
    case 'main_menu':
      return ['<ESC>']
    default:
      return ['<ESC>']
  }
}

/** 简单稳定哈希（用于判断画面有没有变化） */
export function screenHash(text) {
  let h = 2166136261
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 解析一屏。
 * @returns {object}
 */
export function parseScreen(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n')
  const lines = raw.split('\n').slice(-200)
  const healthFromScreen = parseHealth(lines)
  const sidebar = parseSidebar(lines)
  const location = parseLocation(lines)
  const items = parseItems(lines)
  const threats = parseThreats(lines)
  const uiState = parseUiState(raw)
  const ui = {
    state: uiState,
    title: parseUiTitle(raw, uiState),
    options: parseUiOptions(raw, uiState),
  }
  return {
    healthFromScreen,
    thirst: sidebar.thirst,
    hunger: sidebar.hunger,
    fatigue: sidebar.fatigue,
    morale: sidebar.morale,
    location,
    visibleItems: items,
    visibleThreats: threats,
    ui,
    hash: screenHash(raw),
  }
}

export function uiLabel(state) {
  return ({
    inventory_organization: '物品栏整理',
    inventory: '物品栏',
    advanced_inventory: '高级物品栏',
    pickup_menu: '拾取菜单',
    confirmation_dialog: '确认框',
    item_description: '物品说明',
    main_menu: '主菜单',
    look_around: '环视',
    generic_menu: '菜单',
  })[state] || state || '游戏'
}
