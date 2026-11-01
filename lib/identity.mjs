/**
 * lib/identity.mjs —— 鱼的身份证 → CDDA 记忆命名空间
 *
 * 优先顺序：
 *   1. 显式 identityFile / CDDA_DUTY_IDENTITY_FILE（老配置仍可用）
 *   2. 当前 cwd 在鱼家/孩子家里
 *   3. fish-kin 家族工作区里唯一的 fish/identity.json
 *   4. 家族里有父代 + 子代、cwd 不命中子代时，用父代
 *   5. 多个子代且无法判断 → shared（宁可共用，不串档）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

// 鱼身份证：老格式 fish_ + 26 位；2026-11 起新格式 ds-fish- + YYYYMMDD + 4 位编码（过渡期的 330105 也认）
export const LEGACY_IDENTITY_RE = /^fish_[0-9A-Z]{26}$/
export const IDENTITY_RE = /^(?:fish_[0-9A-Z]{26}|330105\d{12}|ds-fish-\d{12})$/
export const IDENTITY_FILE = 'identity.json'

export function identityPathOf(cfg = {}) {
  const raw = String(cfg.identityFile || process.env.CDDA_DUTY_IDENTITY_FILE || '').trim()
  if (!raw) return ''
  try {
    if (statSync(raw).isDirectory()) return join(raw, IDENTITY_FILE)
  } catch { /* 不存在也按文件路径处理 */ }
  return resolve(raw)
}

function readIdentityFile(file, source) {
  if (!file || !existsSync(file)) return null
  try {
    const x = JSON.parse(readFileSync(file, 'utf8'))
    const identityId = String(x?.identityId || '')
    if (!IDENTITY_RE.test(identityId)) return null
    return {
      identityId,
      childId: x.childId ?? null,
      parentId: x.parentId ?? null,
      lineageId: String(x.lineageId || identityId),
      generation: Number(x.generation) || 1,
      file,
      source,
    }
  } catch { return null }
}

function familyRoots() {
  const out = []
  const env = String(process.env.DSH_KIN_FAMILY_ROOT || '').trim()
  if (env) out.push(resolve(env))
  const home = homedir()
  try {
    const pointer = JSON.parse(readFileSync(join(home, '.dsh-fish-kin.json'), 'utf8'))
    const v = String(pointer?.familyRoot || '').trim()
    if (v) out.push(resolve(v))
  } catch { /* 没有指针 */ }
  for (const p of [join(home, '大肥鱼家族'), join(home, '.dsh-fish-kin')]) {
    try { if (statSync(p).isDirectory()) out.push(p) } catch { /* 没有 */ }
  }
  return [...new Set(out)]
}

function candidates() {
  const out = []
  const fishEnv = String(process.env.DSH_KIN_FISH_HOME || '').trim()
  if (fishEnv) {
    const id = readIdentityFile(join(resolve(fishEnv), IDENTITY_FILE), 'env-fish')
    if (id) out.push(id)
  }
  for (const family of familyRoots()) {
    const parent = readIdentityFile(join(family, 'fish', IDENTITY_FILE), 'family-parent')
    if (parent) out.push(parent)
    let names = []
    try { names = readdirSync(join(family, 'children'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { /* 没孩子 */ }
    for (const name of names) {
      const id = readIdentityFile(join(family, 'children', name, IDENTITY_FILE), 'family-child')
      if (id) out.push(id)
    }
  }
  return out
}

function under(dir, cwd) {
  const a = resolve(dir)
  const b = resolve(cwd)
  return b === a || b.startsWith(a + sep)
}

/** 读身份；显式 → cwd → 父代 → 唯一 → null(shared)。 */
export function readIdentity(cfg = {}, { cwd = process.cwd() } = {}) {
  const explicit = readIdentityFile(identityPathOf(cfg), 'explicit')
  if (explicit) return explicit
  if (cfg.identityAuto === false) return null
  const all = candidates()
  if (!all.length) return null

  const byCwd = all.find((x) => under(join(x.file, '..'), cwd))
  if (byCwd) return byCwd
  if (all.length === 1) return all[0]
  const parent = all.find((x) => x.source === 'family-parent' || x.source === 'env-fish')
  if (parent) return parent
  return null
}

/** 身份记忆目录；无身份时所有无身份会话共用 shared。 */
export function memoryDirOf(stateDir, identity) {
  return join(stateDir, 'memory', identity?.identityId || 'shared')
}

export function identityLabel(identity) {
  return identity?.identityId ? `鱼 ${identity.identityId.slice(-6)}` : '无身份（共用）'
}
