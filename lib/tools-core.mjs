/**
 * lib/tools-core.mjs —— 工具的真正实现（host 半端和 MCP 半端共用）
 * ============================================================================
 * 这里只依赖 screen / game / state-read，不依赖 cordis：
 *   · index.js 把它包成 ctx.tools.register(defineTool(...))
 *   · lib/mcp-server.mjs 把它包成 MCP tools/call
 * 这样“聊天里让 DSH 玩”和“自动玩回合”走的是同一套逻辑。
 * ============================================================================
 */
import { parseKeys, KEY_HELP } from './keys.mjs'
import { recoveryKeysFor, screenHash } from './screen-parse.mjs'
import { ensureGoal, updateGoal } from './goal.mjs'
import { hasSession, stuff } from './screen.mjs'
import { modeHint, modeLabel } from './parse.mjs'
import { inspectGame, lookGame, startGame, stopGame } from './game.mjs'
import {
  KnowledgeBase, TAG_HELP, knowledgeDirOf, loadKnowledge, searchKnowledge, suggestTags,
} from './knowledge.mjs'
import {
  appendActivity, appendDecision, readActivity, readRound, readRuntime, readStatus,
  recordAction, recordNote, recordEvent, writeStatus,
} from './state.mjs'

function summarizeCapture(cap) {
  if (!cap || !cap.ok) return { ok: false, error: cap?.error || '没有屏幕内容' }
  return {
    mode: cap.mode,
    modeLabel: modeLabel(cap.mode),
    hint: modeHint(cap.mode),
    screen: cap.text,
    rows: cap.rows,
    cols: cap.cols,
  }
}

const STUCK = new Map()
function stuckFor(stateDir) {
  let s = STUCK.get(stateDir)
  if (!s) { s = { sig: '', count: 0, recoveryCount: 0 }; STUCK.set(stateDir, s) }
  return s
}
export function resetStuck(stateDir) { STUCK.delete(stateDir) }

function summarizeSave(st) {
  if (!st || !st.ok) return { ok: false, error: st?.error || '没有存档' }
  return {
    ok: true,
    name: st.name,
    calendar: st.calendar,
    needs: st.needs,
    health: st.health,
    stats: st.stats,
    location: st.location,
    stamina: st.stamina,
    focus: st.focus,
    pain: st.pain,
    stim: st.stim,
    radiation: st.radiation,
    morale: st.morale,
    profession: st.profession,
    scenario: st.scenario,
    skills: st.skills,
    lastMessage: st.lastMessage,
    messages: st.messages.slice(-5),
    summary: st.summary,
    savedAt: st.savedAt,
    world: st.world,
  }
}

async function doLook(rt, { includeSave = true } = {}) {
  const cfg = rt.getCfg ? rt.getCfg() : rt.cfg
  const { capture, state, parsed, view } = await lookGame(cfg, rt.stateDir)
  ensureGoal(rt.stateDir, cfg.goal, state)
  const goalInfo = updateGoal(rt.stateDir, state, parsed)
  const out = {
    ok: Boolean(capture.ok),
    ...summarizeCapture(capture),
    ui: view.ui,
    visible: view.visible,
    vitals: { health: view.health, needs: view.needs, location: view.location },
    consistency: view.consistency,
    composedSummary: view.summary,
    round: readRound(rt.stateDir),
    goal: goalInfo,
    goalProgress: goalInfo?.progress?.text || '',
    knowledgeTags: suggestTags(state, capture.mode, parsed),
    ...(includeSave ? { save: summarizeSave(state) } : {}),
  }
  if (!capture.ok) out.error = capture.error
  // 给 cdda_log 战报屏留一份摘要（它不跑游戏逻辑，只读 status.json）
  try {
    writeStatus(rt.stateDir, {
      running: Boolean(capture.ok),
      mode: capture.ok ? capture.mode : 'not_running',
      goal: String((rt.getCfg ? rt.getCfg() : rt.cfg)?.goal || ''),
      goalProgress: goalInfo?.progress || null,
      goalComplete: Boolean(goalInfo?.complete),
      ui: view.ui,
      visible: view.visible,
      vitals: { health: view.health, needs: view.needs, location: view.location },
      consistency: view.consistency,
      ...(includeSave && state?.ok ? { state: summarizeSave(state) } : {}),
      ...(capture.ok ? { screenPreview: capture.text.split('\n').filter(Boolean).slice(-8).join('\n') } : {}),
    })
  } catch { /* 忽略 */ }
  return out
}

