import test from 'node:test'
import assert from 'node:assert/strict'
import { parseKeys } from '../lib/keys.mjs'

test('单字符原样发送', () => {
  assert.deepEqual(parseKeys('e'), { ok: true, data: 'e', label: 'e' })
  assert.deepEqual(parseKeys('jjj'), { ok: true, data: 'jjj', label: 'jjj' })
  assert.deepEqual(parseKeys(' '), { ok: true, data: ' ', label: 'SPACE' })
})

test('具名键整串翻译', () => {
  assert.equal(parseKeys('RETURN').data, '\n')
  assert.equal(parseKeys('UP ARROW').data, '\x1b[A')
  assert.equal(parseKeys('esc').data, '\x1b')
  assert.equal(parseKeys('f5').data, '\x1b[15~')
})

test('尖括号混写', () => {
  const r = parseKeys('jj<RETURN>i')
  assert.equal(r.ok, true)
  assert.equal(r.data, 'jj\ni')
  assert.equal(parseKeys('<ESC>i').data, '\x1bi')
})

test('不认识的键报错', () => {
  const r = parseKeys('<NOPE>')
  assert.equal(r.ok, false)
  assert.match(r.error, /不认识/)
})

test('空输入报错', () => {
  assert.equal(parseKeys('').ok, false)
  assert.equal(parseKeys(undefined).ok, false)
})
