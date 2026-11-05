import { buildApp } from './app.ts'
import { ezidVerifier } from './ezid.ts'

const issuer = process.env.EZID_ISSUER ?? 'https://id.ezcloud.vn'
const supporterRoles = (process.env.EZID_SUPPORTER_ROLES ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const secret = process.env.EZCLOUD_JWT_SECRET ?? ''
if (!secret) {
  console.error('EZCLOUD_JWT_SECRET is required')
  process.exit(1)
}

const app = await buildApp({
  databasePath: process.env.DATABASE_PATH ?? './support.sqlite',
  jwtSecret: secret,
  jwtIss: process.env.EZCLOUD_JWT_ISS ?? 'ezcloud-support',
  supporterRoles,
  verifyEzid: ezidVerifier(issuer),
  acl: {
    mode: (process.env.ACL_MODE as 'off' | 'shadow' | 'enforce') || 'off',
    baseUrl: process.env.ACL_BASE_URL ?? '',
    apiKey: process.env.ACL_API_KEY ?? '',
    fetchImpl: fetch,
  },
  settingsKey: process.env.SETTINGS_ENC_KEY ?? '',
  breakGlassEmails: (process.env.ACL_BREAK_GLASS_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
})

const listen = process.env.LISTEN_ADDR ?? '127.0.0.1:8080'
const [host, portText] = listen.split(':')
await app.listen({ host, port: Number(portText ?? 8080) })
