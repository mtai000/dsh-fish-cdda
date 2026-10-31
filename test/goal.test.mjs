import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureGoal, parseGoal, readGoal, updateGoal } from '../lib/goal.mjs'

test('GoalManager：目标解析', () => {
  assert.deepEqual(parseGoal('survive 3 days'), { type: 'survive', days: 3, raw: 'survive 3 days' })
  assert.equal(parseGoal('活过 5 天').type, 'survive')
  assert.equal(parseGoal('活过 5 天').days, 5)
  assert.equal(parseGoal('find vehicle').type, 'acquire')
  assert.equal(parseGoal('找到水').type, 'acquire')
  assert.equal(parseGoal('随便玩玩').type, 'generic')
})

test('GoalManager：进度、达成、换目标重置', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cdda-goal-'))
  try {
    const start = { ok: true, turn: 0, calendar: { day: 1, hour: 0, minute: 0 } }
    let g = ensureGoal(dir, 'survive 3 days', start)
    assert.equal(g.spec.type, 'survive')
    assert.equal(g.complete, false)

    g = updateGoal(dir, { ...start, turn: 1.5 * 86400, calendar: { day: 2, hour: 12, minute: 0 } })
    assert.equal(g.progress.percent, 50)
    assert.equal(g.complete, false)

    g = updateGoal(dir, { ...start, turn: 3.2 * 86400, calendar: { day: 4, hour: 4, minute: 48 } })
    assert.equal(g.complete, true)
    assert.equal(readGoal(dir).complete, true)

    // 换目标：起点重置，completed 清掉
    g = ensureGoal(dir, 'find vehicle', start)
    assert.equal(g.spec.type, 'acquire')
    assert.equal(g.complete, false)
    g = updateGoal(dir, start, { visibleItems: ['a broken vehicle'] })
    assert.equal(g.complete, true)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
