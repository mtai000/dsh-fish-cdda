/**
 * lib/state-read.mjs —— 从 CDDA 的 .sav 里读“硬状态”
 * ============================================================================
 * 屏幕告诉模型“眼前有什么”，存档告诉模型“身体/时间/位置/消息”。
 * CDDA 0.G 的 .sav 是文本：第一行 `# version 33`，第二行起是 JSON。
 * 这个解析是**只读的、尽力而为的**：字段对不上就返回 ok:false，
 * 绝不影响抓屏和按键。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SEASONS = ['春', '夏', '秋', '冬']
const NEED_LABELS = {
  thirst: ['正常', '口渴', '很渴', '极渴', '脱水'],
  hunger: ['正常', '有点饿', '饿', '很饿', '极饿', '快饿死'],
  fatigue: ['精神', '有点累', '累', '很累', '精疲力竭', '快昏倒'],
}

function needLabel(kind, value) {
  const n = Number(value)
  const list = NEED_LABELS[kind] || []
  if (!Number.isFinite(n)) return '未知'
  const idx = Math.max(0, Math.min(list.length - 1, Math.round(n)))
  return list[idx] + (n > list.length - 1 ? `(${n})` : '')
}

/** 返回 save 目录下所有世界（含 .sav 的目录），按最近修改排序 */
export function findWorlds(saveDir) {
  const out = []
  try {
    for (const d of readdirSync(saveDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const dir = join(saveDir, d.name)
      let latest = 0
      let saves = 0
      try {
        for (const f of readdirSync(dir)) {
          if (!f.endsWith('.sav')) continue
          saves++
          try { latest = Math.max(latest, statSync(join(dir, f)).mtimeMs) } catch { /* 忽略 */ }
        }
      } catch { continue }
      if (saves) out.push({ name: d.name, saves, latest })
    }
  } catch { /* 目录不存在 */ }
  out.sort((a, b) => b.latest - a.latest)
  return out
}

export function findNewestSave(saveDir, world) {
  const worlds = findWorlds(saveDir)
  if (!worlds.length) return null
  const w = world ? worlds.find((x) => x.name === world) : worlds[0]
  if (!w) return null
  const dir = join(saveDir, w.name)
  let best = null
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.sav')) continue
      const full = join(dir, f)
      const st = statSync(full)
      if (!best || st.mtimeMs > best.mtimeMs) best = { file: full, mtimeMs: st.mtimeMs, world: w.name }
    }
  } catch { return null }
  return best
}

function parseSaveText(text) {
  const raw = String(text || '')
  const idx = raw.indexOf('\n')
  const first = idx >= 0 ? raw.slice(0, idx) : raw
  const body = first.trim().startsWith('#') && idx >= 0 ? raw.slice(idx + 1) : raw
  return JSON.parse(body)
}

function avgBody(player) {
  const body = player?.body
  const out = { hp: 0, hpMax: 0, parts: [], worst: null }
  if (!body || typeof body !== 'object') return out
  for (const [id, part] of Object.entries(body)) {
    const cur = Number(part?.hp_cur)
    const max = Number(part?.hp_max)
    if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) continue
    out.hp += cur
    out.hpMax += max
    const pct = Math.round((cur / max) * 100)
    out.parts.push({ id, cur, max, pct })
  }
  out.worst = out.parts.length ? out.parts.reduce((a, b) => (b.pct < a.pct ? b : a)) : null
  out.pct = out.hpMax > 0 ? Math.round((out.hp / out.hpMax) * 100) : 0
  return out
}

function topSkills(skills, n = 6) {
  if (!skills || typeof skills !== 'object') return []
  return Object.entries(skills)
    .map(([id, v]) => ({ id, level: Number(v?.level) || 0 }))
    .filter((s) => s.level > 0)
    .sort((a, b) => b.level - a.level || a.id.localeCompare(b.id))
    .slice(0, n)
}

function recentMessages(container, n = 8) {
  const arr = container?.messages
  if (!Array.isArray(arr)) return []
  return arr.slice(-n).map((m) => ({
    turn: Number(m?.turn) || 0,
    type: m?.type,
    message: String(m?.message || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  })).filter((m) => m.message)
}

/**
 * @returns {{ok:true, ...}|{ok:false, error:string}}
 */
export function readGameState(saveDir, world) {
  try {
    const file = findNewestSave(saveDir, world)
    if (!file) return { ok: false, error: '还没有存档（游戏还没保存过）', saveDir }
    const text = readFileSync(file.file, 'utf8')
    const data = parseSaveText(text)
    const player = data.player && typeof data.player === 'object' ? data.player : {}
    const turn = Number(data.turn) || 0
    const day = Math.floor(turn / 86400) + 1
    const hour = Math.floor((turn % 86400) / 3600)
    const minute = Math.floor((turn % 3600) / 60)
    const season = SEASONS[Math.max(0, Math.min(3, Math.floor((day - 1) / 91) % 4))]
    const health = avgBody(player)
    const loc = Array.isArray(player.location) ? player.location : []
    const messages = recentMessages(data.player_messages)
    const lastMsg = messages.length ? messages[messages.length - 1].message : ''

    const out = {
      ok: true,
      file: file.file,
      world: file.world,
      savedAt: new Date(file.mtimeMs).toISOString(),
      name: String(player.name || player.play_name || '无名幸存者').slice(0, 80),
      turn,
      calendar: { day, hour, minute, season, text: `第 ${day} 天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} · ${season}` },
      location: {
        x: Number(loc[0]) || 0, y: Number(loc[1]) || 0, z: Number(loc[2]) || 0,
        omX: Number(data.om_x) || 0, omY: Number(data.om_y) || 0,
      },
      needs: {
        thirst: { value: Number(player.thirst) || 0, label: needLabel('thirst', player.thirst) },
        hunger: { value: Number(player.hunger) || 0, label: needLabel('hunger', player.hunger) },
        fatigue: { value: Number(player.fatigue) || 0, label: needLabel('fatigue', player.fatigue) },
      },
      health: {
        hp: health.hp, hpMax: health.hpMax, pct: health.pct,
        worst: health.worst ? { id: health.worst.id, pct: health.worst.pct } : null,
      },
      stats: {
        str: Number(player.str_cur) || 0, dex: Number(player.dex_cur) || 0,
        int: Number(player.int_cur) || 0, per: Number(player.per_cur) || 0,
      },
      stamina: Math.round((Number(player.stamina) || 0) / 100),
      focus: Math.round((Number(player.focus_pool) || 0) / 1000),
      pain: Number(player.pain) || 0,
      stim: Number(player.stim) || 0,
      radiation: Number(player.radiation) || 0,
      morale: Array.isArray(player.morale) ? player.morale.length : 0,
      profession: String(player.profession || player.custom_profession || ''),
      scenario: String(player.scenario || ''),
      traits: Array.isArray(player.traits) ? player.traits.slice(0, 20) : [],
      skills: topSkills(player.skills),
      invCount: Array.isArray(player.inv) ? player.inv.length : 0,
      messages,
      lastMessage: lastMsg,
    }
    out.summary = `${out.calendar.text} · HP ${out.health.pct}% · 渴 ${out.needs.thirst.label} · 饿 ${out.needs.hunger.label} · 疲劳 ${out.needs.fatigue.label}`
    return out
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

export function saveExists(saveDir) {
  for (const w of findWorlds(saveDir)) {
    if (w.saves > 0) return true
  }
  return false
}
