# Identity Redesign — Plan A (API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md`
**Companion plan:** `docs/superpowers/plans/2026-09-15-identity-redesign-plan-b-ui.md` (frontend; depends on this plan's SDK methods)

**Goal:** Add the five new backend endpoints, two new Zod validators, and five new SDK methods the identity module redesign needs — no Prisma schema changes, no new migrations.

**Architecture:** New route handlers are added inline in `apps/api/src/index.js` next to the existing `/identity/*` routes (matching how every other identity endpoint is already organized in that file). Decision logic that has more than one branch (role-scope checks, protected-role checks, self-lockout checks, upsert-vs-create resolution) is extracted into small pure functions in a new `apps/api/src/lib/identity-memberships.js` module and unit-tested directly — this repo's existing convention (see `apps/api/src/lib/permission-grants.js` + `apps/api/src/services/__tests__/permission-grants.test.js`) is to unit-test extracted pure logic, not the Hono route handlers themselves (there is no HTTP-level test harness for `index.js` anywhere in this codebase); route handlers stay thin glue over Prisma + these helpers and are verified manually per the spec's Verification plan.

**Tech Stack:** Hono, Prisma, Zod (`@runly/validators`), `node:test` + `node:assert/strict`, the existing `@runly/sdk` `request`/`requestBlob` fetch wrapper.

---

## File Structure

- Create: `apps/api/src/lib/identity-memberships.js` — 4 pure helper functions used by the new membership endpoints.
- Create: `apps/api/src/services/__tests__/identity-memberships.test.js` — unit tests for the above.
- Modify: `apps/api/src/index.js` — add 5 new route handlers next to the existing `/identity/*` block, extend `serializeIdentityUser` usage for the single-user endpoint.
- Modify: `packages/validators/src/index.js` — add `createMembershipSchema`, `updateMembershipSchema`.
- Create: `packages/validators/src/__tests__/identity-membership-schemas.test.js`.
- Modify: `packages/sdk/src/index.js` — add `getUser`, `updateMembership`, `createMembership`, `listCompanyOptions`, `listRoleMembers` under the existing `identity` domain.

No Prisma schema or migration changes (confirmed in the spec, Section 11).

---

### Task 1: Pure membership guard helpers

**Files:**
- Create: `apps/api/src/lib/identity-memberships.js`
- Test: `apps/api/src/services/__tests__/identity-memberships.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// apps/api/src/services/__tests__/identity-memberships.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkMembershipRoleScope,
  checkProtectedRoleAssignment,
  checkSelfLockout,
  findExistingMembership,
} from "../../lib/identity-memberships.js";

test("checkMembershipRoleScope allows a company-scoped role matching the membership's company", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: "co-1", membershipCompanyId: "co-1" });
  assert.equal(result.ok, true);
});

test("checkMembershipRoleScope allows a system-wide role (companyId null) for any membership", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: null, membershipCompanyId: "co-1" });
  assert.equal(result.ok, true);
});

test("checkMembershipRoleScope rejects a role scoped to a different company", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: "co-2", membershipCompanyId: "co-1" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /no pertenece a esta empresa/);
});

test("checkMembershipRoleScope is a no-op when no role is being set (roleId omitted)", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: undefined, membershipCompanyId: "co-1" });
  assert.equal(result.ok, true);
});

test("checkProtectedRoleAssignment allows a non-protected role regardless of actor permissions", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "sales.rep",
    protectedKeys: new Set(["runly.admin", "system.admin"]),
    actorCanManageRoles: false,
  });
  assert.equal(result.ok, true);
});

test("checkProtectedRoleAssignment rejects a protected role for an actor without identity.roles.update", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "runly.admin",
    protectedKeys: new Set(["runly.admin", "system.admin"]),
    actorCanManageRoles: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("checkProtectedRoleAssignment allows a protected role for an actor with identity.roles.update", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "system.admin",
    protectedKeys: new Set(["runly.admin", "system.admin"]),
    actorCanManageRoles: true,
  });
  assert.equal(result.ok, true);
});

test("checkProtectedRoleAssignment is case-insensitive and trims the role key", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "  Runly.Admin  ",
    protectedKeys: new Set(["runly.admin"]),
    actorCanManageRoles: false,
  });
  assert.equal(result.ok, false);
});

test("checkSelfLockout allows disabling someone else's membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: false,
    enabledMembershipIds: ["m1", "m2"],
    membershipId: "m1",
    disabling: true,
  });
  assert.equal(result.ok, true);
});

test("checkSelfLockout allows disabling your own non-last membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: true,
    enabledMembershipIds: ["m1", "m2"],
    membershipId: "m1",
    disabling: true,
  });
  assert.equal(result.ok, true);
});

test("checkSelfLockout rejects disabling your own last enabled membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: true,
    enabledMembershipIds: ["m1"],
    membershipId: "m1",
    disabling: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /única empresa/);
});

test("checkSelfLockout is a no-op when the action does not disable the membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: true,
    enabledMembershipIds: ["m1"],
    membershipId: "m1",
    disabling: false,
  });
  assert.equal(result.ok, true);
});

test("findExistingMembership finds a membership for the given company, enabled or not", () => {
  const memberships = [
    { id: "m1", companyId: "co-1", enabled: false },
    { id: "m2", companyId: "co-2", enabled: true },
  ];
  assert.equal(findExistingMembership({ memberships, companyId: "co-1" })?.id, "m1");
  assert.equal(findExistingMembership({ memberships, companyId: "co-2" })?.id, "m2");
});

test("findExistingMembership returns null when the user has no membership for that company", () => {
  const memberships = [{ id: "m1", companyId: "co-1", enabled: true }];
  assert.equal(findExistingMembership({ memberships, companyId: "co-9" }), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/identity-memberships.test.js`
Expected: FAIL — `Cannot find module '../../lib/identity-memberships.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/api/src/lib/identity-memberships.js

// Pure decision-logic helpers for the membership-management endpoints in
// apps/api/src/index.js. Kept side-effect-free and unit-tested directly —
// see apps/api/src/services/__tests__/identity-memberships.test.js.
// Spec: docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md

export function checkMembershipRoleScope({ roleCompanyId, membershipCompanyId }) {
  if (roleCompanyId === undefined) return { ok: true };
  if (roleCompanyId === null) return { ok: true };
  if (roleCompanyId === membershipCompanyId) return { ok: true };
  return {
    ok: false,
    status: 400,
    error: "El rol seleccionado no pertenece a esta empresa.",
  };
}

export function checkProtectedRoleAssignment({ roleKey, protectedKeys, actorCanManageRoles }) {
  const normalizedKey = String(roleKey ?? "").trim().toLowerCase();
  const isProtected = protectedKeys instanceof Set && protectedKeys.has(normalizedKey);
  if (!isProtected || actorCanManageRoles) return { ok: true };
  return {
    ok: false,
    status: 403,
    error: "Asignar el rol Runly Admin o System Admin requiere permisos de gestion de roles.",
  };
}

export function checkSelfLockout({ isActingOnSelf, enabledMembershipIds, membershipId, disabling }) {
  if (!isActingOnSelf || !disabling) return { ok: true };
  const ids = Array.isArray(enabledMembershipIds) ? enabledMembershipIds : [];
  const isOnlyEnabledMembership = ids.length === 1 && ids[0] === membershipId;
  if (!isOnlyEnabledMembership) return { ok: true };
  return {
    ok: false,
    status: 400,
    error: "No puedes deshabilitar el acceso a tu unica empresa habilitada.",
  };
}

export function findExistingMembership({ memberships, companyId }) {
  const list = Array.isArray(memberships) ? memberships : [];
  return list.find((m) => m?.companyId === companyId) ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/identity-memberships.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/identity-memberships.js apps/api/src/services/__tests__/identity-memberships.test.js
git commit -m "feat(identity): add pure guard helpers for membership management"
```

---

### Task 2: Membership Zod validators

**Files:**
- Modify: `packages/validators/src/index.js`
- Test: `packages/validators/src/__tests__/identity-membership-schemas.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// packages/validators/src/__tests__/identity-membership-schemas.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMembershipSchema, updateMembershipSchema } from "../index.js";

test("createMembershipSchema requires a uuid companyId", () => {
  const fail = createMembershipSchema.safeParse({});
  assert.equal(fail.success, false);
  const ok = createMembershipSchema.safeParse({ companyId: "9c6f6b1e-0000-4000-8000-000000000000" });
  assert.equal(ok.success, true);
});

test("createMembershipSchema accepts an optional nullable roleId", () => {
  const withNull = createMembershipSchema.safeParse({
    companyId: "9c6f6b1e-0000-4000-8000-000000000000",
    roleId: null,
  });
  assert.equal(withNull.success, true);
  const withRole = createMembershipSchema.safeParse({
    companyId: "9c6f6b1e-0000-4000-8000-000000000000",
    roleId: "9c6f6b1e-0000-4000-8000-000000000001",
  });
  assert.equal(withRole.success, true);
});

test("createMembershipSchema rejects a non-uuid companyId", () => {
  const fail = createMembershipSchema.safeParse({ companyId: "not-a-uuid" });
  assert.equal(fail.success, false);
});

test("updateMembershipSchema accepts roleId only", () => {
  const ok = updateMembershipSchema.safeParse({ roleId: "9c6f6b1e-0000-4000-8000-000000000000" });
  assert.equal(ok.success, true);
});

test("updateMembershipSchema accepts enabled only", () => {
  const ok = updateMembershipSchema.safeParse({ enabled: false });
  assert.equal(ok.success, true);
});

test("updateMembershipSchema rejects an empty body (neither field present)", () => {
  const fail = updateMembershipSchema.safeParse({});
  assert.equal(fail.success, false);
});

test("updateMembershipSchema accepts a null roleId to clear the role", () => {
  const ok = updateMembershipSchema.safeParse({ roleId: null });
  assert.equal(ok.success, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/validators/src/__tests__/identity-membership-schemas.test.js`
Expected: FAIL — `createMembershipSchema is not a function` / import error (schemas don't exist yet)

- [ ] **Step 3: Add the schemas**

Modify `packages/validators/src/index.js`: insert immediately after the existing `createUserSchema` block (the one ending in `roleId: z.string().uuid().optional(),\n});` shown below), so the new schemas sit next to the identity schema they extend:

```js
export const createUserSchema = z.object({
  firstName: z.string().min(1, "El nombre es obligatorio."),
  lastName: z.string().min(1, "Los apellidos son obligatorios."),
  email: z.string().email("Correo electrónico inválido."),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres."),
  roleId: z.string().uuid().optional(),
});

export const createMembershipSchema = z.object({
  companyId: z.string().uuid("Empresa inválida."),
  roleId: z.string().uuid("Rol inválido.").nullable().optional(),
});

export const updateMembershipSchema = z
  .object({
    roleId: z.string().uuid("Rol inválido.").nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => data.roleId !== undefined || data.enabled !== undefined, {
    message: "Debes enviar roleId o enabled.",
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/validators/src/__tests__/identity-membership-schemas.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/validators/src/index.js packages/validators/src/__tests__/identity-membership-schemas.test.js
git commit -m "feat(validators): add createMembershipSchema and updateMembershipSchema"
```

---

### Task 3: `GET /identity/users/:id`

**Files:**
- Modify: `apps/api/src/index.js`

- [ ] **Step 1: Add the route**

Insert immediately after the closing `);` of the existing `GET /identity/users` list handler (the block starting `app.get(\n  "/identity/users",` and ending with its own `);` right before `app.post(\n  "/identity/users",`):

```js
app.get(
  "/identity/users/:id",
  authMiddleware,
  requirePermission("identity.users.read"),
  async (c) => {
    try {
      const id = c.req.param("id");
      const tenant = c.get("tenantContext");
      if (!(await assertUserInCompany(id, tenant.companyId))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }
      const user = await prisma.userProfile.findUnique({
        where: { id },
        include: {
          memberships: {
            include: { role: true, company: true },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!user) return c.json({ error: "Usuario no encontrado." }, 404);

      const avatarFileIds = user.avatarFileId ? [user.avatarFileId] : [];
      const avatarUrlMap = await buildAvatarUrlMapByFileIds(avatarFileIds);
      const serialized = serializeIdentityUser(user, avatarUrlMap);

      return c.json({
        data: { ...serialized, membershipsTotal: serialized.memberships.length },
      });
    } catch {
      return c.json({ error: "No se pudo cargar el usuario." }, 500);
    }
  },
);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/api/src/index.js`
Expected: no output (valid syntax)

- [ ] **Step 3: Manual verification**

Start the API (`pnpm dev:api`) and, authenticated as a user with `identity.users.read`, run:

```bash
curl -s "http://localhost:4010/identity/users/<a-real-user-id>" -H "Authorization: Bearer $RUNLY_TOKEN" | head -c 500
```

Expected: `{"data":{"id":"...","memberships":[...],"membershipsTotal":N,...}}` including any disabled memberships, ordered oldest-first.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(identity): add GET /identity/users/:id single-record endpoint"
```

---

### Task 4: `PATCH /identity/users/:id/memberships/:membershipId`

**Files:**
- Modify: `apps/api/src/index.js`

- [ ] **Step 1: Add the import**

Modify the existing `import { ... } from "@runly/validators"` block near the top of the file (the one already importing `createUserSchema`) to also import `updateMembershipSchema` and `createMembershipSchema`:

```js
import {
  createMembershipSchema,
  createUserSchema,
  hrCatalogCreateSchema,
  hrCatalogEnabledSchema,
  hrCatalogUpdateSchema,
  hrEmployeeCreateSchema,
  hrEmployeeEnabledSchema,
  hrEmployeeUpdateSchema,
  moduleInstallSchema,
  setupInitializeSchema,
  updateMembershipSchema,
} from "@runly/validators";
```

Add the import for the new pure helpers next to the other local imports at the top of the file:

```js
import {
  checkMembershipRoleScope,
  checkProtectedRoleAssignment,
  checkSelfLockout,
  findExistingMembership,
} from "./lib/identity-memberships.js";
```

- [ ] **Step 2: Add the route**

Insert this route immediately after Task 3's `GET /identity/users/:id` handler:

```js
app.patch(
  "/identity/users/:id/memberships/:membershipId",
  authMiddleware,
  requirePermission("identity.users.update"),
  async (c) => {
    try {
      const id = c.req.param("id");
      const membershipId = c.req.param("membershipId");
      const tenant = c.get("tenantContext");
      const context = c.get("userContext");
      if (!(await assertUserInCompany(id, tenant.companyId))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }

      const body = await c.req.json();
      const fields = updateMembershipSchema.parse(body);

      const membership = await prisma.membership.findUnique({
        where: { id: membershipId },
        include: { role: { select: { key: true } } },
      });
      if (!membership || membership.userId !== id) {
        return c.json({ error: "La membresia no corresponde a este usuario." }, 400);
      }

      if (fields.roleId !== undefined && fields.roleId !== null) {
        const targetRole = await prisma.role.findUnique({
          where: { id: fields.roleId },
          select: { key: true, companyId: true },
        });
        if (!targetRole) return c.json({ error: "Rol no encontrado." }, 404);

        const scopeCheck = checkMembershipRoleScope({
          roleCompanyId: targetRole.companyId,
          membershipCompanyId: membership.companyId,
        });
        if (!scopeCheck.ok) return c.json({ error: scopeCheck.error }, scopeCheck.status);

        const protectedCheck = checkProtectedRoleAssignment({
          roleKey: targetRole.key,
          protectedKeys: PROTECTED_IDENTITY_ROLE_KEYS,
          actorCanManageRoles: Boolean(
            context?.isAdmin || context?.permissionSet?.has("identity.roles.update"),
          ),
        });
        if (!protectedCheck.ok) return c.json({ error: protectedCheck.error }, protectedCheck.status);
      }

      if (fields.enabled === false) {
        const enabledMemberships = await prisma.membership.findMany({
          where: { userId: id, enabled: true },
          select: { id: true },
        });
        const lockoutCheck = checkSelfLockout({
          isActingOnSelf: id === context?.profile?.id,
          enabledMembershipIds: enabledMemberships.map((m) => m.id),
          membershipId,
          disabling: true,
        });
        if (!lockoutCheck.ok) return c.json({ error: lockoutCheck.error }, lockoutCheck.status);
      }

      const before = { roleId: membership.roleId, enabled: membership.enabled };
      const updated = await prisma.membership.update({
        where: { id: membershipId },
        data: {
          ...(fields.roleId !== undefined ? { roleId: fields.roleId } : {}),
          ...(fields.enabled !== undefined ? { enabled: fields.enabled } : {}),
        },
        include: { role: true, company: true },
      });

      cacheDelByPrefix("user_ctx:");
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.membership.update",
        severity: "info",
        entityType: "Membership",
        entityId: membershipId,
        summary: `${actorName} actualizo la membresia de ${updated.company?.name ?? "una empresa"}`,
      });

      return c.json({
        data: {
          id: updated.id,
          companyId: updated.companyId,
          companyName: updated.company?.name ?? null,
          roleId: updated.roleId,
          roleKey: updated.role?.key ?? null,
          roleName: updated.role?.name ?? null,
          enabled: updated.enabled,
        },
        before,
      });
    } catch (err) {
      if (err?.name === "ZodError") {
        return c.json({ error: err.errors[0]?.message ?? "Datos inválidos." }, 400);
      }
      return c.json({ error: "No se pudo actualizar la membresia." }, 500);
    }
  },
);
```

- [ ] **Step 3: Verify syntax**

Run: `node --check apps/api/src/index.js`
Expected: no output

- [ ] **Step 4: Manual verification**

As a user with `identity.users.update`, run each of these against a seeded test user/membership and confirm the documented status codes from the spec's Section 12/23:

```bash
# happy path: disable a membership that isn't the user's last one
curl -s -X PATCH "http://localhost:4010/identity/users/<userId>/memberships/<membershipId>" \
  -H "Authorization: Bearer $RUNLY_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

