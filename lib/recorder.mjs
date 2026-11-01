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
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capture } from './screen.mjs'
import { hasSession, tmuxBin } from './backend.mjs'
import { renderScreen, charCells as displayCell } from './ansirender.mjs'
import { openCastWriter } from './cast.mjs'
import {
  appendActivity, logLine, pathsOf, readJson, writeJson, writeStatus,
} from './state.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 一行显示宽度（把宽字符算两格），用来决定这一帧画多宽。 */
function displayCells(line) {
  const txt = String(line || '').replace(/\x1b\[[0-9;]*m/g, '')
  let n = 0
  for (const ch of txt) n += displayCell(ch.codePointAt(0))
  return n
}

/** 这一段游玩从什么时候开始：用 tmux 会话的创建时间做 id。 */
function gameSessionId(cfg, name) {
  return new Promise((res) => {
    execFile(tmuxBin(cfg), ['display-message', '-p', '-t', String(name), '#{session_created}'],
      { timeout: 4000 }, (e, out) => {
        if (e) return res('')
        const n = Number(String(out || '').trim())
        if (!Number.isFinite(n) || n <= 0) return res('')
        const d = new Date(n * 1000)
        const p2 = (x) => String(x).padStart(2, '0')
        res(`${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`)
      })
  })
}

/** 问 tmux 这个会话终端多大；拿不到就返回 null。 */
function paneSizeOf(cfg, name) {
  return new Promise((res) => {
    execFile(tmuxBin(cfg), ['display-message', '-p', '-t', String(name), '#{pane_width}x#{pane_height}'],
      { timeout: 4000 }, (e, out) => {
        if (e) return res(null)
        const m = /(\d+)x(\d+)/.exec(String(out || ''))
        res(m ? { cols: Number(m[1]), rows: Number(m[2]) } : null)
      })
  })
}

/** 抓一屏「带颜色码」的原始输出，和前端「cdda画面」页吃的是同一份。 */
function captureAnsiRows(cfg, name) {
  return new Promise((res, rej) => {
    execFile(tmuxBin(cfg), ['capture-pane', '-p', '-e', '-t', name],
      { timeout: 8000, maxBuffer: 16 << 20 },
      (e, out) => (e ? rej(e) : res(String(out ?? '').split('\n'))))
  })
}

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

function parseGeometry(raw) {
  const m = /^(\d{2,5})x(\d{2,5})(?:\+(-?\d+)\+(-?\d+))?$/.exec(String(raw || '').trim())
  if (!m) return null
  return {
    width: Number(m[1]), height: Number(m[2]),
    x: Math.max(0, Number(m[3] || 0)), y: Math.max(0, Number(m[4] || 0)),
  }
}

function x11Env(display) {
  return { ...process.env, DISPLAY: String(display || process.env.DISPLAY || ':0.0') }
}

function x11ScreenSize(display) {
  const env = x11Env(display)
  const r = spawnSync('xrandr', ['--current'], { encoding: 'utf8', env })
  const m = /(\d+)x(\d+)\+0\+0/.exec(String(r.stdout || ''))
  if (m) return { width: Number(m[1]), height: Number(m[2]) }
  const r2 = spawnSync('xwininfo', ['-root'], { encoding: 'utf8', env })
  const w = /Width:\s*(\d+)/.exec(String(r2.stdout || ''))
  const h = /Height:\s*(\d+)/.exec(String(r2.stdout || ''))
  if (w && h) return { width: Number(w[1]), height: Number(h[1]) }
  return null
}

function x11WindowTarget(display, needle) {
  const env = x11Env(display)
  const tree = spawnSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8', env })
  const want = String(needle || '').trim().toLowerCase()
  const wins = []
  for (const line of String(tree.stdout || '').split(/\r?\n/)) {
    const m = /^\s*(0x[0-9a-f]+)\s+"([^"]*)":\s*\(([^)]*)\)\s+(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/i.exec(line)
    if (!m) continue
    const width = Number(m[4])
    const height = Number(m[5])
    if (width < 160 || height < 120) continue
    const title = m[2]
    const cls = m[3]
    const hay = (title + ' ' + cls).toLowerCase()
    const hit = want ? hay.includes(want) : /(cdda|cataclysm)/i.test(hay)
    if (hit) wins.push({ id: m[1], title, cls, width, height })
  }
  wins.sort((a, b) => b.width * b.height - a.width * a.height)
  const win = wins[0]
  if (!win) return null
  const info = spawnSync('xwininfo', ['-id', win.id], { encoding: 'utf8', env })
  const text = String(info.stdout || '')
  const width = Number((/Width:\s*(\d+)/.exec(text) || [])[1] || win.width)
  const height = Number((/Height:\s*(\d+)/.exec(text) || [])[1] || win.height)
  const x = Number((/Absolute upper-left X:\s*(-?\d+)/.exec(text) || [])[1] || 0)
  const y = Number((/Absolute upper-left Y:\s*(-?\d+)/.exec(text) || [])[1] || 0)
  return { width, height, x: Math.max(0, x), y: Math.max(0, y), title: win.title, cls: win.cls, id: win.id }
}

