import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyPresence } from '../src/tokens.ts'
import { testApp, testEzidToken, validUser } from './helpers.ts'

test('rejects an ezID token with the wrong issuer or expiry', async () => {
  const app = await testApp()
  const wrongIss = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${testEzidToken({ iss: 'https://evil.example', exp: 9_999_999_999, sub: 'a', email: 'a@ezcloud.vn' })}` },
    payload: { device_uuid: 'dev', device_id: '1' },
  })
  assert.equal(wrongIss.statusCode, 401)
  const expired = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${testEzidToken({ iss: 'https://dev-id.ezcloud.vn', exp: 1, sub: 'a', email: 'a@ezcloud.vn' })}` },
    payload: { device_uuid: 'dev', device_id: '1' },
  })
  assert.equal(expired.statusCode, 401)
  await app.close()
})

test('issues a presence token for a valid ezID user', async () => {
  const app = await testApp()
  const response = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${validUser({ roles: ['support-staff'] })}` },
    payload: { device_uuid: 'device-uuid', device_id: '100' },
  })
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.role, 'supporter')
  const claims = await verifyPresence('test-secret', 'ezcloud-support', body.presence_token)
  assert.equal(claims.sub, 'user-1')
  assert.equal(claims.device_uuid, 'device-uuid')
  assert.equal(claims.email, 'user@ezcloud.vn')
  await app.close()
})
