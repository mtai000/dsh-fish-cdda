/**
 * dsh-cdda —— 浏览器半端：设置页里的一页「CDDA 陪玩」
 * ============================================================================
 * DSH 的 client bundle 不是 ESM，是自注册脚本：
 *   window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ... })
 * 进设置页的方式（抄 dsh-bili-scroll / dsh-meme）：
 *   slots.inject('settings.section', () => slots.register({...}, () => h(Panel)))
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-cdda',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/cdda-duty'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 401 ? '（未登录 / 没权限）' : res.status === 403 ? '（被宿主拦了）' : ''
      throw new Error('HTTP ' + res.status + why)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-cd-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:760px;}
[data-cd-sec]{display:flex;flex-direction:column;gap:9px;}
[data-cd-h]{font-size:11px;font-weight:600;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-cd-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-cd-grow]{flex:1;min-width:0;}
[data-cd-label]{font-size:13px;}
[data-cd-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-cd-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-all;}
[data-cd-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-cd-sw][data-on]{background:#3b82f6;}
[data-cd-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
[data-cd-sw][data-on] i{left:19px;}
[data-cd-sw][disabled]{opacity:.45;cursor:default;}
[data-cd-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:inherit;font-family:inherit;}
[data-cd-input]:focus{outline:none;border-color:#3b82f6;}
[data-cd-area]{min-height:72px;resize:vertical;line-height:1.55;}
[data-cd-num]{width:92px;text-align:center;}
[data-cd-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));color:inherit;}
[data-cd-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-cd-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-cd-btn][data-danger]{background:#ef4444;border-color:#ef4444;color:#fff;}
[data-cd-btn][disabled]{opacity:.5;cursor:default;}
[data-cd-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-all;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-cd-msg][data-good]{color:#22c55e;}
[data-cd-msg][data-warn]{color:#f59e0b;}
[data-cd-msg][data-bad]{color:#ef4444;}
[data-cd-pre]{margin:6px 0 0;padding:8px 9px;border-radius:8px;max-height:320px;overflow:auto;font-size:11px;
  line-height:15px;white-space:pre;background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.25));
  color:var(--dsw-alias-label-secondary,#c9ccd1);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
[data-cd-badge]{font-size:11px;padding:2px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));
  color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-cd-dot]{width:8px;height:8px;border-radius:50%;display:inline-block;background:#9aa0a6;}
[data-cd-dot][data-on]{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18);}
[data-cd-dot][data-dead]{background:#ef4444;}
[data-cd-list]{display:flex;flex-direction:column;gap:5px;margin-top:2px;}
[data-cd-item]{display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:17px;}
[data-cd-item] time{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-variant-numeric:tabular-nums;}
[data-cd-item] b{flex:none;font-weight:600;color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-cd-item] span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-cd-grid]{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
@media (max-width:560px){[data-cd-grid]{grid-template-columns:1fr;}}
[data-cd-code]{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;padding:3px 6px;border-radius:6px;
  background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.18));}
[data-cd-link]{font-size:12px;color:#3b82f6;text-decoration:none;white-space:nowrap;}
[data-cd-link]:hover{text-decoration:underline;}
[data-cd-rec]{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;
  box-shadow:0 0 0 3px rgba(239,68,68,.16);animation:cd-pulse 1.2s ease-in-out infinite;}
@keyframes cd-pulse{50%{opacity:.35}}
    `

    function Switch({ on, onChange, disabled, title }) {
      return h('button', {
        'data-cd-sw': '', 'data-on': on ? '' : undefined, disabled: Boolean(disabled),
        title: title || (on ? '已开' : '已关'),
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
    }

    function ToggleRow({ label, note, on, onChange, disabled }) {
      return h('div', { 'data-cd-row': '' },
        h('div', { 'data-cd-grow': '' },
          h('div', { 'data-cd-label': '' }, label),
          note ? h('div', { 'data-cd-note': '' }, note) : null),
        h(Switch, { on, onChange, disabled }))
    }

    const fmtTime = (iso) => {
      try {
        const d = new Date(iso)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      } catch { return '--:--' }
    }
    const copyText = async (t) => {
      try { await navigator.clipboard.writeText(String(t || '')) ; return true } catch { return false }
    }

    function useStatus(intervalMs) {
      const [st, setSt] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [fails, setFails] = React.useState(0)
      const tick = React.useCallback(async () => {
        try {
          const d = await jget('/status')
          if (d && d.ok) { setSt(d); setErr(''); setFails(0) }
          else { setFails((n) => n + 1); setErr(d?.error || '读不到状态') }
        } catch (e) {
          setFails((n) => n + 1)
          setErr(String(e?.message ?? e))
        }
      }, [])
      React.useEffect(() => {
        let alive = true
        const run = () => { if (alive) tick() }
        run()
        const t = setInterval(run, intervalMs || 3000)
        return () => { alive = false; clearInterval(t) }
      }, [tick, intervalMs])
      return [st, setSt, err, fails, tick]
    }

    function Panel() {
      const [st, setSt, err, fails, reload] = useStatus(3000)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState(null)
      const [screen, setScreen] = React.useState('')
      const [showScreen, setShowScreen] = React.useState(false)
      const [draft, setDraft] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)

      const cfg = st?.config || {}
      React.useEffect(() => {
        if (!st?.config || dirty) return
        setDraft({
          goal: st.config.goal || '',
          actionsPerRound: st.config.actionsPerRound ?? 40,
          maxRoundsPerDay: st.config.maxRoundsPerDay ?? 24,
          roundGapSec: st.config.roundGapSec ?? 20,
          autoStartGame: Boolean(st.config.autoStartGame),
          restartOnDeath: Boolean(st.config.restartOnDeath),
          world: st.config.world || '',
          cddaPath: st.config.cddaPath || '',
          userDir: st.config.userDir || '',
          screenGame: st.config.screenGame || 'cdda',
          screenLog: st.config.screenLog || 'cdda_log',
          dshBin: st.config.dshBin || '',
          recordFps: st.config.recordFps ?? 2,
          recordDir: st.config.recordDir || '',
          recordFont: st.config.recordFont || '',
          ffmpegPath: st.config.ffmpegPath || '',
          recordMaxMinutes: st.config.recordMaxMinutes ?? 120,
          knowledge: st.config.knowledge !== false,
          knowledgeMaxChars: st.config.knowledgeMaxChars ?? 12000,
          autoUnstick: st.config.autoUnstick !== false,
          restartOnCrash: st.config.restartOnCrash !== false,
          maxRestartsPerDay: st.config.maxRestartsPerDay ?? 5,
        })
      }, [st?.config, dirty])

      const set = (k, v) => { setDraft((d) => ({ ...(d || {}), [k]: v })); setDirty(true) }
      const say = (text, tone = '') => setMsg({ text, tone, at: Date.now() })

      const run = async (name, fn) => {
        setBusy(name)
        try { await fn() } catch (e) { say(String(e?.message ?? e), 'bad') }
        finally { setBusy(''); reload() }
      }

      const onSave = () => run('save', async () => {
        const patch = {
          goal: String(draft.goal || '').slice(0, 4000),
          actionsPerRound: Number(draft.actionsPerRound) || 40,
          maxRoundsPerDay: Number(draft.maxRoundsPerDay) || 0,
          roundGapSec: Number(draft.roundGapSec) || 20,
          autoStartGame: Boolean(draft.autoStartGame),
          restartOnDeath: Boolean(draft.restartOnDeath),
          world: String(draft.world || '').trim(),
          cddaPath: String(draft.cddaPath || '').trim(),
          userDir: String(draft.userDir || '').trim(),
          screenGame: String(draft.screenGame || 'cdda').trim(),
          screenLog: String(draft.screenLog || 'cdda_log').trim(),
          dshBin: String(draft.dshBin || '').trim(),
          recordFps: Number(draft.recordFps) || 2,
          recordDir: String(draft.recordDir || '').trim(),
          recordFont: String(draft.recordFont || '').trim(),
          ffmpegPath: String(draft.ffmpegPath || '').trim(),
          recordMaxMinutes: Number(draft.recordMaxMinutes) || 120,
          knowledge: Boolean(draft.knowledge),
          knowledgeMaxChars: Number(draft.knowledgeMaxChars) || 12000,
          autoUnstick: Boolean(draft.autoUnstick),
          restartOnCrash: Boolean(draft.restartOnCrash),
          maxRestartsPerDay: Number(draft.maxRestartsPerDay) || 5,
        }
        const r = await jpost('/config', { patch })
        setDirty(false)
        say(r.ok ? '已保存（插件 config.json + DSH 设置都写了）' : ('保存到了插件，但 DSH 设置没写进去：' + (r.error || '')), r.ok ? 'good' : 'warn')
      })

      const onStart = () => run('start', async () => {
        const r = await jpost('/start', { goal: String(draft?.goal || '').trim() })
        if (r.ok) say(r.already ? '游戏本来就在跑' : '游戏已启动（第一次可能要等十几秒）', 'good')
        else say(r.error || '启动失败', 'bad')
      })
      const onStop = () => run('stop', async () => {
        if (!confirm('停止游戏？会先尝试 S / Y 存档退出。')) return
        const r = await jpost('/stop', { save: true })
        say(r.ok ? '已停止' : (r.error || '停止失败'), r.ok ? 'good' : 'bad')
      })
      const onRecord = async (on) => {
        setBusy('record')
        try {
          const r = await jpost('/record', { on, fps: Number(draft?.recordFps) || 2 })
          if (r.ok) say(on ? '录制已开始；视频和同名 .srt 会写进录制目录' : '录制已停止并收尾', 'good')
          else say(r.error || '录制没起来', 'bad')
        } catch (e) { say(String(e?.message ?? e), 'bad') }
        finally { setBusy(''); reload() }
      }
      const fileUrl = (name) => API + '/recording/file?name=' + encodeURIComponent(String(name || '').split('/').pop())
      const fmtSize = (n) => {
        const v = Number(n) || 0
        if (v > 1024 * 1024 * 1024) return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
        if (v > 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB'
        if (v > 1024) return Math.round(v / 1024) + ' KB'
        return v + ' B'
      }
      const onRound = () => run('round', async () => {
        const r = await jpost('/round', {})
        if (r.started) say('这一轮开跑了，去 screen -x cdda_log 看战报', 'good')
        else say(r.error || '没跑起来', 'bad')
      })
      const onAutoplay = async (on) => {
        setBusy('autoplay')
        try {
          await jpost('/autoplay', { on })
          say(on ? '自动玩已打开：到点会自己起回合' : '自动玩已暂停', on ? 'good' : '')
        } catch (e) { say(String(e?.message ?? e), 'bad') }
        finally { setBusy(''); reload() }
      }
      const onScreen = async () => {
        setShowScreen((v) => !v)
        if (showScreen) return
        setBusy('screen')
        try {
          const r = await jget('/screen')
          setScreen(r.ok ? r.text : (r.error || '抓不到屏幕'))
        } catch (e) { setScreen(String(e?.message ?? e)) }
        finally { setBusy('') }
      }

      if (!st && !err) {
        return h('div', { 'data-cd-page': '' },
          h('div', { 'data-cd-sec': '' },
            h('div', { 'data-cd-h': '' }, 'CDDA 陪玩'),
            h('div', { 'data-cd-note': '' }, '读状态中…')))
      }

      if (!st && err) {
        return h('div', { 'data-cd-page': '' },
          h('div', { 'data-cd-sec': '' },
            h('div', { 'data-cd-h': '' }, 'CDDA 陪玩'),
            h('div', { 'data-cd-msg': '', 'data-bad': '' }, `${err}（连续失败 ${fails} 次）`),
            h('div', { 'data-cd-note': '' },
              '看不到状态通常是：插件刚装/刚更新，DSH 还没重启；或插件没激活（看 dsh 启动日志里有没有 cdda-duty）。'),
            h('button', { 'data-cd-btn': '', onClick: reload }, '重试')))
      }

      const stt = st?.status || {}
      const dot = stt.mode === 'death' ? 'dead' : (stt.running ? 'on' : '')
      const round = st?.round
      const acts = Array.isArray(st?.activity) ? st.activity.slice(-14).reverse() : []
      const attach = st?.attach || {}

      return h('div', { 'data-cd-page': '' },
        // ── 现在 ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-row': '' },
            h('div', { 'data-cd-grow': '' },
              h('div', { 'data-cd-row': '' },
                h('span', { 'data-cd-dot': '', 'data-on': dot === 'on' ? '' : undefined, 'data-dead': dot === 'dead' ? '' : undefined }),
                h('span', { 'data-cd-label': '', style: { fontWeight: 600 } }, stt.running ? `游戏中 · ${stt.modeLabel || ''}` : '未运行'),
                h('span', { 'data-cd-badge': '' }, 'v' + (st.version || '?')),
                round?.active ? h('span', { 'data-cd-badge': '' }, `回合 ${round.id || ''}`) : null)),
            h('button', { 'data-cd-btn': '', disabled: Boolean(busy), onClick: onStart }, '开始游戏'),
            h('button', { 'data-cd-btn': '', disabled: Boolean(busy) || !stt.running, onClick: onRound }, '跑一轮'),
            h('button', { 'data-cd-btn': '', 'data-danger': '', disabled: Boolean(busy) || !stt.running, onClick: onStop }, '停止')),
          h('div', { 'data-cd-row': '' },
            h('div', { 'data-cd-grow': '' },
              h('div', { 'data-cd-label': '' }, '自动玩'),
              h('div', { 'data-cd-note': '' }, '打开后插件会定时起 headless 回合，让 DSH 自己看屏幕、发动作。')),
            h(Switch, { on: Boolean(cfg.autoplay), disabled: Boolean(busy), onChange: onAutoplay })),
          h('div', { 'data-cd-note': '' },
            `今日 ${stt.actionsToday ?? 0} 个动作` +
            (st?.runtime ? ` · 今日 ${st.runtime.roundsToday ?? 0} 轮` : '') +
            (round?.active ? ` · 本回合 ${round.actions ?? 0}/${round.actionsLimit ?? 0}` : '') +
            (st.status?.updatedAt ? ` · 更新 ${fmtTime(st.status.updatedAt)}` : '')),
          stt.hint ? h('div', { 'data-cd-msg': '' }, stt.hint) : null,
          stt.goalProgress?.text ? h('div', { 'data-cd-msg': '' }, `目标进度：${stt.goalProgress.text}${stt.goalComplete ? ' · 已达成' : ''}`) : null,
          st?.lastRound ? h('div', { 'data-cd-note': '' },
            `上一轮：${st.lastRound.actions ?? 0} 动作 · ${st.lastRound.durationSec ?? 0}s · ${st.lastRound.goalProgress || ''}`) : null,
          (stt.ui?.state || stt.visible?.threats?.length) ? h('div', { 'data-cd-msg': '' },
            `${stt.ui?.state ? '界面：' + stt.ui.state : ''}${stt.visible?.threats?.length ? ' · 威胁：' + stt.visible.threats.join('/') : ''}`) : null,
          (stt.lastNote?.text || stt.lastAction?.note || stt.lastAction?.keys) ? h('div', { 'data-cd-msg': '' },
            `正在做：${stt.lastNote?.text || stt.lastAction?.note || ''}${stt.lastAction?.keys ? `（${stt.lastAction.keys}）` : ''}`) : null,
          msg ? h('div', { 'data-cd-msg': '', ...(msg.tone === 'good' ? { 'data-good': '' } : msg.tone === 'warn' ? { 'data-warn': '' } : msg.tone === 'bad' ? { 'data-bad': '' } : {}) }, msg.text) : null),

        // ── 录制 ──
        (() => {
          const rec = st.recording || {}
          const list = Array.isArray(st.recordings) ? st.recordings : []
          const active = Boolean(rec.active)
          const last = rec.last || null
          const cur = active ? rec : last
          return h('div', { 'data-cd-sec': '' },
            h('div', { 'data-cd-row': '' },
              h('div', { 'data-cd-grow': '' },
                h('div', { 'data-cd-label': '', style: { fontWeight: 600 } }, '录制游玩过程'),
                h('div', { 'data-cd-note': '' }, '录成 mp4，同时生成同名 .srt 外挂字幕；字幕来自 cdda_log 的战报（动作/记录/回合）。')),
              h(Switch, { on: active || Boolean(cfg.recordVideo), disabled: Boolean(busy), onChange: onRecord })),
            active
              ? h('div', { 'data-cd-msg': '', 'data-bad': '' },
                  h('span', { 'data-cd-rec': '' }), ' 录制中 · ',
                  String(rec.video || '').split('/').pop(), ` · ${Number(rec.durationSec || 0)}s · ${Number(rec.frames || 0)} 帧 · ${fmtSize(rec.size)}`)
              : (cur ? h('div', { 'data-cd-msg': '' },
                  `上一段：${String(cur.video || '').split('/').pop()} · ${Number(cur.durationSec || 0)}s · ${fmtSize(cur.size)}`) : h('div', { 'data-cd-note': '' }, '还没有录制。打开开关后如果游戏没开，会先启动游戏。')),
            !active && cfg.recordVideo ? h('div', { 'data-cd-msg': '', 'data-warn': '' }, '开关是开的，但当前没在录制：游戏没开、到了单段上限，或 ffmpeg 起不来。') : null,
            cur ? h('div', { 'data-cd-row': '' },
              h('a', { 'data-cd-link': '', href: fileUrl(cur.video), target: '_blank', rel: 'noreferrer' }, '看视频'),
              h('a', { 'data-cd-link': '', href: fileUrl(cur.srt), target: '_blank', rel: 'noreferrer' }, '下字幕 .srt'),
              h('span', { 'data-cd-note': '' }, active ? `目录：${st.recordDir || ''}` : '')) : null,
            h('div', { 'data-cd-row': '' },
              h('div', { 'data-cd-grow': '' },
                h('div', { 'data-cd-label': '' }, '帧率（1-10，默认 2）'),
                h('div', { 'data-cd-note': '' }, '文本界面不需要高帧率；2 帧/秒足够看清操作。')),
              h('input', { 'data-cd-input': '', 'data-cd-num': '', type: 'number', min: 1, max: 10, value: draft?.recordFps ?? 2, onChange: (e) => set('recordFps', e.target.value) }),
              h('button', { 'data-cd-btn': '', disabled: Boolean(busy) || !dirty, onClick: onSave }, '保存帧率')),
            st.recorderReady === false ? h('div', { 'data-cd-msg': '', 'data-warn': '' }, '找不到 ffmpeg 或等宽字体：录制会起不来。到「高级」里填 ffmpegPath / recordFont。') : null,
            list.length ? h('div', { 'data-cd-sec': '' },
              h('div', { 'data-cd-note': '' }, '历史录制：'),
              ...list.slice(0, 5).map((r) => h('div', { 'data-cd-row': '', key: r.video || r.id },
                h('span', { 'data-cd-note': '', 'data-cd-grow': '' },
                  `${String(r.startedAt || '').replace('T', ' ').slice(0, 16)} · ${Number(r.durationSec || 0)}s · ${fmtSize(r.size)}${r.exists === false ? '（文件没了）' : ''}`),
                h('a', { 'data-cd-link': '', href: fileUrl(r.video), target: '_blank', rel: 'noreferrer' }, '视频'),
                h('a', { 'data-cd-link': '', href: fileUrl(r.srt), target: '_blank', rel: 'noreferrer' }, '字幕')))) : null,
          )
        })(),

        // ── 目标与节奏 ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '目标与节奏'),
          h('textarea', {
            'data-cd-input': '', 'data-cd-area': '', value: draft?.goal ?? '',
            placeholder: '例：尽量活过 3 天；先找水和食物；不要主动打怪。',
            onChange: (e) => set('goal', e.target.value),
          }),
          h('div', { 'data-cd-grid': '' },
            h('div', null,
              h('div', { 'data-cd-label': '' }, '每轮动作预算'),
              h('div', { 'data-cd-note': '' }, '一次按键发送算一个动作；40 大约 10-20 分钟。'),
              h('input', { 'data-cd-input': '', 'data-cd-num': '', type: 'number', min: 5, max: 500, value: draft?.actionsPerRound ?? 40, onChange: (e) => set('actionsPerRound', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '每天最多几轮'),
              h('div', { 'data-cd-note': '' }, '0 = 不限制；默认 24。'),
              h('input', { 'data-cd-input': '', 'data-cd-num': '', type: 'number', min: 0, max: 200, value: draft?.maxRoundsPerDay ?? 24, onChange: (e) => set('maxRoundsPerDay', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '两轮间隔（秒）'),
              h('div', { 'data-cd-note': '' }, '上一轮结束后歇多久。'),
              h('input', { 'data-cd-input': '', 'data-cd-num': '', type: 'number', min: 5, max: 3600, value: draft?.roundGapSec ?? 20, onChange: (e) => set('roundGapSec', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '世界名（可选）'),
              h('div', { 'data-cd-note': '' }, '留空 = 最近的存档。'),
              h('input', { 'data-cd-input': '', value: draft?.world ?? '', placeholder: 'Pena Pobre', onChange: (e) => set('world', e.target.value) }))),
          h(ToggleRow, {
            label: '开跑前自动开游戏', note: '游戏没开时先启动，再起回合。',
            on: Boolean(draft?.autoStartGame), onChange: (v) => set('autoStartGame', v),
          }),
          h(ToggleRow, {
            label: '注入 CDDAi 知识库',
            note: '每轮按当前渴/饿/血/界面自动挑 2-5 个章节（基础生存、水、战斗、配方等）注入提示词；模型也可以随时用 cdda_knowledge 查。',
            on: draft?.knowledge !== false, onChange: (v) => set('knowledge', v),
          }),
          h('div', { 'data-cd-row': '' },
            h('div', { 'data-cd-grow': '' },
              h('div', { 'data-cd-label': '' }, '知识注入上限（字符）'),
              h('div', { 'data-cd-note': '' }, '默认 12000；太大费 token，太小会截断章节。')),
            h('input', { 'data-cd-input': '', 'data-cd-num': '', type: 'number', min: 2000, max: 30000, value: draft?.knowledgeMaxChars ?? 12000, onChange: (e) => set('knowledgeMaxChars', e.target.value) })),
          h('div', { 'data-cd-note': '' }, '角色死亡后自动玩会暂停，不会自己清档重开；要重开请在游戏里新建角色，或手动清掉 game/save。'),
          h('div', { 'data-cd-row': '' },
            h('button', { 'data-cd-btn': '', 'data-primary': '', disabled: Boolean(busy) || !dirty, onClick: onSave }, busy === 'save' ? '保存中…' : '保存'),
            dirty ? h('div', { 'data-cd-note': '' }, '有未保存的改动') : null)),

        // ── 旁观 ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '旁观'),
          h('div', { 'data-cd-note': '' }, '在任意终端里执行下面的命令；CDDA 的 screen 会话是 detached 的，可以多端一起看。'),
          h('div', { 'data-cd-row': '' },
            h('code', { 'data-cd-code': '' }, attach.game || 'screen -x cdda'),
            h('button', { 'data-cd-btn': '', onClick: () => copyText(attach.game || 'screen -x cdda').then((ok) => say(ok ? '已复制' : '复制失败', ok ? 'good' : 'warn')) }, '复制看游戏')),
          h('div', { 'data-cd-row': '' },
            h('code', { 'data-cd-code': '' }, attach.log || 'screen -x cdda_log'),
            h('button', { 'data-cd-btn': '', onClick: () => copyText(attach.log || 'screen -x cdda_log').then((ok) => say(ok ? '已复制' : '复制失败', ok ? 'good' : 'warn')) }, '复制看战报')),
          h('div', { 'data-cd-kv': '' },
            `家：${st.home || ''}`, h('br'),
            `存档：${st.paths?.saveDir || ''}`, h('br'),
            `游戏：${st.sessions?.game?.running ? '在跑' : '没开'} · 战报：${st.sessions?.log?.running ? '在跑' : '没开'}`)),

        // ── 角色状态 ──
        stt.save ? h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '角色'),
          h('div', { 'data-cd-kv': '' },
            `${stt.save.name || '?'} · ${stt.save.calendar?.text || ''}`, h('br'),
            `${stt.save.summary || ''}`, h('br'),
            `HP ${stt.save.health?.pct ?? '?'}% · 渴 ${stt.save.needs?.thirst?.label || '?'} · 饿 ${stt.save.needs?.hunger?.label || '?'} · 疲劳 ${stt.save.needs?.fatigue?.label || '?'}`, h('br'),
            `位置 (${stt.save.location?.x ?? '?'}, ${stt.save.location?.y ?? '?'})`),
          stt.save.lastMessage ? h('div', { 'data-cd-msg': '' }, stt.save.lastMessage) : null) : null,

        // ── 最近动作 ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '最近动作（cdda_log 里滚动的内容）'),
          acts.length ? h('div', { 'data-cd-list': '' }, acts.map((a, i) => {
            const kind = a.kind === 'action' || a.kind === 'sent' ? '动作' : a.kind === 'note' ? '记录' : a.kind === 'round_start' ? '回合' : a.kind === 'round_end' ? '结束' : a.kind === 'error' ? '错误' : '事件'
            const text = a.kind === 'action' || a.kind === 'sent'
              ? `${a.keys || ''}${a.note ? ' — ' + a.note : ''}`
              : (a.note || a.text || '')
            return h('div', { 'data-cd-item': '', key: String(a.ts || '') + i },
              h('time', null, fmtTime(a.ts)),
              h('b', null, kind),
              h('span', { title: text }, text))
          })) : h('div', { 'data-cd-note': '' }, '还没有动作。')),
        // ── 当前屏幕 ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-row': '' },
            h('div', { 'data-cd-h': '', 'data-cd-grow': '' }, '当前屏幕（调试用）'),
            h('button', { 'data-cd-btn': '', disabled: Boolean(busy), onClick: onScreen }, showScreen ? '收起' : '抓一屏')),
          showScreen ? h('pre', { 'data-cd-pre': '' }, screen || '（空）') : null),

        // ── 高级 ──
        h('details', { 'data-cd-sec': '' },
          h('summary', { 'data-cd-h': '', style: { cursor: 'pointer' } }, '高级 / 路径'),
          h('div', { 'data-cd-grid': '' },
            h('div', null,
              h('div', { 'data-cd-label': '' }, 'CDDA 可执行文件'),
              h('input', { 'data-cd-input': '', value: draft?.cddaPath ?? '', placeholder: '/usr/games/cataclysm', onChange: (e) => set('cddaPath', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, 'CDDA userdir'),
              h('input', { 'data-cd-input': '', value: draft?.userDir ?? '', placeholder: '留空 = <家>/game', onChange: (e) => set('userDir', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '游戏 screen 名'),
              h('input', { 'data-cd-input': '', value: draft?.screenGame ?? '', onChange: (e) => set('screenGame', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '战报 screen 名'),
              h('input', { 'data-cd-input': '', value: draft?.screenLog ?? '', onChange: (e) => set('screenLog', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, 'dshBin（自动找，可留空）'),
              h('input', { 'data-cd-input': '', value: draft?.dshBin ?? '', placeholder: '.../@deepseek-ai/dsh/lib/bin.js', onChange: (e) => set('dshBin', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '录制目录（留空 = <家>/recordings）'),
              h('input', { 'data-cd-input': '', value: draft?.recordDir ?? '', placeholder: '/home/me/Videos/cdda', onChange: (e) => set('recordDir', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '单段最长（分钟）'),
              h('input', { 'data-cd-input': '', 'data-cd-num': '', type: 'number', min: 1, max: 600, value: draft?.recordMaxMinutes ?? 120, onChange: (e) => set('recordMaxMinutes', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, 'ffmpeg（留空自动找）'),
              h('input', { 'data-cd-input': '', value: draft?.ffmpegPath ?? '', placeholder: '/usr/bin/ffmpeg', onChange: (e) => set('ffmpegPath', e.target.value) })),
            h('div', null,
              h('div', { 'data-cd-label': '' }, '录制字体（留空自动找）'),
              h('input', { 'data-cd-input': '', value: draft?.recordFont ?? '', placeholder: '.../DejaVuSansMono.ttf', onChange: (e) => set('recordFont', e.target.value) }))),
          h(ToggleRow, {
            label: '卡菜单自动兜底',
            note: '连续 3 次画面没变时先提示恢复键；第 4 次仍卡住就自动发一次 Esc（不会在正常游戏里乱按）。',
            on: draft?.autoUnstick !== false, onChange: (v) => set('autoUnstick', v),
          }),
          h(ToggleRow, {
            label: '崩溃/游戏消失时自动重开',
            note: '只在自动玩开着时生效；死角色不会重开，会暂停等你处理。',
            on: draft?.restartOnCrash !== false, onChange: (v) => set('restartOnCrash', v),
          }),
          h('div', { 'data-cd-row': '' },
            h('div', { 'data-cd-grow': '' },
              h('div', { 'data-cd-label': '' }, '每天最多自动重开几次'),
              h('div', { 'data-cd-note': '' }, '0 = 不限制；默认 5。')),
            h('input', { 'data-cd-input': '', 'data-cd-num': '', type: 'number', min: 0, max: 50, value: draft?.maxRestartsPerDay ?? 5, onChange: (e) => set('maxRestartsPerDay', e.target.value) })),
          h('div', { 'data-cd-row': '' },
            h('button', { 'data-cd-btn': '', disabled: Boolean(busy) || !dirty, onClick: onSave }, '保存高级设置')),
          st.logTail ? h('pre', { 'data-cd-pre': '', style: { maxHeight: 160 } }, st.logTail) : null),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-cdda')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-cdda: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'cdda-duty', order: 31, label: 'CDDA 陪玩' },
          () => h(Panel),
        ))
      },
    }
  },
})
