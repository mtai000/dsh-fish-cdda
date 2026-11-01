import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_CFG } from '../lib/state.mjs'
import { handleTool, TOOL_SPECS } from '../lib/tools-core.mjs'

const ID = 'fish_01KC0000000000000000000000'

function makeRt(identity = true) {
  const sd = mkdtempSync(join(tmpdir(), 'dsh-cdda-memtool-'))
  const cfg = { ...DEFAULT_CFG, goal: '活下去', identityFile: identity ? join(sd, 'identity.json') : '', memory: true }
  if (identity) writeFileSync(cfg.identityFile, JSON.stringify({ identityId: ID, lineageId: ID }))
  return { sd, cfg, rt: { stateDir: sd, pluginDir: process.cwd(), cfg, source: 'chat', log: () => {}, getCfg: () => cfg } }
}

test('cdda_learn：按身份写入独立目录', async () => {
  const { sd, rt } = makeRt(true)
  try {
    assert.ok(TOOL_SPECS.some((t) => t.name === 'cdda_learn'))
    const r = await handleTool('cdda_learn', { text: '晚上不要走街道', evidence: '被追过', confidence: 0.8 }, rt)
    assert.equal(r.ok, true)
    const file = join(sd, 'memory', ID, 'memory.jsonl')
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((x) => JSON.parse(x))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].text, '晚上不要走街道')
    assert.equal(rows[0].scope, 'skill')
    const exported = JSON.parse(readFileSync(join(sd, 'cdda-lessons.json'), 'utf8'))
    assert.equal(exported.lessons.length, 1)
    assert.equal(exported.lessons[0].text, '晚上不要走街道')
  } finally { rmSync(sd, { recursive: true, force: true }) }
})

test('cdda_learn：无身份写入 shared', async () => {
  const { sd, rt } = makeRt(false)
  try {
    const r = await handleTool('cdda_learn', { text: '水要煮沸' }, rt)
    assert.equal(r.ok, true)
    const rows = readFileSync(join(sd, 'memory', 'shared', 'memory.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x))
    assert.equal(rows[0].text, '水要煮沸')
  } finally { rmSync(sd, { recursive: true, force: true }) }
})

test('cdda_status：带身份和记忆数', async () => {
  const { rt } = makeRt(true)
  try {
    const s = await handleTool('cdda_status', {}, rt)
    assert.equal(s.identity.identityId, ID)
    assert.equal(s.memoryCount, 0)
  } finally { rmSync(rt.stateDir, { recursive: true, force: true }) }
})
