/**
 * lib/game.mjs —— 开游戏 / 停游戏 / 窗口状态机
 * ============================================================================
 * 插件包不带存档。第一次运行且 `game/save` 里没有存档时，直接走 bootstrap
 * 的按键状态机（也可以从 `<家>/starter-world/save` 复制一份可选外部种子，
 * 然后用 `--world <名字>` 直接进游戏）：
 *   选语言 → 选角色(Play Now!) → 建世界(f/Y) → 建角色(TAB/Y) → 游戏中。
 * bootstrap 是尽力而为；失败时用户仍可 `screen -x cdda` 手动建一次角色，
 * 之后插件会检测到存档并直接用 `--world` 进游戏。
 * ============================================================================
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildLaunchScript, capture, createSession, ensureLogScreen, findCdda,
  findWorlds, hasSession, pickWorld, quitSession, stuff,
} from './screen.mjs'
import { detectMode, modeHint, modeLabel } from './parse.mjs'
import { readGameState, saveExists } from './state-read.mjs'
import { parseScreen } from './screen-parse.mjs'
import { composeState } from './state-compose.mjs'
import { pathsOf, starterWorldNames } from './state.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function gameSession(cfg) { return String(cfg.screenGame || 'cdda') }

/** 可选：把外部 starter world 铺到 home（只铺一次；插件包不带 .sav） */
export function ensureStarterWorld(cfg, stateDir, pluginDir, log = () => {}) {
  if (!cfg.starterWorld) return { ok: true, skipped: true }
  const p = pathsOf(stateDir)
  if (cfg.userDir && String(cfg.userDir).trim()) {
    // 用户指定了自己的 CDDA 目录：不往里塞东西
    return { ok: true, skipped: true, reason: 'userDir 是用户自己的目录' }
  }
  if (saveExists(p.saveDir)) return { ok: true, exists: true }
  // 插件包不携带任何 .sav：可选种子放在运行时家里，不放进插件目录
  const base = join(stateDir, 'starter-world', 'save')
  if (!existsSync(base)) return { ok: true, skipped: true, reason: '没有外部 starter-world；将走新建角色流程' }
  try {
    mkdirSync(p.saveDir, { recursive: true })
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const to = join(p.saveDir, d.name)
      if (existsSync(to)) continue
      cpSync(join(base, d.name), to, { recursive: true, force: true })
      log(`已铺好外部开局种子：${d.name}（${p.saveDir}）`)
    }
    return { ok: true, copied: true }
  } catch (e) {
    return { ok: false, error: `铺外部开局种子失败：${String(e?.message ?? e)}` }
  }
}

async function captureGame(cfg, stateDir) {
  return capture(cfg, gameSession(cfg), { stateDir })
}

/** 等画面进入游戏（最多 timeoutMs），处理加载/校验/建局 */
async function waitForGameplay(cfg, stateDir, { timeoutMs = 25_000, log = () => {} } = {}) {
  const start = Date.now()
  let lastMode = ''
  while (Date.now() - start < timeoutMs) {
    const cap = await captureGame(cfg, stateDir)
    if (cap.ok) {
      if (cap.mode !== lastMode) {
        lastMode = cap.mode
        log(`界面：${modeLabel(cap.mode)}`)
      }
      if (cap.mode === 'gameplay') return { ok: true, capture: cap }
      if (cap.mode === 'death') return { ok: false, dead: true, capture: cap, error: '角色已经死了' }
    }
    await sleep(700)
  }
  return { ok: false, capture: null, error: `等了 ${Math.round(timeoutMs / 1000)} 秒还没进游戏` }
}