Expected: `200 { "data": { ..., "enabled": false } }`. Repeat against your own last enabled membership and confirm `400`; repeat with a `roleId` belonging to a different company and confirm `400`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(identity): add PATCH /identity/users/:id/memberships/:membershipId"
```

---

### Task 5: `POST /identity/users/:id/memberships`

**Files:**
- Modify: `apps/api/src/index.js`

- [ ] **Step 1: Add the route**

Insert immediately after Task 4's route:

```js
app.post(
  "/identity/users/:id/memberships",
  authMiddleware,
  requirePermission("identity.users.update"),
  async (c) => {
    try {
      const id = c.req.param("id");
      const tenant = c.get("tenantContext");
      const context = c.get("userContext");
      if (!(await assertUserInCompany(id, tenant.companyId))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }

      const body = await c.req.json();
      const fields = createMembershipSchema.parse(body);

      const company = await prisma.company.findUnique({
        where: { id: fields.companyId },
        select: { id: true },
      });
      if (!company) return c.json({ error: "Empresa no encontrada." }, 404);

      let targetRole = null;
      if (fields.roleId !== undefined && fields.roleId !== null) {
        targetRole = await prisma.role.findUnique({
          where: { id: fields.roleId },
          select: { key: true, companyId: true },
        });
        if (!targetRole) return c.json({ error: "Rol no encontrado." }, 404);

        const scopeCheck = checkMembershipRoleScope({
          roleCompanyId: targetRole.companyId,
          membershipCompanyId: fields.companyId,
        });
        if (!scopeCheck.ok) return c.json({ error: scopeCheck.error }, scopeCheck.status);

        const protectedCheck = checkProtectedRoleAssignment({
          roleKey: targetRole.key,
          protectedKeys: PROTECTED_IDENTITY_ROLE_KEYS,
          actorCanManageRoles: Boolean(
            context?.isAdmin || context?.permissionSet?.has("identity.roles.update"),
          ),
        });
        if (!protectedCheck.ok) return c.json({ error: protectedCheck.error }, protectedCheck.status);
      }

      const existingMemberships = await prisma.membership.findMany({
        where: { userId: id, companyId: fields.companyId },
      });
      const existing = findExistingMembership({
        memberships: existingMemberships,
        companyId: fields.companyId,
      });

      if (existing?.enabled) {
        return c.json({ error: "El usuario ya tiene acceso a esta empresa." }, 400);
      }

      const membership = existing
        ? await prisma.membership.update({
            where: { id: existing.id },
            data: {
              enabled: true,
              roleId: fields.roleId !== undefined ? fields.roleId : existing.roleId,
            },
            include: { role: true, company: true },
          })
        : await prisma.membership.create({
            data: { userId: id, companyId: fields.companyId, roleId: fields.roleId ?? null },
            include: { role: true, company: true },
          });

      cacheDelByPrefix("user_ctx:");
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.membership.create",
        severity: "success",
        entityType: "Membership",
        entityId: membership.id,
        summary: `${actorName} asigno a ${membership.company?.name ?? "una empresa"} al usuario`,
      });

      return c.json(
        {
          data: {
            id: membership.id,
            companyId: membership.companyId,
            companyName: membership.company?.name ?? null,
            roleId: membership.roleId,
            roleKey: membership.role?.key ?? null,
            roleName: membership.role?.name ?? null,
            enabled: membership.enabled,
          },
        },
        existing ? 200 : 201,
      );
    } catch (err) {
      if (err?.name === "ZodError") {
        return c.json({ error: err.errors[0]?.message ?? "Datos inválidos." }, 400);
      }
      return c.json({ error: "No se pudo asignar la empresa." }, 500);
    }
  },
);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/api/src/index.js`
Expected: no output

- [ ] **Step 3: Manual verification**

```bash
curl -s -X POST "http://localhost:4010/identity/users/<userId>/memberships" \
  -H "Authorization: Bearer $RUNLY_TOKEN" -H "Content-Type: application/json" \
  -d '{"companyId":"<companyId>","roleId":null}'
