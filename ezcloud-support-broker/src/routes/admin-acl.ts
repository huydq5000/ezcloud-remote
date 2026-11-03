import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PERMISSIONS, ROLES } from '../catalog.ts'
import type { Db } from '../db.ts'
import { effectiveMode, readStoredAcl, writeStoredAcl, type AclMode } from '../acl/settings.ts'
import type { PresenceClaims } from '../tokens.ts'

type FetchImpl = typeof fetch

export type AclAdminCtx = {
  db: Db
  settingsKey: string
  envMode: string
  envBaseUrl: string
  envApiKey: string
  fetchImpl: FetchImpl
  presence: (request: FastifyRequest) => Promise<PresenceClaims | undefined>
  clearCache: () => void
}

function resolved(ctx: AclAdminCtx) {
  const saved = readStoredAcl(ctx.db, ctx.settingsKey)
  const mode = effectiveMode(ctx.envMode, saved)
  return {
    saved,
    mode: mode.mode,
    envOverride: mode.envOverride,
    baseUrl: saved.baseUrl || ctx.envBaseUrl,
    apiKey: saved.apiKey || ctx.envApiKey,
  }
}

async function aclFetch(ctx: AclAdminCtx, baseUrl: string, apiKey: string, path: string, body: unknown) {
  const response = await ctx.fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { ok: response.ok, status: response.status, body: text.slice(0, 2000) }
}

export function registerAclAdmin(app: FastifyInstance, ctx: AclAdminCtx) {
  app.get('/admin', async (_request, reply) => {
    const { adminPage } = await import('./admin.ts')
    return reply.type('text/html').send(adminPage)
  })

  app.get('/admin/acl', async (_request, reply) => reply.type('text/html').send(aclPage))

  app.get('/admin/acl/settings', async (request, reply) => {
    const user = await ctx.presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const current = resolved(ctx)
    return {
      baseUrl: current.saved.baseUrl || current.baseUrl,
      apiKeySet: Boolean(current.saved.apiKey || current.apiKey),
      mode: current.saved.present ? current.saved.mode : current.mode,
      effectiveMode: current.mode,
      envOverride: current.envOverride,
    }
  })

  app.put('/admin/acl', async (request, reply) => {
    const user = await ctx.presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const body = request.body as { baseUrl?: string; apiKey?: string; mode?: string }
    const current = resolved(ctx)
    const nextMode: AclMode = body.mode === 'shadow' || body.mode === 'enforce' ? body.mode : 'off'
    const nextUrl = (body.baseUrl ?? current.saved.baseUrl ?? current.baseUrl).trim()
    const nextKey = body.apiKey ? body.apiKey : current.saved.apiKey || current.apiKey
    if (nextKey && !ctx.settingsKey) {
      return reply.code(400).send({ error: 'settings_key_missing' })
    }
    if (nextMode === 'enforce' && ctx.envMode !== 'off') {
      const allowed = await callerHasPermission(ctx, nextUrl, nextKey, user)
      if (!allowed) {
        return reply.code(409).send({ error: 'acl_enforce_self_lockout' })
      }
    }
    writeStoredAcl(ctx.db, ctx.settingsKey, {
      baseUrl: nextUrl,
      apiKey: nextKey,
      mode: ctx.envMode === 'off' ? 'off' : nextMode,
      present: true,
    })
    ctx.clearCache()
    const stored = readStoredAcl(ctx.db, ctx.settingsKey)
    return { apiKeySet: Boolean(stored.apiKey), mode: effectiveMode(ctx.envMode, stored).mode, envOverride: ctx.envMode === 'off' }
  })

  app.post('/admin/acl/push', async (request, reply) => {
    const user = await ctx.presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const current = resolved(ctx)
    if (!current.baseUrl || !current.apiKey) {
      return reply.code(400).send({ error: 'acl_not_configured' })
    }
    const roles = ROLES.map((role) => ({ name: role.name, permissions: role.permissions }))
    const preview = await aclFetch(ctx, current.baseUrl, current.apiKey, '/roles', { dryRun: true, roles })
    if (!preview.ok) {
      logPush(ctx, user.sub, { step: 'roles-dry-run', preview })
      return reply.code(502).send({ error: 'acl_push_failed', step: 'roles-dry-run' })
    }
    const manifest = await aclFetch(ctx, current.baseUrl, current.apiKey, '/manifest', {
      resourceTypes: [],
      permissions: PERMISSIONS.map((item) => ({ code: item.code, description: item.name })),
    })
    const commit = manifest.ok
      ? await aclFetch(ctx, current.baseUrl, current.apiKey, '/roles', { dryRun: false, roles })
      : null
    logPush(ctx, user.sub, { step: 'push', preview: preview.body, manifest: manifest.body, commit: commit?.body ?? null })
    if (!manifest.ok || !commit?.ok) return reply.code(502).send({ error: 'acl_push_failed' })
    return { ok: true }
  })
}

