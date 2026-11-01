/**
 * lib/knowledge.mjs —— 把 CDDAi 的 knowledge_base 接进 DSH
 * ============================================================================
 * 来源：CDDAi/data/knowledge_base（MIT），已复制到 data/knowledge_base/。
 * 两层用法：
 *   1. 自动玩每一轮：按当前状态（渴/饿/血/疼/界面/时间）挑 2-5 个章节，
 *      和基础生存 + 核心按键一起注入提示词（默认上限 12000 字符，避免爆上下文）。
 *   2. 工具 `cdda_knowledge`：模型可以按 tag 或关键词查详细内容。
 *
 * 首次加载会把知识库铺到 `<DSH_HOME>/cdda-duty/knowledge/`，用户可以直接改；
 * 改过不会被插件升级覆盖（插件包里的 data 只是首次来源）。
 * ============================================================================
 */
import {
  cpSync, existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { logLine } from './state.mjs'

export const KNOWLEDGE_TAG_FILES = {
  thirst_mechanics: ['mechanics/thirst_system.json'],
  hunger_mechanics: ['mechanics/hunger_system.json'],
  water_sources: ['items/water_sources.json'],
  food_sources: ['items/food_items.json'],
  crafting: ['recipes/early_game_crafting.json'],
  combat_tactics: ['guides/combat_tactics.md'],
  healing: ['mechanics/health_system.json'],
  item_identification: ['items/tools_basic.json'],
  menu_navigation: ['guides/menu_navigation.md'],
  general_survival: ['guides/early_game_strategy.md'],
  fatigue: ['mechanics/fatigue_system.json'],
  morale: ['mechanics/morale_system.json'],
  temperature: ['mechanics/temperature_system.json'],
  materials: ['items/materials_basic.json'],
}

export const TAG_HELP = {
  thirst_mechanics: '口渴等级、速度/健康惩罚、喝水节奏',
  hunger_mechanics: '饥饿等级、热量/士气影响',
  water_sources: '干净水/井水/雨水/河水，净化与煮沸',
  food_sources: '早期食物、热量、腐败',
  crafting: '早期制作配方与材料',
  combat_tactics: '打还是跑、体力、地形与撤退',
  healing: '受伤、出血、感染、包扎与恢复',
  item_identification: '常见工具/容器/武器',
  menu_navigation: '物品栏/拾取菜单的按键流程',
  general_survival: '第一天的优先级与早期路线',
  fatigue: '疲劳/睡眠/体力',
  morale: '士气与心情',
  temperature: '温度/保暖/潮湿',
  materials: '基础材料与用途',
}

const BASELINE_FILES = ['guides/basic_survival.md']
const MAX_FILE_CHARS = 6000
const CACHE = new Map()

function readText(file) {
  try { return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n') } catch { return '' }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function clip(text, max) {
  const s = String(text || '')
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 18)).trimEnd() + '\n…（内容已截断）'
}

