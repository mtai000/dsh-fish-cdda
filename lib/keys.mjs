/**
 * lib/keys.mjs —— 把模型/设置页给的按键写法翻成终端的字节
 * ============================================================================
 * 允许三种写法：
 *   1. 单个字面字符：`e`、`i`、`j`、`1`、`>`
 *   2. 具名键（整串就是一个名字）：`RETURN`、`ESC`、`TAB`、`UP`、`F5`
 *   3. 混在字符串里的尖括号记号：`<ESC>i`、`<UP><UP><RETURN>`、`jj<RETURN>`
 *
 * ⚠️ 不要把这些交给 shell —— 全程 argv 数组，`screen -X stuff <data>` 直接送。
 * ============================================================================
 */

const NAMED = {
  RETURN: '\n', ENTER: '\n', NEWLINE: '\n', CR: '\r',
  ESC: '\x1b', ESCAPE: '\x1b',
  TAB: '\t', BACKTAB: '\x1b[Z', SHIFT_TAB: '\x1b[Z',
  SPACE: ' ', SPACEBAR: ' ',
  BACKSPACE: '\x7f', BS: '\x7f',
  DELETE: '\x1b[3~', DEL: '\x1b[3~',
  INSERT: '\x1b[2~', INS: '\x1b[2~',
  UP: '\x1b[A', DOWN: '\x1b[B', RIGHT: '\x1b[C', LEFT: '\x1b[D',
  UP_ARROW: '\x1b[A', DOWN_ARROW: '\x1b[B', RIGHT_ARROW: '\x1b[C', LEFT_ARROW: '\x1b[D',
  'UP ARROW': '\x1b[A', 'DOWN ARROW': '\x1b[B', 'RIGHT ARROW': '\x1b[C', 'LEFT ARROW': '\x1b[D',
  ARROW_UP: '\x1b[A', ARROW_DOWN: '\x1b[B', ARROW_RIGHT: '\x1b[C', ARROW_LEFT: '\x1b[D',
  HOME: '\x1b[H', END: '\x1b[F',
  PAGEUP: '\x1b[5~', PAGEDOWN: '\x1b[6~', PGUP: '\x1b[5~', PGDN: '\x1b[6~',
  PAGE_UP: '\x1b[5~', PAGE_DOWN: '\x1b[6~',
  F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS',
  F5: '\x1b[15~', F6: '\x1b[17~', F7: '\x1b[18~', F8: '\x1b[19~',
  F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
}

// CDDA 常用菜单键的别名（方便模型不查键位表）
const ALIASES = {
  CONFIRM: 'RETURN', CANCEL: 'ESC', YES: 'y', NO: 'n',
  NORTH: 'k', SOUTH: 'j', WEST: 'h', EAST: 'l',
}

const MAX_BYTES = 512

function lookup(name) {
  const raw = String(name || '').trim()
  if (!raw) return null
  const up = raw.toUpperCase().replace(/[\s-]+/g, '_')
  if (NAMED[up] !== undefined) return NAMED[up]
  if (ALIASES[up] !== undefined) {
    const a = ALIASES[up]
    return NAMED[a] !== undefined ? NAMED[a] : a
  }
  return null
}

/**
 * @returns {{ok:true,data:string,label:string}|{ok:false,error:string}}
 */
export function parseKeys(input) {
  if (input === undefined || input === null) return { ok: false, error: 'keys 不能为空（例："e"、"jj<RETURN>"、"<ESC>i"）' }
  let s = String(input)
  if (!s) return { ok: false, error: 'keys 不能为空' }

  // 整串就是具名键（保留空格键的特例）
  if (s === ' ') return { ok: true, data: ' ', label: 'SPACE' }
  const whole = lookup(s)
  if (whole !== null) return { ok: true, data: whole, label: String(s).toUpperCase() }

  // 尖括号记号
  let out = ''
  let label = ''
  for (let i = 0; i < s.length;) {
    if (s[i] === '<') {
      const j = s.indexOf('>', i + 1)
      if (j < 0) return { ok: false, error: '尖括号没闭合：' + s.slice(i, i + 24) }
      const name = s.slice(i + 1, j)
      const v = lookup(name)
      if (v === null) return { ok: false, error: `不认识的键：<${name}>（可用：RETURN/ESC/TAB/UP/DOWN/LEFT/RIGHT/HOME/END/PGUP/PGDN/F1-F12/SPACE/BACKSPACE）` }
      out += v
      label += (label ? ' ' : '') + String(name).toUpperCase()
      i = j + 1
      continue
    }
    const ch = s[i]
    out += ch
    i++
  }
  if (!out) return { ok: false, error: '没有可发送的按键' }
  if (Buffer.byteLength(out, 'utf8') > MAX_BYTES) {
    return { ok: false, error: `一次最多发 ${MAX_BYTES} 字节（收到 ${Buffer.byteLength(out, 'utf8')}）` }
  }
  const plain = label || (/^[\x20-\x7e]+$/.test(out) ? out : JSON.stringify(out))
  return { ok: true, data: out, label: plain }
}

/** 给提示词/设置页看的按键表 */
export const KEY_HELP = 'e=查看、i=物品、m=地图、j/k/h/l=下/上/左/右移动（或方向键）、<RETURN>=确认、<ESC>=取消、<TAB>=切换、<BACKTAB>=反向切换'
