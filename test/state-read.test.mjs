import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findWorlds, readGameState } from '../lib/state-read.mjs'

function makeSave() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cdda-save-'))
  const world = join(root, 'Test World')
  mkdirSync(world, { recursive: true })
  const data = {
    turn: 5212800,
    om_x: 0,
    om_y: 0,
    player: {
      name: 'Jody Anaya',
      thirst: 1,
      hunger: 1,
      fatigue: 1,
      str_cur: 9,
      dex_cur: 9,
      int_cur: 5,
      per_cur: 5,
      body: {
        head: { hp_cur: 60, hp_max: 60 },
        torso: { hp_cur: 60, hp_max: 60 },
        arm_l: { hp_cur: 60, hp_max: 60 },
        arm_r: { hp_cur: 60, hp_max: 60 },
        leg_l: { hp_cur: 60, hp_max: 60 },
        leg_r: { hp_cur: 60, hp_max: 60 },
      },
      location: [2935, 363, 0],
      profession: 'unemployed',
      scenario: 'last_delivery',
      skills: { dodge: { level: 3 }, bashing: { level: 2 } },
      inv: [],
      morale: [],
      stamina: 10100,
      focus_pool: 100000,
    },
    player_messages: {
      messages: [{ turn: 5212800, type: 4, message: 'You have learned a new style: Brawling!' }],
    },
  }
  writeFileSync(join(world, 'player.sav'), '# version 33\n' + JSON.stringify(data), 'utf8')
  return { root, saveDir: root }
}

test('存档能被找到', () => {
  const { root, saveDir } = makeSave()
  try {
    const worlds = findWorlds(saveDir)
    assert.equal(worlds.length, 1)
    assert.equal(worlds[0].name, 'Test World')
    assert.equal(worlds[0].saves, 1)
  } finally {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})

test('解析存档硬状态', () => {
  const { root, saveDir } = makeSave()
  try {
    const st = readGameState(saveDir, 'Test World')
    assert.equal(st.ok, true)
    assert.equal(st.name, 'Jody Anaya')
    assert.equal(st.calendar.day, 61)
    assert.equal(st.calendar.season, '春')
    assert.equal(st.health.pct, 100)
    assert.equal(st.needs.thirst.label, '口渴')
    assert.ok(st.summary.includes('HP'))
    assert.equal(st.messages.length, 1)
  } finally {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
