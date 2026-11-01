#!/usr/bin/env node
/**
 * lib/mcp-server.mjs —— 自动玩回合用的 MCP stdio 服务
 * ============================================================================
 * 为什么还要一个 MCP：
 *   headless 回合不加载本插件（不想把 web 插件塞进第二个 profile），
 *   所以由插件生成一份 overlay，把这个 stdio 服务挂成 `cdda-duty` MCP。
 *   它和 host 半端共用 lib/tools-core.mjs —— 聊天里怎么玩，自动玩就怎么玩。
 *
 * 协议：newline-delimited JSON-RPC 2.0（MCP stdio 的标准写法）。
 * stdout 只允许协议消息；日志一律写 $CDDA_DUTY_HOME/mcp.log 或 stderr。
 * ============================================================================
 */
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { handleTool, TOOL_SPECS, toolSchemaForMcp } from './tools-core.mjs'
import { loadCfgFromDisk, logLine, stateDirOf } from './state.mjs'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
const stateDir = process.env.CDDA_DUTY_HOME || stateDirOf(null)
const logFile = join(stateDir, 'mcp.log')

function log(text) {
  try { appendFileSync(logFile, `[${new Date().toISOString()}] ${text}\n`, 'utf8') } catch { /* 忽略 */ }
  try { logLine(stateDir, '[mcp] ' + text) } catch { /* 忽略 */ }
}

const rt = {
  stateDir,
  pluginDir,
  autoUnstick: true,
  source: 'selfplay',
  cfg: loadCfgFromDisk(stateDir),
  getCfg: () => loadCfgFromDisk(stateDir),
  log,
}

const MCP_TOOLS = TOOL_SPECS
  .filter((t) => t.name !== 'cdda_autoplay' && t.name !== 'cdda_record')
  .map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toolSchemaForMcp(t.parameters),
  }))

function send(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n')
  } catch (e) {
    log('写 stdout 失败：' + String(e?.message ?? e))
  }
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }) }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }) }

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  if (method === 'initialize') {
    const requested = params?.protocolVersion
    // 回一个我们确定支持的旧版协议；SDK 会按兼容处理
    reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'cdda-duty', version: '0.1.0' },
      instructions: 'CDDA 陪玩工具：cdda_start / cdda_look / cdda_send / cdda_note / cdda_state / cdda_status。'
        + '每一步都要先看屏幕、再用 cdda_note 说明意图。',
    })
    return
  }
  if (isNotification) {
    if (method === 'notifications/initialized') log('客户端完成初始化')
    return
  }

  if (method === 'ping') { reply(id, {}); return }
  if (method === 'logging/setLevel') { reply(id, {}); return }
  if (method === 'tools/list') { reply(id, { tools: MCP_TOOLS }); return }
  if (method === 'resources/list') { reply(id, { resources: [] }); return }
  if (method === 'prompts/list') { reply(id, { prompts: [] }); return }
  if (method === 'tools/call') {
    const name = String(params?.name || '')
    const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}
    if (!MCP_TOOLS.some((t) => t.name === name)) { fail(id, -32602, `Unknown tool: ${name}`); return }
    try {
      rt.cfg = rt.getCfg()
      const result = await handleTool(name, args, rt)
      const text = JSON.stringify(result, null, 2)
      reply(id, { content: [{ type: 'text', text }], isError: false })
    } catch (e) {
      const text = '工具执行失败：' + String(e?.message ?? e)
      log(text)
      reply(id, { content: [{ type: 'text', text }], isError: true })
    }
    return
  }

  fail(id, -32601, `Method not found: ${method}`)
}

const pending = new Set()
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const text = String(line || '').trim()
  if (!text) return
  let msg
  try { msg = JSON.parse(text) } catch (e) {
    fail(null, -32700, 'Parse error')
    return
  }
  const task = Promise.resolve(handleMessage(msg)).catch((e) => {
    log('处理消息失败：' + String(e?.stack ?? e))
  })
  pending.add(task)
  task.finally(() => pending.delete(task))
})
rl.on('close', async () => {
  try { await Promise.allSettled([...pending]) } catch { /* 忽略 */ }
  log('stdin 关闭，退出')
  process.exit(0)
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
log(`MCP 启动（state=${stateDir}，tools=${MCP_TOOLS.length}）`)
