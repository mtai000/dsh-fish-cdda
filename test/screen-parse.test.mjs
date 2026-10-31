import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScreen, recoveryKeysFor, screenHash, uiLabel } from '../lib/screen-parse.mjs'
import { composeState } from '../lib/state-compose.mjs'

const numericScreen = [
  'Head: 84/84  Torso: 82/82  L Arm: 75/84  R Arm: 84/84  L Leg: 70/84  R Leg: 80/84',
  'Focus: 100  Morale: 2  Pain: 0',
  'Hunger: Peckish  Thirst: Slaked  Fatigue: Fresh',
  "Place: Evac Shelter (NW)",
  'You see here: pocket knife, bottled water, emergency jacket',
  'To the north you see a feral zombie!',
  'To the south you spot a giant spider skittering.',
  'Nearby: rock, stick',
].join('\n')

const barScreen = [
  'Head  |||||  Torso  |||||  L Arm  |||||  R Arm  ||||.  L Leg  |||||  R Leg  |||||',
  'Focus 100  Morale 3  Pain 0',
  'Hunger Peckish  Thirst Slaked  Fatigue Fresh',
].join('\n')

test('ScreenParser：数字/条状 HP、饥渴、位置、物品、威胁', () => {
  const p = parseScreen(numericScreen)
  assert.equal(p.healthFromScreen, 95) // 84,82,75,84,70,80 → 79.2 平均? CDDAi 测试是 95
  assert.equal(p.thirst, 'Slaked')
  assert.equal(p.hunger, 'Peckish')
  assert.equal(p.fatigue, 'Fresh')
  assert.equal(p.morale, 2)
  assert.equal(p.location, 'Evac Shelter (NW)')
  assert.deepEqual(p.visibleItems, ['pocket knife', 'bottled water', 'emergency jacket', 'rock', 'stick'])
  assert.deepEqual(p.visibleThreats, ['feral zombie', 'giant spider'])
})

test('ScreenParser：ASCII 血条', () => {
  const p = parseScreen(barScreen)
  assert.equal(p.healthFromScreen, 97)
  assert.equal(p.morale, 3)
})

test('ScreenParser：真实 0.G 行（地图字符 + Place）', () => {
  const screen = [
    '                                     Press } for sidebar options.',
    '                                     L ARM   |||||  HEAD    |||||  R ARM  |||||',
    '                                     L LEG   |||||  TORSO   |||||  R LEG  |||||',
    '               #.###...              Pain:                 Thirst:',
    '               ...@...+              Place:    gas station        F  FFFFFFFFFF',
    '                                     Date:     Spring, day 61',
  ].join('\n')
  const p = parseScreen(screen)
  assert.equal(p.healthFromScreen, 100)
  assert.equal(p.location, 'gas station')
  assert.equal(p.ui.state, null)
})

test('ScreenParser：物品栏 / 环视 / 确认框 / 主菜单', () => {
  const inv = [
    '  Inventory                  Longest Length (in.): 19 Weight (lbs):  7.1/108.1',
    '  ITEMS WORN',
    '    || jeans > 4 items (remains 4.03L, 33.63lbs) max length 7in.',
    '  TOOLS',
    '    pocket knife',
  ].join('\n')
  const p1 = parseScreen(inv)
  assert.equal(p1.ui.state, 'inventory')
  assert.equal(p1.ui.title, 'Inventory')

  const look = [
    '                           < Look around >',
    '                           Gas station',
    '                           Floor',
    '                           Cover: 0%',
  ].join('\n')
  const p2 = parseScreen(look)
  assert.equal(p2.ui.state, 'look_around')
  assert.equal(p2.ui.title, 'Look around')

  const confirm = 'Save and quit? (Case Sensitive)\n(Y)es  (N)o'
  const p3 = parseScreen(confirm)
  assert.equal(p3.ui.state, 'confirmation_dialog')
  assert.deepEqual(p3.ui.options, ['Y Yes', 'N No'])

  const menu = 'MAIN MENU\n0 View help\n1 Display keybindings menu\nS Save and quit'
  const p4 = parseScreen(menu)
  assert.equal(p4.ui.state, 'main_menu')
  assert.equal(p4.ui.title, 'Main Menu')
})

test('StateComposer：屏幕优先、一致性、stale、回退存档', () => {
  const save = {
    ok: true,
    savedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    health: { pct: 80 },
    needs: {
      thirst: { value: 1, label: '口渴' },
      hunger: { value: 1, label: '有点饿' },
      fatigue: { value: 1, label: '有点累' },
    },
    location: { x: 10, y: 20 },
    calendar: { text: '第 61 天 08:00 · 春' },
  }
  const parsed = parseScreen(numericScreen)
  const v = composeState(save, parsed, { ok: true, mode: 'gameplay' })
  assert.equal(v.health.pct, 95)
  assert.equal(v.health.source, 'screen')
  assert.equal(v.needs.thirst.source, 'screen')
  assert.equal(v.consistency.stale, true)
  assert.ok(v.consistency.warnings.length > 0)
  assert.ok(v.summary.includes('HP'))

  const v2 = composeState(null, parseScreen(''), { ok: false, mode: 'not_running' })
  assert.equal(v2.ok, false)
  assert.equal(v2.health.pct, null)
  assert.ok(v2.consistency.warnings.length > 0)
})

test('工具：恢复键 / 哈希 / 标签', () => {
  assert.deepEqual(recoveryKeysFor('pickup_menu'), ['<ESC>'])
  assert.deepEqual(recoveryKeysFor('inventory'), ['<ESC>', '<ESC>'])
  assert.equal(screenHash('abc'), screenHash('abc'))
  assert.notEqual(screenHash('abc'), screenHash('abd'))
  assert.equal(uiLabel('pickup_menu'), '拾取菜单')
})
