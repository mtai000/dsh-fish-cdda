import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  KnowledgeBase, ensureKnowledge, knowledgeDirOf, knowledgeForState,
  searchKnowledge, suggestTags,
} from '../lib/knowledge.mjs'

const pluginDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const kbDir = join(pluginDir, 'data', 'knowledge_base')

test('知识库：基础包 + tag 加载', () => {
  const kb = new KnowledgeBase(kbDir)
  const base = kb.baseline()
  assert.match(base, /基础生存|Basic Survival/)
  assert.match(base, /核心按键|KEYBINDINGS/)
  const text = kb.load(['water_sources', 'thirst_mechanics'], { maxChars: 12000 })
  assert.match(text, /WATER_SOURCES|water_sources/i)
  assert.match(text, /THIRST_SYSTEM|thirst_system/i)
  assert.ok(text.length <= 12000)
})

test('知识库：按状态选 tag', () => {
  const state = {
    ok: true,
    needs: { thirst: { value: 3 }, hunger: { value: 2 }, fatigue: { value: 3 } },
    health: { pct: 45 },
    pain: 12,
    calendar: { day: 3 },
    messages: [{ message: 'You are bleeding!' }],
    invCount: 2,
    lastMessage: 'a zombie attacks',
  }
  const tags = suggestTags(state, 'gameplay')
  assert.ok(tags.includes('water_sources'))
  assert.ok(tags.includes('thirst_mechanics'))
  assert.ok(tags.includes('healing'))
  assert.ok(tags.length <= 6)
  assert.equal(suggestTags(state, 'main_menu').includes('menu_navigation'), true)
})

test('知识库：关键词检索', () => {
  const r = searchKnowledge(kbDir, '煮沸', 5)
  assert.ok(r.length > 0)
  assert.ok(r.some((x) => /煮沸/.test(x.text)))
  assert.ok(r.every((x) => !/VALIDATION_REPORT/.test(x.file)))
})

test('知识库：配方嵌套对象不会变成 [object Object]', () => {
  const text = new KnowledgeBase(kbDir).load(['crafting'], { maxChars: 12000 })
  assert.doesNotMatch(text, /\[object Object\]/)
  assert.match(text, /木棍|木板|石斧/)
})

test('知识库：首次铺到家里且可读', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cdda-kb-'))
  try {
    // 模拟一个带 data/knowledge_base 的插件目录
    const fakePlugin = join(home, 'plugin')
    mkdirSync(join(fakePlugin, 'data'), { recursive: true })
    cpSync(kbDir, join(fakePlugin, 'data', 'knowledge_base'), { recursive: true })
    const dir = ensureKnowledge(fakePlugin, home, () => {})
    assert.ok(existsSync(join(dir, 'guides', 'basic_survival.md')))
    assert.ok(existsSync(join(dir, '.version')))
    assert.equal(knowledgeDirOf(fakePlugin, home), dir)
    const k = knowledgeForState(dir, { ok: true, needs: { thirst: { value: 2 } }, health: { pct: 100 } }, 'gameplay', { maxChars: 8000 })
    assert.ok(k.tags.length > 0)
    assert.ok(k.text.length > 1000)
    assert.ok(k.text.length <= 8000)
  } finally {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})


test('知识库：旧副本没有 .version 时备份并升级到中文版', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cdda-kb-upgrade-'))
  try {
    const fakePlugin = join(home, 'plugin')
    mkdirSync(join(fakePlugin, 'data'), { recursive: true })
    cpSync(kbDir, join(fakePlugin, 'data', 'knowledge_base'), { recursive: true })
    mkdirSync(join(home, 'knowledge'), { recursive: true })
    writeFileSync(join(home, 'knowledge', 'guides.md'), 'old english knowledge', 'utf8')
    const dir = ensureKnowledge(fakePlugin, home, () => {})
    assert.equal(dir, join(home, 'knowledge'))
    assert.match(readFileSync(join(dir, 'guides', 'basic_survival.md'), 'utf8'), /基础生存/)
    assert.ok(existsSync(join(dir, '.version')))
    const backups = readdirSync(home).filter((x) => x.startsWith('knowledge.bak-'))
    assert.equal(backups.length, 1)
  } finally {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
