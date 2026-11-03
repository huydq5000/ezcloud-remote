import { jwtVerify, SignJWT } from 'jose'

export type PresenceClaims = {
  sub: string
  name: string
  email: string
  role: 'customer' | 'supporter'
  device_uuid: string
  exp: number
}

export type ConnectClaims = {
  sub: string
  name: string
  ticket_id: string
  peer_id: string
  jti: string
  exp: number
}

function key(secret: string) {
  return new TextEncoder().encode(secret)
}

export async function signPresence(
  secret: string,
  iss: string,
  claims: Omit<PresenceClaims, 'exp'>,
  ttlSeconds = 600,
): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const token = await new SignJWT({
    typ: 'ezcloud-presence',
    name: claims.name,
    email: claims.email,
    role: claims.role,
    device_uuid: claims.device_uuid,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(iss)
    .setExpirationTime(exp)
    .sign(key(secret))
  return { token, exp }
}

export async function signConnect(
  secret: string,
  iss: string,
  claims: Omit<ConnectClaims, 'exp'>,
  ttlSeconds = 60,
): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const token = await new SignJWT({
    typ: 'ezcloud-connect',
    name: claims.name,
    ticket_id: claims.ticket_id,
    peer_id: claims.peer_id,
    jti: claims.jti,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(iss)
    .setExpirationTime(exp)
    .sign(key(secret))
  return { token, exp }
}

async function read(secret: string, iss: string, token: string, typ: string) {
  const { payload } = await jwtVerify(token, key(secret), { issuer: iss })
  if (payload.typ !== typ || typeof payload.sub !== 'string') {
    throw new Error('wrong token type')
  }
  return payload
}

export async function verifyPresence(secret: string, iss: string, token: string): Promise<PresenceClaims> {
  const payload = await read(secret, iss, token, 'ezcloud-presence')
  const role = payload.role === 'supporter' ? 'supporter' : 'customer'
  return {
    sub: payload.sub as string,
    name: String(payload.name ?? ''),
    email: String(payload.email ?? ''),
    role,
    device_uuid: String(payload.device_uuid ?? ''),
    exp: Number(payload.exp ?? 0),
  }
}

export async function verifyConnect(secret: string, iss: string, token: string): Promise<ConnectClaims> {
  const payload = await read(secret, iss, token, 'ezcloud-connect')
  return {
    sub: payload.sub as string,
    name: String(payload.name ?? ''),
    ticket_id: String(payload.ticket_id ?? ''),
    peer_id: String(payload.peer_id ?? ''),
    jti: String(payload.jti ?? ''),
    exp: Number(payload.exp ?? 0),
  }
}
