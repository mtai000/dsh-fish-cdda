/**
 * lib/cast.mjs —— 原始帧日志（录制时存，渲染时读）
 * ============================================================================
 * 为什么要这么切：录一次原始数据，画面怎么画可以反复改、反复重放，
 * 不用为了看一眼效果再开一局游戏。测试渲染只要一条命令，不碰 tmux。
 *
 * 格式：gzip 的 JSONL，一行一帧：
 *   {"t":1.5,"w":80,"h":24,"d":"<带颜色码的一整屏>"}
 * t = 相对开始的秒数；d 里保留 ANSI 转义。
 * 只存网格快照，不存原始字节流——我们不需要重放终端状态机。
 * ============================================================================
 */
import { createWriteStream, createReadStream } from 'node:fs'
import { createGzip, createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'

export function openCastWriter(file, opts = {}) {
  const out = createWriteStream(file, opts.append ? { flags: 'a' } : undefined)
  const gz = createGzip({ level: 6 })
  const done = pipeline(gz, out)
  const t0 = Date.now()
  let frames = 0
  return {
    file,
    get frames() { return frames },
    write(lines, cols) {
      const rowCount = Array.isArray(lines) ? lines.length : 0
      const rec = {
        t: Math.round((Date.now() - t0) / 10) / 100,
        w: Math.max(1, Number(cols) || 80),
        h: Math.max(1, rowCount),
        d: (Array.isArray(lines) ? lines : String(lines || '').split('\n')).join('\n'),
      }
      frames++
      return gz.write(JSON.stringify(rec) + '\n')
    },
    close() {
      gz.end()
      return done.then(() => ({ file, frames })).catch(() => ({ file, frames }))
    },
  }
}

/** 读 cast：逐个 yield {t,w,h,d}。 */
export async function* readCast(file) {
  const stream = createReadStream(file)
  const gunzip = createGunzip()
  stream.pipe(gunzip)
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity })
  for await (const line of rl) {
    const s = line.trim()
    if (!s) continue
    try { yield JSON.parse(s) } catch { /* 坏行跳过 */ }
  }
}
