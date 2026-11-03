import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allows } from '../src/catalog.ts'
import { testApp, validUser, PERMISSIONS, ROUTE_TABLE } from './helpers.ts'

test('every admin route names a declared permission and desktop routes are not ACL gated', () => {
  const codes = new Set(PERMISSIONS.map((item) => item.code))
  const paths = new Set<string>()
  for (const route of ROUTE_TABLE) {
    const key = `${route.method} ${route.path}`
    assert.equal(paths.has(key), false, key)
    paths.add(key)
    if (route.access === 'acl') {
      assert.equal(codes.has(route.permission), true)
    }
    if (route.access === 'desktop' || route.access === 'public' || route.access === 'login') {
      assert.equal('permission' in route, false)
    }
  }
  assert.equal(PERMISSIONS.every((item) => !('resourceType' in item)), true)
  assert.equal(allows({ status: 'ACTIVE', permissions: [{ code: 'support.read', scope: { type: 'other', id: '1' } }] }, 'support.read'), true)
  assert.equal(allows({ status: 'ACTIVE', permissions: [] }, 'support.read'), false)
})

test('management routes stay closed until ACL enforce is configured', async () => {
  const app = await testApp()
  const login = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${validUser()}` },
    payload: { device_uuid: 'u', device_id: '1' },
  })
  const token = login.json().presence_token as string
  const tickets = await app.inject({
    method: 'GET',
    url: '/admin/tickets',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(tickets.statusCode, 403)
  assert.equal(tickets.json().error, 'forbidden_acl')
  const me = await app.inject({
    method: 'GET',
    url: '/admin/me',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(me.statusCode, 200)
  await app.close()
})

test('enforce mode allows support.read and rejects a missing permission', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'ACTIVE', permissions: [{ code: 'support.read', scope: null }], appAdmins: ['admin@ezcloud.vn'] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  const app = await testApp({ mode: 'enforce', baseUrl: 'https://acl.ezcloud.vn/api/integration/v1', apiKey: 'acl_test_secret', fetchImpl })
  const login = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${validUser()}` },
    payload: { device_uuid: 'u', device_id: '1' },
  })
  const token = login.json().presence_token as string
  const tickets = await app.inject({
    method: 'GET',
    url: '/admin/tickets',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(tickets.statusCode, 200)
  const close = await app.inject({
    method: 'POST',
    url: '/admin/tickets/missing/close',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(close.statusCode, 403)
  assert.equal(close.json().error, 'forbidden_acl')
  await app.close()
})

test('ACL settings hide the key, block a lockout, and let ACL_MODE=off win', async () => {
  let checks = 0
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/subjects/permissions')) {
      checks += 1
      const permissions = checks === 1 ? [] : [{ code: 'support.read', scope: null }]
      return new Response(JSON.stringify({ status: 'ACTIVE', permissions, appAdmins: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const app = await testApp({
    mode: 'shadow',
    baseUrl: 'https://acl.ezcloud.vn/api/integration/v1',
    settingsKey: 'settings-key',
    breakGlassEmails: ['user@ezcloud.vn'],
    fetchImpl,
  })
  const login = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${validUser()}` },
    payload: { device_uuid: 'u', device_id: '1' },
  })
  const token = login.json().presence_token as string
  const headers = { authorization: `Bearer ${token}` }
  const locked = await app.inject({
    method: 'PUT',
    url: '/admin/acl',
    headers,
    payload: { baseUrl: 'https://acl.ezcloud.vn/api/integration/v1', apiKey: 'acl_test_secret', mode: 'enforce' },
  })
  assert.equal(locked.statusCode, 409)
  assert.equal(locked.json().error, 'acl_enforce_self_lockout')
  const saved = await app.inject({
    method: 'PUT',
    url: '/admin/acl',
    headers,
    payload: { baseUrl: 'https://acl.ezcloud.vn/api/integration/v1', apiKey: 'acl_test_secret', mode: 'shadow' },
  })
  assert.equal(saved.statusCode, 200)
  assert.equal(saved.json().apiKeySet, true)
  assert.equal(JSON.stringify(saved.json()).includes('acl_test_secret'), false)
  const settings = await app.inject({ method: 'GET', url: '/admin/acl/settings', headers })
  assert.equal(settings.json().apiKeySet, true)
  assert.equal(JSON.stringify(settings.json()).includes('acl_test_secret'), false)
  const pushed = await app.inject({ method: 'POST', url: '/admin/acl/push', headers })
  assert.equal(pushed.statusCode, 200)
  const roleCalls = calls.filter((item) => item.includes('/roles'))
  const manifestAt = calls.findIndex((item) => item.includes('/manifest'))
  const firstRole = calls.findIndex((item) => item.includes('/roles'))
  assert.equal(firstRole >= 0 && firstRole < manifestAt, true)
  assert.equal(roleCalls.length >= 2, true)
  await app.close()
})

test('a saved enforce mode stays closed when ACL_MODE=off', async () => {
  const { openDb } = await import('../src/db.ts')
  const db = openDb(':memory:')
  db.prepare(`INSERT INTO acl_settings (id, base_url, api_key_enc, mode) VALUES (1, ?, '', 'enforce')`).run(
    'https://acl.ezcloud.vn/api/integration/v1',
  )
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'ACTIVE', permissions: [{ code: 'support.read', scope: null }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  const app = await testApp({
    db,
    mode: 'off',
    baseUrl: 'https://acl.ezcloud.vn/api/integration/v1',
    apiKey: 'acl_test_secret',
    fetchImpl,
  })
  const login = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${validUser()}` },
    payload: { device_uuid: 'u', device_id: '1' },
  })
  const tickets = await app.inject({
    method: 'GET',
    url: '/admin/tickets',
    headers: { authorization: `Bearer ${login.json().presence_token}` },
  })
  assert.equal(tickets.statusCode, 403)
  assert.equal(tickets.json().error, 'forbidden_acl')
  await app.close()
})