```

Expected: `201` on first assignment; re-running the exact same request returns `400` ("El usuario ya tiene acceso a esta empresa."); disabling that membership first (via Task 4's endpoint) and re-running returns `200` (reactivation).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(identity): add POST /identity/users/:id/memberships"
```

---

### Task 6: `GET /identity/companies-options`

**Files:**
- Modify: `apps/api/src/index.js`

- [ ] **Step 1: Add the route**

Insert immediately after Task 5's route:

```js
app.get(
  "/identity/companies-options",
  authMiddleware,
  requirePermission("identity.users.update"),
  async (c) => {
    try {
      const companies = await prisma.company.findMany({
        where: { enabled: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return c.json({ data: companies });
    } catch {
      return c.json({ error: "No se pudieron cargar las empresas." }, 500);
    }
  },
);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/api/src/index.js`
Expected: no output

- [ ] **Step 3: Manual verification**

```bash
curl -s "http://localhost:4010/identity/companies-options" -H "Authorization: Bearer $RUNLY_TOKEN"
```

Expected: `{"data":[{"id":"...","name":"..."}, ...]}` ordered by name.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(identity): add GET /identity/companies-options"
```

---

### Task 7: `GET /identity/roles/:id/members`

**Files:**
- Modify: `apps/api/src/index.js`

- [ ] **Step 1: Add the route**

Insert immediately after the existing `PATCH /identity/roles/:id/permissions` handler (end of the roles route block, right before the `app.get(\n  "/identity/users",` list handler):

```js
app.get(
  "/identity/roles/:id/members",
  authMiddleware,
  requirePermission("identity.roles.read"),
  async (c) => {
    try {
      const id = c.req.param("id");
      const tenant = c.get("tenantContext");
      const where = {
        roleId: id,
        enabled: true,
        userProfile: tenant.isSystemAdmin ? {} : { memberships: { some: { enabled: true, companyId: tenant.companyId } } },
      };
      const memberships = await prisma.membership.findMany({
        where,
        include: {
          userProfile: { select: { id: true, displayName: true, email: true, avatarFileId: true } },
          company: { select: { name: true } },
        },
        orderBy: { userProfile: { displayName: "asc" } },
      });

      const avatarFileIds = memberships
        .map((m) => m.userProfile?.avatarFileId)
        .filter(Boolean);
      const avatarUrlMap = await buildAvatarUrlMapByFileIds(avatarFileIds);

      const seen = new Set();
      const data = [];
      for (const m of memberships) {
        const user = m.userProfile;
        if (!user || seen.has(user.id)) continue;
        seen.add(user.id);
        data.push({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          avatarUrl: user.avatarFileId ? (avatarUrlMap.get(user.avatarFileId) ?? null) : null,
          companyName: m.company?.name ?? null,
        });
      }

      return c.json({ data });
    } catch {
      return c.json({ error: "No se pudieron cargar los usuarios del rol." }, 500);
    }
  },
);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/api/src/index.js`
Expected: no output

- [ ] **Step 3: Manual verification**

```bash
curl -s "http://localhost:4010/identity/roles/<roleId>/members" -H "Authorization: Bearer $RUNLY_TOKEN"
```

Expected: `{"data":[{"id":"...","displayName":"...","email":"...","avatarUrl":null|"...","companyName":"..."}]}`, one row per distinct user holding the role (deduped across companies).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(identity): add GET /identity/roles/:id/members"
```

---

### Task 8: SDK methods

**Files:**
- Modify: `packages/sdk/src/index.js`

- [ ] **Step 1: Add the methods**

Modify the `identity: { ... }` domain object: insert the following immediately after the existing `listUsers` method and before `updateUser`:

```js
    identity: {
      listUsers: (token, query = null) =>
        request(`/identity/users${toQueryString(query)}`, {
          headers: withAuthHeaders(token),
        }),
      getUser: (id, token) =>
        request(`/identity/users/${encodeURIComponent(id)}`, {
          headers: withAuthHeaders(token),
        }),
      updateMembership: (userId, membershipId, data, token) =>
        request(
          `/identity/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(membershipId)}`,
          {
            method: "PATCH",
            headers: withAuthHeaders(token),
            body: JSON.stringify(data),
          },
        ),
      createMembership: (userId, data, token) =>
        request(`/identity/users/${encodeURIComponent(userId)}/memberships`, {
          method: "POST",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
      listCompanyOptions: (token) =>
        request("/identity/companies-options", { headers: withAuthHeaders(token) }),
      listRoleMembers: (roleId, token) =>
        request(`/identity/roles/${encodeURIComponent(roleId)}/members`, {
          headers: withAuthHeaders(token),
        }),
      updateUser: (id, data, token) =>
        request(`/identity/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: withAuthHeaders(token),
          body: JSON.stringify(data),
        }),
