/**
 * lib/ansirender.mjs —— 把 tmux 带颜色输出的 ANSI 帧画成 PNG
 * ============================================================================
 * 为什么不用浏览器：页面上之所以对齐，是因为浏览器替它算了「中文占两格」。
 * 这一步谁算都一样。这里用 GNU Unifont（16x16 点阵，覆盖 CJK / 制表符 / ASCII）
 * 自己画：半角 8x16、全角 16x16，格子严丝合缝，不依赖任何运行时。
 *
 * 数据源和「cdda画面」页完全一致：tmux capture-pane -p -e
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { gunzipSync, deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_FONT = join(HERE, '..', 'assets', 'fonts', 'unifont.hex.gz')

// ---------------------------------------------------------------- 字体

let fontCache = null

/** 解析 GNU Unifont .hex：每行 `码位:十六进制位图`，8 宽 32 位十六进制，16 宽 64 位。 */
export function loadFont(file = DEFAULT_FONT) {
  if (fontCache) return fontCache
  const raw = file.endsWith('.gz') ? gunzipSync(readFileSync(file)) : readFileSync(file)
  const map = new Map()
  for (const line of raw.toString('latin1').split('\n')) {
    const i = line.indexOf(':')
    if (i < 1) continue
    const cp = parseInt(line.slice(0, i), 16)
    if (!Number.isFinite(cp)) continue
    const hex = line.slice(i + 1).trim()
    const wide = hex.length > 32
    const rows = []
    const per = wide ? 4 : 2
    for (let r = 0; r < 16; r++) {
      const chunk = hex.slice(r * per, r * per + per)
      rows.push(parseInt(chunk || '0', 16))
    }
    map.set(cp, { wide, rows })
  }
  fontCache = map
  return map
}

function glyphOf(font, cp) {
  return font.get(cp) || font.get(0x003f) || null
}

/** 这个码位在点阵里占几格：16 宽 = 两格，8 宽 = 一格。和终端里看到的完全一致。 */
export function cellWidth(font, cp) {
  const g = glyphOf(font, cp)
  return g && g.wide ? 2 : 1
}

// ---------------------------------------------------------------- 颜色

const BASE = [
  '#0a0a0a', '#c0392b', '#2f9e44', '#b8860b', '#2e6fb0', '#8e44ad', '#12808f', '#c8c8c8',
  '#5c5c5c', '#ff6b57', '#6edb7f', '#e0c452', '#6aa9ff', '#c48ce0', '#4fd8e8', '#ffffff',
]

function cube(i) {
  const v = [0, 95, 135, 175, 215, 255]
  const r = v[Math.floor(i / 36) % 6]
  const g = v[Math.floor(i / 6) % 6]
  const b = v[i % 6]
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

function idx256(n) {
  if (n < 16) return BASE[n]
  if (n < 232) return cube(n - 16)
  const v = 8 + (n - 232) * 10
  const h = v.toString(16).padStart(2, '0')
  return `#${h}${h}${h}`
}

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

// ---------------------------------------------------------------- ANSI

const FG_DEFAULT = '#c8c8c8'
const BG_DEFAULT = '#0a0a0a'

/** 把一行带 SGR 的文本切成 [{ ch, fg, bg, bold }]，逐码位。 */
function parseLine(line, state) {
  const out = []
  const re = /\x1b\[([0-9;:]*)m/g
  let last = 0
  let m
  const push = (s) => {
    for (const ch of s) out.push({ ch, fg: state.fg, bg: state.bg, bold: state.bold })
  }
  while ((m = re.exec(line))) {
    if (m.index > last) push(line.slice(last, m.index))
    applySgr(state, m[1])
    last = re.lastIndex
  }
  if (last < line.length) push(line.slice(last))
  return out
}

function applySgr(st, body) {
  const parts = body.split(';')
  if (!body) { st.fg = FG_DEFAULT; st.bg = BG_DEFAULT; st.bold = false; return }
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i] || '0')
    if (n === 0) { st.fg = FG_DEFAULT; st.bg = BG_DEFAULT; st.bold = false }
    else if (n === 1) st.bold = true
    else if (n === 22) st.bold = false
    else if (n === 39) st.fg = FG_DEFAULT
    else if (n === 49) st.bg = BG_DEFAULT
    else if (n >= 30 && n <= 37) st.fg = BASE[n - 30 + (st.bold ? 8 : 0)]
    else if (n >= 90 && n <= 97) st.fg = BASE[n - 90 + 8]
    else if (n >= 40 && n <= 47) st.bg = BASE[n - 40]
    else if (n >= 100 && n <= 107) st.bg = BASE[n - 100 + 8]
    else if (n === 38 || n === 48) {
      const target = n === 38 ? 'fg' : 'bg'
      if (parts[i + 1] === '5') { st[target] = idx256(Number(parts[i + 2])); i += 2 }
      else if (parts[i + 1] === '2') {
        const r = Number(parts[i + 2]); const g = Number(parts[i + 3]); const b = Number(parts[i + 4])
        st[target] = `#${[r, g, b].map((x) => (x || 0).toString(16).padStart(2, '0')).join('')}`
        i += 4
      }
    }
  }
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function encodePng(width, height, rgbBuf) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    rgbBuf.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}


