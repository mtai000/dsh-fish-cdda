/**
 * lib/parse.mjs —— 把 screen 的 hardcopy 洗成模型能读的 ASCII，并判断当前界面
 * ============================================================================
 * CDDA 0.G 在 `TERM=linux` 下不会切 alternate screen，但菜单的边框是
 * CP437 / ACS 字节：hardcopy 里会变成非法 UTF-8（U+FFFD）或控制字符。
 * 游戏地图本身是 ASCII（# . @ 等），侧栏也是 ASCII，所以：
 *   · 把非法字节 / 控制字符替换成空格（地图与侧栏完全保留）
 *   · 菜单里的文字仍然可读，只是边框变成空白
 * ============================================================================
 */

const ANSI = [
  /\x1b\][^\x07]*(?:\x07|\x1b\\)/g,          // OSC
  /\x1b\[[0-?]*[ -/]*[@-~]/g,                // CSI
  /\x1b[()][A-Za-z0-9]/g,                    // charset
  /\x1b[@-_]/g,                              // 其它 ESC
]

export function stripAnsi(s) {
  let out = String(s || '')
  for (const re of ANSI) out = out.replace(re, '')
  return out
}

/** 洗一屏：去掉 ANSI / 非法字节 / 控制字符，行尾去空格，尾部空行去掉 */
export function cleanScreen(raw) {
  let s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')
  s = s.replace(/\r\n?/g, '\n')
  s = stripAnsi(s)
  // 非法 UTF-8 解出来的替换符、以及所有 C0 控制字符（保留换行）
  s = s.replace(/\uFFFD/g, ' ')
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  // CP437 / ACS 有时会以 U+00A0 之类的不可见字符出现
  s = s.replace(/[\u00a0\u200b\ufeff]/g, ' ')
  s = s.replace(/\t/g, '  ')
  const lines = s.split('\n').map((l) => l.replace(/[ \u00a0]+$/g, ''))
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

/** 屏幕的显示行列（CJK 按 2 列估，够日志屏排版用） */
export function displayWidth(str) {
  let n = 0
  for (const ch of String(str || '')) {
    const c = ch.codePointAt(0)
    if (
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)
    ) n += 2
    else n += 1
  }
  return n
}

export function truncDisplay(str, width) {
  const s = String(str || '')
  if (width <= 0) return ''
  if (displayWidth(s) <= width) return s
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = displayWidth(ch)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return out + '…'
}

export function padDisplay(str, width) {
  const t = truncDisplay(str, width)
  return t + ' '.repeat(Math.max(0, width - displayWidth(t)))
}

/**
 * 判断现在是什么界面。
 * @returns {'gameplay'|'main_menu'|'char_select'|'char_create'|'world_create'|'language'|'dialog'|'death'|'saving'|'loading'|'unknown'}
 */
export function detectMode(text) {
  const raw = String(text || '')
  if (!raw.trim()) return 'unknown'
  const t = raw.toLowerCase()

  if (/you (?:have )?died|final death|your body is|game over|press esc.*(?:death|get up)/.test(t)) return 'death'
  if (/save and quit\?|save and quit/.test(t)) return 'saving'
  if (/select your language/.test(t)) return 'language'
  if (/are you sure|\(y\)es\s+\(n\)o|yes\s+no/.test(t)) return 'dialog'
  if (/< create world >/.test(t) || /world name:/.test(t) && /\[f\]\s*\[\s*finish/.test(t)) return 'world_create'
  if (/press tab to finish character creation/.test(t) || (/custom character/.test(t) && /points left:/.test(t))) return 'char_create'
  if (/custom character/.test(t) && /play now!/.test(t)) return 'char_select'
  if (/\[motd\].*\[new game\]|new game.*load.*world/.test(t)) return 'main_menu'
  if (/verifying|finalizing|loading|please wait/.test(t) && !/@/.test(t)) return 'loading'
  if (/press \} for sidebar options|date:.*time:|place:.*lighting:/.test(t) && /@/.test(t)) return 'gameplay'
  // 游戏内弹窗（物品栏、制作菜单、确认框）仍然算 gameplay，避免误判
  if (/@/.test(t) && /date:|place:|weather:|wield:/.test(t)) return 'gameplay'
  return 'unknown'
}

export function modeLabel(mode) {
  return ({
    gameplay: '游戏中',
    main_menu: '主菜单',
    char_select: '选角色',
    char_create: '建角色',
    world_create: '建世界',
    language: '选语言',
    dialog: '确认框',
    death: '死亡',
    saving: '存档中',
    loading: '加载中',
    unknown: '未知',
  })[mode] || mode || '未知'
}

export function modeHint(mode) {
  return ({
    gameplay: '用 cdda_send 发一个动作；每次动作后用 cdda_look 看屏幕。',
    main_menu: '主菜单：n=新游戏、l=读档、w=世界、q=退出。',
    char_select: '选角色：j/k 上下、<RETURN> 确认。想快速开局选「Play Now! (Default Scenario)」。',
    char_create: '建角色：<TAB> 完成、<BACKTAB> 返回上一页；确认名字时按 Y。',
    world_create: '建世界：f 完成、Y 确认；生成要等十几秒。',
    language: '选语言：按 1 选 English。',
    dialog: '确认框：看提示按 Y/N，别乱按。',
    death: '角色死了。告诉用户，或在设置里清档重开。',
    saving: '正在存档/退出，等它完成。',
    loading: '正在加载，等 1-3 秒再看。',
    unknown: '认不出界面：先 cdda_look 看一眼原文，再决定按什么。',
  })[mode] || ''
}

/** 从屏幕里抓游戏内消息行（侧栏右侧/底部，尽力而为） */
export function screenMessageBlock(text, maxLines = 8) {
  const lines = String(text || '').split('\n')
  const hits = lines.filter((l) => /^[A-Za-z"].{10,}$/.test(l.trim()) && !/Press \}|sidebar options|See docs/.test(l))
  return hits.slice(-maxLines).join('\n')
}

/** 屏幕摘要（日志屏 / 设置页用）：最后几条非空行 */
export function screenPreview(text, maxLines = 6) {
  const lines = String(text || '').split('\n').filter((l) => l.trim())
  return lines.slice(-maxLines).join('\n')
}