```

(The rest of the `identity` object — `setUsersEnabled` through `deleteRole` — is unchanged; this step only inserts the 5 new methods between `listUsers` and the existing `updateUser`.)

- [ ] **Step 2: Verify syntax**

Run: `node --check packages/sdk/src/index.js`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/index.js
git commit -m "feat(sdk): add identity membership and single-user SDK methods"
```

---

### Task 9: Plan A verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: no errors in `apps/api`, `packages/sdk`, `packages/validators`.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new violations.

- [ ] **Step 3: Full test run for the files this plan touched**

Run: `node --test apps/api/src/services/__tests__/identity-memberships.test.js packages/validators/src/__tests__/identity-membership-schemas.test.js`
Expected: all tests PASS.

- [ ] **Step 4: Regression check on an unrelated existing test that imports `@runly/validators`**

Run: `node --test packages/validators/src/__tests__/module-lifecycle-schemas.test.js`
Expected: still PASS (confirms the new schemas didn't break existing exports).

- [ ] **Step 5: Manual smoke test of all 5 new endpoints**

Re-run the curl commands from Tasks 3–7 against a real dev API instance and confirm every documented status code and payload shape from the spec's Sections 12 and 26.

- [ ] **Step 6: Commit** (only if any fixes were needed in the steps above; otherwise skip)

```bash
git add -A
git commit -m "fix(identity): address Plan A verification findings"
```

---

## Plan A complete

Once all 9 tasks are checked off and Task 9's verification passes, Plan A is done. Plan B (`docs/superpowers/plans/2026-09-15-identity-redesign-plan-b-ui.md`) depends on the SDK methods added in Task 8 and can proceed independently of Plan A's manual-verification steps as long as the routes exist and respond with the documented shapes.
