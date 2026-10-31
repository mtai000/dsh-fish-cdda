import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const pluginDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')

test('MCP：initialize / tools/list / cdda_status', { timeout: 30_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cdda-mcp-'))
  try {
    mkdirSync(join(home, 'game', 'save'), { recursive: true })
    writeFileSync(join(home, 'config.json'), JSON.stringify({
      screenGame: 'dsh-cdda-mcp-none',
      screenLog: 'dsh-cdda-mcp-none-log',
      userDir: join(home, 'game'),
      starterWorld: false,
    }))
    const child = spawn(process.execPath, [join(pluginDir, 'lib', 'mcp-server.mjs')], {
      cwd: pluginDir,
      env: { ...process.env, CDDA_DUTY_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const lines = []
    const rl = createInterface({ input: child.stdout })
    rl.on('line', (l) => { try { lines.push(JSON.parse(l)) } catch { /* 忽略 */ } })
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cdda_status', arguments: {} } })

    const until = Date.now() + 20_000
    while (Date.now() < until && !lines.some((x) => x.id === 3)) {
      await new Promise((r) => setTimeout(r, 100))
    }
    child.stdin.end()
    const init = lines.find((x) => x.id === 1)
    const list = lines.find((x) => x.id === 2)
    const call = lines.find((x) => x.id === 3)
    assert.ok(init, 'initialize 有响应')
    assert.equal(init.result.protocolVersion, '2024-11-05')
    assert.ok(list, 'tools/list 有响应')
    const names = list.result.tools.map((t) => t.name)
    assert.ok(names.includes('cdda_look'))
    assert.ok(names.includes('cdda_send'))
    assert.ok(names.includes('cdda_knowledge'))
    assert.ok(names.includes('cdda_restart'))
    assert.ok(!names.includes('cdda_autoplay'), 'MCP 里不应该有 autoplay')
    assert.ok(!names.includes('cdda_record'), 'MCP 里不应该有 record')
    assert.ok(call, 'tools/call 有响应')
    const payload = JSON.parse(call.result.content[0].text)
    assert.equal(payload.ok, true)
    assert.equal(payload.running, false)
    assert.ok(payload.goal && payload.goal.spec, '状态里有目标对象')
    assert.ok(payload.goalProgress, '状态里有目标进度')
  } finally {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
