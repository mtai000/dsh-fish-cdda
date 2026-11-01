import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_CFG } from '../lib/state.mjs'
import { capture, createSession, hasSession, quitSession, screenBin, stuff, tmuxBin } from '../lib/screen.mjs'

test('screen：创建 / 抓屏 / 发送 / 关闭', { timeout: 30_000 }, async () => {
  const bin = screenBin({})
  if (!existsSync('/usr/bin/screen') && bin === 'screen') {
    // 没装 screen 就跳过
    return
  }
  const name = `dsh-cdda-test-${process.pid}`
  const cfg = { ...DEFAULT_CFG, terminal: 'screen', screenGame: name, screenLog: `${name}-log`, logScreen: false }
  const stateDir = join(tmpdir(), `dsh-cdda-screen-${process.pid}`)
  try {
    const created = await createSession(cfg, name, ['bash', '-lc', "printf 'hello from dsh-cdda\\n'; sleep 60"], { waitMs: 3000 })
    assert.equal(created.ok, true, created.error)
    assert.equal(await hasSession(cfg, name), true)
    const cap = await capture(cfg, name, { stateDir })
    assert.equal(cap.ok, true, cap.error)
    assert.match(cap.text, /hello from dsh-cdda/)
    const sent = await stuff(cfg, name, 'x')
    assert.equal(sent.ok, true)
  } finally {
    await quitSession(cfg, name)
  }
})

test('tmux：创建 / 抓屏 / 发送 / 关闭', { timeout: 30_000 }, async () => {
  const tbin = tmuxBin({})
  if (!tbin) return // 没装 tmux 就跳过
  const name = `dsh-cdda-tmux-${process.pid}`
  const cfg = { ...DEFAULT_CFG, terminal: 'tmux', screenGame: name, screenLog: `${name}-log`, logScreen: false }
  const stateDir = join(tmpdir(), `dsh-cdda-tmux-${process.pid}`)
  try {
    const created = await createSession(cfg, name, ['bash', '-lc', "printf 'hello from tmux backend\\n'; sleep 60"], { waitMs: 3000 })
    assert.equal(created.ok, true, created.error)
    assert.equal(await hasSession(cfg, name), true)
    const cap = await capture(cfg, name, { stateDir })
    assert.equal(cap.ok, true, cap.error)
    assert.equal(cap.backend, 'tmux')
    assert.match(cap.text, /hello from tmux backend/)
    const sent = await stuff(cfg, name, 'x')
    assert.equal(sent.ok, true, sent.error)
  } finally {
    await quitSession(cfg, name)
  }
})
