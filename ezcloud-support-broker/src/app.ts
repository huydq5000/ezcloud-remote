import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { allows, classify, type AclPerms } from './catalog.ts'
import { effectiveMode, readStoredAcl } from './acl/settings.ts'
import { closeExpiredTickets, openDb, rememberDevice, type Db, type TicketRow } from './db.ts'
import { registerAclAdmin } from './routes/admin-acl.ts'
import { signConnect, signPresence, verifyPresence, type PresenceClaims } from './tokens.ts'

export type EzidUser = {
  sub: string
  email: string
  name: string
  roles: string[]
}

export type AclConfig = {
  mode: 'off' | 'shadow' | 'enforce'
  baseUrl: string
  apiKey: string
  fetchImpl: typeof fetch
}

export type AppDeps = {
  db?: Db
  databasePath?: string
  jwtSecret: string
  jwtIss: string
  supporterRoles: string[]
  verifyEzid: (token: string) => Promise<EzidUser | null>
  acl: AclConfig
  settingsKey?: string
  breakGlassEmails?: string[]
}

type CacheEntry = { perms: AclPerms; at: number }

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function ticketJson(row: TicketRow) {
  return {
    ticket_id: row.ticket_id,
    sub: row.sub,
    name: row.name,
    device_id: row.device_id,
    status: row.status,
    created_at: row.created_at,
    supporter_sub: row.supporter_sub,
  }
}

