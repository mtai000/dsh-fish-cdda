/**
 * dsh-fish-cdda —— 浏览器半端：设置页里的一页「CDDA 陪玩」
 * ============================================================================
 * DSH 的 client bundle 不是 ESM，是自注册脚本：
 *   window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ... })
 * 进设置页的方式（抄 dsh-bili-scroll / dsh-meme）：
 *   slots.inject('settings.section', () => slots.register({...}, () => h(Panel)))
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-fish-cdda',
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
    const fileUrl = (name) => API + '/recording/file?name=' + encodeURIComponent(String(name || '').split('/').pop())
    const fmtSize = (n) => {
      const v = Number(n) || 0
      if (v > 1024 * 1024 * 1024) return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
      if (v > 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB'
      if (v > 1024) return Math.round(v / 1024) + ' KB'
      return v + ' B'
    }

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
[data-cd-recv]{display:flex;flex-direction:column;gap:14px;padding:18px 22px 28px;max-width:1100px;width:100%;
  box-sizing:border-box;margin:0 auto;color:var(--dsw-alias-label-primary,#e6e6e6);}
[data-cd-recvhead]{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;}
[data-cd-recvtitle]{font-size:16px;font-weight:600;letter-spacing:.01em;}
[data-cd-recvsub]{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-all;}
[data-cd-recvplayer]{border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));border-radius:14px;overflow:hidden;
  background:#000;display:flex;flex-direction:column;}
[data-cd-recvplayer] video{display:block;width:100%;max-height:62vh;background:#000;}
[data-cd-recvmeta]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 11px;font-size:11px;
  color:var(--dsw-alias-label-tertiary,#9aa0a6);background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.2));}
[data-cd-recvlist]{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
[data-cd-recvcard]{border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));border-radius:12px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.08));display:flex;flex-direction:column;}
[data-cd-recvcard][data-sel]{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.18);}
[data-cd-recvthumb]{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:16/9;
  border:0;padding:0;cursor:pointer;color:#fff;background:linear-gradient(135deg,#1f2937,#0f172a);font-family:inherit;}
[data-cd-recvthumb]:hover{filter:brightness(1.15);}
[data-cd-recvplay]{display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;
  background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);font-size:16px;padding-left:3px;}
[data-cd-recvmissing]{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.55);font-size:12px;color:#fca5a5;}
[data-cd-recvbody]{display:flex;flex-direction:column;gap:4px;padding:9px 11px;min-width:0;}
[data-cd-recvname]{font-size:12.5px;line-height:1.4;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-cd-recvactions]{display:flex;gap:10px;flex-wrap:wrap;padding-top:2px;}
@media (max-width:640px){[data-cd-recv]{padding:14px 14px 22px;}[data-cd-recvlist]{grid-template-columns:1fr;}}
[data-cd-badge][data-good]{color:#22c55e;}
[data-cd-modal]{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);}
[data-cd-modal-card]{width:min(1050px,96vw);max-height:92vh;display:flex;flex-direction:column;gap:10px;padding:14px;overflow:hidden;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.16));border-radius:14px;background:var(--dsw-alias-bg-layer-1,#1b1b1f);
  box-shadow:0 20px 60px rgba(0,0,0,.45);color:var(--dsw-alias-label-primary,#e6e6e6);}
[data-cd-modal-head]{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;}
[data-cd-screens]{display:flex;flex-direction:column;gap:10px;overflow:auto;min-height:0;}
[data-cd-screen]{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));border-radius:10px;}
[data-cd-screen-head]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 9px;background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));}
[data-cd-screen-head] b{font-size:12px;font-weight:600;}
[data-cd-screen-pre]{margin:0;padding:9px;min-height:120px;max-height:34vh;overflow:auto;white-space:pre;font-size:11px;line-height:15px;
  background:#0b0f14;color:#d7dde5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
@media (max-width:640px){[data-cd-modal]{padding:8px;}[data-cd-modal-card]{max-height:96vh;}[data-cd-screen-pre]{max-height:30vh;}}
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
      const [draft, setDraft] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)
      const [screenOpen, setScreenOpen] = React.useState(false)
      const [screens, setScreens] = React.useState(null)
      const [screenErr, setScreenErr] = React.useState('')

      React.useEffect(() => {
        if (!st?.config || dirty) return
        setDraft({
          actionsPerRound: st.config.actionsPerRound ?? 40,
          maxRoundsPerDay: st.config.maxRoundsPerDay ?? 24,
          roundGapSec: st.config.roundGapSec ?? 20,
          autoStartGame: Boolean(st.config.autoStartGame),
          restartOnDeath: Boolean(st.config.restartOnDeath),
          world: st.config.world || '',
          cddaPath: st.config.cddaPath || '',
          userDir: st.config.userDir || '',
          terminal: st.config.terminal || 'auto',
          screenGame: st.config.screenGame || 'cdda',
          screenLog: st.config.screenLog || 'cdda_log',
          dshBin: st.config.dshBin || '',
          recordVideo: Boolean(st.config.recordVideo),
          recordMode: st.config.recordMode || 'pixels',
          recordWindow: st.config.recordWindow || '',
          recordGeometry: st.config.recordGeometry || '',
          recordDisplay: st.config.recordDisplay || '',
          recordFps: st.config.recordFps ?? 2,
          recordDir: st.config.recordDir || '',
          recordFont: st.config.recordFont || '',
          ffmpegPath: st.config.ffmpegPath || '',
          recordMaxMinutes: st.config.recordMaxMinutes ?? 120,
          autoUnstick: st.config.autoUnstick !== false,
          restartOnCrash: st.config.restartOnCrash !== false,
          starterWorld: Boolean(st.config.starterWorld),
          identityFile: st.config.identityFile || '',
          identityAuto: st.config.identityAuto !== false,
          memory: st.config.memory !== false,
          memoryMaxItems: st.config.memoryMaxItems ?? 10,
          memoryMaxChars: st.config.memoryMaxChars ?? 4000,
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

      const loadScreens = async () => {
        try {
          const r = await jget('/screens')
          if (r && r.ok) { setScreens(r); setScreenErr('') }
          else setScreenErr(r?.error || '抓不到终端画面')
        } catch (e) { setScreenErr(String(e?.message ?? e)) }
      }
      const openScreens = () => { setScreenOpen(true); loadScreens() }
      const openTerminal = async (which) => {
        setBusy('terminal-' + which)
        try {
          const r = await jpost('/screens/open', { which })
          if (r.ok) say(`已在系统终端打开 ${r.name || which}`, 'good')
          else {
            let copied = false
            if (r.command) copied = await copyText(r.command)
            say((r.error || '打不开系统终端') + (copied ? `；命令已复制：${r.command}` : (r.command ? `；可手动执行：${r.command}` : '')), 'warn')
          }
        } catch (e) { say(String(e?.message ?? e), 'bad') }
        finally { setBusy('') }
      }
      const copyScreenCommand = async (which) => {
        const cmd = screens?.commands?.[which] || ''
        if (!cmd) { say('还没有会话命令：先「开始游戏」或刷新状态', 'warn'); return }
        await copyText(cmd)
        say('命令已复制：' + cmd, 'good')
      }
      React.useEffect(() => {
        if (!screenOpen) return
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          await loadScreens()
          if (alive) timer = setTimeout(tick, 2000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [screenOpen])

      const onSave = () => run('save', async () => {
        const patch = {
          actionsPerRound: Number(draft.actionsPerRound) || 40,
          maxRoundsPerDay: Number(draft.maxRoundsPerDay) || 0,
          roundGapSec: Number(draft.roundGapSec) || 20,
          autoStartGame: Boolean(draft.autoStartGame),
          restartOnDeath: Boolean(draft.restartOnDeath),
          world: String(draft.world || '').trim(),
          cddaPath: String(draft.cddaPath || '').trim(),
          userDir: String(draft.userDir || '').trim(),
          terminal: ['auto', 'tmux', 'screen'].includes(String(draft.terminal)) ? String(draft.terminal) : 'auto',
          screenGame: String(draft.screenGame || 'cdda').trim(),
          screenLog: String(draft.screenLog || 'cdda_log').trim(),
          dshBin: String(draft.dshBin || '').trim(),
          recordVideo: Boolean(draft.recordVideo),
          recordMode: String(draft.recordMode || 'pixels') === 'text' ? 'text' : 'pixels',
          recordWindow: String(draft.recordWindow || '').trim(),
          recordGeometry: String(draft.recordGeometry || '').trim(),
          recordDisplay: String(draft.recordDisplay || '').trim(),
          recordFps: Number(draft.recordFps) || 2,
          recordDir: String(draft.recordDir || '').trim(),
          recordFont: String(draft.recordFont || '').trim(),
          ffmpegPath: String(draft.ffmpegPath || '').trim(),
          recordMaxMinutes: Number(draft.recordMaxMinutes) || 120,
          autoUnstick: Boolean(draft.autoUnstick),
          restartOnCrash: Boolean(draft.restartOnCrash),
          starterWorld: Boolean(draft.starterWorld),
          identityFile: String(draft.identityFile || '').trim(),
          identityAuto: Boolean(draft.identityAuto),
          memory: Boolean(draft.memory),
          memoryMaxItems: Number(draft.memoryMaxItems) || 10,
          memoryMaxChars: Number(draft.memoryMaxChars) || 4000,
          maxRestartsPerDay: Number(draft.maxRestartsPerDay) || 5,
        }
        const r = await jpost('/config', { patch })
        setDirty(false)
        say(r.ok ? '已保存（插件 config.json + DSH 设置都写了）' : ('保存到了插件，但 DSH 设置没写进去：' + (r.error || '')), r.ok ? 'good' : 'warn')
      })

      const pickDir = async () => {
        try {
          const picker = globalThis.__DSH_DIRECTORY_PICKER__
          if (picker && typeof picker.pick === 'function') {
            const d = await picker.pick()
            if (d) { set('recordDir', String(d)); say('目录已选，保存后下一段生效', 'good') }
            return
          }
          say('这个界面没有文件夹选择器，手动填路径吧', 'warn')
        } catch (e) { say('打开文件夹选择器失败：' + String(e?.message ?? e), 'bad') }
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

      const ScreenPane = ({ which, title }) => {
        const d = (screens && screens[which]) || {}
        return h('div', { 'data-cd-screen': '' },
          h('div', { 'data-cd-screen-head': '' },
            h('b', null, title),
            h('span', { 'data-cd-badge': '', ...(d.running ? { 'data-good': '' } : {}) }, d.running ? '运行中' : '未运行'),
            h('span', { 'data-cd-note': '' }, d.command || ''),
            h('button', { 'data-cd-btn': '', disabled: Boolean(busy), onClick: () => openTerminal(which) }, '在系统终端打开'),
            h('button', { 'data-cd-btn': '', onClick: () => copyScreenCommand(which) }, '复制命令')),
          h('pre', { 'data-cd-screen-pre': '' }, d.text || d.error || '读取中…'))
      }

      const stt = st?.status || {}
      const dot = stt.mode === 'death' ? 'dead' : (stt.running ? 'on' : '')
      const recActive = Boolean(st?.recording?.active)
      const platform = st?.platform || ''
      const FieldRow = ({ label, note, children }) => h('div', { 'data-cd-row': '' },
        h('div', { 'data-cd-grow': '' },
          h('div', { 'data-cd-label': '' }, label),
          note ? h('div', { 'data-cd-note': '' }, note) : null),
        children)
      const NumInput = ({ k, val, min, max }) => h('input', {
        'data-cd-input': '', 'data-cd-num': '', type: 'number', min, max,
        value: draft?.[k] ?? val, onChange: (e) => set(k, e.target.value),
      })
      const TxtInput = ({ k, placeholder, type }) => h('input', {
        'data-cd-input': '', type: type || 'text', style: { flex: '1 1 260px', minWidth: 180 },
        value: draft?.[k] ?? '', placeholder: placeholder || '', onChange: (e) => set(k, e.target.value),
      })

      return h('div', { 'data-cd-page': '' },
        // ── 只读状态：不放开始/停止/跑一轮/目标 ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-row': '' },
            h('div', { 'data-cd-grow': '' },
              h('div', { 'data-cd-row': '' },
                h('span', { 'data-cd-dot': '', 'data-on': dot === 'on' ? '' : undefined, 'data-dead': dot === 'dead' ? '' : undefined }),
                h('span', { 'data-cd-label': '', style: { fontWeight: 600 } }, stt.running ? `游戏中 · ${stt.modeLabel || ''}` : '未运行'),
                h('span', { 'data-cd-badge': '' }, 'v' + (st.version || '?')),
                recActive ? h('span', { 'data-cd-badge': '', 'data-bad': '' }, '录制中') : null),
              h('div', { 'data-cd-note': '' },
                '开始 / 停止 / 跑一轮 / 目标 / 立刻录制，都在会话里直接对 DSH 说，或让 DSH 自己调 cdda_* 工具。这里只放会重复用到的设置。')),
            h('button', { 'data-cd-btn': '', onClick: openScreens }, '调出终端')),
          stt.hint ? h('div', { 'data-cd-msg': '' }, stt.hint) : null,
          msg ? h('div', { 'data-cd-msg': '', ...(msg.tone === 'good' ? { 'data-good': '' } : msg.tone === 'warn' ? { 'data-warn': '' } : msg.tone === 'bad' ? { 'data-bad': '' } : {}) }, msg.text) : null),

        // ── 自动玩与节奏（可重复使用） ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '自动玩与节奏'),
          h('div', { 'data-cd-note': '' }, '目标是 DSH 当场决定的；这里只定预算、间隔和兜底。'),
          h(FieldRow, { label: '每轮动作预算', note: '一次按键算一个动作；40 大约 10-20 分钟。', children: h(NumInput, { k: 'actionsPerRound', val: 40, min: 5, max: 500 }) }),
          h(FieldRow, { label: '每天最多几轮', note: '0 = 不限制；默认 24。', children: h(NumInput, { k: 'maxRoundsPerDay', val: 24, min: 0, max: 200 }) }),
          h(FieldRow, { label: '两轮间隔（秒）', note: '上一轮结束后歇多久。', children: h(NumInput, { k: 'roundGapSec', val: 20, min: 5, max: 3600 }) }),
          h(FieldRow, { label: '世界名（可选）', note: '留空 = 最近的存档。通常由 DSH 启动时决定。', children: h(TxtInput, { k: 'world', placeholder: 'Pena Pobre' }) }),
          h(ToggleRow, { label: '开跑前自动开游戏', note: '游戏没开时先启动，再起回合。', on: Boolean(draft?.autoStartGame), onChange: (v) => set('autoStartGame', v) }),
          h(ToggleRow, { label: '卡菜单自动兜底', note: '连续 3 次画面没变时先提示恢复键；第 4 次仍卡住就自动发一次 Esc。', on: draft?.autoUnstick !== false, onChange: (v) => set('autoUnstick', v) }),
          h(ToggleRow, { label: '崩溃/游戏消失时自动重开', note: '只在自动玩开着时生效；死角色不会自动重开。', on: draft?.restartOnCrash !== false, onChange: (v) => set('restartOnCrash', v) }),
          h(ToggleRow, { label: '角色死亡也自动重开', note: '默认关；打开后死亡也会重开。', on: Boolean(draft?.restartOnDeath), onChange: (v) => set('restartOnDeath', v) }),
          h(FieldRow, { label: '每天最多自动重开', note: '0 = 不限制；默认 5。', children: h(NumInput, { k: 'maxRestartsPerDay', val: 5, min: 0, max: 50 }) })),

        // ── 录制设置（不在这里手动开关） ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '录制'),
          h(ToggleRow, {
            label: '开始游戏后自动录制',
            note: '下一局/下一轮生效，不会打断当前这段；要立刻开关录制，让 DSH 调 cdda_record。',
            on: Boolean(draft?.recordVideo), onChange: (v) => set('recordVideo', v),
          }),
          h(FieldRow, { label: '录制方式', note: platform === 'darwin' ? 'macOS 录整个屏幕，可用「画面区域」裁切；中文按桌面字体显示。' : platform === 'win32' ? 'Windows 录整个桌面；可用「画面区域」裁切。' : 'Linux X11 自动找 cdda/cataclysm 窗口，找不到录全屏；中文按桌面字体显示。', children: h('select', {
            'data-cd-input': '', style: { flex: '1 1 220px' }, value: draft?.recordMode || 'pixels', onChange: (e) => set('recordMode', e.target.value),
          },
            h('option', { value: 'pixels' }, '实际画面（推荐）'),
            h('option', { value: 'text' }, '字符重绘（旧）')) }),
          h(FieldRow, { label: '录制窗口（像素模式）', note: platform === 'darwin' ? 'macOS 不按窗口标题裁切；请用下面的「画面区域」。' : '留空自动找 cdda/cataclysm；找不到就录全屏。也可以填 Konsole 等窗口标题。', children: h(TxtInput, { k: 'recordWindow', placeholder: '留空自动找' }) }),
          h(FieldRow, { label: '画面区域（像素模式）', note: '可选，格式 WxH+X+Y；留空自动窗口/全屏。', children: h(TxtInput, { k: 'recordGeometry', placeholder: '1280x900+0+0' }) }),
          h('div', { 'data-cd-note': '' }, '实际画面录的是桌面上真实可见的窗口；如果游戏在 detached 会话里、桌面看不到，先点上面的「调出终端」把终端打开，再填终端窗口标题或直接录全屏。'),
          h(FieldRow, { label: '录制存放目录', note: '绝对路径；留空 = 插件家的 recordings。保存后下一段生效。', children: h('div', { 'data-cd-row': '', style: { flex: '1 1 320px' } },
            h('input', { 'data-cd-input': '', style: { flex: '1 1 260px', minWidth: 180 }, value: draft?.recordDir ?? '', placeholder: '/home/你/CDDA录像', onChange: (e) => set('recordDir', e.target.value) }),
            h('button', { 'data-cd-btn': '', onClick: pickDir }, '选择…')) }),
          st.recordDir ? h('div', { 'data-cd-note': '' }, `当前实际目录：${st.recordDir}`) : null,
          h(FieldRow, { label: '帧率（1-10，默认 2）', note: '文本界面不需要高帧率。', children: h(NumInput, { k: 'recordFps', val: 2, min: 1, max: 10 }) }),
          h(FieldRow, { label: '单段最长（分钟）', note: '到点自动收尾；默认 120。', children: h(NumInput, { k: 'recordMaxMinutes', val: 120, min: 1, max: 1440 }) }),
          h('div', { 'data-cd-note': '' }, '看录像/字幕不在这里：会话顶部「更多会话视图」→「cdda录制」，可直接播放。'),
          st.recorderReady === false ? h('div', { 'data-cd-msg': '', 'data-warn': '' }, '找不到 ffmpeg（或字符模式需要的等宽字体）：录制会起不来。到「高级」里填 ffmpegPath / recordFont。') : null),

        // ── 身份与记忆（可重复使用） ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '身份与记忆'),
          h(FieldRow, { label: '身份文件（可留空）', note: '留空从 fish-kin 家族目录自动找 identity.json。', children: h(TxtInput, { k: 'identityFile', placeholder: '留空自动发现' }) }),
          h(ToggleRow, { label: '自动发现鱼的身份证', note: '从 DSH_KIN_FAMILY_ROOT / ~/.dsh-fish-kin.json / ~/大肥鱼家族 找。', on: draft?.identityAuto !== false, onChange: (v) => set('identityAuto', v) }),
          h(ToggleRow, { label: '注入自己的经验', note: '最多 10 条、4000 字符；明确标成假设。', on: draft?.memory !== false, onChange: (v) => set('memory', v) }),
          h(FieldRow, { label: '经验注入条数', note: '默认 10。', children: h(NumInput, { k: 'memoryMaxItems', val: 10, min: 1, max: 50 }) }),
          h(FieldRow, { label: '经验注入字符上限', note: '默认 4000。', children: h(NumInput, { k: 'memoryMaxChars', val: 4000, min: 200, max: 30000 }) })),

        // ── 高级路径 ──
        h('div', { 'data-cd-sec': '' },
          h('div', { 'data-cd-h': '' }, '高级'),
          h(FieldRow, { label: 'CDDA 可执行文件', note: '留空 = PATH 里的 cataclysm。', children: h(TxtInput, { k: 'cddaPath', placeholder: '/usr/games/cataclysm' }) }),
          h(FieldRow, { label: 'CDDA 用户目录', note: '留空 = 默认用户目录。', children: h(TxtInput, { k: 'userDir', placeholder: '~/.cataclysm-dda' }) }),
          h(FieldRow, { label: '终端后端', note: 'auto = 同名会话在哪个后端活着就用哪个，都没有则优先 tmux。切换后重启游戏会话生效。', children: h('select', {
            'data-cd-input': '', style: { flex: '1 1 200px' }, value: draft?.terminal || 'auto', onChange: (e) => set('terminal', e.target.value),
          },
            h('option', { value: 'auto' }, '自动（推荐）'),
            h('option', { value: 'tmux' }, 'tmux'),
            h('option', { value: 'screen' }, 'GNU screen')) }),
          h(FieldRow, { label: '游戏会话名', note: '默认 cddagame（老配置是 cdda）。', children: h(TxtInput, { k: 'screenGame', placeholder: 'cddagame' }) }),
          h(FieldRow, { label: '战报 screen 名', note: '默认 cdda_log。', children: h(TxtInput, { k: 'screenLog', placeholder: 'cdda_log' }) }),
          h(FieldRow, { label: 'dsh 可执行文件', note: '桌面版找不到 dsh 时填。', children: h(TxtInput, { k: 'dshBin', placeholder: '留空自动找' }) }),
          h(FieldRow, { label: 'ffmpeg 路径', note: '留空 = PATH 里的 ffmpeg。', children: h(TxtInput, { k: 'ffmpegPath', placeholder: '留空自动找' }) }),
          h(FieldRow, { label: '录制字体', note: '留空 = 自动找等宽字体。', children: h(TxtInput, { k: 'recordFont', placeholder: '留空自动找' }) }),
          h(FieldRow, { label: 'X11 DISPLAY（像素模式）', note: '留空用环境变量；一般不用填。', children: h(TxtInput, { k: 'recordDisplay', placeholder: ':0.0' }) }),
          h(ToggleRow, { label: '使用外部开局种子', note: '默认关；从 <DSH_HOME>/cdda-duty/starter-world/save/ 复制世界。', on: Boolean(draft?.starterWorld), onChange: (v) => set('starterWorld', v) }),
          st.logTail ? h('pre', { 'data-cd-pre': '', style: { maxHeight: 160 } }, st.logTail) : null),

        h('div', { 'data-cd-row': '' },
          h('button', { 'data-cd-btn': '', 'data-primary': '', disabled: Boolean(busy) || !dirty, onClick: onSave }, '保存设置')),

        screenOpen ? h('div', {
          'data-cd-modal': '',
          onClick: (e) => { if (e.target === e.currentTarget) setScreenOpen(false) },
        },
          h('div', { 'data-cd-modal-card': '' },
            h('div', { 'data-cd-modal-head': '' },
              h('div', { 'data-cd-grow': '' },
                h('b', { style: { fontSize: 15 } }, '正在运行的 screen'),
                h('div', { 'data-cd-note': '' }, '游戏画面 + cdda_log 战报；每 2 秒刷新。也可以直接复制命令到自己的终端。')),
              h('button', { 'data-cd-btn': '', onClick: () => setScreenOpen(false) }, '关闭')),
            screenErr ? h('div', { 'data-cd-msg': '', 'data-bad': '' }, screenErr) : null,
            h('div', { 'data-cd-screens': '' },
              h(ScreenPane, { which: 'game', title: '游戏画面' }),
              h(ScreenPane, { which: 'log', title: 'cdda_log 战报' })))) : null,
      )
    }

    function RecordingsView() {
      const [st, setSt] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [sel, setSel] = React.useState('')
      const load = React.useCallback(async () => {
        try {
          const d = await jget('/recordings')
          if (d && d.ok) { setSt(d); setErr('') }
          else setErr(d?.error || '读不到录制列表')
        } catch (e) { setErr(String(e?.message ?? e)) }
      }, [])
      React.useEffect(() => {
        let alive = true
        const run = () => { if (alive) load() }
        run()
        const t = setInterval(run, 5000)
        return () => { alive = false; clearInterval(t) }
      }, [load])

      const rec = st?.recording || {}
      const list = Array.isArray(st?.recordings) ? st.recordings : []
      const active = Boolean(rec.active)
      const chosen = list.find((x) => x.video === sel) || list[0] || null
      const chosenUrl = chosen && chosen.video && chosen.exists !== false ? fileUrl(chosen.video) : ''
      const fmtWhen = (v) => {
        try { return new Date(v).toLocaleString('zh-CN', { hour12: false }) } catch { return String(v || '') }
      }

      return h('div', { 'data-cd-recv': '' },
        h('div', { 'data-cd-recvhead': '' },
          h('div', { 'data-cd-grow': '' },
            h('div', { 'data-cd-recvtitle': '' }, 'CDDA 录制'),
            h('div', { 'data-cd-recvsub': '' },
              st ? `${st.recordDir || ''} · ${list.length} 段` : '读取录制列表…',
              active ? ' · 正在录制' : '')),
          h('button', { 'data-cd-btn': '', onClick: load }, '刷新'),
          st?.recordDir ? h('button', { 'data-cd-btn': '', onClick: () => copyText(st.recordDir) }, '复制目录') : null),

        err ? h('div', { 'data-cd-msg': '', 'data-warn': '' }, err) : null,

        active ? h('div', { 'data-cd-msg': '', 'data-bad': '', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { 'data-cd-rec': '' }),
          `录制中 · ${String(rec.video || '').split('/').pop()} · ${Number(rec.durationSec || 0)}s · ${Number(rec.frames || 0)} 帧 · ${fmtSize(rec.size)}${rec.source ? ' · ' + rec.source : ''}`,
          rec.video ? h('a', { 'data-cd-link': '', href: fileUrl(rec.video), target: '_blank', rel: 'noreferrer' }, '打开当前文件') : null) : null,

        chosenUrl ? h('div', { 'data-cd-recvplayer': '' },
          h('video', { controls: true, preload: 'metadata', src: chosenUrl, key: chosenUrl }),
          h('div', { 'data-cd-recvmeta': '' },
            h('span', { 'data-cd-grow': '' }, `${chosen.videoName || String(chosen.video || '').split('/').pop()} · ${chosen.mode === 'text' ? '字符重绘' : '实际画面'}${chosen.source ? ' · ' + chosen.source : ''} · ${fmtWhen(chosen.startedAt)} · ${Number(chosen.durationSec || 0)}s · ${fmtSize(chosen.size)}`),
            h('a', { 'data-cd-link': '', href: chosenUrl, target: '_blank', rel: 'noreferrer' }, '新窗口打开'),
            chosen.srt ? h('a', { 'data-cd-link': '', href: fileUrl(chosen.srt), target: '_blank', rel: 'noreferrer' }, '下载字幕') : null)) : null,

        list.length
          ? h('div', { 'data-cd-recvlist': '' }, list.map((r) => {
              const url = r.video ? fileUrl(r.video) : ''
              const isSel = chosen && r.video === chosen.video
              return h('div', { key: r.video || r.id, 'data-cd-recvcard': '', 'data-sel': isSel ? '' : undefined },
                h('button', { 'data-cd-recvthumb': '', onClick: () => setSel(r.video), title: '播放这一段' },
                  h('span', { 'data-cd-recvplay': '' }, '▶'),
                  r.exists === false ? h('span', { 'data-cd-recvmissing': '' }, '文件没了') : null),
                h('div', { 'data-cd-recvbody': '' },
                  h('div', { 'data-cd-recvname': '' }, r.videoName || String(r.video || '').split('/').pop() || '未命名'),
                  h('div', { 'data-cd-note': '' }, `${r.mode === 'text' ? '字符重绘' : '实际画面'}${r.source ? ' · ' + r.source : ''} · ${fmtWhen(r.startedAt)} · ${Number(r.durationSec || 0)}s · ${fmtSize(r.size)}`),
                  h('div', { 'data-cd-recvactions': '' },
                    url ? h('a', { 'data-cd-link': '', href: url, target: '_blank', rel: 'noreferrer' }, '视频') : null,
                    r.srt ? h('a', { 'data-cd-link': '', href: fileUrl(r.srt), target: '_blank', rel: 'noreferrer' }, '字幕') : null)))
            }))
          : h('div', { 'data-cd-msg': '' },
              st ? '还没有录制。到设置 → CDDA 陪玩里打开「开始游戏后自动录制」。' : '读取中…'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-fish-cdda')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-fish-cdda: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'cdda-duty', order: 31, label: 'CDDA 陪玩' },
          () => h(Panel),
        ))
        slots.inject('conversation.view', () => slots.register(
          { name: 'conversation.view', id: 'cdda-recordings', order: 5, label: () => 'cdda录制' },
          RecordingsView,
        ))
      },
    }
  },
})