/** 把 CDDAi 的 JSON knowledge 转成可读文本（跟它的 _format_json_knowledge 一个口径） */
export function formatValue(value, depth = 0) {
  if (value == null) return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    if (value.every((v) => v == null || typeof v !== 'object')) {
      return value.map((v) => String(v ?? '')).join(' / ')
    }
    // recipe components 是 [[{item}, {item}], ...]：每组是“任选其一”
    if (value.every((v) => Array.isArray(v))) {
      return value.map((group) => group.map((v) => formatValue(v, depth + 1)).join(' 或 ')).join('；')
    }
    return value.map((v) => formatValue(v, depth + 1)).join(' / ')
  }
  if (depth > 4) return '[…]'
  const entries = Object.entries(value)
    .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
  if (!entries.length) return ''
  return entries.map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`).join(', ')
}

export function formatJsonKnowledge(data) {
  if (!data || typeof data !== 'object') return ''
  const topic = String(data.topic || 'knowledge')
  const summary = String(data.summary || '').trim()
  const details = data.details && typeof data.details === 'object' ? data.details : {}
  const lines = [`${topic.toUpperCase()}:`, summary].filter(Boolean)
  for (const [key, value] of Object.entries(details)) {
    lines.push(`\n${key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}:`)
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          const pretty = formatValue(item, 1)
          lines.push(pretty ? `  - ${pretty}` : '  -')
        } else {
          lines.push(`  - ${item}`)
        }
      }
    } else if (value && typeof value === 'object') {
      lines.push('  ' + formatValue(value, 1))
    } else {
      lines.push(`  ${value}`)
    }
  }
  return clip(lines.join('\n').trim(), MAX_FILE_CHARS)
}

function compactKeybindings(dir) {
  const data = readJson(join(dir, 'keybindings', 'cdda_controls.json'), null)
  const all = data?.details?.keybindings
  if (!Array.isArray(all)) return ''
  const rows = all
    .filter((b) => b && b.context === 'defaultmode' && b.key && b.action)
    .map((b) => `- ${b.key}: ${b.action}${b.category ? `  [${b.category}]` : ''}`)
  if (!rows.length) return ''
  return clip('核心按键（defaultmode）：\n' + rows.join('\n'), 5000)
}

export class KnowledgeBase {
  constructor(dir) {
    this.dir = dir
    this._baseline = undefined
    this._cache = new Map()
  }

  exists() {
    try { return statSync(this.dir).isDirectory() } catch { return false }
  }

  listTags() {
    return Object.keys(KNOWLEDGE_TAG_FILES)
  }

  /** 基础包：基础生存 + 核心按键。每次注入都会带。 */
  baseline() {
    if (this._baseline !== undefined) return this._baseline
    const parts = []
    for (const rel of BASELINE_FILES) {
      const text = readText(join(this.dir, rel))
      if (text.trim()) parts.push(text.trim())
    }
    const kb = compactKeybindings(this.dir)
    if (kb) parts.push(kb)
    this._baseline = parts.join('\n\n')
    return this._baseline
  }

  tag(tag, { includeBaseline = false, maxChars = 12000 } = {}) {
    const key = `tag:${tag}:${includeBaseline}:${maxChars}`
    if (this._cache.has(key)) return this._cache.get(key)
    const content = this._tagContent(tag)
    const out = content
      ? clip((includeBaseline ? this.baseline() + '\n\n' : '') + `## ${tag.replace(/_/g, ' ')}\n${content}`, maxChars)
      : ''
    this._cache.set(key, out)
    return out
  }

  /**
   * 按 tags 拼一段知识；baseline 永远在前，超出 maxChars 就截断并停止。
   */
  load(tags = [], { maxChars = 12000, includeBaseline = true } = {}) {
    const list = [...new Set((tags || []).map((t) => String(t || '').trim()).filter(Boolean))]
    const key = `load:${list.join('|')}:${maxChars}:${includeBaseline}`
    if (this._cache.has(key)) return this._cache.get(key)
    const parts = []
    let total = 0
    if (includeBaseline) {
      const base = this.baseline()
      if (base) { parts.push(base); total += base.length }
    }
    for (const tag of list) {
      const content = this._tagContent(tag)
      if (!content) continue
      const header = `\n\n## ${tag.replace(/_/g, ' ')}\n`
      const room = maxChars - total - header.length
      if (room <= 200) break
      const body = content.length > room ? clip(content, room) : content
      parts.push(header + body)
      total += header.length + body.length
      if (total >= maxChars) break
    }
    const out = clip(parts.join(''), maxChars)
    this._cache.set(key, out)
    return out
  }

  _tagContent(tag) {
    const files = KNOWLEDGE_TAG_FILES[tag] || []
    const parts = []
    for (const rel of files) {
      const file = join(this.dir, rel)
      if (!existsSync(file)) continue
      if (rel.endsWith('.json')) {
        const data = readJson(file, null)
        if (data) parts.push(formatJsonKnowledge(data))
      } else {
        const text = readText(file).trim()
        if (text) parts.push(clip(text, MAX_FILE_CHARS))
      }
    }
    return parts.join('\n\n').trim()
  }

  /** 关键词检索：返回文件/行号/片段，适合 `cdda_knowledge query=...` */
  search(query, limit = 6) {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return []
    const terms = q.split(/\s+/).filter(Boolean)
    const files = []
    const walk = (dir) => {
      let ents = []
      try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.(md|json)$/i.test(e.name)) files.push(full)
      }
    }
    walk(this.dir)
    const scan = (matcher, cap) => {
      const out = []
      for (const file of files) {
        const rel = relative(this.dir, file).replace(/\\/g, '/')
        if (['CHANGELOG.md', 'VALIDATION_REPORT.md', 'README.md'].includes(rel)) continue
        const lines = readText(file).split('\n')
        for (let i = 0; i < lines.length; i++) {
          const lower = lines[i].toLowerCase()
          if (!matcher(lower)) continue
          out.push({ file: rel, line: i + 1, text: lines[i].replace(/\s+/g, ' ').trim().slice(0, 300) })
          if (out.length >= cap) return out
        }
      }
      return out
    }
    // 先找整串 / 所有词都在同一行；没有就放宽到任意一个词
    const exact = scan((line) => line.includes(q) || terms.every((t) => line.includes(t)), limit)
    return exact.length ? exact : scan((line) => terms.some((t) => line.includes(t)), limit)
  }
}

export function knowledgeDirOf(pluginDir, stateDir) {
  const home = join(stateDir, 'knowledge')
  try { if (statSync(home).isDirectory()) return home } catch { /* 用 vendor */ }
  return join(pluginDir, 'data', 'knowledge_base')
}