// ---------------------------------------------------------------- 宽度
//
// 排版不能靠「字体里这个字多宽」，得按终端的规矩：
//   W/F（中日韩、全角标点、表情）= 2 格；组合记号 = 0 格；其余 = 1 格。
// 否则换一门语言，整行就往右挪。

const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd], [0x30000, 0x3fffd],
]

const ZERO_RANGES = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a],
  [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x0900, 0x0903],
  [0x093a, 0x094f], [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x2060, 0x2064], [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
]

const inRanges = (cp, ranges) => {
  for (const [a, b] of ranges) if (cp >= a && cp <= b) return true
  return false
}

/** 这个码位占几格：0 / 1 / 2。 */
export function charCells(cp) {
  if (cp === 0 || cp === 0x200b) return 0
  if (inRanges(cp, ZERO_RANGES)) return 0
  if (inRanges(cp, WIDE_RANGES)) return 2
  return 1
}

// ---------------------------------------------------------------- 画帧

const CELL_W = 8
const CELL_H = 16

/**
 * 把若干行 ANSI 文本画成一帧。
 * lines 可以只是游戏屏，也可以把 cdda_log 的几行拼在后面（中间留一行空隙）。
 */
export function renderScreen(lines, opts = {}) {
  const scale = Math.max(1, Math.min(4, Number(opts.scale) || 2))
  // 行距：字形是整格塞满的，行与行贴死会互相咬，看起来像错位
  const pad = Math.max(0, Math.min(8, Number(opts.linePad ?? 2))) * scale
  const font = loadFont(opts.fontFile)
  const raw = Array.isArray(lines) ? lines : String(lines || '').split('\n')
  // 上下留一行空白：很多播放器会把贴边的第一行裁掉
  const margin = Math.max(0, Math.min(3, Number(opts.marginRows ?? 1)))
  const list = margin ? [...Array(margin).fill(''), ...raw, ...Array(margin).fill('')] : raw
  const rows = Math.max(1, list.length)
  const cols = Math.max(1, Number(opts.cols) || 80)

  const cw = CELL_W * scale
  const chh = CELL_H * scale + pad
  const width = cols * cw
  const height = rows * chh
  const buf = Buffer.alloc(width * height * 3)

  // 底色铺满
  const bg0 = rgb(opts.background || BG_DEFAULT)
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = bg0[0]; buf[i * 3 + 1] = bg0[1]; buf[i * 3 + 2] = bg0[2]
  }

  const st = { fg: FG_DEFAULT, bg: BG_DEFAULT, bold: false }

  for (let y = 0; y < rows; y++) {
    st.fg = FG_DEFAULT; st.bg = BG_DEFAULT; st.bold = false
    const cells = parseLine(list[y] || '', st)
    let x = 0
    for (const cell of cells) {
      if (x >= cols) break
      const cp = cell.ch.codePointAt(0)
      const g = glyphOf(font, cp)
      const wCell = charCells(cp) || 1
      const px = x * cw
      const py = y * chh

      if (cell.bg && cell.bg !== BG_DEFAULT) {
        const b = rgb(cell.bg)
        const w = Math.min(width - px, wCell * cw)
        for (let dy = 0; dy < chh; dy++) {
          const rowOff = (py + dy) * width * 3 + px * 3
          for (let dx = 0; dx < w; dx++) {
            buf[rowOff + dx * 3] = b[0]
            buf[rowOff + dx * 3 + 1] = b[1]
            buf[rowOff + dx * 3 + 2] = b[2]
          }
        }
      }

      if (g && cell.ch.trim()) {
        const f = rgb(cell.fg || FG_DEFAULT)
        const gw = g.wide ? 16 : 8
        // 制表符要跨行连起来：加行距后按比例把竖线拉长，否则边框断成一截一截
        const boxy = cp >= 0x2500 && cp <= 0x257f
        const stretch = boxy && pad > 0 ? (CELL_H * scale + pad) / (CELL_H * scale) : 1
        for (let gy = 0; gy < 16; gy++) {
          const bits = g.rows[gy]
          if (!bits) continue
          for (let gx = 0; gx < gw; gx++) {
            if (!((bits >> (gw - 1 - gx)) & 1)) continue
            const bx = px + gx * scale
            const by = py + Math.floor(gy * scale * stretch)
            if (bx >= width || by >= height) continue
            const sh = Math.max(1, Math.ceil(scale * stretch))
            for (let sy = 0; sy < sh; sy++) {
              const off = (by + sy) * width * 3 + bx * 3
              for (let sx = 0; sx < scale; sx++) {
                const o = off + sx * 3
                if (o + 2 >= buf.length) break
                buf[o] = f[0]; buf[o + 1] = f[1]; buf[o + 2] = f[2]
              }
            }
          }
        }
      }
      if (process.env.ANSI_DEBUG) console.error('cell', JSON.stringify(cell.ch), 'cp', cp, 'wide', !!(g&&g.wide), 'x', x, 'px', px)
      x += wCell
    }
  }

  return { png: encodePng(width, height, buf), width, height, cols, rows }
}
