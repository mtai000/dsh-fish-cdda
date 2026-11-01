import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { identityPathOf, memoryDirOf, readIdentity } from '../lib/identity.mjs'

const ID = 'fish_01KC0000000000000000000000'

function temp() { return mkdtempSync(join(tmpdir(), 'dsh-cdda-id-')) }

test('身份：从 identityFile 读取', () => {
  const dir = temp()
  try {
    const file = join(dir, 'identity.json')
    writeFileSync(file, JSON.stringify({ identityId: ID, childId: 'kin_x' }))
    const id = readIdentity({ identityFile: file })
    assert.equal(id.identityId, ID)
    assert.equal(id.childId, 'kin_x')
    assert.equal(memoryDirOf(dir, id), join(dir, 'memory', ID))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('身份：目录会自动补 identity.json', () => {
  const dir = temp()
  try {
    writeFileSync(join(dir, 'identity.json'), JSON.stringify({ identityId: ID }))
    assert.equal(identityPathOf({ identityFile: dir }), join(dir, 'identity.json'))
    assert.equal(readIdentity({ identityFile: dir }).identityId, ID)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('身份：缺失/坏文件回退 shared', () => {
  const dir = temp()
  try {
    assert.equal(readIdentity({ identityFile: join(dir, 'nope.json') }), null)
    writeFileSync(join(dir, 'identity.json'), '{bad')
    assert.equal(readIdentity({ identityFile: join(dir, 'identity.json') }), null)
    assert.equal(memoryDirOf(dir, null), join(dir, 'memory', 'shared'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('身份：环境变量回退', () => {
  const dir = temp()
  const old = process.env.CDDA_DUTY_IDENTITY_FILE
  try {
    writeFileSync(join(dir, 'identity.json'), JSON.stringify({ identityId: ID }))
    process.env.CDDA_DUTY_IDENTITY_FILE = join(dir, 'identity.json')
    assert.equal(readIdentity({}).identityId, ID)
  } finally {
    if (old === undefined) delete process.env.CDDA_DUTY_IDENTITY_FILE
    else process.env.CDDA_DUTY_IDENTITY_FILE = old
    rmSync(dir, { recursive: true, force: true })
  }
})
