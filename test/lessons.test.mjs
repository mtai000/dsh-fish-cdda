import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendMemory, readMemories, importInherited } from '../lib/memory.mjs'
import { exportParentLessons, readInheritedLessons, lessonsPathOf } from '../lib/lessons.mjs'

const P = 'fish_01KC0000000000000000000000'
const C = 'fish_01KC0000000000000000000001'

function idFile(dir, id, extra = {}) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'identity.json')
  writeFileSync(file, JSON.stringify({ identityId: id, ...extra }))
  return { identityId: id, file, ...extra }
}

test('经验导出：只导出 skill 且 confidence>=0.6', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cdda-les-'))
  try {
    const id = idFile(dir, P)
    const mem = join(dir, 'memory')
    appendMemory(mem, { text: '水要煮沸', scope: 'skill', confidence: 0.9 })
    appendMemory(mem, { text: '这个基地在东边', scope: 'world', confidence: 0.99 })
    appendMemory(mem, { text: '不确定的经验', scope: 'skill', confidence: 0.3 })
    const r = exportParentLessons(id, mem)
    assert.equal(r.ok, true)
    const data = JSON.parse(readFileSync(lessonsPathOf(id), 'utf8'))
    assert.equal(data.lessons.length, 1)
    assert.equal(data.lessons[0].text, '水要煮沸')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('经验导入：子代只读 parentId 匹配的文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cdda-les2-'))
  try {
    const childDir = join(dir, 'child')
    const child = idFile(childDir, C, { parentId: P })
    writeFileSync(join(childDir, 'cdda-lessons.json'), JSON.stringify({ v: 1, parentId: P, lessons: [{ text: '晚上不要走街道', confidence: 0.8 }] }))
    const inherited = readInheritedLessons(child)
    assert.equal(inherited.length, 1)
    const mem = join(childDir, 'memory')
    const r = importInherited(mem, inherited)
    assert.equal(r.added, 1)
    assert.equal(readMemories(mem)[0].scope, 'inherited')
    const again = importInherited(mem, inherited)
    assert.equal(again.added, 0)
    // parentId 不匹配 -> 不读
    const other = idFile(join(dir, 'other'), C, { parentId: 'fish_01KC0000000000000000000002' })
    writeFileSync(join(dir, 'other', 'cdda-lessons.json'), JSON.stringify({ v: 1, parentId: P, lessons: [{ text: 'x' }] }))
    assert.equal(readInheritedLessons(other).length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