/** 像素录制的目标：显式区域 > 窗口标题匹配 > 全屏；找不到显示就返回 null。 */
export function findCaptureTarget(cfg = {}) {
  if (process.platform === 'win32') return { kind: 'desktop', label: '全屏', platform: 'win32' }
  if (process.platform === 'darwin') {
    const geo = parseGeometry(cfg.recordGeometry)
    return geo
      ? { kind: 'desktop', platform: 'darwin', ...geo, label: `裁切 ${geo.width}x${geo.height}+${geo.x}+${geo.y}` }
      : { kind: 'desktop', platform: 'darwin', label: '整个屏幕' }
  }
  if (process.platform !== 'linux') return null
  const display = String(cfg.recordDisplay || process.env.DISPLAY || ':0.0').trim()
  if (!display) return null
  const geo = parseGeometry(cfg.recordGeometry)
  if (geo) return { kind: 'x11', display, ...geo, label: `区域 ${geo.width}x${geo.height}+${geo.x}+${geo.y}` }
  const win = x11WindowTarget(display, cfg.recordWindow)
  if (win) return { kind: 'x11', display, width: win.width, height: win.height, x: win.x, y: win.y, title: win.title, label: `窗口「${win.title}」` }
  const size = x11ScreenSize(display)
  if (!size) return null
  return { kind: 'x11', display, width: size.width, height: size.height, x: 0, y: 0, label: '全屏' }
}

function even(n) { return Math.max(2, Math.floor(Number(n) / 2) * 2) }

function macScreenDevice(ffmpeg) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8' })
  const text = String(r.stderr || '') + String(r.stdout || '')
  const m = /\[(\d+)\]\s+Capture screen 0/i.exec(text)
  return m ? m[1] : '1'
}

function pixelArgs(ffmpeg, target, fps, video) {
  const common = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video]
  if (target.kind === 'x11') {
    const w = even(target.width)
    const h = even(target.height)
    return [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(fps),
      '-video_size', `${w}x${h}`,
      '-i', `${target.display}+${target.x},${target.y}`,
      ...common,
    ]
  }
  if (target.platform === 'win32') {
    return ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop', ...common]
  }
  const device = macScreenDevice(ffmpeg)
  const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'avfoundation', '-i', device, '-r', String(fps)]
  if (target.width) args.push('-vf', `crop=${even(target.width)}:${even(target.height)}:${target.x || 0}:${target.y || 0}`)
  return [...args, ...common]
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


/**
 * 删掉一段录制：原始帧 + 转出来的 mp4 + 字幕 + 元数据。
 * target 可以是 id、xxx.cast.jsonl.gz 或 xxx.mp4。
 */
