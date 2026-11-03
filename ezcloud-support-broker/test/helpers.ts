import { buildApp, type EzidUser } from '../src/app.ts'
import { PERMISSIONS, ROLES, ROUTE_TABLE } from '../src/catalog.ts'

export function testEzidToken(body: Record<string, unknown>) {
  return `test.${Buffer.from(JSON.stringify(body)).toString('base64url')}`
}

export function testVerifier(token: string): Promise<EzidUser | null> {
  if (!token.startsWith('test.')) return Promise.resolve(null)
  const body = JSON.parse(Buffer.from(token.slice(5), 'base64url').toString()) as {
    iss?: string
    exp?: number
    sub?: string
    email?: string
    name?: string
    roles?: string[]
  }
  if (body.iss !== 'https://dev-id.ezcloud.vn') return Promise.resolve(null)
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return Promise.resolve(null)
  if (!body.sub || !body.email) return Promise.resolve(null)
  return Promise.resolve({
    sub: body.sub,
    email: body.email,
    name: body.name ?? body.email,
    roles: body.roles ?? [],
  })
}

export function validUser(extra: Record<string, unknown> = {}) {
  return testEzidToken({
    iss: 'https://dev-id.ezcloud.vn',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'user-1',
    email: 'user@ezcloud.vn',
    name: 'User One',
    roles: [],
    ...extra,
  })
}

export async function testApp(acl?: {
  mode?: 'off' | 'shadow' | 'enforce'
  fetchImpl?: typeof fetch
  baseUrl?: string
  apiKey?: string
  settingsKey?: string
  breakGlassEmails?: string[]
  db?: import('../src/db.ts').Db
}) {
  return buildApp({
    db: acl?.db,
    jwtSecret: 'test-secret',
    jwtIss: 'ezcloud-support',
    supporterRoles: ['support-staff'],
    verifyEzid: testVerifier,
    settingsKey: acl?.settingsKey,
    breakGlassEmails: acl?.breakGlassEmails,
    acl: {
      mode: acl?.mode ?? 'off',
      baseUrl: acl?.baseUrl ?? '',
      apiKey: acl?.apiKey ?? '',
      fetchImpl: acl?.fetchImpl ?? fetch,
    },
  })
}

export { PERMISSIONS, ROLES, ROUTE_TABLE }
