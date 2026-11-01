/**
 * lib/identity.mjs —— 鱼的身份证 → CDDA 记忆命名空间
 *
 * identity.json 由 dsh-fish-kin 写在鱼家目录；CDDA 只读它，不猜、不写。
 * 有身份：memory/<identityId>/；没有/坏了：memory/shared/。
 * 身份只做隔离，不做权限/认证。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const IDENTITY_RE = /^fish_[0-9A-Z]{26}$/

export function identityPathOf(cfg = {}) {
  const raw = String(cfg.identityFile || process.env.CDDA_DUTY_IDENTITY_FILE || '').trim()
  if (!raw) return ''
  try {
    if (statSync(raw).isDirectory()) return join(raw, 'identity.json')
  } catch { /* 不存在也按文件路径处理 */ }
  return resolve(raw)
}

/** 读身份；缺失/坏文件/格式不对返回 null（走 shared）。 */
export function readIdentity(cfg = {}) {
  const file = identityPathOf(cfg)
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
    }
  } catch { return null }
}

/** 身份记忆目录；无身份时所有无身份会话共用 shared。 */
export function memoryDirOf(stateDir, identity) {
  return join(stateDir, 'memory', identity?.identityId || 'shared')
}

/** 给提示词/状态看的短标签。 */
export function identityLabel(identity) {
  return identity?.identityId ? `鱼 ${identity.identityId.slice(-6)}` : '无身份（共用）'
}