export function listCasts(stateDir, cfg = {}) {
  const root = resolve(recordDirOf(stateDir, cfg))
  let names = []
  try { names = readdirSync(root) } catch { return [] }
  const out = []
  for (const n of names) {
    const full = join(root, n)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      const cast = join(full, 'cast.jsonl.gz')
      if (!existsSync(cast)) continue
      let size = 0
      try { size = statSync(cast).size } catch { /* 忽略 */ }
      let videoSize = 0
      const video = join(full, 'video.mp4')
      try { videoSize = statSync(video).size } catch { /* 没转 */ }
      const meta = readJson(join(full, 'meta.json'), null)
      out.push({
        id: n,
        dir: full,
        castName: n + '/cast.jsonl.gz',
        videoName: videoSize ? n + '/video.mp4' : '',
        srtName: existsSync(join(full, 'events.srt')) ? n + '/events.srt' : '',
        size, videoSize,
        startedAt: meta?.startedAt || '',
        durationSec: meta?.durationSec || 0,
        frames: meta?.frames || 0,
      })
    } else if (n.endsWith('.cast.jsonl.gz')) {
      const id = n.slice(0, -'.cast.jsonl.gz'.length)
      let size = 0
      try { size = statSync(full).size } catch { /* 忽略 */ }
      let videoSize = 0
      try { videoSize = statSync(join(root, id + '.mp4')).size } catch { /* 没转 */ }
      const meta = readJson(join(root, id + '.json'), null)
      out.push({
        id,
        dir: root,
        legacy: true,
        castName: n,
        videoName: videoSize ? id + '.mp4' : '',
        srtName: existsSync(join(root, id + '.srt')) ? id + '.srt' : '',
        size, videoSize,
        startedAt: meta?.startedAt || '',
        durationSec: meta?.durationSec || 0,
        frames: meta?.frames || 0,
      })
    }
  }
  return out.sort((a, b) => String(b.id).localeCompare(String(a.id)))
}

/** 把某一段的原始帧转成 mp4（跑 scripts/render-cast.mjs）。 */
export function renderCast(stateDir, cfg = {}, id = '') {
  const root = resolve(recordDirOf(stateDir, cfg))
  const key = String(id || '').trim().replace(/\/+$/, '')
  if (!key || key.includes('..') || basename(key) !== key) return Promise.resolve({ ok: false, error: '名字不合法' })
  const dirCast = join(root, key, 'cast.jsonl.gz')
  const legacyCast = join(root, key + '.cast.jsonl.gz')
  const isDir = existsSync(dirCast)
  const cast = isDir ? dirCast : legacyCast
  if (!existsSync(cast)) return Promise.resolve({ ok: false, error: '这一段没有原始帧' })
  const out = isDir ? join(root, key, 'video.mp4') : join(root, key + '.mp4')
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'render-cast.mjs')
  return new Promise((res2) => {
    execFile(process.execPath, [script, cast, out,
      '--scale', String(Number(cfg.recordScale) || 2),
      '--linepad', String(Number(cfg.recordLinePad ?? 2)),
      '--fps', String(Number(cfg.recordFps) || 2)],
    { timeout: 600000, maxBuffer: 8 << 20 }, (e, so, se) => {
      if (e) return res2({ ok: false, error: String(e.message || e).slice(0, 300), log: String(se || '').slice(-300) })
      res2({ ok: true, video: out, videoName: isDir ? `${key}/video.mp4` : `${key}.mp4` })
    })
  })
}

