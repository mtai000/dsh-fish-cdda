/**
 * lib/lessons.mjs —— 父代经验 → 出生包文件 → 子代记忆
 *
 * 文件就放在 identity.json 旁边：
 *   <鱼家>/cdda-lessons.json
 * 只有 skill/confidence>=0.6 的条目会导出；子代只读自己目录里的这一份。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readMemories } from './memory.mjs'

export const LESSON_FILE = 'cdda-lessons.json'

export function lessonsPathOf(identity) {
  if (!identity?.file) return ''
  return join(dirname(identity.file), LESSON_FILE)
}

export function readInheritedLessons(identity) {
  const file = lessonsPathOf(identity)
  if (!file || !existsSync(file)) return []
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (data?.parentId && identity?.parentId && data.parentId !== identity.parentId) return []
    const arr = Array.isArray(data?.lessons) ? data.lessons : []
    return arr.filter((x) => x && typeof x.text === 'string' && x.text.trim())
      .map((x) => ({ text: String(x.text).trim().slice(0, 160), confidence: Number(x.confidence) || 0.6, evidence: String(x.evidence || '').slice(0, 160) }))
  } catch { return [] }
}

/** 导出父代可继承的经验；没有身份/没有经验时返回空。 */
export function exportParentLessons(identity, memoryDir) {
  if (!identity?.file) return { ok: false, count: 0 }
  const lessons = readMemories(memoryDir)
    .filter((x) => (x.scope || 'skill') === 'skill' && Number(x.confidence) >= 0.6)
    .sort((a, b) => Number(b.confidence) - Number(a.confidence))
    .slice(0, 20)
    .map((x) => ({ text: x.text, confidence: x.confidence, evidence: x.evidence || '', scope: 'skill' }))
  const file = lessonsPathOf(identity)
  try {
    writeFileSync(file, JSON.stringify({ v: 1, identityId: identity.identityId, updatedAt: new Date().toISOString(), lessons }, null, 2) + '\n', 'utf8')
  } catch { return { ok: false, count: lessons.length } }
  return { ok: true, count: lessons.length, file }
}
