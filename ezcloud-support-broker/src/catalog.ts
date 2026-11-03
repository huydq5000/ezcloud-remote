export type Permission = {
  code: string
  name: string
}

export const PERMISSIONS: Permission[] = [
  { code: 'support.read', name: 'View support queue and devices' },
  { code: 'support.change', name: 'Close another person\'s support request' },
  // support.config is reserved for the settings screen, which is not built yet.
  { code: 'support.config', name: 'Change broker settings' },
]

export const ROLES = [
  { name: 'Support Viewer', permissions: ['support.read'] },
  { name: 'Support Operator', permissions: ['support.read', 'support.change'] },
  { name: 'Support Admin', permissions: ['support.read', 'support.change', 'support.config'] },
]

export type RouteAccess =
  | { method: string; path: string; access: 'public' | 'desktop' | 'login' | 'break-glass' }
  | { method: string; path: string; access: 'acl'; permission: string }

export const ROUTE_TABLE: RouteAccess[] = [
  { method: 'GET', path: '/health', access: 'public' },
  { method: 'POST', path: '/v1/sessions', access: 'desktop' },
  { method: 'POST', path: '/v1/sessions/refresh', access: 'desktop' },
  { method: 'DELETE', path: '/v1/sessions/current', access: 'desktop' },
  { method: 'POST', path: '/v1/tickets', access: 'desktop' },
  { method: 'GET', path: '/v1/tickets', access: 'desktop' },
  { method: 'POST', path: '/v1/tickets/:ticket_id/connect', access: 'desktop' },
  { method: 'POST', path: '/v1/tickets/:ticket_id/close', access: 'desktop' },
  { method: 'GET', path: '/admin', access: 'public' },
  { method: 'GET', path: '/admin/me', access: 'login' },
  { method: 'GET', path: '/admin/acl', access: 'public' },
  { method: 'GET', path: '/admin/acl/settings', access: 'break-glass' },
  { method: 'PUT', path: '/admin/acl', access: 'break-glass' },
  { method: 'POST', path: '/admin/acl/push', access: 'break-glass' },
  { method: 'GET', path: '/admin/tickets', access: 'acl', permission: 'support.read' },
  { method: 'GET', path: '/admin/devices', access: 'acl', permission: 'support.read' },
  { method: 'POST', path: '/admin/tickets/:id/close', access: 'acl', permission: 'support.change' },
]

const permissionCodes = new Set(PERMISSIONS.map((item) => item.code))

export function classify(method: string, path: string): RouteAccess | undefined {
  return ROUTE_TABLE.find((route) => route.method === method && route.path === path)
}

export type AclGrant = { code: string; scope: { type: string; id: string } | null }
export type AclPerms = { status: string; permissions: AclGrant[]; appAdmins?: string[] }

export function allows(perms: AclPerms | undefined, code: string): boolean {
  if (!perms || perms.status !== 'ACTIVE') return false
  const grants = perms.permissions.filter((item) => item.code === code)
  if (grants.length === 0) return false
  // None of the current permissions declare a resourceType, so any grant counts.
  if (!permissionCodes.has(code)) return false
  return true
}
