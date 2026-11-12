# ADR 0003 — Static RBAC policy in the shared kernel

- Status: accepted
- Date: 2026-11-13

## Context

Three roles (admin, staff, member) cover current needs. Permissions are checked by use cases in multiple bounded contexts.

## Decision

Define `PERMISSIONS`, `ROLE_NAMES` and `ROLE_PERMISSIONS` as typed constants in `src/shared/domain/permissions.ts`. Users store role names; permissions are derived. Use cases call `requirePermission(actor, 'x:y')` — the compiler rejects unknown permission strings.

## Consequences

- Policy changes are code-reviewed and versioned; no privilege escalation via data edits.
- Adding a role or permission requires a deploy.
- If tenants/departments need custom roles, migrate to `roles` + `role_permissions` tables behind a `PolicyRepository` port; use cases do not change.
