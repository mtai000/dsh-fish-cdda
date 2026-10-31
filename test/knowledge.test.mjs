import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  KnowledgeBase, ensureKnowledge, knowledgeDirOf, knowledgeForState,
  searchKnowledge, suggestTags,
} from '../lib/knowledge.mjs'

const pluginDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const kbDir = join(pluginDir, 'vendor', 'knowledge_base')

test('知识库：基础包 + tag 加载', () => {
  const kb = new KnowledgeBase(kbDir)
  const base = kb.baseline()
  assert.match(base, /Basic Survival Guide/)
  assert.match(base, /KEYBINDINGS/)
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
  const r = searchKnowledge(kbDir, 'boil', 5)
  assert.ok(r.length > 0)
  assert.ok(r.some((x) => /boil/i.test(x.text)))
  assert.ok(r.every((x) => !/VALIDATION_REPORT/.test(x.file)))
})

test('知识库：首次铺到家里且可读', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cdda-kb-'))
  try {
    const dir = ensureKnowledge(pluginDir, home, () => {})
    assert.ok(existsSync(join(dir, 'guides', 'basic_survival.md')))
    assert.equal(knowledgeDirOf(pluginDir, home), dir)
    const k = knowledgeForState(dir, { ok: true, needs: { thirst: { value: 2 } }, health: { pct: 100 } }, 'gameplay', { maxChars: 8000 })
    assert.ok(k.tags.length > 0)
    assert.ok(k.text.length > 1000)
    assert.ok(k.text.length <= 8000)
  } finally {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
