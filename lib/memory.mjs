/**
 * lib/memory.mjs —— CDDA 自己的经验（按身份目录隔离）
 *
 * 只存“可复用的教训/发现”，不存屏幕原文。每条明确是假设，
 * 注入时必须带“用屏幕验证”的声明；错误经验可以人工删。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_MEMORIES = 200
export const DEFAULT_ITEMS = 10
export const DEFAULT_CHARS = 4000
export const HEADER = '## 我自己的经验（假设，不是攻略；必须用屏幕验证）'

const SCOPES = new Set(['skill', 'world', 'inherited'])

function clip(s, n) {
  const v = String(s || '').replace(/\s+/g, ' ').trim()
  return v.length <= n ? v : v.slice(0, Math.max(0, n - 1)) + '…'
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function memoryPath(dir) { return join(dir, 'memory.jsonl') }

export function ensureMemoryDir(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch { /* 让写入报 */ }
  return dir
}

export function readMemories(dir) {
  try {
    const raw = readFileSync(memoryPath(dir), 'utf8')
    const out = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const x = JSON.parse(line)
        if (x && typeof x.text === 'string' && x.text.trim()) out.push(x)
      } catch { /* 坏行跳过 */ }
    }
    return out
  } catch { return [] }
}

function writeAll(dir, rows) {
  ensureMemoryDir(dir)
  const file = memoryPath(dir)
  const tmp = file + '.tmp-' + process.pid
  const body = rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : '')
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, file)
}

function score(x, now = Date.now()) {
  const t = Date.parse(x.ts || '') || 0
  const ageDays = t ? Math.max(0, (now - t) / 86_400_000) : 30
  return (Number(x.confidence) || 0) * 2 + Math.min(3, Number(x.hits) || 1) * 0.3 + Math.max(0, 1 - ageDays / 30)
}

/** 写一条；完全重复（归一化后相同）合并 hits/confidence。 */
export function appendMemory(dir, entry = {}) {
  const text = clip(entry.text, 500)
  if (!text) return { ok: false, error: 'text 不能为空', count: readMemories(dir).length }
  const scope = SCOPES.has(entry.scope) ? entry.scope : 'skill'
  const rows = readMemories(dir)
  const key = norm(text)
  const hit = rows.find((x) => norm(x.text) === key && (x.scope || 'skill') === scope)
  if (hit) {
    hit.hits = (Number(hit.hits) || 1) + 1
    hit.confidence = Math.max(Number(hit.confidence) || 0, Math.min(1, Number(entry.confidence) || 0.5))
    hit.lastUsedAt = new Date().toISOString()
    if (entry.evidence && !hit.evidence) hit.evidence = clip(entry.evidence, 300)
    writeAll(dir, rows)
    return { ok: true, merged: true, count: rows.length, item: hit }
  }
  const item = {
    id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    scope,
    worldId: entry.worldId ? String(entry.worldId) : null,
    text,
    evidence: clip(entry.evidence, 300),
    confidence: Math.max(0, Math.min(1, Number(entry.confidence) || 0.5)),
    hits: 1,
    lastUsedAt: null,
    source: String(entry.source || 'model').slice(0, 40),
  }
  rows.push(item)
  rows.sort((a, b) => score(b) - score(a))
  writeAll(dir, rows.slice(0, MAX_MEMORIES))
  return { ok: true, merged: false, count: Math.min(rows.length, MAX_MEMORIES), item }
}

function terms(text) {
  const s = String(text || '').toLowerCase()
  return [...new Set(s.match(/[\p{Script=Han}]{1,4}|[a-z0-9_]{2,}/gu) || [])].slice(0, 30)
}

/** 按 world 过滤，按相关度/置信度/次数/新近排序，硬上限。 */
export function selectMemories(dir, { goal = '', worldId = '', maxItems = DEFAULT_ITEMS, maxChars = DEFAULT_CHARS } = {}) {
  const all = readMemories(dir).filter((x) => {
    const scope = x.scope || 'skill'
    if (scope === 'world') return Boolean(worldId) && String(x.worldId || '') === String(worldId)
    return scope === 'skill' || scope === 'inherited'
  })
  const goalTerms = terms(goal)
  const ranked = all.map((x) => {
    const text = String(x.text || '').toLowerCase()
    const overlap = goalTerms.filter((t) => text.includes(t)).length
    return { ...x, _score: score(x) + overlap * 0.5 }
  }).sort((a, b) => b._score - a._score)

  const items = []
  let text = ''
  const limitItems = Math.max(1, Math.min(50, Number(maxItems) || DEFAULT_ITEMS))
  const limitChars = Math.max(200, Math.min(30_000, Number(maxChars) || DEFAULT_CHARS))
  for (const x of ranked) {
    if (items.length >= limitItems) break
    const line = `- ${x.text}${x.evidence ? `（依据：${x.evidence}）` : ''}`
    const next = [HEADER, ...items.map((i) => `- ${i.text}${i.evidence ? `（依据：${i.evidence}）` : ''}`), line].join('\n')
    if (next.length > limitChars) break
    items.push(x)
    text = next
  }
  if (!items.length) return { items: [], text: '', count: all.length }
  return { items, text, count: all.length }
}

export function clearMemories(dir) {
  try { writeAll(dir, []) } catch { /* 忽略 */ }
  return { ok: true, count: 0 }
}

export function memoryCount(dir) {
  return readMemories(dir).length
}

export { existsSync }
