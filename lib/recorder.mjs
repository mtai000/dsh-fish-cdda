/**
 * lib/recorder.mjs —— 把 `cdda` 的 screen 画面录成 mp4，并把战报写成同名 .srt
 * ============================================================================
 * 方案（2026-10-31 实测可行）：
 *   · 用 `screen -X redisplay/hardcopy` 定时抓 ASCII 画面
 *   · 把画面原子写进一个 textfile
 *   · ffmpeg 用 `-re` 实时读 `color` 源，`drawtext=textfile=...:reload=1`
 *     每帧重新读 textfile ⇒ 得到一张会动的终端视频（2 FPS 足够；
 *     这个游戏是文本界面，不需要 30 FPS）
 *   · 同时轮询 `activity.jsonl`，生成同名的 `.srt` 外挂字幕
 *
 * 不依赖 ImageMagick / 浏览器 / X11：只需要 ffmpeg + 一个等宽字体。
 * ============================================================================
 */
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { capture } from './screen.mjs'
import {
  appendActivity, logLine, pathsOf, readJson, writeJson, writeStatus,
} from './state.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function recordDirOf(stateDir, cfg) {
  const raw = String(cfg?.recordDir || '').trim()
  if (!raw) return pathsOf(stateDir).recordingsDir
  return resolve(stateDir, raw)
}