async function callerHasPermission(ctx: AclAdminCtx, baseUrl: string, apiKey: string, user: PresenceClaims) {
  if (!baseUrl || !apiKey) return false
  try {
    const response = await ctx.fetchImpl(`${baseUrl.replace(/\/$/, '')}/subjects/permissions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sub: user.sub, email: user.email }),
    })
    if (!response.ok) return false
    const body = (await response.json()) as { status?: string; permissions?: unknown[] }
    return body.status === 'ACTIVE' && Array.isArray(body.permissions) && body.permissions.length > 0
  } catch {
    return false
  }
}

function logPush(ctx: AclAdminCtx, sub: string, result: unknown) {
  ctx.db.prepare(`INSERT INTO acl_push_log (at, sub, result) VALUES (?, ?, ?)`).run(
    new Date().toISOString(),
    sub,
    JSON.stringify(result),
  )
}

const aclPage = `<!doctype html>
<meta charset="utf-8">
<title>ACL ezCloud Remote</title>
<style>body { font-family: sans-serif; margin: 2rem; max-width: 40rem; } label { display: block; margin: .6rem 0; }</style>
<h1>Kết nối Central ACL</h1>
<p>Trang này chỉ gọi broker.</p>
<label>Presence token <input id="token" size="60"></label>
<label>URL <input id="url" size="60"></label>
<label>API key <input id="key" type="password" size="40" placeholder="để trống nếu giữ key cũ"></label>
<label>Chế độ
  <select id="mode"><option>off</option><option>shadow</option><option>enforce</option></select>
</label>
<button id="save" type="button">Lưu</button>
<button id="push" type="button">Đẩy lên ACL</button>
<p id="out"></p>
<script>
const tokenBox = document.querySelector('#token')
tokenBox.value = sessionStorage.getItem('ez-presence') || ''
const headers = () => ({ authorization: 'Bearer ' + tokenBox.value, 'content-type': 'application/json' })
document.querySelector('#save').onclick = async () => {
  sessionStorage.setItem('ez-presence', tokenBox.value)
  const response = await fetch('/admin/acl', { method: 'PUT', headers: headers(), body: JSON.stringify({
    baseUrl: document.querySelector('#url').value,
    apiKey: document.querySelector('#key').value,
    mode: document.querySelector('#mode').value,
  }) })
  document.querySelector('#out').textContent = await response.text()
}
document.querySelector('#push').onclick = async () => {
  sessionStorage.setItem('ez-presence', tokenBox.value)
  const response = await fetch('/admin/acl/push', { method: 'POST', headers: headers() })
  document.querySelector('#out').textContent = await response.text()
}
fetch('/admin/acl/settings', { headers: { authorization: 'Bearer ' + tokenBox.value } }).then(async (response) => {
  if (!response.ok) return
  const body = await response.json()
  document.querySelector('#url').value = body.baseUrl || ''
  document.querySelector('#mode').value = body.mode || 'off'
})
</script>
`

export async function rejectUnlessBreakGlass(
  request: FastifyRequest,
  reply: FastifyReply,
  presence: AclAdminCtx['presence'],
  emails: string[],
) {
  const user = await presence(request)
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' })
    return false
  }
  const allowed = emails.map((item) => item.toLowerCase())
  if (!allowed.includes(user.email.toLowerCase())) {
    await reply.code(403).send({ error: 'forbidden', message: 'Break-glass email required' })
    return false
  }
  return true
}