/** 首次运行把知识库铺到家里，之后用户可改；升级不覆盖 */
export function ensureKnowledge(pluginDir, stateDir, log = () => {}) {
  const home = join(stateDir, 'knowledge')
  const src = join(pluginDir, 'data', 'knowledge_base')
  const want = readText(join(src, '.version')).trim()
  let hasHome = false
  try { hasHome = statSync(home).isDirectory() } catch { /* 继续铺 */ }
  if (hasHome) {
    const got = readText(join(home, '.version')).trim()
    // 老版本没有 .version：升级到中文版时备份旧副本再覆盖，避免用户改过的内容直接丢
    if (!want || got === want) return home
    const backup = `${home}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      cpSync(home, backup, { recursive: true })
      log(`知识库升级：旧副本备份到 ${backup}`)
    } catch { /* 备份失败也继续，至少让新版可用 */ }
    try {
      cpSync(src, home, { recursive: true, force: true })
      log(`知识库已更新到 ${want}（${home}）`)
      return home
    } catch (e) {
      log(`知识库升级失败，保留旧副本：${String(e?.message ?? e)}`)
      return home
    }
  }
  try {
    cpSync(src, home, { recursive: true })
    log(`知识库已铺到 ${home}`)
    return home
  } catch (e) {
    log(`知识库铺到家里失败，直接用 data：${String(e?.message ?? e)}`)
    return src
  }
}

function kbFor(dir) {
  // 按目录短期缓存（知识库 200KB）；30 秒后重建，用户改 home/knowledge 能生效
  const hit = CACHE.get(dir)
  if (hit && Date.now() - hit.at < 30_000) return hit.kb
  const kb = new KnowledgeBase(dir)
  CACHE.set(dir, { kb, at: Date.now() })
  return kb
}

export function loadKnowledge(dir, tags, opts = {}) {
  try { return kbFor(dir).load(tags, opts) } catch { return '' }
}

export function searchKnowledge(dir, query, limit = 6) {
  try { return kbFor(dir).search(query, limit) } catch { return [] }
}

/**
 * 按当前状态选 tag。输入来自 state-read.mjs 的 readGameState()。
 * @returns {string[]} 按紧急程度排序，最多 6 个
 */
export function suggestTags(state, mode = 'unknown', screen = null) {
  const score = new Map()
  const add = (tag, n) => {
    if (!KNOWLEDGE_TAG_FILES[tag]) return
    score.set(tag, Math.max(score.get(tag) || 0, n))
  }

  if (mode && mode !== 'gameplay') add('menu_navigation', 9)
  if (screen?.ui?.state) add('menu_navigation', 8)
  if (Array.isArray(screen?.visibleThreats) && screen.visibleThreats.length) add('combat_tactics', 9)
  if (Number(screen?.healthFromScreen) > 0 && Number(screen.healthFromScreen) < 60) add('healing', 8)

  const pl = state && state.ok ? state : null
  if (pl) {
    const thirst = Number(pl.needs?.thirst?.value)
    if (Number.isFinite(thirst) && thirst >= 1) {
      add('thirst_mechanics', thirst >= 2 ? 9 : 4)
      add('water_sources', thirst >= 2 ? 10 : 4)
    }
    const hunger = Number(pl.needs?.hunger?.value)
    if (Number.isFinite(hunger) && hunger >= 1) {
      add('hunger_mechanics', hunger >= 2 ? 9 : 4)
      add('food_sources', hunger >= 2 ? 10 : 4)
    }
    const fatigue = Number(pl.needs?.fatigue?.value)
    if (Number.isFinite(fatigue) && fatigue >= 2) add('fatigue', fatigue >= 3 ? 8 : 5)

    const hp = Number(pl.health?.pct)
    if (Number.isFinite(hp) && hp > 0) {
      if (hp < 50) { add('healing', 10); add('combat_tactics', 8) }
      else if (hp < 75) add('healing', 6)
    }
    const pain = Number(pl.pain)
    if (Number.isFinite(pain) && pain >= 10) add('healing', Math.max(score.get('healing') || 0, 6))
    if (Number(pl.radiation) > 0) add('healing', 7)

    const msg = [pl.lastMessage, ...(Array.isArray(pl.messages) ? pl.messages.slice(-4).map((m) => m.message) : [])]
      .filter(Boolean).join(' ')
    if (/bleed|wound|hurt|pain|infect|poison/i.test(msg)) add('healing', 8)
    if (/zombie|monster|hostile|attack|brute|hulk|shocker|acid/i.test(msg)) add('combat_tactics', 8)

    const day = Number(pl.calendar?.day) || 0
    if (day >= 2) add('crafting', 3)
    if (Number(pl.invCount) > 0) add('item_identification', 2)
  }

  // 早期路线总是值得看一眼；基础生存已经在 baseline 里
  add('general_survival', 2)

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([tag]) => tag)
}

/**
 * 给自动玩一轮用的知识块。
 * @returns {{tags:string[], text:string}}
 */
export function knowledgeForState(dir, state, mode = 'unknown', { maxChars = 12000, screen = null } = {}) {
  const tags = suggestTags(state, mode, screen)
  const text = loadKnowledge(dir, tags, { maxChars, includeBaseline: true })
  return { tags, text }
}

export function knowledgeSummary() {
  return Object.entries(KNOWLEDGE_TAG_FILES).map(([tag, files]) => ({
    tag,
    help: TAG_HELP[tag] || '',
    files,
  }))
}
