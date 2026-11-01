import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureStarterWorld } from '../lib/game.mjs'

function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cdda-starter-'))
  mkdirSync(join(dir, 'game', 'save'), { recursive: true })
  return dir
}

test('默认不铺任何存档；插件目录没有 .sav', () => {
  const home = tempHome()
  try {
    const r = ensureStarterWorld({ starterWorld: false }, home, '/nonexistent-plugin', () => {})
    assert.equal(r.ok, true)
    assert.equal(r.skipped, true)
    assert.equal(existsSync(join(home, 'game', 'save', 'x.sav')), false)
  } finally {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})

test('没有外部种子时跳过，不报错', () => {
  const home = tempHome()
  try {
    const r = ensureStarterWorld({ starterWorld: true }, home, '/nonexistent-plugin', () => {})
    assert.equal(r.ok, true)
    assert.equal(r.skipped, true)
    assert.match(r.reason || '', /starter-world/)
  } finally {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})

test('外部种子只复制到 home，不写插件目录', () => {
  const home = tempHome()
  const seed = join(home, 'starter-world', 'save', 'SeedWorld')
  mkdirSync(seed, { recursive: true })
  writeFileSync(join(seed, 'player.sav'), '# version 33\n{}', 'utf8')
  try {
    const r = ensureStarterWorld({ starterWorld: true }, home, '/nonexistent-plugin', () => {})
    assert.equal(r.ok, true)
    assert.equal(r.copied, true)
    assert.equal(existsSync(join(home, 'game', 'save', 'SeedWorld', 'player.sav')), true)
    assert.equal(existsSync('/nonexistent-plugin/game/save'), false)
  } finally {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
