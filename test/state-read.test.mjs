import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findWorlds, readGameState } from '../lib/state-read.mjs'

const pluginDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const saveDir = join(pluginDir, 'vendor', 'starter-world', 'save')

test('内置开局存档能被找到', () => {
  const worlds = findWorlds(saveDir)
  assert.ok(worlds.length >= 1)
  assert.equal(worlds[0].name, 'Pena Pobre')
  assert.ok(worlds[0].saves >= 1)
})

test('解析存档硬状态', () => {
  const st = readGameState(saveDir, 'Pena Pobre')
  assert.equal(st.ok, true)
  assert.equal(st.name, 'Jody Anaya')
  assert.equal(st.calendar.day, 61)
  assert.equal(st.calendar.season, '春')
  assert.ok(st.health.pct > 0)
  assert.ok(st.needs.thirst.label.length > 0)
  assert.ok(st.summary.includes('HP'))
  assert.ok(Array.isArray(st.messages))
})