export const TOOL_SPECS = [
  {
    name: 'cdda_start',
    description: '启动 CDDA（在 screen 会话 `cdda` 里）并确保 `cdda_log` 战报屏也在。'
      + '已有存档会直接用 --world 进游戏；第一次没有存档时会铺内置开局，必要时自动走一遍建世界/建角色。'
      + '启动可能要 10-30 秒。启动后先用 cdda_look 看屏幕。',
    parameters: {
      world: { type: 'string', description: '要载入的世界名；留空 = 最近有存档的世界' },
      goal: { type: 'string', description: '这一局的目标（会显示在日志屏；只在本次调用里更新）' },
    },
    async handler(args, rt) {
      const cfg = rt.getCfg ? rt.getCfg() : rt.cfg
      if (args.goal) rt.updateGoal?.(String(args.goal).slice(0, 4000))
      const r = await startGame(cfg, rt.stateDir, rt.pluginDir, { world: args.world, log: rt.log })
      recordEvent(rt.stateDir, r.ok ? 'start' : 'start_failed', r.ok ? (r.already ? '游戏已经在跑' : `游戏已启动${r.bootstrapped ? '（自动建局）' : ''}`) : (r.error || '启动失败'))
      if (!r.ok) return { ok: false, error: r.error, manual: Boolean(r.manual), mode: r.capture?.mode }
      resetStuck(rt.stateDir)
      try { await rt.ensureRecording?.() } catch { /* 录制失败不影响玩 */ }
      const look = await doLook(rt)
      return { ok: true, already: Boolean(r.already), bootstrapped: Boolean(r.bootstrapped), world: r.world || '', ...look }
    },
  },
  {
    name: 'cdda_look',
    description: '看当前 CDDA 屏幕（ASCII，80×24 左右）+ 界面类型 + 结构化 ui/visible/vitals/consistency + 存档状态。'
      + '每次按键前、后都应该看一次；这是你唯一的“眼睛”。',
    parameters: {},
    async handler(_args, rt) { return doLook(rt) },
  },
  {
    name: 'cdda_send',
    description: '往 CDDA 发送按键，然后（默认）返回最新屏幕。'
      + 'keys 用法：单字符 "e" / "jjj" / "i"；特殊键用尖括号 "<ESC>"、"<RETURN>"、"<TAB>"、"<UP>"；'
      + '也可以混写 "jj<RETURN>i"。一次不要发太多，1-3 个动作最稳。\n'
      + `常用：${KEY_HELP}\n`
      + '如果返回 stuck:true，先按 recovery_keys 退出当前菜单；宿主也可能已经自动发了一次 Esc。',
    parameters: {
      keys: { type: 'string', required: true, description: '要发送的按键，例如 "e"、"jj<RETURN>"、"<ESC>i"' },
      note: { type: 'string', description: '这一步在做什么/为什么（会显示在 cdda_log 战报屏，务必写）' },
      wait_ms: { type: 'number', description: '发送后等多久再抓屏，默认 450ms；过门/加载可以给 1500-5000' },
      look: { type: 'boolean', description: '是否返回最新屏幕，默认 true' },
    },
    async handler(args, rt) {
      const cfg = rt.getCfg ? rt.getCfg() : rt.cfg
      const parsed = parseKeys(args.keys)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      const name = String(cfg.screenGame || 'cdda')
      if (!(await hasSession(cfg, name))) {
        return { ok: false, error: `screen 会话 ${name} 不存在。先调用 cdda_start。` }
      }
      const before = readStatus(rt.stateDir)
      const t0 = Date.now()
      const sent = await stuff(cfg, name, parsed.data)
      if (!sent.ok) return { ok: false, error: sent.error || '发送按键失败' }
      const wait = Math.max(120, Math.min(30_000, Number(args.wait_ms) || 450))
      await new Promise((r) => setTimeout(r, wait))
      let cap = null
      if (args.look !== false) cap = await doLook(rt)

      // 卡菜单检测：只对“有 UI / 非正常游戏”的重复画面下手，正常等待不会触发
      let stuck = null
      let auto = null
      if (cap?.ok) {
        const st = stuckFor(rt.stateDir)
        const sig = `${cap.mode}|${cap.ui?.state || ''}|${screenHash(cap.screen || '')}`
        if (st.sig && st.sig === sig) st.count += 1
        else { st.sig = sig; st.count = 1; st.recoveryCount = 0 }
        const special = Boolean(cap.ui?.state) || cap.mode !== 'gameplay'
        if (special && st.count >= 3) {
          stuck = { count: st.count, uiState: cap.ui?.state || null, recoveryKeys: recoveryKeysFor(cap.ui?.state) }
          if (st.count >= 4 && st.recoveryCount < 1 && rt.autoUnstick !== false) {
            const key = stuck.recoveryKeys[0] || '<ESC>'
            const kp = parseKeys(key)
            if (kp.ok) {
              try {
                await stuff(cfg, name, kp.data)
                await new Promise((r) => setTimeout(r, 500))
                const recovered = await doLook(rt)
                if (recovered?.ok) cap = recovered
                auto = { key, note: '连续卡在同一画面，宿主自动发了一次恢复键' }
                st.recoveryCount++
                st.sig = ''
                st.count = 0
                appendActivity(rt.stateDir, { kind: 'unstick', keys: key, note: auto.note, source: rt.source || 'chat' })
              } catch { /* 恢复失败就只返回提示 */ }
            }
          }
        }
      }

      const mode = cap?.mode || ''
      const rec = recordAction(rt.stateDir, {
        keys: parsed.label,
        note: String(args.note || ''),
        mode,
        source: rt.source || 'chat',
      })
      const out = {
        ok: true,
        sent: parsed.label,
        actionsToday: rec.actionsToday,
        actionsThisRound: rec.actionsThisRound,
        ...(cap && cap.ok ? {
          mode: cap.mode,
          modeLabel: modeLabel(cap.mode),
          hint: modeHint(cap.mode),
          screen: cap.screen,
          rows: cap.rows,
          cols: cap.cols,
          ui: cap.ui,
          visible: cap.visible,
          vitals: cap.vitals,
          consistency: cap.consistency,
          goal: cap.goal,
          goalProgress: cap.goalProgress,
          knowledgeTags: cap.knowledgeTags,
        } : {}),
        ...(cap && !cap.ok ? { screen_error: cap.error } : {}),
      }
      if (stuck) {
        out.stuck = true
        out.stuck_count = stuck.count
        out.recovery_keys = stuck.recoveryKeys
        out.hint = '画面连续没有变化：先按恢复键序列退出当前菜单，再重新看屏幕。'
        if (auto) {
          out.auto_unstuck = true
          out.auto_unstuck_key = auto.key
          out.auto_unstuck_note = auto.note
        }
      }
      try {
        appendDecision(rt.stateDir, {
          turn: rec.actionsToday,
          source: rt.source || 'chat',
          action: parsed.label,
          note: String(args.note || ''),
          mode,
          ui: cap?.ui?.state || null,
          stuck: Boolean(stuck),
          autoUnstuck: Boolean(auto),
          latencyMs: Date.now() - t0,
          knowledgeTags: cap?.knowledgeTags || [],
          stateBefore: before?.vitals || (before?.state ? { summary: before.state.summary } : null),
          stateAfter: cap?.vitals ? { ...cap.vitals, summary: cap.composedSummary } : null,
          goalProgress: cap?.goalProgress || null,
          actionsThisRound: rec.actionsThisRound,
        })
      } catch { /* 日志失败不影响玩 */ }
      if (rec.roundActive && rec.actionsLimit > 0 && rec.actionsThisRound >= rec.actionsLimit) {
        out.budget_exhausted = true
        out.budget_hint = `本回合动作预算 ${rec.actionsLimit} 已用完 ⇒ 总结一下并结束这一轮。`
      }
      return out
    },
  },
  {
    name: 'cdda_note',
    description: '把“我现在在做什么/为什么”写到 cdda_log 战报屏。'
      + '这不是游戏动作，不消耗动作预算；每次改变计划、发现危险、准备长动作前写一句，使用者才知道你在干什么。',
    parameters: {
      note: { type: 'string', required: true, description: '一句话说明当前计划/判断（中文）' },
    },
    async handler(args, rt) {
      const text = String(args.note || '').trim()
      if (!text) return { ok: false, error: 'note 不能为空' }
      recordNote(rt.stateDir, text, { source: rt.source || 'chat' })
      return { ok: true, note: text }
    },
  },
  {
    name: 'cdda_state',
    description: '读存档里的硬状态：名字、天数/时间/季节、HP、渴/饿/疲劳、力量/敏捷/智力/感知、'
      + '体力、专注、疼痛、辐射、技能、位置、最近消息。存档可能比屏幕旧（游戏只在存档时写盘），'
      + '所以它和 cdda_look 要一起看。',
    parameters: {},
    async handler(_args, rt) {
      const cfg = rt.getCfg ? rt.getCfg() : rt.cfg
      const { state } = await lookGame(cfg, rt.stateDir)
      return summarizeSave(state)
    },
  },
  {
    name: 'cdda_status',
    description: '看插件/游戏/回合/今日动作数/目标进度/两个 screen 会话是否在跑，以及怎么手动旁观。',
    parameters: {},
    async handler(_args, rt) {
      const cfg = rt.getCfg ? rt.getCfg() : rt.cfg
      const g = await inspectGame(cfg, rt.stateDir)
      const rtState = readRuntime(rt.stateDir)
      const goalInfo = (ensureGoal(rt.stateDir, cfg.goal, g.save), updateGoal(rt.stateDir, g.save, g.parsed))
      return {
        ok: true,
        running: g.running,
        mode: g.mode,
        modeLabel: g.modeLabel,
        hint: g.hint,
        ui: g.view?.ui,
        visible: g.view?.visible,
        vitals: g.view?.vitals || { health: g.view?.health, needs: g.view?.needs, location: g.view?.location },
        consistency: g.view?.consistency,
        screen: g.screen,
        logScreen: g.logScreen,
        saveDir: g.saveDir,
        gameDir: g.gameDir,
        save: summarizeSave(g.save),
        round: readRound(rt.stateDir),
        goal: goalInfo,
        goalText: cfg.goal,
        goalProgress: goalInfo?.progress?.text || '',
        recording: typeof rt.recordingStatus === 'function' ? rt.recordingStatus() : null,
        knowledgeTags: suggestTags(g.save, g.mode, g.parsed),
        composedSummary: g.view?.summary,
        actionsToday: rtState.actionsToday,
        roundsToday: rtState.roundsToday,
        totalActions: rtState.totalActions,
        autoplay: Boolean(cfg.autoplay),
        attach: {
          game: `screen -x ${g.screen}`,
          log: `screen -x ${g.logScreen}`,
          list: 'screen -ls',
        },
        recent: readActivity(rt.stateDir, 6),
      }
    },
  },
  {
    name: 'cdda_stop',
    description: '停掉游戏：优先发 S / Y 存档退出，再关闭 screen 会话 `cdda`（战报屏保留）。',
    parameters: {
      save: { type: 'boolean', description: '是否先存档，默认 true' },
    },
    async handler(args, rt) {
      const cfg = rt.getCfg ? rt.getCfg() : rt.cfg
      const r = await stopGame(cfg, rt.stateDir, { save: args.save !== false, log: rt.log })
      resetStuck(rt.stateDir)
      try { await rt.stopRecording?.() } catch { /* 忽略 */ }
      try { await rt.setAutoplay?.(false) } catch { /* 忽略 */ }
      recordEvent(rt.stateDir, 'stop', r.ok ? '游戏已停止' : `停止失败：${r.error || ''}`)
      try { writeStatus(rt.stateDir, { running: false, mode: 'not_running', round: null, actionsThisRound: 0 }) } catch { /* 忽略 */ }
      return { ok: r.ok, ...r }
    },
  },
  {
    name: 'cdda_knowledge',
    description: '查 CDDAi 知识库：基础生存、早期路线、饥渴/健康/疲劳/士气/温度机制、'
      + '水/食物/工具/材料、早期配方、菜单按键。\n'
      + '· 不传参数：列出可用 tag + 按当前状态推荐哪些\n'
      + '· 传 tags（数组）：取这些章节（会带基础生存 + 核心按键，默认上限 12000 字符）\n'
      + '· 传 query：按关键词搜原文（返回文件名/行号/片段）\n'
      + '自动玩回合已经会按状态自动注入一段；这只工具用于查更细的内容。',
    parameters: {
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '章节 tag，例如 ["water_sources","thirst_mechanics","combat_tactics"]',
      },
      query: { type: 'string', description: '关键词，例如 "boil water"、"bleeding"、"crowbar"' },
      max_chars: { type: 'number', description: '返回上限，默认 12000，范围 2000-30000' },
    },
    async handler(args, rt) {
      const dir = rt.knowledgeDir || knowledgeDirOf(rt.pluginDir, rt.stateDir)
      const kb = new KnowledgeBase(dir)
      const maxChars = Math.max(2000, Math.min(30_000, Number(args.max_chars) || 12000))
      if (args.query) {
        const results = searchKnowledge(dir, String(args.query), 8)
        return {
          ok: true,
          query: String(args.query),
          results,
          text: results.length
            ? results.map((r) => `### ${r.file}:${r.line}\n${r.text}`).join('\n\n')
            : '没有匹配的条目；可以换个关键词，或查看可用 tag。',
        }
      }
      const tags = Array.isArray(args.tags)
        ? [...new Set(args.tags.map((x) => String(x || '').trim()).filter(Boolean))]
        : []
      if (!tags.length) {
        let suggested = ['general_survival']
        let state = null
        try {
          const look = await lookGame(rt.getCfg ? rt.getCfg() : rt.cfg, rt.stateDir)
          state = look.state
          suggested = suggestTags(state, look.capture?.mode || 'unknown', look.parsed)
        } catch { /* 用默认 */ }
        return {
          ok: true,
          available: kb.listTags().map((tag) => ({ tag, help: TAG_HELP[tag] || '' })),
          suggested,
          hint: '不传 tags/query 只列目录；要正文就传 tags 或 query。',
        }
      }
      const text = loadKnowledge(dir, tags, { maxChars, includeBaseline: true })
      return { ok: Boolean(text), tags, maxChars, text: text || '没有找到这些 tag 的内容。' }
    },
  },
  {
    name: 'cdda_record',
    description: '开始/停止录制游玩视频：把 `cdda` 的 screen 画面录成 mp4，并把同一时段的战报（动作/记录/回合）'
      + '生成同名 `.srt` 外挂字幕。只有 DSH host 半端有这只工具；录制会占一点 CPU 和磁盘。'
      + '打开开关后如果游戏没开，会先启动游戏。',
    parameters: {
      on: { type: 'boolean', required: true, description: 'true=开始录制，false=停止并收尾' },
      fps: { type: 'number', description: '录制帧率 1-10，默认用设置里的值（2 足够）' },
    },
    async handler(args, rt) {
      if (typeof rt.record !== 'function') return { ok: false, error: '这只工具只能在 DSH host 里用' }
      const r = await rt.record(Boolean(args.on), args.fps)
      return { ok: Boolean(r.ok), ...r }
    },
  },
  {
    name: 'cdda_restart',
    description: '重启游戏：先尝试存档/关闭，再用 --world 重新进入（崩溃或卡死时用）。'
      + '只在游戏已经不在正常运行时需要；正常玩请用 cdda_stop / cdda_start。',
    parameters: {
      save: { type: 'boolean', description: '重启前是否存档，默认 true' },
      world: { type: 'string', description: '要载入的世界名；留空 = 最近存档' },
    },
    async handler(args, rt) {
      const cfg = rt.getCfg ? rt.getCfg() : rt.cfg
      const stopped = await stopGame(cfg, rt.stateDir, { save: args.save !== false, log: rt.log })
      try { await rt.stopRecording?.() } catch { /* 忽略 */ }
      resetStuck(rt.stateDir)
      recordEvent(rt.stateDir, 'restart', '重启游戏')
      const started = await startGame(cfg, rt.stateDir, rt.pluginDir, { world: args.world, log: rt.log })
      if (!started.ok) return { ok: false, error: started.error || '重开失败', stopped }
      try { await rt.ensureRecording?.() } catch { /* 忽略 */ }
      const look = await doLook(rt)
      return { ok: true, restarted: true, ...look }
    },
  },
  {
    name: 'cdda_autoplay',
    description: '开关“自动玩”：打开后插件会定时起 headless 回合，让 DSH 自己看屏幕、发动作、写战报。'
      + '只有 DSH 的 host 半端有这只工具；MCP 回合里没有。',
    parameters: {
      on: { type: 'boolean', required: true, description: 'true=开始自动玩，false=暂停' },
      goal: { type: 'string', description: '顺便更新这一局的目标' },
    },
    async handler(args, rt) {
      if (typeof rt.setAutoplay !== 'function') {
        return { ok: false, error: '这只工具只能在 DSH host 里用（自动玩回合里没有）' }
      }
      if (args.goal) rt.updateGoal?.(String(args.goal).slice(0, 4000))
      const r = await rt.setAutoplay(Boolean(args.on))
      return { ok: true, autoplay: Boolean(args.on), ...r }
    },
  },
]

/** 统一入口：MCP 和 host 都调它 */
export async function handleTool(name, args, rt) {
  const spec = TOOL_SPECS.find((t) => t.name === name)
  if (!spec) return { ok: false, error: `没有这个工具：${name}` }
  try {
    const out = await spec.handler(args && typeof args === 'object' ? args : {}, rt)
    return out === undefined ? { ok: true } : out
  } catch (e) {
    const msg = String(e?.message ?? e)
    try { recordEvent(rt.stateDir, 'error', `${name}: ${msg}`) } catch { /* 忽略 */ }
    return { ok: false, error: msg }
  }
}

export function toolSchemaForMcp(parameters) {
  const properties = {}
  const required = []
  for (const [k, v] of Object.entries(parameters || {})) {
    const { required: req, ...rest } = v || {}
    properties[k] = rest
    if (req) required.push(k)
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}
