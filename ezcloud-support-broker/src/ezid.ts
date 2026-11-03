import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { EzidUser } from './app.ts'

export function ezidVerifier(issuer: string, audience: string, _supporterRoles: string[]) {
  const jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration/jwks`))
  return async (token: string): Promise<EzidUser | null> => {
    if (!token) return null
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: audience || undefined,
      })
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email === '') {
        return null
      }
      const raw = payload.role
      const roles = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []
      return {
        sub: payload.sub,
        email: payload.email,
        name: String(payload.name ?? payload.preferred_username ?? payload.email),
        roles,
      }
    } catch {
      return null
    }
  }
}