/** 删掉一整段（目录形式就整目录删，老格式删那几个文件）。 */
export function deleteRecording(stateDir, target, cfg = {}) {
  const root = resolve(recordDirOf(stateDir, cfg))
  let key = String(target || '').trim()
  if (!key) return { ok: false, error: '没给要删哪一段' }
  key = basename(key).replace(/\.(cast\.jsonl\.gz|mp4|srt|json)$/i, '')
  if (!key || key.includes('..')) return { ok: false, error: '名字不合法' }
  const dirPath = join(root, key)
  if (dirPath.startsWith(root + sep) && existsSync(dirPath)) {
    try {
      const st = statSync(dirPath)
      if (st.isDirectory()) { rmSync(dirPath, { recursive: true, force: true }); return { ok: true, removed: [key + '/'], id: key } }
    } catch (e) { return { ok: false, error: `删不掉：${String(e?.message ?? e)}` } }
  }
  const files = [key + '.cast.jsonl.gz', key + '.mp4', key + '.srt', key + '.json']
  const removed = []
  for (const f of files) {
    const full = join(root, f)
    if (!full.startsWith(root + sep)) continue
    try { if (existsSync(full)) { rmSync(full, { force: true }); removed.push(f) } } catch { /* 忽略 */ }
  }
  if (!removed.length) return { ok: false, error: '这一段不存在' }
  return { ok: true, removed, id: key }
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
        frames: a.mode === 'pixels'
          ? Math.max(a.frames || 0, Math.floor((Date.now() - a.startedAt) / 1000 * (a.fps || 2)))
          : a.frames,
        size,
        font: a.font ? basename(a.font) : '',
        mode: a.mode || 'text',
        source: a.source || '',
        window: a.window || '',
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

    const want = String(cfg.recordMode || 'ansi').toLowerCase()
    const mode = want === 'text' ? 'text' : want === 'pixels' ? 'pixels' : 'ansi'
    const ffmpeg = mode === 'ansi' ? '' : findFfmpeg(cfg)
    if (mode !== 'ansi' && !ffmpeg) return { ok: false, error: '找不到 ffmpeg：请先安装 ffmpeg，或在设置里填 ffmpegPath' }
    let font = ''
    let target = null
    if (mode === 'text') {
      font = findFont(cfg)
      if (!font) return { ok: false, error: '找不到可用的等宽字体：请在设置里填 recordFont（字体文件路径）' }
    } else if (mode === 'pixels') {
      target = findCaptureTarget(cfg)
      if (!target) return { ok: false, error: '像素录制不可用：找不到显示/窗口。可在设置里把「录制方式」改成「彩色重绘」，或填 recordDisplay / recordGeometry' }
    } else if (!(await hasSession(cfg, String(cfg.screenGame || 'cdda')).catch(() => false))) {
      return { ok: false, error: '彩色重绘需要 tmux 会话在跑（游戏得先起来）' }
    }

    const dir = recordDirOf(this.stateDir, cfg)
    try { mkdirSync(dir, { recursive: true }) } catch (e) {
      return { ok: false, error: `录制目录建不了：${String(e?.message ?? e)}` }
    }

    const fps = Math.max(1, Math.min(10, Math.round(Number(cfg.recordFps) || 2)))
    const startedAt = Date.now()
    const id = new Date(startedAt).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-') +
      '-' + Math.random().toString(16).slice(2, 6)
    let sessionDir = join(dir, id)
    let reusedSession = false
    if (mode === 'ansi') {
      const sid = await gameSessionId(cfg, String(cfg.screenGame || 'cdda')).catch(() => '')
      if (sid) { sessionDir = join(dir, sid); reusedSession = existsSync(sessionDir) }
    }
    try { mkdirSync(sessionDir, { recursive: true }) } catch (e) {
      return { ok: false, error: `录制目录建不了：${String(e?.message ?? e)}` }
    }
    const video = join(sessionDir, 'video.mp4')
    const srt = join(sessionDir, 'events.srt')
    const metaFile = join(sessionDir, 'meta.json')
    const frameFile = mode === 'text' ? join(sessionDir, `.frame.txt`) : ''
    const ffmpegLog = join(sessionDir, '.ffmpeg.log')
    const goal = String(cfg.goal || '')

    if (mode === 'text') {
      const initial = 'DSH x CDDA\n\nrecording starting...\n'
      try {
        writeFileSync(frameFile, initial, 'utf8')
      } catch (e) {
        return { ok: false, error: `写录制临时文件失败：${String(e?.message ?? e)}` }
      }
    }

    const q = (s) => "'" + String(s).replace(/'/g, "\\'") + "'"
    const filter = `drawtext=fontfile=${q(font)}:textfile=${q(frameFile)}:reload=1:expansion=none:fontcolor=white:fontsize=16:x=16:y=16:line_spacing=2`
    const args = mode === 'pixels'
      ? pixelArgs(ffmpeg, target, fps, video)
      : mode === 'ansi'
      ? [
          '-y', '-hide_banner', '-loglevel', 'warning',
          '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
          '-an',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
          '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
          video,
        ]
      : [
          '-y', '-hide_banner', '-loglevel', 'warning',
          '-re',
          '-f', 'lavfi', '-i', `color=c=black:s=1280x900:r=${fps}`,
          '-vf', filter,
          '-an',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
          video,
        ]

    let child = null
    let fd = -1
    try {
      if (mode !== 'ansi') {
      fd = openSync(ffmpegLog, 'a')
      child = spawn(ffmpeg, args, { stdio: ['pipe', fd, fd] })
      closeSync(fd)
      fd = -1
      }
    } catch (e) {
      if (fd >= 0) { try { closeSync(fd) } catch { /* 忽略 */ } }
      if (frameFile) { try { rmSync(frameFile, { force: true }) } catch { /* 忽略 */ } }
      return { ok: false, error: `ffmpeg 起不来：${String(e?.message ?? e)}` }
    }

    const a = {
      id, dir, video, srt, metaFile, frameFile, ffmpegLog, font, fps, startedAt, goal, appendSrt: reusedSession,
      mode, source: target?.label || (mode === 'ansi' ? '彩色重绘（ANSI）' : '字符重绘'), window: target?.title || '',
      child, frames: 0, srtEntries: 0, lastText: '', lastFrameAt: 0, missingSince: 0,
      captureTimer: null, srtTimer: null, maxTimer: null, logFd: -1,
    }

    // 等 600ms：ffmpeg 参数错 / 没有 libx264 时会立刻退出
    if (mode !== 'ansi') await sleep(600)
    if (child && (child.exitCode !== null || child.signalCode)) {
      let tail = ''
      try { tail = readFileSync(ffmpegLog, 'utf8').split(/\r?\n/).slice(-8).join('\n') } catch { /* 忽略 */ }
      if (frameFile) { try { rmSync(frameFile, { force: true }) } catch { /* 忽略 */ } }
      return { ok: false, error: `ffmpeg 立刻退出了：${tail || `code=${child.exitCode}`}` }
    }

    this.active = a
    this.stopping = false
    this.events = new Map()
    this.captureBusy = false

    if (child) {
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
    }

    if (mode === 'text') {
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
    }

    if (mode === 'ansi') {
      if (cfg.recordKeepRaw !== false) {
        try {
          a.cast = openCastWriter(join(sessionDir, 'cast.jsonl.gz'), { append: true })
          a.castFile = a.cast.file
        } catch (e) {
          this.log(`原始帧日志开不了：${String(e?.message ?? e)}`)
        }
      }
      const gameName = String(cfg.screenGame || 'cdda')
      const logName = String(cfg.screenLog || 'cdda_log')
      const paneSize = await paneSizeOf(cfg, gameName).catch(() => null)
      const cols = Math.max(40, Math.min(300, paneSize?.cols || Number(cfg.recordCols) || 80))
      const rowsWanted = Math.max(1, Math.min(120, paneSize?.rows || Number(cfg.recordRows) || 24))
      const scale = Math.max(1, Math.min(4, Number(cfg.recordScale) || 2))
      const linePad = Math.max(0, Math.min(8, Number(cfg.recordLinePad ?? 2)))
      const wantLog = cfg.recordLogScreen !== false
      const logRows = Math.max(0, Math.min(20, Number(cfg.recordLogRows) || 4))
      const withLog = wantLog && logRows > 0 && await hasSession(cfg, logName).catch(() => false)

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
          // 不按开录时的尺寸裁：游戏可能自己把终端撑大，裁了就丢内容。
          // 宽高按这一帧实际有多少算，转视频时再统一补白。
          const game = await captureAnsiRows(cfg, gameName)
          const frameCols = Math.max(1, ...game.map((l) => displayCells(l)))
          let all = game
          if (withLog) {
            const log = (await captureAnsiRows(cfg, logName)).filter((l) => l.trim()).slice(-logRows)
            if (log.length) all = game.concat([''.repeat(cols)], log)
          }
          if (cur.cast) {
            try { cur.cast.write(all, frameCols) } catch { /* 原始帧写不进去不该拖垮录制 */ }
          }
          const frame = renderScreen(all, { cols: frameCols, scale, linePad })
          const sink = cur.child?.stdin
          if (sink && !sink.destroyed) sink.write(frame.png)
          cur.frames++
          cur.lastFrameAt = Date.now()
          cur.missingSince = 0
        } catch (e) {
          if (!cur.missingSince) cur.missingSince = Date.now()
          else if (Date.now() - cur.missingSince > 15_000) { await this.stop('game-missing'); return }
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
    }

    this.events = new Map()
    a.srtTimer = setInterval(() => {
      try { this.refreshEvents(a); this.writeSrt(a, false) } catch { /* 渲染失败不能停 */ }
    }, 1000)
    const maxMin = Math.max(1, Math.min(600, Number(cfg.recordMaxMinutes) || 120))
    a.maxTimer = setTimeout(() => { if (this.active === a) void this.stop('max-duration') }, maxMin * 60_000)

    this.log(`开始录制：${video}（${mode === 'pixels' ? '像素' : mode === 'ansi' ? '彩色重绘' : '字符'}，${a.source}，${fps} fps，字幕 ${srt}）`)
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
      // 同一个游玩目录里多次录制：字幕追加，编号接着往下排
      let prefix = ''
      let offset = 0
      if (final && a.appendSrt) {
        try {
          const prev = readFileSync(a.srt, 'utf8')
          offset = (prev.match(/^\d+\s*$/gm) || []).length
          if (prev.trim()) prefix = prev.replace(/\s*$/, '') + '\n\n'
        } catch { /* 第一次 */ }
      }
      const shifted = offset
        ? blocks.map((b) => b.replace(/^(\d+)\n/, (_, n) => `${Number(n) + offset}\n`)).join('\n')
        : blocks.join('\n')
      const tmp = a.srt + '.tmp'
      writeFileSync(tmp, prefix + shifted, 'utf8')
      renameSync(tmp, a.srt)
      a.srtEntries = entries.length + offset
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
    try {
      if (a.cast) {
        const c = await a.cast.close()
        a.castFrames = c.frames
        this.log(`原始帧：${basename(c.file)}（${c.frames} 帧）`)
      }
    } catch { /* 忽略 */ }

    // 让 ffmpeg 正常收尾（写 moov）；原始帧模式没有 ffmpeg
    if (a.child) {
      try {
        if (a.mode === 'ansi') a.child.stdin.end()
        else a.child.stdin.write('q\n')
      } catch { /* 已经关了 */ }
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
    }

    let size = 0
    try { size = statSync(a.video).size } catch { /* 没有文件 */ }
    const durationSec = Math.max(0, Math.round((a.endedAt - a.startedAt) / 1000))
    const frameCount = a.mode === 'pixels' ? Math.max(a.frames || 0, Math.floor(durationSec * (a.fps || 2))) : a.frames
    const meta = {
      id: a.id,
      video: a.video,
      srt: a.srt,
      startedAt: new Date(a.startedAt).toISOString(),
      endedAt: new Date(a.endedAt).toISOString(),
      durationSec,
      fps: a.fps,
      frames: frameCount,
      mode: a.mode || 'text',
      source: a.source || '',
      size,
      reason,
    }
    // 一个游玩目录里可能录了多次（暂停/继续）：帧数累加，起始时间保留第一次
    try {
      const prev = readJson(a.metaFile, null)
      if (prev && prev.startedAt) meta.startedAt = prev.startedAt
      if (prev) meta.frames = Number(prev.frames || 0) + Number(meta.frames || 0)
      meta.toggles = Number(prev?.toggles || 0) + 1
      writeJson(a.metaFile, meta)
    } catch { /* 忽略 */ }
    addRecording(this.stateDir, meta)
    if (a.frameFile) { try { rmSync(a.frameFile, { force: true }) } catch { /* 忽略 */ } }
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
