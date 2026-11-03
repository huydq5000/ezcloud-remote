import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import type { Db } from '../db.ts'

export type AclMode = 'off' | 'shadow' | 'enforce'

export type StoredAcl = {
  baseUrl: string
  apiKey: string
  mode: AclMode
  present: boolean
}

const empty: StoredAcl = { baseUrl: '', apiKey: '', mode: 'off', present: false }

function keyBytes(secret: string) {
  return scryptSync(secret, 'ezcloud-support-broker', 32)
}

export function encryptSecret(secret: string, plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, data]).toString('base64')
}

export function decryptSecret(secret: string, packed: string) {
  const raw = Buffer.from(packed, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function readStoredAcl(db: Db, settingsKey: string): StoredAcl {
  const row = db.prepare(`SELECT base_url, api_key_enc, mode FROM acl_settings WHERE id = 1`).get() as
    | { base_url: string; api_key_enc: string; mode: string }
    | undefined
  if (!row) return { ...empty }
  let apiKey = ''
  if (row.api_key_enc && settingsKey) {
    try {
      apiKey = decryptSecret(settingsKey, row.api_key_enc)
    } catch {
      apiKey = ''
    }
  }
  const mode: AclMode = row.mode === 'shadow' || row.mode === 'enforce' ? row.mode : 'off'
  return { baseUrl: row.base_url, apiKey, mode, present: true }
}

export function writeStoredAcl(db: Db, settingsKey: string, value: StoredAcl) {
  const apiKeyEnc = value.apiKey ? encryptSecret(settingsKey, value.apiKey) : ''
  db.prepare(
    `INSERT INTO acl_settings (id, base_url, api_key_enc, mode) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, api_key_enc = excluded.api_key_enc, mode = excluded.mode`,
  ).run(value.baseUrl, apiKeyEnc, value.mode)
}

export function effectiveMode(envMode: string, saved: StoredAcl): { mode: AclMode; envOverride: boolean } {
  if (envMode === 'off') return { mode: 'off', envOverride: true }
  if (saved.present) return { mode: saved.mode, envOverride: false }
  if (envMode === 'shadow' || envMode === 'enforce') return { mode: envMode, envOverride: false }
  return { mode: 'off', envOverride: false }
}