export async function buildApp(deps: AppDeps) {
  const db = deps.db ?? openDb(deps.databasePath ?? ':memory:')
  const cache = new Map<string, CacheEntry>()
  const app = Fastify({ logger: false })

  async function presence(request: FastifyRequest): Promise<PresenceClaims | undefined> {
    const token = bearer(request)
    if (!token) return undefined
    try {
      return await verifyPresence(deps.jwtSecret, deps.jwtIss, token)
    } catch {
      return undefined
    }
  }

  function resolvedAcl() {
    const saved = readStoredAcl(db, deps.settingsKey ?? '')
    const mode = effectiveMode(deps.acl.mode, saved)
    return {
      mode: mode.mode,
      envOverride: mode.envOverride,
      baseUrl: saved.baseUrl || deps.acl.baseUrl,
      apiKey: saved.apiKey || deps.acl.apiKey,
    }
  }

  async function loadPerms(user: PresenceClaims, baseUrl: string, apiKey: string): Promise<AclPerms | 'unavailable'> {
    const cacheKey = `${user.sub}\n${user.email}`
    const hit = cache.get(cacheKey)
    const now = Date.now()
    if (hit && now - hit.at < 300_000) return hit.perms
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await deps.acl.fetchImpl(`${baseUrl.replace(/\/$/, '')}/subjects/permissions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sub: user.sub, email: user.email }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(String(response.status))
      const body = (await response.json()) as AclPerms & { ttlSeconds?: number }
      const perms: AclPerms = {
        status: body.status,
        permissions: body.permissions ?? [],
        appAdmins: body.appAdmins ?? [],
      }
      cache.set(cacheKey, { perms, at: now })
      return perms
    } catch {
      if (hit && now - hit.at < 300_000 + 120_000) return hit.perms
      return 'unavailable'
    } finally {
      clearTimeout(timer)
    }
  }

  app.addHook('preHandler', async (request, reply) => {
    const pattern = request.routeOptions.url
    const rule = classify(request.method, pattern)
    if (!rule) {
      return reply.code(403).send({ error: 'acl_unmapped', message: 'Route is not declared' })
    }
    if (rule.access === 'public' || rule.access === 'desktop' || rule.access === 'login') return
    const user = await presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Presence token required' })
    if (rule.access === 'break-glass') {
      const emails = (deps.breakGlassEmails ?? []).map((item) => item.toLowerCase())
      if (!emails.includes(user.email.toLowerCase())) {
        return reply.code(403).send({ error: 'forbidden', message: 'Break-glass email required' })
      }
      return
    }
    const current = resolvedAcl()
    if (current.mode === 'shadow') {
      db.prepare(`INSERT INTO acl_shadow_diff (at, method, path, sub, detail) VALUES (?, ?, ?, ?, ?)`).run(
        new Date().toISOString(),
        request.method,
        pattern,
        user.sub,
        'management denied while ACL is in shadow',
      )
    }
    const configured = current.mode === 'enforce' && current.baseUrl !== '' && current.apiKey !== ''
    if (!configured) {
      return reply.code(403).send({
        error: 'forbidden_acl',
        message: 'Management is closed until ACL enforce mode is configured',
        permission: rule.permission,
        resources: [],
        appAdmins: [],
      })
    }
    const perms = await loadPerms(user, current.baseUrl, current.apiKey)
    if (perms === 'unavailable') {
      return reply.code(503).send({
        error: 'acl_unavailable',
        message: 'ACL did not respond',
        detail: 'timeout or 5xx',
      })
    }
    if (!allows(perms, rule.permission)) {
      return reply.code(403).send({
        error: 'forbidden_acl',
        message: 'Missing permission',
        permission: rule.permission,
        resources: [],
        appAdmins: perms.appAdmins ?? [],
      })
    }
  })

  app.get('/health', async () => ({ ok: true }))

  app.post('/v1/sessions', async (request, reply) => {
    const token = bearer(request)
    const user = await deps.verifyEzid(token)
    if (!user || !user.sub || !user.email) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const body = request.body as { device_uuid?: string; device_id?: string }
    if (!body?.device_uuid || !body.device_id) {
      return reply.code(400).send({ error: 'device_uuid and device_id are required' })
    }
    const role = user.roles.some((item) => deps.supporterRoles.includes(item)) ? 'supporter' : 'customer'
    db.prepare(
      `INSERT INTO profile (sub, name, email, role) VALUES (?, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET name=excluded.name, email=excluded.email, role=excluded.role`,
    ).run(user.sub, user.name, user.email, role)
    const signed = await signPresence(deps.jwtSecret, deps.jwtIss, {
      sub: user.sub,
      name: user.name,
      email: user.email,
      role,
      device_uuid: body.device_uuid,
    })
    rememberDevice(db, body.device_id, body.device_uuid, user.sub, user.name, signed.exp)
    return { presence_token: signed.token, expires_in: 600, role, name: user.name }
  })

  app.post('/v1/sessions/refresh', async (request, reply) => {
    const body = request.body as { access_token?: string; device_uuid?: string; device_id?: string }
    const user = body.access_token ? await deps.verifyEzid(body.access_token) : null
    if (!user || !body.device_uuid || !body.device_id) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const role = user.roles.some((item) => deps.supporterRoles.includes(item)) ? 'supporter' : 'customer'
    const signed = await signPresence(deps.jwtSecret, deps.jwtIss, {
      sub: user.sub,
      name: user.name,
      email: user.email,
      role,
      device_uuid: body.device_uuid,
    })
    rememberDevice(db, body.device_id, body.device_uuid, user.sub, user.name, signed.exp)
    return { presence_token: signed.token, expires_in: 600, role, name: user.name }
  })

  app.delete('/v1/sessions/current', async (request, reply) => {
    const user = await presence(request)
    const body = request.body as { device_uuid?: string }
    if (!user || !body?.device_uuid || body.device_uuid !== user.device_uuid) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    const open = db.prepare(
      `SELECT * FROM ticket WHERE sub = ? AND device_uuid = ? AND status IN ('waiting', 'active')`,
    ).get(user.sub, user.device_uuid) as TicketRow | undefined
    if (open) {
      db.prepare(`UPDATE ticket SET status = 'closed', closed_at = ? WHERE ticket_id = ?`).run(
        new Date().toISOString(),
        open.ticket_id,
      )
    }
    return reply.code(204).send()
  })

  app.post('/v1/tickets', async (request, reply) => {
    closeExpiredTickets(db)
    const user = await presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (user.role !== 'customer') return reply.code(403).send({ error: 'forbidden' })
    const body = request.body as { device_id?: string; device_uuid?: string }
    if (!body.device_id || body.device_uuid !== user.device_uuid) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    const existing = db.prepare(
      `SELECT * FROM ticket WHERE device_id = ? AND status IN ('waiting', 'active')`,
    ).get(body.device_id) as TicketRow | undefined
    if (existing) return ticketJson(existing)
    const row: TicketRow = {
      ticket_id: randomUUID(),
      sub: user.sub,
      name: user.name,
      device_id: body.device_id,
      device_uuid: body.device_uuid,
      status: 'waiting',
      created_at: new Date().toISOString(),
      closed_at: null,
      supporter_sub: null,
    }
    db.prepare(
      `INSERT INTO ticket (ticket_id, sub, name, device_id, device_uuid, status, created_at, closed_at, supporter_sub)
       VALUES (@ticket_id, @sub, @name, @device_id, @device_uuid, @status, @created_at, @closed_at, @supporter_sub)`,
    ).run(row)
    return ticketJson(row)
  })

  app.get('/v1/tickets', async (request, reply) => {
    closeExpiredTickets(db)
    const user = await presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (user.role !== 'supporter') return reply.code(403).send({ error: 'forbidden' })
    const status = (request.query as { status?: string }).status
    if (status !== 'waiting') return reply.code(400).send({ error: 'status=waiting is required' })
    const tickets = db.prepare(`SELECT * FROM ticket WHERE status = 'waiting' ORDER BY created_at`).all() as TicketRow[]
    return { tickets: tickets.map(ticketJson) }
  })

  app.post('/v1/tickets/:ticket_id/connect', async (request, reply) => {
    closeExpiredTickets(db)
    const user = await presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (user.role !== 'supporter') return reply.code(403).send({ error: 'forbidden' })
    const ticketId = (request.params as { ticket_id: string }).ticket_id
    const row = db.prepare(`SELECT * FROM ticket WHERE ticket_id = ?`).get(ticketId) as TicketRow | undefined
    if (!row || row.status !== 'waiting') return reply.code(409).send({ error: 'conflict' })
    const jti = randomUUID()
    const signed = await signConnect(deps.jwtSecret, deps.jwtIss, {
      sub: user.sub,
      name: user.name,
      ticket_id: row.ticket_id,
      peer_id: row.device_id,
      jti,
    })
    db.prepare(`INSERT INTO used_jti (jti, exp) VALUES (?, ?)`).run(jti, signed.exp)
    db.prepare(`UPDATE ticket SET status = 'active', supporter_sub = ? WHERE ticket_id = ?`).run(user.sub, row.ticket_id)
    return { connect_grant: signed.token, expires_in: 60 }
  })

  app.post('/v1/tickets/:ticket_id/close', async (request, reply) => {
    const user = await presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const ticketId = (request.params as { ticket_id: string }).ticket_id
    const row = db.prepare(`SELECT * FROM ticket WHERE ticket_id = ?`).get(ticketId) as TicketRow | undefined
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const allowed = row.sub === user.sub || (user.role === 'supporter' && row.supporter_sub === user.sub)
    if (!allowed) return reply.code(403).send({ error: 'forbidden' })
    db.prepare(`UPDATE ticket SET status = 'closed', closed_at = ? WHERE ticket_id = ?`).run(new Date().toISOString(), ticketId)
    const updated = db.prepare(`SELECT * FROM ticket WHERE ticket_id = ?`).get(ticketId) as TicketRow
    return ticketJson(updated)
  })

  app.get('/admin/me', async (request, reply) => {
    const user = await presence(request)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    let permissions: AclPerms['permissions'] = []
    let status = 'skipped'
    const current = resolvedAcl()
    if (current.mode === 'enforce' && current.baseUrl && current.apiKey) {
      const perms = await loadPerms(user, current.baseUrl, current.apiKey)
      if (perms === 'unavailable') status = 'unavailable'
      else {
        status = perms.status
        permissions = perms.permissions
      }
    }
    return {
      sub: user.sub,
      email: user.email,
      name: user.name,
      role: user.role,
      acl: { mode: deps.acl.mode, status, permissions },
    }
  })

  app.get('/admin/tickets', async () => {
    const tickets = db.prepare(`SELECT * FROM ticket ORDER BY created_at`).all() as TicketRow[]
    return { tickets: tickets.map(ticketJson) }
  })

  app.get('/admin/devices', async () => {
    const devices = db.prepare(`SELECT device_id, device_uuid, sub, name, last_seen FROM device ORDER BY last_seen DESC`).all()
    return { devices }
  })

  app.post('/admin/tickets/:id/close', async (request, reply) => {
    const ticketId = (request.params as { id: string }).id
    const row = db.prepare(`SELECT * FROM ticket WHERE ticket_id = ?`).get(ticketId) as TicketRow | undefined
    if (!row) return reply.code(404).send({ error: 'not_found' })
    db.prepare(`UPDATE ticket SET status = 'closed', closed_at = ? WHERE ticket_id = ?`).run(new Date().toISOString(), ticketId)
    const updated = db.prepare(`SELECT * FROM ticket WHERE ticket_id = ?`).get(ticketId) as TicketRow
    return ticketJson(updated)
  })

  registerAclAdmin(app, {
    db,
    settingsKey: deps.settingsKey ?? '',
    envMode: deps.acl.mode,
    envBaseUrl: deps.acl.baseUrl,
    envApiKey: deps.acl.apiKey,
    fetchImpl: deps.acl.fetchImpl,
    presence,
    clearCache: () => cache.clear(),
  })

  return app
}

export function reject(reply: FastifyReply, code: number, error: string) {
  return reply.code(code).send({ error })
}
