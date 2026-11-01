import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_SPECS } from '../lib/tools-core.mjs'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

test('自带知识库已移除，经验工具仍在', () => {
  assert.equal(existsSync(join(root, 'data')), false)
  assert.equal(existsSync(join(root, 'lib', 'knowledge.mjs')), false)
  const names = TOOL_SPECS.map((t) => t.name)
  assert.ok(!names.includes('cdda_knowledge'))
  assert.ok(names.includes('cdda_learn'))
})