/** 认不出/没存档时的按键状态机（只用于首次开局） */
export async function bootstrapNewGame(cfg, stateDir, { timeoutMs = 90_000, log = () => {} } = {}) {
  const start = Date.now()
  let lastMode = ''
  let acted = 0
  log('开始自动建局（bootstrap）……')
  while (Date.now() - start < timeoutMs) {
    const cap = await captureGame(cfg, stateDir)
    if (!cap.ok) { await sleep(800); continue }
    const mode = cap.mode
    if (mode !== lastMode) { lastMode = mode; log(`bootstrap 界面：${modeLabel(mode)}`) }
    const t = cap.text.toLowerCase()

    if (mode === 'gameplay') { log('bootstrap 成功：进入游戏'); return { ok: true, capture: cap } }
    if (mode === 'death') { log('bootstrap 失败：角色死了'); return { ok: false, dead: true, capture: cap } }

    if (mode === 'language') {
      await stuff(cfg, gameSession(cfg), '1'); acted++
      await sleep(1200)
      continue
    }
    if (mode === 'char_select') {
      // 第一项默认是 Custom Character；下一项就是 Play Now! (Default Scenario)
      await stuff(cfg, gameSession(cfg), 'j'); await sleep(400)
      await stuff(cfg, gameSession(cfg), '\n'); acted++
      await sleep(2500)
      continue
    }
    if (mode === 'world_create') {
      await stuff(cfg, gameSession(cfg), 'f'); await sleep(600)
      await stuff(cfg, gameSession(cfg), 'Y'); acted++
      log('正在生成世界（约 10-20 秒）……')
      await sleep(5000)
      continue
    }
    if (mode === 'char_create') {
      await stuff(cfg, gameSession(cfg), '\t'); await sleep(600)
      await stuff(cfg, gameSession(cfg), 'Y'); acted++
      await sleep(2500)
      continue
    }
    if (mode === 'main_menu') {
      await stuff(cfg, gameSession(cfg), 'n'); acted++
      await sleep(1500)
      continue
    }
    if (mode === 'dialog') {
      if (/save and quit\?/.test(t)) await stuff(cfg, gameSession(cfg), 'N')
      else await stuff(cfg, gameSession(cfg), 'Y')
      acted++
      await sleep(1200)
      continue
    }
    if (mode === 'loading') { await sleep(1500); continue }
    // unknown：不要乱按，等它自己稳定
    await sleep(1200)
    if (Date.now() - start > 30_000 && acted === 0) {
      log('bootstrap 认不出界面，也没有可安全执行的按键 ⇒ 停手，等你手动开局')
      return { ok: false, manual: true, capture: cap }
    }
  }
  return { ok: false, error: 'bootstrap 超时', capture: null }
}

