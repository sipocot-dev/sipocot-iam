/**
 * Shared kernel: the permission catalogue used by every bounded context.
 * Format: `<resource>:<action>`.
 */
export const PERMISSIONS = [
  'users:read',
  'users:write',
  'roles:assign',
  'sessions:read_any',
  'sessions:revoke_any',
  'files:write',
  'files:read_any',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_NAMES = ['admin', 'staff', 'member'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Static RBAC policy. Changing it is a code review, not a runtime mutation. */
export const ROLE_PERMISSIONS: Readonly<Record<RoleName, readonly Permission[]>> = {
  admin: PERMISSIONS,
  staff: ['users:read', 'sessions:read_any', 'files:write', 'files:read_any', 'audit:read'],
  member: ['files:write'],
};

export const isRoleName = (value: string): value is RoleName => (ROLE_NAMES as readonly string[]).includes(value);

export const permissionsFor = (roles: Iterable<RoleName>): ReadonlySet<Permission> => {
  const out = new Set<Permission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role]) out.add(p);
  return out;
};
