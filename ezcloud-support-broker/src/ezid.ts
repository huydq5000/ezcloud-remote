import type { EzidUser } from './app.ts'

type UserInfo = {
  sub?: unknown
  email?: unknown
  name?: unknown
  given_name?: unknown
  family_name?: unknown
  preferred_username?: unknown
  role?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fullName(body: UserInfo): string {
  const name = text(body.name)
  if (name) return name
  const combined = [text(body.family_name), text(body.given_name)].filter(Boolean).join(' ')
  return combined || text(body.preferred_username) || text(body.email)
}

export function ezidVerifier(issuer: string) {
  const userinfo = `${issuer.replace(/\/$/, '')}/connect/userinfo`
  return async (token: string): Promise<EzidUser | null> => {
    if (!token) {
      console.error('ezid userinfo missing bearer')
      return null
    }
    let response: Response
    try {
      response = await fetch(userinfo, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      console.error('ezid userinfo unreachable')
      return null
    }
    if (!response.ok) {
      console.error('ezid userinfo rejected', response.status)
      return null
    }
    const body = (await response.json()) as UserInfo
    if (typeof body.sub !== 'string' || typeof body.email !== 'string' || body.email === '') {
      console.error('ezid userinfo missing sub or email')
      return null
    }
    const raw = body.role
    const roles = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []
    return {
      sub: body.sub,
      email: body.email,
      name: fullName(body),
      roles,
    }
  }
}
