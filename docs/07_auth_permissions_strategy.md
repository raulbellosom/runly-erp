# Runly ERP — Authentication and Permissions Strategy

## Two-layer architecture

| Concern | Owner |
|---|---|
| Email/password login | Supabase Auth |
| Session tokens (JWT) | Supabase Auth |
| Password recovery | Supabase Auth |
| User profiles | Runly API + Prisma |
| Companies + memberships | Runly API + Prisma |
| Roles + permissions | Runly API + Prisma |
| Module access control | Runly API + Prisma |

## Auth flow

1. React calls `supabase.auth.signInWithPassword({ email, password })` (anon key)
2. Supabase returns a signed JWT
3. Supabase client stores session and handles refresh automatically
4. Every `@runly/sdk` request includes `Authorization: Bearer <jwt>`
5. Runly API calls `supabaseAdmin.auth.getUser(jwt)` to verify (service role key)
6. API loads UserProfile by `authUserId` → Membership → Role → Permissions
7. Route handler receives verified user context

## RBAC data model

```
UserProfile (authUserId → Supabase auth.users.id)
  ↓
Membership  (UserProfile ↔ Company ↔ Role)
  ↓
Role
  ↓
RolePermission  (Role ↔ Permission)
  ↓
Permission  (key: 'contacts.contacts.read', moduleId, etc.)
```

## User vs. HR employee

```
Supabase auth.users
  ↓ (authUserId)
UserProfile          ← someone who can log in to Runly ERP
  ↓ (optional)
HREmployee           ← HR/business record (runly.hr module)
```

- A `UserProfile` is a Runly identity with login access.
- An `HREmployee` is a business record that may or may not have a login.
- Employees without user accounts are valid (contractors, archived staff).
- System users without employee records are valid (IT admins, service accounts).

`HREmployee` is part of the `runly.hr` module. `UserProfile` exists today.

## Permission middleware (Phase 4 implementation)

## RBAC/ACL v1 (server-authoritative)

Current behavior (v1):

- API is the source of truth for authorization.
- Admin bypass only for roles `runly.admin` (or the legacy `atlas.admin`) and `system.admin`.
- Every authenticated active user gets base permission `profile.self.read`.
- If a permission is not explicitly granted, access is denied.

Granular convention (current standard):

- `module.access` controls module runtime visibility.
- `module.feature.read|create|update|delete` controls feature operations.
- Non-CRUD permissions are explicit and exceptional.

Granular-only policy:

- API guards validate only granular permissions directly.
- Legacy fallback and legacy role mappings are removed.

Standard middleware in `apps/api/src/index.js`:

- `requirePermission(permissionKey)`
- `requireAnyPermission(permissionKeys[])`
- `requireModuleAccess(moduleKey)`

Runtime exposure is filtered by permissions:

- `GET /runtime/modules` returns only modules allowed by `manifest.acl.module`.
- Navigation inside each module is filtered by `navigation[].permissionKey`.
- `GET /blueprints` is filtered by module access.
- `GET /modules` is administrative and requires `core.modules.read`.

Operational verification:

- `pnpm rbac:verify-catalog` must return `missing_in_catalog = 0` and
  `extra_in_catalog = 0`.

Profile access is granular:

- `GET /profile/me` -> `profile.self.read`
- `PUT /profile/me` -> `profile.self.update`
- `POST /profile/me/avatar` -> `profile.avatar.update`
- `POST /profile/me/password` -> `profile.password.update`

```js
// apps/api/src/middleware/require-permission.js
export function requirePermission(permissionKey) {
  return async (c, next) => {
    const jwt = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!jwt) return c.json({ error: 'Unauthorized' }, 401)

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(jwt)
    if (error || !user) return c.json({ error: 'Unauthorized' }, 401)

    const profile = await prisma.userProfile.findUnique({
      where: { authUserId: user.id },
      include: {
        memberships: {
          where: { enabled: true },
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } }
              }
            }
          }
        }
      }
    })

    if (!profile || !profile.enabled) return c.json({ error: 'Forbidden' }, 403)

    const has = profile.memberships.some(m =>
      m.role.permissions.some(rp => rp.permission.key === permissionKey)
    )
    if (!has) return c.json({ error: 'Forbidden' }, 403)

    c.set('user', profile)
    await next()
  }
}
```

Usage in routes (Phase 4+):
```js
app.get('/contacts', requirePermission('contacts.contacts.read'), async (c) => { ... })
```

Current granular-style examples:
```js
app.get('/finance/accounts', requirePermission('finance.accounts.read'), async (c) => { ... })
app.post('/finance/accounts', requirePermission('finance.accounts.create'), async (c) => { ... })
app.get('/runtime/modules', requirePermission('core.access'), async (c) => { ... })
```

## Supabase Auth configuration (in Studio)

Navigate to https://studio.supabase.example.com → Authentication:
- Enable Email provider (email + password)
- JWT secret must match `JWT_SECRET` in `.env`
- Configure SMTP for password recovery emails
