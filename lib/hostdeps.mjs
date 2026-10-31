/**
 * lib/hostdeps.mjs —— 从宿主那棵树里取 `@deepseek-ai/*`（拿不到就退到自己的依赖）
 * ============================================================================
 * 背景（抄自 dsh-bili-scroll 的同一份修复，MIT）：`@deepseek-ai/dsh-tools` /
 * `@deepseek-ai/schemastery` 在插件里是 optional peer；桌面版 profile 的
 * `autoInstallPeers: false` 不会装它们，裸 import 会让整条插件“静默不激活”。
 *
 * 策略：
 *   ① 先从 DSH 宿主那棵树里解析（跟宿主用同一份，行为最一致）；
 *   ② 解析不到就 bare import（靠 package.json 的 dependencies 保底）；
 *   ③ schemastery 彻底拿不到 ⇒ 没有 Config，插件照常加载（设置页降级）；
 *      dsh-tools 拿不到 ⇒ 用本地等价实现顶上。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

/** 可能藏着宿主 `@deepseek-ai` 包的地方（不写死某一台机器，按可能性排序） */
export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)

  // ① 当前 dsh 进程自己的入口：node <node_modules>/.bin/dsh web
  //    ⇒ <node_modules>/@deepseek-ai 就是宿主树（npx / pnpm / 桌面版都适用）
  try {
    const argv1 = process.argv[1] ? resolve(process.argv[1]) : ''
    if (argv1) {
      let dir = dirname(argv1)
      for (let i = 0; i < 5 && dir && dir !== '/'; i++) {
        push(join(dir, '@deepseek-ai'))
        push(join(dir, 'node_modules', '@deepseek-ai'))
        dir = dirname(dir)
      }
    }
  } catch { /* 忽略 */ }

  // ② 桌面版 / Windows 安装目录
  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch { /* 没有就算了 */ }
  }
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai')

  // ③ profile 树（有些机器上这些包被别的插件 hoist 到 profile 根上）
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }

  // ④ 插件自己那份（package.json 的 dependencies 装出来的）—— 放最后
  push(SELF_MODULES)
  return out
}

function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string'
      ? dot
      : (dot?.import || dot?.default || (typeof dot === 'object' ? dot?.require : null) || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

async function fromHostTree(name, log) {
  const fails = []
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue
    const url = entryUrlFor(root, name)
    if (!url) continue
    try {
      const mod = await import(url)
      log(`${name}：从宿主树取到（${url.replace(/^file:\/\/\//, '')}）`)
      return mod
    } catch (e) { fails.push(`${e?.code || 'ERR'}:${root}`) }
  }
  if (fails.length) log(`${name}：宿主树里都不行（${fails.slice(0, 3).join(' ')}）`)
  return null
}

/** 兜底：拿不到宿主的 dsh-tools 时用。parameters / output.schema 已经是标准形状。 */
function localDefineTool(options, log) {
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      throw new Error(`defineTool(${options.name}): ${where} 是 object 却没写 additionalProperties`)
    }
    for (const [k, v] of Object.entries(schema.properties || {})) check(v, `${where}.properties.${k}`)
  }
  // parameters 是“属性名 → 属性 schema”的 map（宿主 defineTool 自己转 JSON Schema），
  // 所以只检查每个属性的 schema；output.schema 是标准 JSON Schema。
  for (const [k, v] of Object.entries(options.parameters || {})) check(v, `parameters.${k}`)
  check(options.output?.schema, 'output.schema')
  log?.(`dsh-tools 拿不到 —— 用本地等价实现顶上了（工具 ${options.name}）`)
  return options
}

/**
 * @returns {Promise<{z:any, defineTool:Function, notes:string[]}>}
 */
export async function loadHostDeps() {
  const notes = []
  const log = (m) => notes.push(m)

  let zMod = await fromHostTree('schemastery', log)
  if (!zMod) {
    try { zMod = await import('@deepseek-ai/schemastery'); log('schemastery：宿主树里没有，用自己依赖里那份') }
    catch (e) { log(`⚠️ schemastery 彻底拿不到（${e?.code || ''} ${String(e?.message || '').slice(0, 120)}）—— 这一份插件没有 Config，设置页会降级`) }
  }
  const z = zMod?.default ?? zMod ?? null

  let defineTool = null
  let dtMod = await fromHostTree('dsh-tools', log)
  if (!dtMod) {
    try { dtMod = await import('@deepseek-ai/dsh-tools'); log('dsh-tools：宿主树里没有，用自己依赖里那份') }
    catch (e) { log(`dsh-tools 拿不到（${e?.code || ''}）—— 用本地等价实现顶上`); dtMod = null }
  }
  defineTool = dtMod?.defineTool || ((options) => localDefineTool(options, log))

  return { z, defineTool, notes }
}
