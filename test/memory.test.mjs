import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendMemory, clearMemories, readMemories, selectMemories } from '../lib/memory.mjs'

function temp() { return mkdtempSync(join(tmpdir(), 'dsh-cdda-mem-')) }

test('记忆：写入/读取/完全重复合并', () => {
  const dir = temp()
  try {
    const a = appendMemory(dir, { text: '晚上不要走街道', confidence: 0.6, scope: 'skill' })
    assert.equal(a.count, 1)
    const b = appendMemory(dir, { text: ' 晚上不要走街道 ', confidence: 0.9, scope: 'skill' })
    assert.equal(b.count, 1)
    assert.equal(b.merged, true)
    const rows = readMemories(dir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].hits, 2)
    assert.equal(rows[0].confidence, 0.9)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('记忆：最多 200 条', () => {
  const dir = temp()
  try {
    for (let i = 0; i < 205; i++) appendMemory(dir, { text: `经验 ${i}`, confidence: 0.5 })
    assert.equal(readMemories(dir).length, 200)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('记忆：world 只给同一世界，skill 都给', () => {
  const dir = temp()
  try {
    appendMemory(dir, { text: '这个基地在东边', scope: 'world', worldId: 'w1', confidence: 0.8 })
    appendMemory(dir, { text: '这个基地在西边', scope: 'world', worldId: 'w2', confidence: 0.9 })
    appendMemory(dir, { text: '水要煮沸', scope: 'skill', confidence: 0.7 })
    const r = selectMemories(dir, { worldId: 'w1', goal: '找水', maxItems: 10, maxChars: 4000 })
    assert.equal(r.items.length, 2)
    assert.ok(r.text.includes('这个基地在东边'))
    assert.ok(!r.text.includes('这个基地在西边'))
    assert.ok(r.text.includes('水要煮沸'))
    assert.match(r.text, /假设/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('记忆：注入条数和字符上限', () => {
  const dir = temp()
  try {
    for (let i = 0; i < 30; i++) appendMemory(dir, { text: `经验 ${i} `.repeat(20), confidence: 0.9 })
    const r = selectMemories(dir, { maxItems: 5, maxChars: 300 })
    assert.ok(r.items.length <= 5)
    assert.ok(r.text.length <= 300)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('记忆：清空', () => {
  const dir = temp()
  try {
    appendMemory(dir, { text: 'x' })
    assert.equal(clearMemories(dir).count, 0)
    assert.equal(readMemories(dir).length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
