import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_CFG } from '../lib/state.mjs'
import { appendActivity } from '../lib/state.mjs'
import { createSession, quitSession, screenBin } from '../lib/screen.mjs'
import { Recorder, findFfmpeg, findFont } from '../lib/recorder.mjs'

test('录制：screen → mp4 + 同名 srt', { timeout: 40_000 }, async () => {
  const ff = findFfmpeg({})
  const font = findFont({})
  if (!ff || !font) {
    console.log('跳过：没有 ffmpeg 或等宽字体')
    return
  }
  const base = mkdtempSync(join(tmpdir(), 'dsh-cdda-rec-'))
  const stateDir = join(base, 'state')
  const recordDir = join(base, 'rec')
  const name = `dsh-cdda-rec-${process.pid}`
  const cfg = { ...DEFAULT_CFG, screenGame: name, recordDir, recordFps: 2, goal: '测试录制' }
  const rec = new Recorder({ stateDir, pluginDir: join(import.meta.dirname, '..'), log: () => {} })
  try {
    const s = await createSession(cfg, name, ['bash', '-lc', "printf 'recording test screen\\n'; sleep 60"], { waitMs: 3000 })
    assert.equal(s.ok, true, s.error)
    const started = await rec.start(cfg)
    assert.equal(started.ok, true, started.error)
    await new Promise((r) => setTimeout(r, 1200))
    appendActivity(stateDir, { kind: 'action', keys: 'e', note: '测试字幕动作' })
    await new Promise((r) => setTimeout(r, 1800))
    const stopped = await rec.stop('test')
    assert.equal(stopped.ok, true, stopped.error)
    assert.ok(existsSync(stopped.video), 'mp4 存在')
    assert.ok(existsSync(stopped.srt), 'srt 存在')
    const size = readFileSync(stopped.video).length
    assert.ok(size > 1000, `mp4 太小：${size}`)
    const srt = readFileSync(stopped.srt, 'utf8')
    assert.match(srt, /-->/, 'srt 有时间轴')
    assert.match(srt, /测试字幕动作/, 'srt 包含动作字幕')
  } finally {
    try { await rec.stop('cleanup') } catch { /* 忽略 */ }
    await quitSession(cfg, name)
    try { rmSync(base, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
