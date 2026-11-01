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

test('身份：自动发现 family/fish，cwd 命中 child 时用 child', () => {
  const old = process.env.DSH_KIN_FAMILY_ROOT
  const root = mkdtempSync(join(tmpdir(), 'dsh-cdda-family-'))
  try {
    const fish = join(root, 'fish')
    mkdirSync(fish, { recursive: true })
    writeFileSync(join(fish, 'identity.json'), JSON.stringify({ identityId: ID, lineageId: ID }))
    const childDir = join(root, 'children', 'kin_01KC0000000000000000000001')
    mkdirSync(childDir, { recursive: true })
    const childId = 'fish_01KC0000000000000000000001'
    writeFileSync(join(childDir, 'identity.json'), JSON.stringify({ identityId: childId, parentId: ID, lineageId: ID }))
    process.env.DSH_KIN_FAMILY_ROOT = root
    assert.equal(readIdentity({}).identityId, ID)
    assert.equal(readIdentity({}, { cwd: childDir }).identityId, childId)
    assert.equal(readIdentity({}, { cwd: join(root, 'elsewhere') }).identityId, ID)
  } finally {
    if (old === undefined) delete process.env.DSH_KIN_FAMILY_ROOT
    else process.env.DSH_KIN_FAMILY_ROOT = old
    rmSync(root, { recursive: true, force: true })
  }
})

test('身份：多条 child 且 cwd 不命中时回退 shared', () => {
  const old = process.env.DSH_KIN_FAMILY_ROOT
  const root = mkdtempSync(join(tmpdir(), 'dsh-cdda-family2-'))
  try {
    const a = 'fish_01KC0000000000000000000002'
    const b = 'fish_01KC0000000000000000000003'
    for (const id of [a, b]) {
      const d = join(root, 'children', id)
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'identity.json'), JSON.stringify({ identityId: id }))
    }
    process.env.DSH_KIN_FAMILY_ROOT = root
    assert.equal(readIdentity({}, { cwd: '/tmp' }), null)
    assert.equal(readIdentity({}, { cwd: join(root, 'children', a) }).identityId, a)
  } finally {
    if (old === undefined) delete process.env.DSH_KIN_FAMILY_ROOT
    else process.env.DSH_KIN_FAMILY_ROOT = old
    rmSync(root, { recursive: true, force: true })
  }
})

test('身份：新的 ds-fish- + 年月日 + 4 位编码也认（过渡期 330105 也认）', () => {
  const dir = temp()
  try {
    const file = join(dir, 'identity.json')
    const NEW_ID = 'ds-fish-202611010001'
    writeFileSync(file, JSON.stringify({ identityId: NEW_ID, childId: null, lineageId: NEW_ID }))
    const id = readIdentity({ identityFile: file })
    assert.equal(id.identityId, NEW_ID)
    assert.equal(memoryDirOf(dir, id), join(dir, 'memory', NEW_ID))
    assert.equal(id.lineageId, NEW_ID)

    const OLD_ID = '330105202611010001'
    writeFileSync(file, JSON.stringify({ identityId: OLD_ID, lineageId: OLD_ID }))
    assert.equal(readIdentity({ identityFile: file }).identityId, OLD_ID)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
