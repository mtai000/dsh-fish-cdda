#!/usr/bin/env node
/**
 * selfcheck.mjs —— dsh-fish-cdda 的环境自检（不启动游戏、不花 token）
 *
 *   node selfcheck.mjs
 *
 * 检查：Node、GNU screen、CDDA 可执行文件、插件家目录、两个 screen 会话、配置解析。
 *      插件包不再自带 .sav；可选外部 starter 放到 <家>/starter-world/save。
 */
import { existsSync, accessSync, constants, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { DEFAULT_CFG, loadCfgFromDisk, pathsOf } from './lib/state.mjs'
import { findCdda, hasSession, screenBin, tmuxBin } from './lib/screen.mjs'
import { backendName } from './lib/backend.mjs'
import { findWorlds } from './lib/state-read.mjs'
import { findFfmpeg, findFont } from './lib/recorder.mjs'
import { parseScreen } from './lib/screen-parse.mjs'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const stateDir = join(home, 'cdda-duty')
const p = pathsOf(stateDir)
const pluginDir = new URL('.', import.meta.url).pathname.replace(/\/$/, '')

const results = []
const add = (ok, name, detail = '') => {
  results.push({ ok, name, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}
const warn = (name, detail = '') => {
  results.push({ ok: true, name, detail, warn: true })
  console.log(`⚠️  ${name}${detail ? ' — ' + detail : ''}`)
}

// Node
const major = Number(process.versions.node.split('.')[0])
add(major >= 22, 'Node.js >= 22', process.version)

// CDDA（先读配置，后面要按 terminal 决定查哪个复用器）
const cfg = loadCfgFromDisk(stateDir)

// 终端复用器：按 terminal 配置选，auto 时看装了谁
const backend = backendName(cfg)
const tbin = tmuxBin(cfg)
const sb = screenBin({})
const tv = tbin ? spawnSync(tbin, ['-V'], { encoding: 'utf8' }) : { status: -1, stdout: '' }
const sv = spawnSync(sb, ['--version'], { encoding: 'utf8' })
if (backend === 'tmux') add(tv.status === 0, 'tmux 可用', (tv.stdout || '').trim() || tbin || '没装 tmux；设置里 terminal=screen 可回退')
else add(sv.status === 0, 'GNU screen 可用', (sv.stdout || '').split('\n')[0] || sb)
add(true, '终端后端', `${backend}（terminal=${cfg.terminal || 'auto'}；tmux ${tv.status === 0 ? '有' : '无'} / screen ${(sv.status === 0 || /Screen version/i.test(sv.stdout || '')) ? '有' : '无'}）`)

const cdda = findCdda(cfg)
add(Boolean(cdda), 'CDDA 可执行文件', cdda || '设置里填 cddaPath，或安装 cataclysm-dda-curses')

// screen parser
try {
  const sample = parseScreen('Head  |||||  Torso  |||||\nPlace: Evac Shelter\nYou see here: water bottle')
  add(sample.healthFromScreen === 100 && sample.location === 'Evac Shelter', '屏幕结构化解析',
    `HP ${sample.healthFromScreen} · ${sample.location} · ${sample.visibleItems.join('/')}`)
} catch (e) {
  add(false, '屏幕结构化解析', String(e?.message ?? e))
}

// recording deps
const ff = findFfmpeg(cfg)
const font = findFont(cfg)
if (ff && font) add(true, '录制依赖（ffmpeg + 等宽字体）', `${ff} · ${font}`)
else warn('录制依赖（ffmpeg + 等宽字体）', `ffmpeg=${ff || '缺'} font=${font || '缺'}（只影响录制，不影响玩）`)

// state dir
try {
  accessSync(stateDir, constants.R_OK | constants.W_OK)
  add(true, '插件家目录可读写', stateDir)
} catch {
  add(false, '插件家目录可读写', stateDir)
}

// current saves
const worlds = findWorlds(p.saveDir)
add(worlds.length > 0, '当前 CDDA 存档', worlds.length ? worlds.map((w) => w.name).join(' / ') : '还没开过游戏（第一次点「开始游戏」会自动铺内置存档）')

// 会话（按当前后端查）
const gameSession = String(cfg.screenGame || 'cdda')
const logSession = String(cfg.screenLog || 'cdda_log')
if (await hasSession(cfg, gameSession)) add(true, `会话 ${gameSession}`, `游戏在跑（${backend}）`)
else warn(`会话 ${gameSession}`, `还没开（正常；点「开始游戏」）`)
if (await hasSession(cfg, logSession)) add(true, `会话 ${logSession}`, '战报在跑')
else warn(`会话 ${logSession}`, '还没开（正常；宿主加载后会自动开）')

// config
try {
  add(true, '配置可解析', `goal=${String(cfg.goal).slice(0, 30)}… autoplay=${cfg.autoplay}`)
} catch (e) {
  add(false, '配置可解析', String(e?.message ?? e))
}

// profile
const profile = join(home, 'profiles', cfg.dutyProfile || 'cdda-duty')
if (existsSync(join(profile, 'cordis.patch.yml'))) add(true, '自动玩 profile', profile)
else warn('自动玩 profile', '还没铺（第一次自动玩/加载插件时会铺）')

// 汇总
const bad = results.filter((r) => !r.ok)
console.log('')
if (bad.length) {
  console.log(`❌ ${bad.length} 项没通过。先解决上面的 ❌ 再开游戏。`)
  process.exit(1)
}
console.log('✅ 自检通过。去 dsh 设置 →「CDDA 陪玩」点「开始游戏」。')