/** 确保 cdda_log 在跑；幂等 */
export async function ensureLog(cfg, stateDir, pluginDir, log = () => {}) {
  try {
    const r = await ensureLogScreen(cfg, stateDir, pluginDir)
    if (!r.ok) log(`cdda_log 没起来：${r.error || '未知原因'}`)
    return r
  } catch (e) {
    log(`cdda_log 没起来：${String(e?.message ?? e)}`)
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/**
 * 开游戏。
 * @param {{world?:string, log?:Function, waitMs?:number}} opts
 */
export async function startGame(cfg, stateDir, pluginDir, opts = {}) {
  const log = opts.log || (() => {})
  const p = pathsOf(stateDir)
  const name = gameSession(cfg)
  const worldOpt = String(opts.world || '').trim()

  await ensureLog(cfg, stateDir, pluginDir, log)

  if (await hasSession(cfg, name)) {
    const cap = await captureGame(cfg, stateDir)
    if (cap.ok && cap.mode === 'gameplay') {
      return { ok: true, already: true, mode: cap.mode, world: worldOpt || cfg.world || '', capture: cap }
    }
    // 会话在，但停在菜单/存档/死亡：结束它，按存档重新开
    if (cap.ok && ['main_menu', 'char_select', 'char_create', 'world_create', 'saving'].includes(cap.mode)) {
      log(`游戏会话停在「${modeLabel(cap.mode)}」⇒ 先结束再重开`)
      await quitSession(cfg, name)
      await sleep(600)
    } else if (cap.ok && cap.mode === 'death') {
      return { ok: false, dead: true, error: '角色已经死了；要重开请在设置里清掉存档，或手动新建角色', capture: cap }
    } else {
      return { ok: true, already: true, mode: cap.ok ? cap.mode : 'unknown', capture: cap }
    }
  }

  const starter = ensureStarterWorld(cfg, stateDir, pluginDir, log)
  if (!starter.ok) log(starter.error || '内置存档不可用')

  const cdda = findCdda(cfg)
  if (!cdda) {
    return { ok: false, error: '找不到 CDDA：请安装 cataclysm-dda-curses，或在设置里填 cddaPath' }
  }

  const worlds = findWorlds(p.saveDir)
  const world = worldOpt || pickWorld(cfg, p.saveDir, starterWorldNames(stateDir))
  const launch = buildLaunchScript(cfg, stateDir, world)
  if (!launch.ok) return launch
  log(`启动 CDDA：${launch.cdda}（world=${world || '（无存档，进入开局流程）'}）`)
  const created = await createSession(cfg, name, ['bash', '-lc', launch.script], {
    env: { CDDA_DUTY_HOME: stateDir },
    waitMs: 3000,
  })
  if (!created.ok) return { ok: false, error: created.error }

  // ⚠️ detached screen 有个怪脾气：程序第一帧写进去后，如果没有客户端交互，
  //    hardcopy 可能是空的（实测首次开局的语言选择/加载页）。发一个空格把屏幕“叫醒”，
  //    在最坏情况下也只是游戏内等一回合。
  const first = await captureGame(cfg, stateDir)
  if (!first.ok || !first.text || !first.text.trim()) {
    await stuff(cfg, name, ' ')
    await sleep(1200)
  }

  // 有存档 + --world：通常 2-5 秒直接进游戏；没存档则进菜单
  const wait = await waitForGameplay(cfg, stateDir, { timeoutMs: world ? 25_000 : 8_000, log })
  if (wait.ok) return { ok: true, world, mode: 'gameplay', launch, capture: wait.capture }

  // 没进游戏 ⇒ 跑 bootstrap
  const boot = await bootstrapNewGame(cfg, stateDir, { log })
  if (boot.ok) return { ok: true, world, bootstrapped: true, mode: 'gameplay', launch, capture: boot.capture }
  return {
    ok: false,
    world,
    error: boot.error || (boot.manual ? '需要手动开局：screen -x ' + name + '，建好角色后保存一次；之后插件会自动用 --world 进入' : '开局失败'),
    manual: Boolean(boot.manual),
    capture: boot.capture || wait.capture,
  }
}

/** 停游戏：先 S / Y 存档退出，再关 screen 会话 */
export async function stopGame(cfg, stateDir, { save = true, log = () => {} } = {}) {
  const p = pathsOf(stateDir)
  const name = gameSession(cfg)
  if (!(await hasSession(cfg, name))) return { ok: true, missing: true }
  const cap = await captureGame(cfg, stateDir)
  if (save && cap.ok && ['gameplay', 'unknown'].includes(cap.mode)) {
    log('发送 S / Y 存档并退出……')
    await stuff(cfg, name, 'S')
    await sleep(700)
    await stuff(cfg, name, 'Y')
    await sleep(2600)
  }
  const q = await quitSession(cfg, name)
  await sleep(300)
  log(q.ok ? '游戏会话已关闭' : `关闭游戏会话失败：${q.error}`)
  return { ok: q.ok, saved: Boolean(save && cap.ok), mode: cap.ok ? cap.mode : 'unknown' }
}

/** 看：屏幕 + 存档状态 + 会话信息 */
export async function lookGame(cfg, stateDir, { world = '' } = {}) {
  const p = pathsOf(stateDir)
  const cap = await captureGame(cfg, stateDir)
  const st = readGameState(p.saveDir, world || cfg.world)
  const parsed = cap.ok ? parseScreen(cap.text) : parseScreen('')
  const view = composeState(st, parsed, cap)
  return { capture: cap, state: st, parsed, view }
}

/** 会话/状态汇总（不会自动开游戏） */
export async function inspectGame(cfg, stateDir, { world = '' } = {}) {
  const p = pathsOf(stateDir)
  const name = gameSession(cfg)
  const cap = await captureGame(cfg, stateDir)
  const st = readGameState(p.saveDir, world || cfg.world)
  const parsed = cap.ok ? parseScreen(cap.text) : parseScreen('')
  const view = composeState(st, parsed, cap)
  return {
    screen: name,
    logScreen: String(cfg.screenLog || 'cdda_log'),
    running: Boolean(cap.ok),
    mode: cap.ok ? cap.mode : 'not_running',
    modeLabel: cap.ok ? modeLabel(cap.mode) : '未启动',
    hint: cap.ok ? modeHint(cap.mode) : '游戏没开：调用 cdda_start 或点设置页「开始游戏」。',
    capture: cap,
    save: st,
    parsed,
    view,
    saveDir: p.saveDir,
    gameDir: p.gameDir,
  }
}