export function findFfmpeg(cfg = {}) {
  const explicit = String(cfg.ffmpegPath || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  return r.status === 0 ? 'ffmpeg' : ''
}

export function findFont(cfg = {}) {
  const explicit = String(cfg.recordFont || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    '/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf',
    '/System/Library/Fonts/Menlo.ttc',
  ]
  for (const p of candidates) { if (existsSync(p)) return p }
  for (const name of ['DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', 'monospace']) {
    try {
      const r = spawnSync('fc-match', ['-f', '%{file}', name], { encoding: 'utf8' })
      const f = String(r.stdout || '').trim()
      if (f && existsSync(f)) return f
    } catch { /* 忽略 */ }
  }
  return ''
}

function srtTime(sec) {
  const ms = Math.max(0, Math.round(Number(sec) * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
}

function cleanLine(s, max = 280) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function eventText(e) {
  const kind = String(e.kind || '')
  if (kind === 'action' || kind === 'sent') {
    const keys = cleanLine(e.keys, 40)
    const note = cleanLine(e.note, 220)
    return `动作：${keys}${note ? ' — ' + note : ''}`
  }
  if (kind === 'note') return `DSH：${cleanLine(e.note, 240)}`
  if (kind === 'round_start' || kind === 'round_end') return `回合：${cleanLine(e.text, 240)}`
  if (kind === 'start' || kind === 'stop') return `游戏：${cleanLine(e.text, 240)}`
  if (kind === 'death' || kind === 'error') return `！${cleanLine(e.text || e.note, 240)}`
  if (kind === 'record_start' || kind === 'record_stop') return ''
  return cleanLine(e.text || e.note || kind, 240)
}

export function readRecordings(stateDir, limit = 50) {
  const list = readJson(pathsOf(stateDir).recordingsIndex, [])
  return Array.isArray(list) ? list.slice(0, limit) : []
}

function addRecording(stateDir, meta) {
  try {
    const p = pathsOf(stateDir)
    const list = readRecordings(stateDir, 200).filter((x) => x && x.video !== meta.video)
    list.unshift(meta)
    writeJson(p.recordingsIndex, list.slice(0, 100))
  } catch { /* 忽略 */ }
}

export class Recorder {
  constructor({ stateDir, pluginDir, log }) {
    this.stateDir = stateDir
    this.pluginDir = pluginDir
    this.log = typeof log === 'function' ? log : (m) => logLine(stateDir, m)
    this.active = null
    this.stopping = false
    this.captureBusy = false
    this.events = new Map()
    const rawLast = readJson(pathsOf(stateDir).recordingFile, null)
    this.last = rawLast && rawLast.last && rawLast.last.video
      ? rawLast.last
      : (rawLast && rawLast.video ? rawLast : null)
  }

  status() {
    const a = this.active
    if (a) {
      let size = 0
      try { size = statSync(a.video).size } catch { /* 还在写 */ }
      return {
        active: true,
        id: a.id,
        video: a.video,
        srt: a.srt,
        dir: a.dir,
        startedAt: new Date(a.startedAt).toISOString(),
        durationSec: Math.max(0, Math.round((Date.now() - a.startedAt) / 1000)),
        fps: a.fps,
        frames: a.frames,
        size,
        font: basename(a.font),
        entries: a.srtEntries || 0,
      }
    }
    return { active: false, last: this.last || null }
  }

  writeRecordingStatus(meta = null) {
    const st = this.status()
    try { writeJson(pathsOf(this.stateDir).recordingFile, st) } catch { /* 忽略 */ }
    try { writeStatus(this.stateDir, { recording: st }) } catch { /* 忽略 */ }
    if (meta) this.last = meta
  }

  async start(cfg) {
    if (this.stopping) return { ok: false, error: '正在结束上一段录制，稍等一下' }
    if (this.active) return { ok: true, already: true, ...this.status() }

    const ffmpeg = findFfmpeg(cfg)
    if (!ffmpeg) return { ok: false, error: '找不到 ffmpeg：请先安装 ffmpeg，或在设置里填 ffmpegPath' }
    const font = findFont(cfg)
    if (!font) return { ok: false, error: '找不到可用的等宽字体：请在设置里填 recordFont（字体文件路径）' }

    const dir = recordDirOf(this.stateDir, cfg)
    try { mkdirSync(dir, { recursive: true }) } catch (e) {
      return { ok: false, error: `录制目录建不了：${String(e?.message ?? e)}` }
    }

    const fps = Math.max(1, Math.min(10, Math.round(Number(cfg.recordFps) || 2)))
    const startedAt = Date.now()
    const id = new Date(startedAt).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-') +
      '-' + Math.random().toString(16).slice(2, 6)
    const video = join(dir, id + '.mp4')
    const srt = join(dir, id + '.srt')
    const metaFile = join(dir, id + '.json')
    const frameFile = join(dir, `.${id}.frame.txt`)
    const ffmpegLog = join(dir, `.${id}.ffmpeg.log`)
    const goal = String(cfg.goal || '')

    const initial = 'DSH x CDDA\n\nrecording starting...\n'
    try {
      writeFileSync(frameFile, initial, 'utf8')
    } catch (e) {
      return { ok: false, error: `写录制临时文件失败：${String(e?.message ?? e)}` }
    }

    const q = (s) => "'" + String(s).replace(/'/g, "\\'") + "'"
    const filter = `drawtext=fontfile=${q(font)}:textfile=${q(frameFile)}:reload=1:expansion=none:fontcolor=white:fontsize=16:x=16:y=16:line_spacing=2`
    const args = [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-re',
      '-f', 'lavfi', '-i', `color=c=black:s=1280x900:r=${fps}`,
      '-vf', filter,
      '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      video,
    ]

    let child
    let fd = -1
    try {
      fd = openSync(ffmpegLog, 'a')
      child = spawn(ffmpeg, args, { stdio: ['pipe', fd, fd] })
      closeSync(fd)
      fd = -1
    } catch (e) {
      if (fd >= 0) { try { closeSync(fd) } catch { /* 忽略 */ } }
      try { rmSync(frameFile, { force: true }) } catch { /* 忽略 */ }
      return { ok: false, error: `ffmpeg 起不来：${String(e?.message ?? e)}` }
    }

    const a = {
      id, dir, video, srt, metaFile, frameFile, ffmpegLog, font, fps, startedAt, goal,
      child, frames: 0, srtEntries: 0, lastText: '', lastFrameAt: 0, missingSince: 0,
      captureTimer: null, srtTimer: null, maxTimer: null, logFd: -1,
    }

    // 等 600ms：ffmpeg 参数错 / 没有 libx264 时会立刻退出
    await sleep(600)
    if (child.exitCode !== null || child.signalCode) {
      let tail = ''
      try { tail = readFileSync(ffmpegLog, 'utf8').split(/\r?\n/).slice(-8).join('\n') } catch { /* 忽略 */ }
      try { rmSync(frameFile, { force: true }) } catch { /* 忽略 */ }
      return { ok: false, error: `ffmpeg 立刻退出了：${tail || `code=${child.exitCode}`}` }
    }

    this.active = a
    this.stopping = false
    this.events = new Map()
    this.captureBusy = false

    child.on('error', (e) => {
      this.log(`录制 ffmpeg 错误：${String(e?.message ?? e)}`)
      if (this.active === a) void this.stop('ffmpeg-error')
    })
    child.on('exit', (code, signal) => {
      if (this.active === a && !a.stopping) {
        this.log(`录制 ffmpeg 意外退出（code=${code} signal=${signal || ''}）`)
        void this.stop('ffmpeg-exit')
      }
    })

    // 首帧尽快写上
    const loop = async () => {
      const cur = this.active
      if (!cur) return
      if (this.captureBusy) {
        cur.captureTimer = setTimeout(loop, Math.max(50, Math.round(1000 / fps)))
        return
      }
      this.captureBusy = true
      const t0 = Date.now()
      try {
        const cap = await capture(cfg, String(cfg.screenGame || 'cdda'), { stateDir: this.stateDir })
        if (cap.ok && cap.text && cap.text.trim().length >= 20) {
          this.writeFrame(cur, cap.text)
          cur.frames++
          cur.lastText = cap.text
          cur.lastFrameAt = Date.now()
          cur.missingSince = 0
        } else {
          if (!cur.missingSince) cur.missingSince = Date.now()
          else if (Date.now() - cur.missingSince > 15_000) {
            await this.stop('game-missing')
            return
          }
        }
      } catch (e) {
        if (!cur.missingSince) cur.missingSince = Date.now()
        this.log(`录制抓屏失败：${String(e?.message ?? e)}`)
      } finally {
        this.captureBusy = false
        if (this.active === cur) {
          const wait = Math.max(50, Math.round(1000 / fps) - (Date.now() - t0))
          cur.captureTimer = setTimeout(loop, wait)
        }
      }
    }
    a.captureTimer = setTimeout(loop, 100)

    this.events = new Map()
    a.srtTimer = setInterval(() => {
      try { this.refreshEvents(a); this.writeSrt(a, false) } catch { /* 渲染失败不能停 */ }
    }, 1000)
    const maxMin = Math.max(1, Math.min(600, Number(cfg.recordMaxMinutes) || 120))
    a.maxTimer = setTimeout(() => { if (this.active === a) void this.stop('max-duration') }, maxMin * 60_000)

    this.log(`开始录制：${video}（${fps} fps，字幕 ${srt}）`)
    appendActivity(this.stateDir, { kind: 'record_start', text: `开始录制 ${basename(video)}` })
    this.writeRecordingStatus()
    return { ok: true, ...this.status() }
  }

  writeFrame(a, text) {
    try {
      // 过渡/空屏时别把上一帧覆盖成黑屏：太短的内容不写
      if (String(text || '').trim().length < 20) return
      const tmp = a.frameFile + '.tmp'
      writeFileSync(tmp, String(text).replace(/\r/g, ''), 'utf8')
      renameSync(tmp, a.frameFile)
    } catch (e) {
      this.log(`录制写帧失败：${String(e?.message ?? e)}`)
    }
  }

  refreshEvents(a) {
    const p = pathsOf(this.stateDir)
    let raw = ''
    try { raw = readFileSync(p.activityFile, 'utf8') } catch { return }
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue
      let e
      try { e = JSON.parse(line) } catch { continue }
      const t = Date.parse(e.ts)
      if (!Number.isFinite(t) || t < a.startedAt - 1000) continue
      if (e.kind === 'record_start' || e.kind === 'record_stop') continue
      const key = `${e.ts}|${e.kind}|${e.keys || ''}|${e.note || e.text || ''}`
      if (!this.events.has(key)) this.events.set(key, { ...e, _t: t })
    }
  }

  writeSrt(a, final = false) {
    const now = final ? (a.endedAt || Date.now()) : Date.now()
    const duration = Math.max(0, (now - a.startedAt) / 1000)
    const evs = [...this.events.values()].sort((x, y) => x._t - y._t)
    // 同一瞬间的多个事件（动作 + 记录）合成一条字幕，避免互相盖住
    const groups = []
    for (const e of evs) {
      const last = groups[groups.length - 1]
      if (last && Math.abs(e._t - last.t) <= 350) last.items.push(e)
      else groups.push({ t: e._t, items: [e] })
    }

    const entries = []
    const firstStart = groups.length ? Math.max(0, (groups[0].t - a.startedAt) / 1000) : duration
    const outroStart = final && duration > 1.6 ? Math.max(0, duration - 1.8) : null
    const lastStart = groups.length ? Math.max(0, (groups[groups.length - 1].t - a.startedAt) / 1000) : 0
    const wantOutro = outroStart !== null && outroStart > lastStart + 0.3

    if (duration > 0.2) {
      const goal = cleanLine(a.goal || '', 180)
      let introEnd = Math.min(3.2, Math.max(0.6, duration))
      if (groups.length && firstStart < introEnd) introEnd = Math.max(0.5, firstStart)
      entries.push({
        start: 0,
        end: introEnd,
        text: `DSH × CDDA 开始游玩${goal ? '\n目标：' + goal : ''}`,
      })
    }
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      const start = Math.max(0, (g.t - a.startedAt) / 1000)
      const next = groups[i + 1] ? Math.max(0, (groups[i + 1].t - a.startedAt) / 1000) : 0
      let end
      if (next) end = Math.min(next, start + 12)
      else if (wantOutro) end = Math.max(start + 0.5, outroStart)
      else end = Math.max(start + 2, duration)
      if (end <= start) end = start + 1
      const text = g.items.map(eventText).filter(Boolean).join('\n')
      if (text) entries.push({ start, end, text })
    }
    if (wantOutro) entries.push({ start: outroStart, end: duration, text: '录制结束' })

    const blocks = []
    entries.forEach((e, i) => {
      blocks.push(`${i + 1}\n${srtTime(e.start)} --> ${srtTime(e.end)}\n${e.text}\n`)
    })
    try {
      const tmp = a.srt + '.tmp'
      writeFileSync(tmp, blocks.join('\n'), 'utf8')
      renameSync(tmp, a.srt)
      a.srtEntries = entries.length
    } catch (e) {
      this.log(`写字幕失败：${String(e?.message ?? e)}`)
    }
  }

  async stop(reason = 'manual') {
    const a = this.active
    if (!a) return { ok: false, active: false, error: '当前没有在录制' }
    if (a.stopping) return { ok: false, active: false, error: '正在结束' }
    a.stopping = true
    this.stopping = true
    this.active = null
    a.endedAt = Date.now()
    try { clearTimeout(a.captureTimer) } catch { /* 忽略 */ }
    try { clearInterval(a.srtTimer) } catch { /* 忽略 */ }
    try { clearTimeout(a.maxTimer) } catch { /* 忽略 */ }
    try { this.refreshEvents(a); this.writeSrt(a, true) } catch { /* 忽略 */ }

    // 让 ffmpeg 正常收尾（写 moov）
    try { a.child.stdin.write('q\n') } catch { /* 已经关了 */ }
    await Promise.race([
      new Promise((res) => a.child.once('close', res)),
      sleep(8000),
    ])
    if (a.child.exitCode === null) {
      try { a.child.kill('SIGINT') } catch { /* 忽略 */ }
      await Promise.race([
        new Promise((res) => a.child.once('close', res)),
        sleep(4000),
      ])
    }
    if (a.child.exitCode === null) {
      try { a.child.kill('SIGKILL') } catch { /* 忽略 */ }
      await sleep(300)
    }

    let size = 0
    try { size = statSync(a.video).size } catch { /* 没有文件 */ }
    const durationSec = Math.max(0, Math.round((a.endedAt - a.startedAt) / 1000))
    const meta = {
      id: a.id,
      video: a.video,
      srt: a.srt,
      startedAt: new Date(a.startedAt).toISOString(),
      endedAt: new Date(a.endedAt).toISOString(),
      durationSec,
      fps: a.fps,
      frames: a.frames,
      size,
      reason,
    }
    try { writeJson(a.metaFile, meta) } catch { /* 忽略 */ }
    addRecording(this.stateDir, meta)
    try { rmSync(a.frameFile, { force: true }) } catch { /* 忽略 */ }
    this.last = meta
    this.stopping = false
    this.writeRecordingStatus(meta)
    appendActivity(this.stateDir, { kind: 'record_stop', text: `结束录制 ${basename(a.video)}（${durationSec}s）` })
    this.log(`录制结束：${a.video}（${durationSec}s，${size} bytes，原因 ${reason}）`)
    return { ok: true, ...meta }
  }

  async ensure(cfg) {
    if (cfg.recordVideo) {
      if (!this.active) return this.start(cfg)
      return { ok: true, already: true, ...this.status() }
    }
    if (this.active) return this.stop('switch-off')
    return { ok: true, active: false }
  }

  dispose() {
    // 插件重载/退出：尽量正常收尾（异步跑完，不阻塞卸载）
    if (this.active) void this.stop('plugin-reload')
  }
}
