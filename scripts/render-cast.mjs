#!/usr/bin/env node
/**
 * scripts/render-cast.mjs —— 把录制时存下的原始帧重新画成 mp4
 * ============================================================================
 * 用法：
 *   node scripts/render-cast.mjs <xxx.cast.jsonl.gz> <out.mp4> [--scale 2] [--linepad 2] [--fps 2] [--cols 80]
 *
 * 不碰游戏、不碰 tmux。改了字形、行距、配色，拿老素材重画一遍就能看效果。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCast } from '../lib/cast.mjs'
import { renderScreen, charCells } from '../lib/ansirender.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const castFile = process.argv[2]
const outFile = process.argv[3]
if (!castFile || !outFile) {
  console.error('用法：render-cast <xxx.cast.jsonl.gz> <out.mp4> [--scale 2] [--linepad 2] [--fps 2] [--cols 80]')
  process.exit(2)
}
if (!existsSync(castFile)) {
  console.error(`找不到原始帧：${castFile}`)
  process.exit(2)
}

const scale = Math.max(1, Math.min(4, Number(argOf('scale', 2))))
const linePad = Math.max(0, Math.min(8, Number(argOf('linepad', 2))))
const fps = Math.max(1, Math.min(10, Number(argOf('fps', 2))))
const fixedCols = Number(argOf('cols', 0)) || 0

const ff = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  outFile,
], { stdio: ['pipe', 'inherit', 'inherit'] })

// 先扫一遍拿到最大宽高：同一段里游戏可能自己改过终端尺寸，
// 画布按最大的来，小的补白，视频尺寸才稳定。
const displayCells = (line) => {
  const txt = String(line || '').replace(/\x1b\[[0-9;]*m/g, '')
  let n = 0
  for (const ch of txt) n += charCells(ch.codePointAt(0)) || 1
  return n
}

const frames = []
let maxCols = fixedCols || 0
let maxRows = 0
for await (const rec of readCast(castFile)) {
  const lines = String(rec.d || '').split('\n')
  frames.push({ lines })
  if (!fixedCols) {
    // 只按真实有字的宽度算，右边空出来的地方裁掉
    for (const l of lines) maxCols = Math.max(maxCols, displayCells(l))
  }
  let last = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].replace(/\x1b\[[0-9;]*m/g, '').trim()) last = i
  maxRows = Math.max(maxRows, last + 1)
}
maxRows = Math.max(1, maxRows)
const cols = maxCols || 80

let n = 0
for (const f of frames) {
  const lines = f.lines.slice(0, maxRows)
  while (lines.length < maxRows) lines.push('')
  const frame = renderScreen(lines, { cols, scale, linePad })
  if (!ff.stdin.write(frame.png)) {
    await new Promise((r) => ff.stdin.once('drain', r))
  }
  n++
}
ff.stdin.end()
await new Promise((r) => ff.once('close', r))
console.log(`画完：${outFile}（${n} 帧，${scale}x，行距 ${linePad}）`)
