import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanScreen, detectMode, displayWidth, padDisplay, truncDisplay } from '../lib/parse.mjs'

const gameplay = `
                                     Press } for sidebar options.
                #.###.               Pain:
                ..@...               Place:    gas station
                {##&#.               Date:     Spring, day 61
                                     Time:     8:00:00 AM
`

test('cleanScreen 去掉 ANSI / 控制字符 / 非法字节', () => {
  const raw = '\x1b[31m红\x1b[0m \uFFFD \x00 \x07 测试\r\n第二行  \r\n\r\n'
  const out = cleanScreen(raw)
  assert.equal(out, '红       测试\n第二行')
})

test('detectMode: gameplay', () => {
  assert.equal(detectMode(gameplay), 'gameplay')
})

test('detectMode: 菜单/语言/死亡/对话框', () => {
  assert.equal(detectMode('[MOTD] [New Game] [Load] [World]'), 'main_menu')
  assert.equal(detectMode('Select your language\n1 English'), 'language')
  assert.equal(detectMode('Are you SURE you\'re finished? (Y)es (N)o'), 'dialog')
  assert.equal(detectMode('You died.'), 'death')
  assert.equal(detectMode('Custom Character\nPlay Now!'), 'char_select')
  assert.equal(detectMode('< Create World >\nWorld name: Foo\n[f][ Finish ]'), 'world_create')
})

test('CJK 宽度与截断', () => {
  assert.equal(displayWidth('中文ab'), 6)
  assert.equal(displayWidth('ab'), 2)
  assert.equal(truncDisplay('中文测试', 5), '中文…')
  assert.equal(padDisplay('ab', 5), 'ab   ')
})
