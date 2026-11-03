import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildApp } from '../src/app.ts'
import { openDb } from '../src/db.ts'
import { testApp, testVerifier, validUser } from './helpers.ts'

async function login(app: Awaited<ReturnType<typeof testApp>>, extra: Record<string, unknown>, deviceUuid: string, deviceId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${validUser(extra)}` },
    payload: { device_uuid: deviceUuid, device_id: deviceId },
  })
  assert.equal(response.statusCode, 200)
  return response.json().presence_token as string
}

test('a device has one open ticket and a supporter cannot create one', async () => {
  const app = await testApp()
  const customer = await login(app, { sub: 'cust', email: 'c@ezcloud.vn', name: 'Cust' }, 'uuid-c', '11')
  const first = await app.inject({
    method: 'POST',
    url: '/v1/tickets',
    headers: { authorization: `Bearer ${customer}` },
    payload: { device_id: '11', device_uuid: 'uuid-c' },
  })
  const second = await app.inject({
    method: 'POST',
    url: '/v1/tickets',
    headers: { authorization: `Bearer ${customer}` },
    payload: { device_id: '11', device_uuid: 'uuid-c' },
  })
  assert.equal(first.json().ticket_id, second.json().ticket_id)
  const supporter = await login(app, { sub: 'sup', email: 's@ezcloud.vn', roles: ['support-staff'] }, 'uuid-s', '12')
  const denied = await app.inject({
    method: 'POST',
    url: '/v1/tickets',
    headers: { authorization: `Bearer ${supporter}` },
    payload: { device_id: '12', device_uuid: 'uuid-s' },
  })
  assert.equal(denied.statusCode, 403)
  await app.close()
})

test('only a supporter can list the queue and a connect grant is single use', async () => {
  const app = await testApp()
  const customer = await login(app, { sub: 'cust', email: 'c@ezcloud.vn', name: 'Cust' }, 'uuid-c', '11')
  const created = await app.inject({
    method: 'POST',
    url: '/v1/tickets',
    headers: { authorization: `Bearer ${customer}` },
    payload: { device_id: '11', device_uuid: 'uuid-c' },
  })
  const queueAsCustomer = await app.inject({
    method: 'GET',
    url: '/v1/tickets?status=waiting',
    headers: { authorization: `Bearer ${customer}` },
  })
  assert.equal(queueAsCustomer.statusCode, 403)
  const supporter = await login(app, { sub: 'sup', email: 's@ezcloud.vn', name: 'Sup', roles: ['support-staff'] }, 'uuid-s', '12')
  const queue = await app.inject({
    method: 'GET',
    url: '/v1/tickets?status=waiting',
    headers: { authorization: `Bearer ${supporter}` },
  })
  assert.equal(queue.statusCode, 200)
  assert.equal(queue.json().tickets.length, 1)
  const ticketId = created.json().ticket_id as string
  const first = await app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/connect`,
    headers: { authorization: `Bearer ${supporter}` },
  })
  assert.equal(first.statusCode, 200)
  assert.ok(first.json().connect_grant)
  const second = await app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/connect`,
    headers: { authorization: `Bearer ${supporter}` },
  })
  assert.equal(second.statusCode, 409)
  const closed = await app.inject({
    method: 'GET',
    url: '/v1/tickets?status=waiting',
    headers: { authorization: `Bearer ${supporter}` },
  })
  assert.equal(closed.json().tickets.length, 0)
  await app.close()
})

test('a customer presence that expires closes the open ticket', async () => {
  const db = openDb(':memory:')
  const app = await buildApp({
    db,
    jwtSecret: 'test-secret',
    jwtIss: 'ezcloud-support',
    supporterRoles: ['support-staff'],
    verifyEzid: testVerifier,
    acl: { mode: 'off', baseUrl: '', apiKey: '', fetchImpl: fetch },
  })
  const customer = await login(app, { sub: 'cust', email: 'c@ezcloud.vn', name: 'Cust' }, 'uuid-c', '11')
  const created = await app.inject({
    method: 'POST',
    url: '/v1/tickets',
    headers: { authorization: `Bearer ${customer}` },
    payload: { device_id: '11', device_uuid: 'uuid-c' },
  })
  const ticketId = created.json().ticket_id as string
  db.prepare(`UPDATE device SET presence_exp = 1 WHERE device_uuid = ?`).run('uuid-c')
  const supporter = await login(app, { sub: 'sup', email: 's@ezcloud.vn', name: 'Sup', roles: ['support-staff'] }, 'uuid-s', '12')
  const queue = await app.inject({
    method: 'GET',
    url: '/v1/tickets?status=waiting',
    headers: { authorization: `Bearer ${supporter}` },
  })
  assert.equal(queue.statusCode, 200)
  assert.equal(queue.json().tickets.length, 0)
  const connect = await app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/connect`,
    headers: { authorization: `Bearer ${supporter}` },
  })
  assert.equal(connect.statusCode, 409)
  await app.close()
})
