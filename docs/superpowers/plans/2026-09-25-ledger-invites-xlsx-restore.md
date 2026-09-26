# Ledger Invites/XLSX/Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three gaps described in `docs/superpowers/specs/2026-09-25-ledger-invites-xlsx-restore-design.md`: pending accept/reject invitations for `runly.ledger` groups and shared accounts, XLSX support in the manual import wizard, and a restore UI for disabled movements and categories.

**Architecture:** No schema/Prisma changes. Backend changes are additive functions in the existing `group-service.js`, `collaboration-service.js`, `ledger-service.js`, `categories-service.js`, and their route files, all reusing the existing `enabled`/`status` columns. Frontend changes touch `MembershipsScreen.jsx`, `ImportWizard.jsx`, `AccountScreen.jsx`, `CategoriesScreen.jsx`, add one new component (`DeletedTransactionsSheet.jsx`) and one new hook (`useLedgerPendingInvitesCount.js`), and extend `@runly/ui`'s `ModuleSidebar.jsx` with a generic nav-badge mechanism.

**Tech Stack:** Node.js + Hono + Prisma `$queryRaw` (backend), React + TanStack Query + `@runly/ui` (frontend), Node's built-in `node:test` runner.

---

## Phase A — Pending invitations (groups + direct account shares)

### Task 1: `group-service.js` — invites create a `pending` membership, not `active`

**Files:**
- Modify: `apps/api/src/routes/ledger/group-service.js:173-220` (`inviteMember`)
- Test: `apps/api/src/routes/ledger/__tests__/group-service.test.js`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/routes/ledger/__tests__/group-service.test.js`, inside the `describe('group-service', ...)` block, after the existing `inviteMember` test:

```js
  it('inviteMember creates a pending membership, not an immediately active one', async () => {
    const groupRow = {
      id: GROUP_ID,
      name: 'Grupo Test',
      company_id: COMPANY_ID,
      created_by: OTHER_ID,
      role: 'admin',
      status: 'active',
    }
    let insertStrings = null

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_group g')) return [groupRow]
      if (sqlContains(strings, 'display_name')) return [{ display_name: 'Test Actor' }]
      if (sqlContains(strings, 'insert into ledger_group_member')) {
        insertStrings = strings
        return []
      }
      return []
    })

    const service = createGroupService({ prisma })
    await service.inviteMember({
      companyId: COMPANY_ID,
      groupId: GROUP_ID,
      actorId: ACTOR_ID,
      actorName: 'Test Actor',
      data: { user_id: TARGET_ID, role: 'viewer' },
    })

    assert.ok(insertStrings, 'expected an INSERT INTO ledger_group_member call')
    assert.ok(sqlContains(insertStrings, "'pending'"), 'a fresh invite must insert status pending')
    assert.ok(sqlContains(insertStrings, 'case when'), 'conflict update must preserve an already-active membership')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/ledger/__tests__/group-service.test.js`
Expected: FAIL — the current INSERT still writes `'active'` literally and has no `CASE WHEN` clause.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/ledger/group-service.js`, replace the `inviteMember` INSERT block (currently around line 182-188):

```js
    try {
      await prisma.$queryRaw`
        INSERT INTO ledger_group_member (group_id, user_id, role, invited_by, status)
        VALUES (${groupId}::uuid, ${targetUserId}::uuid, ${role}, ${actorId}::uuid, 'active')
        ON CONFLICT (group_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, status = 'active', invited_by = EXCLUDED.invited_by, invited_at = NOW()
      `
    } catch (err) {
```

with:

```js
    try {
      await prisma.$queryRaw`
        INSERT INTO ledger_group_member (group_id, user_id, role, invited_by, status)
        VALUES (${groupId}::uuid, ${targetUserId}::uuid, ${role}, ${actorId}::uuid, 'pending')
        ON CONFLICT (group_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, invited_at = NOW(),
              status = CASE WHEN ledger_group_member.status = 'active' THEN 'active' ELSE 'pending' END
      `
    } catch (err) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/group-service.test.js`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ledger/group-service.js apps/api/src/routes/ledger/__tests__/group-service.test.js
git commit -m "feat(ledger): group invites create a pending membership instead of instant access"
```

---

### Task 2: `collaboration-service.js` — direct account invites also create `pending`

**Files:**
- Modify: `apps/api/src/routes/ledger/collaboration-service.js:67-116` (`inviteAccountMember`)
- Test: `apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`, inside `describe('collaboration-service', ...)`:

```js
  it('inviteAccountMember creates a pending membership, not an immediately active one', async () => {
    const accountRow = {
      id: ACCOUNT_ID,
      name: 'Cuenta Test',
      company_id: COMPANY_ID,
      owner_id: ACTOR_ID,
      group_id: null,
      enabled: true,
    }
    let insertStrings = null

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_account')) return [accountRow]
      if (sqlContains(strings, 'insert into ledger_account_member')) {
        insertStrings = strings
        return []
      }
      return []
    })

    const service = createCollaborationService({ prisma })
    await service.inviteAccountMember({
      companyId: COMPANY_ID,
      accountId: ACCOUNT_ID,
      actorId: ACTOR_ID,
      actorName: 'Test Actor',
      data: { user_id: TARGET_ID, role: 'viewer' },
    })

    assert.ok(insertStrings, 'expected an INSERT INTO ledger_account_member call')
    assert.ok(sqlContains(insertStrings, "'pending'"), 'a fresh invite must insert status pending')
    assert.ok(sqlContains(insertStrings, 'case when'), 'conflict update must preserve an already-active membership')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`
Expected: FAIL — current INSERT writes `'active'` literally.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/ledger/collaboration-service.js`, replace the `inviteAccountMember` INSERT block (currently around line 79-84):

```js
    try {
      await prisma.$queryRaw`
        INSERT INTO ledger_account_member (account_id, user_id, role, invited_by, status)
        VALUES (${accountId}::uuid, ${targetUserId}::uuid, ${role}, ${actorId}::uuid, 'active')
        ON CONFLICT (account_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, status = 'active', invited_by = EXCLUDED.invited_by, invited_at = NOW()
      `
    } catch (err) {
```

with:

```js
    try {
      await prisma.$queryRaw`
        INSERT INTO ledger_account_member (account_id, user_id, role, invited_by, status)
        VALUES (${accountId}::uuid, ${targetUserId}::uuid, ${role}, ${actorId}::uuid, 'pending')
        ON CONFLICT (account_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, invited_at = NOW(),
              status = CASE WHEN ledger_account_member.status = 'active' THEN 'active' ELSE 'pending' END
      `
    } catch (err) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ledger/collaboration-service.js apps/api/src/routes/ledger/__tests__/collaboration-service.test.js
git commit -m "feat(ledger): direct account invites create a pending membership instead of instant access"
```

---

### Task 3: `collaboration-service.js` — add `acceptGroupInvitation` and `acceptAccountInvitation`

**Files:**
- Modify: `apps/api/src/routes/ledger/collaboration-service.js:216-255` (add next to the existing reject functions, extend the `return { ... }` export block)
- Test: `apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`:

```js
  it('acceptGroupInvitation activates a pending group membership', async () => {
    const memberRow = { group_id: GROUP_ID, user_id: ACTOR_ID, role: 'viewer', status: 'active' }
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_group_member')) return [memberRow]
      return []
    })
    const service = createCollaborationService({ prisma })
    const result = await service.acceptGroupInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, groupId: GROUP_ID })
    assert.deepEqual(result, { ok: true })
  })

  it('acceptGroupInvitation throws 404 when there is no pending invitation', async () => {
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_group_member')) return []
      return []
    })
    const service = createCollaborationService({ prisma })
    await assert.rejects(
      () => service.acceptGroupInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, groupId: GROUP_ID }),
      (err) => {
        assert.ok(err instanceof CollaborationServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('acceptAccountInvitation activates a pending account membership', async () => {
    const memberRow = { account_id: ACCOUNT_ID, user_id: ACTOR_ID, role: 'viewer', status: 'active' }
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_account_member')) return [memberRow]
      return []
    })
    const service = createCollaborationService({ prisma })
    const result = await service.acceptAccountInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID })
    assert.deepEqual(result, { ok: true })
  })

  it('acceptAccountInvitation throws 404 when there is no pending invitation', async () => {
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_account_member')) return []
      return []
    })
    const service = createCollaborationService({ prisma })
    await assert.rejects(
      () => service.acceptAccountInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID }),
      (err) => {
        assert.ok(err instanceof CollaborationServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`
Expected: FAIL with `service.acceptGroupInvitation is not a function` (and the account equivalent).

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/ledger/collaboration-service.js`, add these two functions immediately after `rejectAccountInvitation` (currently ends at line 242, right before the `return { ... }` block):

```js

  async function acceptGroupInvitation({ companyId, actorId, groupId }) {
    const rows = await prisma.$queryRaw`
      UPDATE ledger_group_member
      SET status = 'active'
      WHERE group_id = ${groupId}::uuid AND user_id = ${actorId}::uuid AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM ledger_group WHERE id = ${groupId}::uuid AND company_id = ${companyId}::uuid
        )
      RETURNING *
    `
    if (!firstRow(rows)) throw new CollaborationServiceError('Invitación no encontrada.', 404)
    return { ok: true }
  }

  async function acceptAccountInvitation({ companyId, actorId, accountId }) {
    const rows = await prisma.$queryRaw`
      UPDATE ledger_account_member
      SET status = 'active'
      WHERE account_id = ${accountId}::uuid AND user_id = ${actorId}::uuid AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM ledger_account WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid
        )
      RETURNING *
    `
    if (!firstRow(rows)) throw new CollaborationServiceError('Invitación no encontrada.', 404)
    return { ok: true }
  }
```

Then update the `return { ... }` export block (currently):

```js
  return {
    listAccountMembers,
    inviteAccountMember,
    updateAccountMemberRole,
    removeAccountMember,
    listMemberships,
    leaveGroup,
    leaveAccount,
    rejectGroupInvitation,
    rejectAccountInvitation,
  }
```

to:

```js
  return {
    listAccountMembers,
    inviteAccountMember,
    updateAccountMemberRole,
    removeAccountMember,
    listMemberships,
    leaveGroup,
    leaveAccount,
    rejectGroupInvitation,
    rejectAccountInvitation,
    acceptGroupInvitation,
    acceptAccountInvitation,
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ledger/collaboration-service.js apps/api/src/routes/ledger/__tests__/collaboration-service.test.js
git commit -m "feat(ledger): add acceptGroupInvitation/acceptAccountInvitation service functions"
```

---

### Task 4: `collaboration-service.js` — `listMemberships` includes pending invites + inviter name

**Files:**
- Modify: `apps/api/src/routes/ledger/collaboration-service.js:162-188` (`listMemberships`)
- Test: `apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`:

```js
  it('listMemberships includes pending memberships alongside active ones, with inviter name', async () => {
    const groupRow = {
      id: GROUP_ID, name: 'Grupo Test', role: 'viewer',
      invited_at: new Date(), status: 'pending', invited_by_name: 'Admin User', member_count: 3,
    }
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'from ledger_group_member gm')) return [groupRow]
      return []
    })
    const service = createCollaborationService({ prisma })
    const result = await service.listMemberships({ companyId: COMPANY_ID, actorId: ACTOR_ID })
    assert.equal(result.data.groups.length, 1)
    assert.equal(result.data.groups[0].status, 'pending')
    assert.equal(result.data.groups[0].invited_by_name, 'Admin User')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`
Expected: FAIL — `result.data.groups[0].status` is `undefined` (current query doesn't select `status` or `invited_by_name`, and filters `status = 'active'` only so a `'pending'`-only mock row could even be filtered out conceptually, though the mock here ignores SQL semantics — the assertion on `.status`/`.invited_by_name` being present is what fails).

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/ledger/collaboration-service.js`, replace the `listMemberships` function body (currently lines 162-188):

```js
  async function listMemberships({ companyId, actorId }) {
    const [groups, accounts] = await Promise.all([
      prisma.$queryRaw`
        SELECT g.id, g.name, gm.role, gm.invited_at,
          COUNT(DISTINCT gm2.user_id) FILTER (WHERE gm2.status = 'active')::int4 AS member_count
        FROM ledger_group_member gm
        JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
        LEFT JOIN ledger_group_member gm2 ON gm2.group_id = g.id
        WHERE gm.user_id = ${actorId}::uuid AND gm.status = 'active'
          AND g.company_id = ${companyId}::uuid
          AND g.created_by != ${actorId}::uuid
        GROUP BY g.id, gm.role, gm.invited_at
        ORDER BY g.name
      `,
      prisma.$queryRaw`
        SELECT a.id, a.name, a.bank, a.currency, am.role, am.invited_at,
          p.display_name AS owner_name
        FROM ledger_account_member am
        JOIN ledger_account a ON a.id = am.account_id AND a.enabled = true
        JOIN user_profile p ON p.id = a.owner_id
        WHERE am.user_id = ${actorId}::uuid AND am.status = 'active'
          AND a.company_id = ${companyId}::uuid
        ORDER BY a.name
      `,
    ])
    return { data: { groups, accounts } }
  }
```

with:

```js
  async function listMemberships({ companyId, actorId }) {
    const [groups, accounts] = await Promise.all([
      prisma.$queryRaw`
        SELECT g.id, g.name, gm.role, gm.invited_at, gm.status,
          inviter.display_name AS invited_by_name,
          COUNT(DISTINCT gm2.user_id) FILTER (WHERE gm2.status = 'active')::int4 AS member_count
        FROM ledger_group_member gm
        JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
        LEFT JOIN ledger_group_member gm2 ON gm2.group_id = g.id
        LEFT JOIN user_profile inviter ON inviter.id = gm.invited_by
        WHERE gm.user_id = ${actorId}::uuid AND gm.status IN ('active', 'pending')
          AND g.company_id = ${companyId}::uuid
          AND g.created_by != ${actorId}::uuid
        GROUP BY g.id, gm.role, gm.invited_at, gm.status, inviter.display_name
        ORDER BY g.name
      `,
      prisma.$queryRaw`
        SELECT a.id, a.name, a.bank, a.currency, am.role, am.invited_at, am.status,
          p.display_name AS owner_name,
          inviter.display_name AS invited_by_name
        FROM ledger_account_member am
        JOIN ledger_account a ON a.id = am.account_id AND a.enabled = true
        JOIN user_profile p ON p.id = a.owner_id
        LEFT JOIN user_profile inviter ON inviter.id = am.invited_by
        WHERE am.user_id = ${actorId}::uuid AND am.status IN ('active', 'pending')
          AND a.company_id = ${companyId}::uuid
        ORDER BY a.name
      `,
    ])
    return { data: { groups, accounts } }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/collaboration-service.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ledger/collaboration-service.js apps/api/src/routes/ledger/__tests__/collaboration-service.test.js
git commit -m "feat(ledger): listMemberships returns pending invites with inviter name"
```

---

### Task 5: `collaboration-routes.js` — wire the two new accept endpoints

**Files:**
- Modify: `apps/api/src/routes/ledger/collaboration-routes.js:128-153` (add after the existing reject routes)

- [ ] **Step 1: Write the implementation**

In `apps/api/src/routes/ledger/collaboration-routes.js`, add these two routes immediately after the `POST /ledger/invitations/accounts/:id/reject` route (currently ends at line 152, right before the final `return app`):

```js

  // ── Accept invitations ────────────────────────────────────────────────────

  app.post('/ledger/invitations/groups/:id/accept', requirePermission('ledger.groups.read'), async (c) => {
    try {
      return c.json(await service.acceptGroupInvitation({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        groupId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo aceptar la invitacion.')
    }
  })

  app.post('/ledger/invitations/accounts/:id/accept', requirePermission('ledger.accounts.read'), async (c) => {
    try {
      return c.json(await service.acceptAccountInvitation({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        accountId: c.req.param('id'),
      }))
    } catch (err) {
      return handleError(c, err, 'No se pudo aceptar la invitacion.')
    }
  })
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/api/src/routes/ledger/collaboration-routes.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Run the full ledger test suite**

Run: `node --test apps/api/src/routes/ledger/__tests__/`
Expected: PASS (route file has no dedicated test in this codebase's existing pattern — service-level tests from Tasks 1-4 already cover the logic this route calls).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/collaboration-routes.js
git commit -m "feat(ledger): add POST /ledger/invitations/{groups,accounts}/:id/accept routes"
```

---

### Task 6: `MembershipsScreen.jsx` — "Pendientes" section with accept/reject

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx`

- [ ] **Step 1: Write the implementation**

Replace the full contents of `apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx` with:

```jsx
import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, EmptyState, ErrorState, ConfirmDialog, Button, Card } from '@runly/ui'
import { LogOut, FolderOpen, Landmark, Check, X, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { LedgerStatStrip } from '../components/LedgerStatCard.jsx'

const API_BASE = getApiUrl()

export default function MembershipsScreen() {
  const navigate    = useNavigate()
  const { session } = useAuth()
  const token       = session?.access_token ?? null
  const queryClient = useQueryClient()
  const headers     = { Authorization: `Bearer ${token}` }

  const [leaveGroup, setLeaveGroup]     = useState(null)
  const [leaveAccount, setLeaveAccount] = useState(null)
  const [busyId, setBusyId]             = useState(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ledger-memberships', token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/memberships`, { headers })
      if (!res.ok) throw new Error('No se pudieron cargar las membresias.')
      return res.json()
    },
    enabled: !!token,
  })

  const allGroups   = data?.data?.groups   ?? []
  const allAccounts = data?.data?.accounts ?? []

  const pendingGroups   = allGroups.filter((g) => g.status === 'pending')
  const pendingAccounts = allAccounts.filter((a) => a.status === 'pending')
  const groups          = allGroups.filter((g) => g.status !== 'pending')
  const accounts        = allAccounts.filter((a) => a.status !== 'pending')

  async function confirmLeaveGroup() {
    const res = await companyFetch(`${API_BASE}/ledger/memberships/groups/${leaveGroup.id}`, {
      method: 'DELETE', headers,
    })
    if (!res.ok) { toast.error('No se pudo salir del grupo.'); return }
    toast.success(`Saliste del grupo "${leaveGroup.name}".`)
    setLeaveGroup(null)
    queryClient.invalidateQueries({ queryKey: ['ledger-memberships'] })
    queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
  }

  async function confirmLeaveAccount() {
    const res = await companyFetch(`${API_BASE}/ledger/memberships/accounts/${leaveAccount.id}`, {
      method: 'DELETE', headers,
    })
    if (!res.ok) { toast.error('No se pudo salir de la cuenta compartida.'); return }
    toast.success(`Saliste de la cuenta "${leaveAccount.name}".`)
    setLeaveAccount(null)
    queryClient.invalidateQueries({ queryKey: ['ledger-memberships'] })
    queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
  }

  async function respondInvitation(kind, id, action) {
    setBusyId(`${kind}-${id}-${action}`)
    try {
      const res = await companyFetch(
        `${API_BASE}/ledger/invitations/${kind}/${id}/${action}`,
        { method: 'POST', headers },
      )
      if (!res.ok) throw new Error()
      toast.success(action === 'accept' ? 'Invitación aceptada.' : 'Invitación rechazada.')
      queryClient.invalidateQueries({ queryKey: ['ledger-memberships'] })
      queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
      queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
    } catch {
      toast.error(action === 'accept' ? 'No se pudo aceptar la invitación.' : 'No se pudo rechazar la invitación.')
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}
      </div>
    )
  }

  if (isError) return <ErrorState description="No se pudieron cargar las membresias." onRetry={refetch} />

  const hasPending = pendingGroups.length > 0 || pendingAccounts.length > 0
  const isEmpty = !hasPending && groups.length === 0 && accounts.length === 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5">
        <PageHeader
          eyebrow="Runly Ledger"
          title="Mis membresías"
          description="Grupos y cuentas a los que fuiste invitado."
        />

        {!isEmpty && (
          <LedgerStatStrip
            className="mb-2 max-w-2xl"
            items={[
              { key: 'pending', label: 'Pendientes', value: pendingGroups.length + pendingAccounts.length, icon: Clock, tone: 'destructive' },
              { key: 'groups', label: 'Grupos', value: groups.length, icon: FolderOpen, tone: 'amber' },
              { key: 'accounts', label: 'Cuentas compartidas', value: accounts.length, icon: Landmark, tone: 'violet' },
            ]}
          />
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 pt-4 space-y-8 max-w-2xl">
        {isEmpty && (
          <EmptyState
            icon={LogOut}
            title="Sin membresías"
            description="No tienes membresías activas en grupos ni cuentas compartidas."
          />
        )}

        {hasPending && (
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock size={14} /> Pendientes
            </h3>
            <div className="space-y-2">
              {pendingGroups.map((g) => (
                <Card key={`pending-group-${g.id}`} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2 border-amber-500/30">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--brand-soft) text-(--brand-primary)">
                      <FolderOpen size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{g.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        Invitación de {g.invited_by_name ?? 'un administrador'} · rol <span className="capitalize">{g.role}</span>
                      </div>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => respondInvitation('groups', g.id, 'accept')}
                      disabled={busyId === `groups-${g.id}-accept`}
                    >
                      <Check size={13} className="mr-1" /> Aceptar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => respondInvitation('groups', g.id, 'reject')}
                      disabled={busyId === `groups-${g.id}-reject`}
                    >
                      <X size={13} className="mr-1" /> Rechazar
                    </Button>
                  </span>
                </Card>
              ))}
              {pendingAccounts.map((a) => (
                <Card key={`pending-account-${a.id}`} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2 border-amber-500/30">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                      <Landmark size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        Invitación de {a.invited_by_name ?? a.owner_name ?? 'el propietario'} · rol <span className="capitalize">{a.role}</span>
                      </div>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => respondInvitation('accounts', a.id, 'accept')}
                      disabled={busyId === `accounts-${a.id}-accept`}
                    >
                      <Check size={13} className="mr-1" /> Aceptar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => respondInvitation('accounts', a.id, 'reject')}
                      disabled={busyId === `accounts-${a.id}-reject`}
                    >
                      <X size={13} className="mr-1" /> Rechazar
                    </Button>
                  </span>
                </Card>
              ))}
            </div>
          </section>
        )}

        {groups.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <FolderOpen size={14} /> Grupos
            </h3>
            <div className="space-y-2">
              {groups.map((g) => (
                <Card key={g.id} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2">
                  <button className="flex items-center gap-3 text-left min-w-0" onClick={() => navigate(`/app/m/runly.ledger/groups/${g.id}`)}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--brand-soft) text-(--brand-primary)">
                      <FolderOpen size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{g.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] capitalize">
                        {g.role} · {g.member_count} miembro{Number(g.member_count) !== 1 ? 's' : ''}
                      </div>
                    </span>
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => setLeaveGroup(g)}>
                    <LogOut size={14} className="mr-1" /> Salir
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        )}

        {accounts.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Landmark size={14} /> Cuentas compartidas
            </h3>
            <div className="space-y-2">
              {accounts.map((a) => (
                <Card key={a.id} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2">
                  <button className="flex items-center gap-3 text-left min-w-0" onClick={() => navigate(`/app/m/runly.ledger/accounts/${a.id}`)}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                      <Landmark size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                        {a.bank} · <span className="capitalize">{a.role}</span> · Propietario: {a.owner_name}
                      </div>
                    </span>
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => setLeaveAccount(a)}>
                    <LogOut size={14} className="mr-1" /> Salir
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={!!leaveGroup}
        onOpenChange={(v) => { if (!v) setLeaveGroup(null) }}
        onConfirm={confirmLeaveGroup}
        title="Salir del grupo"
        description={`¿Estás seguro de que quieres salir del grupo "${leaveGroup?.name}"?`}
        confirmLabel="Salir"
      />

      <ConfirmDialog
        open={!!leaveAccount}
        onOpenChange={(v) => { if (!v) setLeaveAccount(null) }}
        onConfirm={confirmLeaveAccount}
        title="Salir de la cuenta compartida"
        description={`¿Estás seguro de que quieres salir de la cuenta "${leaveAccount?.name}"?`}
        confirmLabel="Salir"
      />
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`, sign in as a user who is an admin of a `runly.ledger` group, invite a second test user, then sign in as that second user and open `/app/m/runly.ledger/memberships`. Confirm:
- The invitation shows under "Pendientes" with the inviter's name.
- Clicking "Aceptar" moves it into the "Grupos" section and grants access to the group's accounts.
- Re-inviting a different user and clicking "Rechazar" removes it from "Pendientes" without granting access.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx
git commit -m "feat(ledger): add pending invitations section with accept/reject to MembershipsScreen"
```

---

### Task 7: `@runly/ui` `ModuleSidebar.jsx` — generic nav-item badge support

**Files:**
- Modify: `packages/ui/src/components/ModuleSidebar.jsx`

- [ ] **Step 1: Write the implementation**

In `packages/ui/src/components/ModuleSidebar.jsx`, add the `Badge` import (currently only imports icons and `cn`):

```js
import { ChevronLeft, ChevronRight, ChevronDown, X, Download } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "../lib/utils.js";
import { Badge } from "./Badge.jsx";
import {
  FleetVehicleIcon,
  resolveModuleIcon,
} from "./module-icon-registry.jsx";
```

Add `navBadges = {}` to the `ModuleSidebar` function's destructured props (currently ends with `editionName = "Jaguar",`):

```js
export function ModuleSidebar({
  module,
  currentPath,
  onNavigate,
  collapsed,
  onCollapse,
  mobileOpen = false,
  onMobileClose,
  canInstall = false,
  onInstall,
  contained = false,
  sidebarSlot = null,
  editionName = "Jaguar",
  navBadges = {},
}) {
```

In the flat nav item branch, replace the label `<span>` block (the one rendering `{item.label}` with the `truncate whitespace-nowrap ...` classes) so the `<a>` also renders a badge after it:

```jsx
                <span
                  className={cn(
                    "truncate whitespace-nowrap overflow-hidden transition-[opacity,max-width] duration-300 ease-in-out",
                    collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
                  )}
                >
                  {item.label}
                </span>
                {navBadges[item.fullPath] > 0 && !collapsed && (
                  <Badge
                    variant="destructive"
                    className="ml-auto shrink-0 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
                  >
                    {navBadges[item.fullPath]}
                  </Badge>
                )}
```

In the grouped/child nav item branch, replace the child `<span className="truncate">{child.label}</span>` line so it also renders a badge:

```jsx
                          <span className="truncate">{child.label}</span>
                          {navBadges[child.fullPath] > 0 && (
                            <Badge
                              variant="destructive"
                              className="ml-auto shrink-0 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
                            >
                              {navBadges[child.fullPath]}
                            </Badge>
                          )}
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check packages/ui/src/components/ModuleSidebar.jsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/ModuleSidebar.jsx
git commit -m "feat(ui): ModuleSidebar supports an optional numeric badge per nav item"
```

---

### Task 8: `useLedgerPendingInvitesCount` hook + `useModuleNavBadges` + wire into `RunlyApp.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.ledger/hooks/useLedgerPendingInvitesCount.js`
- Create: `apps/desktop/src/app/useModuleNavBadges.js`
- Modify: `apps/desktop/src/app/RunlyApp.jsx:24,204-208,256-269`

- [ ] **Step 1: Create the ledger-specific pending-count hook**

Create `apps/desktop/src/modules/runly.ledger/hooks/useLedgerPendingInvitesCount.js`:

```jsx
import { companyFetch } from '../../../lib/companyFetch.js'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

// Shares the same queryKey as MembershipsScreen.jsx's own `GET /ledger/memberships`
// query, so the two dedupe/cache together instead of firing two separate requests.
export function useLedgerPendingInvitesCount({ enabled = true } = {}) {
  const { session } = useAuth()
  const token = session?.access_token ?? null

  const { data } = useQuery({
    queryKey: ['ledger-memberships', token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/memberships`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('No se pudieron cargar las membresias.')
      return res.json()
    },
    enabled: enabled && !!token,
    staleTime: 30 * 1000,
  })

  const groups   = data?.data?.groups   ?? []
  const accounts = data?.data?.accounts ?? []
  return groups.filter((g) => g.status === 'pending').length
    + accounts.filter((a) => a.status === 'pending').length
}
```

- [ ] **Step 2: Create the generic nav-badge hook**

Create `apps/desktop/src/app/useModuleNavBadges.js`:

```js
import { useLedgerPendingInvitesCount } from '../modules/runly.ledger/hooks/useLedgerPendingInvitesCount.js'

// Returns { [fullNavPath]: count } for ModuleSidebar's nav-item badges.
// Every branch's hook must be called unconditionally (Rules of Hooks) — each
// hook internally gates its own query on `enabled` so only the active
// module's badge query actually fires a network request.
export function useModuleNavBadges(moduleKey) {
  const ledgerPendingCount = useLedgerPendingInvitesCount({ enabled: moduleKey === 'runly.ledger' })

  if (moduleKey === 'runly.ledger' && ledgerPendingCount > 0) {
    return { '/app/m/runly.ledger/memberships': ledgerPendingCount }
  }
  return {}
}
```

- [ ] **Step 3: Wire it into `RunlyApp.jsx`**

In `apps/desktop/src/app/RunlyApp.jsx`, add the import right after the existing `MODULE_SIDEBAR_SLOTS` import (currently line 24):

```js
import { MODULE_SIDEBAR_SLOTS } from './sidebar-slots.js'
import { useModuleNavBadges } from './useModuleNavBadges.js'
import { useServiceWorkerNotifications } from './useServiceWorkerNotifications.js'
```

Add the hook call right after the existing `sidebarSlot` computation (currently lines 204-208):

```js
  const sidebarSlot = useMemo(() => {
    if (!activeModule) return null
    const Slot = MODULE_SIDEBAR_SLOTS[activeModule.key] ?? MODULE_SIDEBAR_SLOTS[getLegacyModuleKey(activeModule.key)]
    return Slot ? <Slot /> : null
  }, [activeModule?.key])

  const navBadges = useModuleNavBadges(activeModule?.key)
```

Pass it to `<ModuleSidebar>` (currently lines 256-269):

```jsx
              <ModuleSidebar
                key={activeModule?.key}
                module={activeModule}
                currentPath={location.pathname}
                onNavigate={(path) => navigate(path)}
                collapsed={collapsed}
                onCollapse={toggleCollapsed}
                mobileOpen={mobileOpen}
                sidebarSlot={sidebarSlot}
                navBadges={navBadges}
                onMobileClose={() => setMobileOpen(false)}
                canInstall={canInstall}
                onInstall={install}
                editionName={RUNLY_EDITION_NAME}
              />
```

- [ ] **Step 4: Syntax-check the changed files**

Run:
```bash
node --check apps/desktop/src/modules/runly.ledger/hooks/useLedgerPendingInvitesCount.js
node --check apps/desktop/src/app/useModuleNavBadges.js
node --check apps/desktop/src/app/RunlyApp.jsx
```
Expected: no output for all three.

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`, sign in as the invited test user from Task 6 with a fresh pending invitation. Confirm the "Mis membresías" item in the `runly.ledger` sidebar shows a small red numeric badge matching the pending count, and that the badge disappears after accepting/rejecting all pending invitations (may need to navigate away and back, or wait for the 30s `staleTime` / trigger a refetch via the invalidation already wired in Task 6).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.ledger/hooks/useLedgerPendingInvitesCount.js apps/desktop/src/app/useModuleNavBadges.js apps/desktop/src/app/RunlyApp.jsx
git commit -m "feat(ledger): show a pending-invitations badge on the Mis membresias nav item"
```

---

## Phase B — XLSX support in the manual import wizard

### Task 9: `import-service.js` — add missing test coverage (CSV + XLSX parsing)

**Files:**
- Test: `apps/api/src/routes/ledger/__tests__/import-service.test.js` (new file)

- [ ] **Step 1: Write the test file**

Create `apps/api/src/routes/ledger/__tests__/import-service.test.js`:

```js
// apps/api/src/routes/ledger/__tests__/import-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { parseImportBuffer, validateImportRows } from '../import-service.js'

describe('import-service', () => {
  it('parseImportBuffer parses a CSV buffer into row objects', async () => {
    const csv = 'Fecha,Descripcion,Cargo,Abono\n2026-01-05,Renta,1500,\n2026-01-10,Nomina,,20000\n'
    const rows = await parseImportBuffer(Buffer.from(csv, 'utf-8'), 'csv')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].Fecha, '2026-01-05')
    assert.equal(rows[0].Descripcion, 'Renta')
    assert.equal(rows[1].Abono, '20000')
  })

  it('parseImportBuffer parses an XLSX buffer into row objects', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Movimientos')
    sheet.addRow(['Fecha', 'Descripcion', 'Cargo', 'Abono'])
    sheet.addRow(['2026-01-05', 'Renta', 1500, null])
    sheet.addRow(['2026-01-10', 'Nomina', null, 20000])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const rows = await parseImportBuffer(buffer, 'xlsx')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].Fecha, '2026-01-05')
    assert.equal(rows[0].Descripcion, 'Renta')
    assert.equal(rows[1].Abono, '20000')
  })

  it('parseImportBuffer rejects an unsupported format', async () => {
    await assert.rejects(
      () => parseImportBuffer(Buffer.from('x'), 'pdf'),
      /Formato no soportado/,
    )
  })

  it('validateImportRows separates valid rows from rows with errors', () => {
    const rawRows = [
      { Fecha: '2026-01-05', Descripcion: 'Renta', Cargo: '1500', Abono: '' },
      { Fecha: 'no-es-fecha', Descripcion: 'Malo', Cargo: '', Abono: '' },
    ]
    const mapping = { fecha: 'Fecha', nombre: 'Descripcion', retiro: 'Cargo', deposito: 'Abono' }
    const { valid, errors } = validateImportRows(rawRows, mapping)
    assert.equal(valid.length, 1)
    assert.equal(valid[0].nombre, 'Renta')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].rowIndex, 2)
  })
})
```

- [ ] **Step 2: Run the test to verify it passes against the existing (unmodified) `import-service.js`**

Run: `node --test apps/api/src/routes/ledger/__tests__/import-service.test.js`
Expected: PASS — `parseImportBuffer`/`validateImportRows` already exist and already support both formats (this task documents/locks in existing behavior with a regression test, per spec Section 25; Task 10 below adds the missing server endpoint that exposes this to the manual wizard).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/ledger/__tests__/import-service.test.js
git commit -m "test(ledger): add missing coverage for import-service CSV/XLSX parsing"
```

---

### Task 10: `accounts-routes.js` — add `POST /ledger/accounts/:id/import/parse`

**Files:**
- Modify: `apps/api/src/routes/ledger/accounts-routes.js` (top-level constant + new route before `/import/preview`, currently around line 514)

- [ ] **Step 1: Write the implementation**

In `apps/api/src/routes/ledger/accounts-routes.js`, add a module-level constant right after the imports (after line 19, before `function handleError`):

```js
const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
```

Add the new route immediately before the existing `app.post("/ledger/accounts/:id/import/preview", ...)` route (currently starting at line 514):

```js
  app.post(
    "/ledger/accounts/:id/import/parse",
    requirePermission("ledger.import"),
    async (c) => {
      try {
        const { parseImportBuffer } = await import("./import-service.js");
        const companyId = getCompanyId(c);
        const actorId = getActorId(c);
        const accountId = c.req.param("id");
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para importar movimientos en esta cuenta.' }, 403)
        }
        const form = await c.req.formData();
        const file = form.get("file");
        if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
          return c.json({ error: "Adjunta un archivo." }, 400);
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        if (buffer.length > MAX_IMPORT_FILE_BYTES) {
          return c.json({ error: "El archivo excede el tamano maximo de 20MB." }, 400);
        }
        const filename = String(file.name || "").toLowerCase();
        let format = null;
        if (filename.endsWith(".csv")) format = "csv";
        else if (filename.endsWith(".xlsx")) format = "xlsx";
        if (!format) {
          return c.json({ error: "Formato no soportado. Usa CSV o XLSX." }, 400);
        }
        const rows = await parseImportBuffer(buffer, format);
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
        return c.json({ rows, headers });
      } catch (err) {
        return handleError(c, err, "No se pudo leer el archivo.");
      }
    },
  );

```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/api/src/routes/ledger/accounts-routes.js`
Expected: no output.

- [ ] **Step 3: Manual verification**

Run: `pnpm dev`, then from a terminal with a valid session token:
```bash
curl -s -X POST "http://localhost:4010/ledger/accounts/<ACCOUNT_ID>/import/parse" \
  -H "Authorization: Bearer $RUNLY_TOKEN" \
  -F "file=@/path/to/movimientos.xlsx"
```
Expected: `200` with `{ "rows": [...], "headers": [...] }` matching the XLSX's columns.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/accounts-routes.js
git commit -m "feat(ledger): add POST /ledger/accounts/:id/import/parse for server-side CSV/XLSX parsing"
```

---

### Task 11: `ImportWizard.jsx` — upload file to the server instead of parsing CSV client-side

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx`

- [ ] **Step 1: Write the implementation**

In `apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx`, add a `parsing` state next to the existing `step`/`rawRows` state (currently lines 52-56):

```jsx
  const [step, setStep]       = useState(STEP_UPLOAD)
  const [parsing, setParsing] = useState(false)
  const [rawRows, setRawRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState(null)
```

Replace the entire `handleFile` function (currently lines 74-133) with:

```jsx
  async function handleFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (ext !== 'csv' && ext !== 'xlsx') {
      toast.error('Solo se aceptan archivos CSV o XLSX.')
      return
    }

    setParsing(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}/import/parse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'No se pudo leer el archivo.')
      }
      const { rows, headers: hdrs } = await res.json()
      if (!rows.length) { toast.error('El archivo no tiene datos.'); return }

      setHeaders(hdrs)
      setRawRows(rows)

      // Auto-map by header similarity
      const autoMap = {}
      TARGET_FIELDS.forEach(({ key }) => {
        const match = hdrs.find((h) => {
          const lower = h.toLowerCase()
          if (key === 'fecha')      return lower.includes('fecha')
          if (key === 'nombre')     return lower.includes('nombre') || lower.includes('descripci')
          if (key === 'deposito')   return lower.includes('dep') || lower.includes('abono')
          if (key === 'retiro')     return lower.includes('ret') || lower.includes('cargo') || lower.includes('egreso')
          if (key === 'numero')     return lower.includes('num') || lower.includes('folio')
          if (key === 'referencia') return lower.includes('ref')
          if (key === 'concepto')   return lower.includes('concepto') || lower.includes('nota')
          return lower.includes(key)
        })
        if (match) autoMap[key] = match
      })
      setMapping(autoMap)
      setStep(STEP_MAPPING)
    } catch (err) {
      toast.error(err.message ?? 'No se pudo leer el archivo.')
    } finally {
      setParsing(false)
    }
  }
```

Update the `PageHeader` `eyebrow` (currently `"Runly Ledger · Importación CSV"`):

```jsx
          eyebrow="Runly Ledger · Importación de movimientos"
```

Update the Step 0 upload block (currently lines 246-262):

```jsx
        {step === STEP_UPLOAD && (
          <div className="max-w-lg mx-auto">
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Sube un archivo CSV o XLSX con tus movimientos bancarios. La primera fila debe contener los encabezados de columna.
            </p>
            <DistDropZone
              accept=".csv,.xlsx"
              maxSizeMB={20}
              fullScreenOverlay
              isUploading={parsing}
              overlayLabel="Suelta tu archivo aqui"
              overlayHint="CSV o XLSX — primera fila debe ser encabezados"
              onFile={handleFile}
              emptyLabel="Arrastra tu archivo CSV o XLSX aqui"
              emptyHint="CSV o XLSX — primera fila debe ser encabezados"
            />
          </div>
        )}
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx`
Expected: no output.

- [ ] **Step 3: Manual verification**

Run: `pnpm dev`, open an account's "Importar" → "Importar CSV manual" flow, and:
- Upload a real `.xlsx` bank statement export. Confirm headers are detected and the mapping/preview/commit steps work exactly as CSV did before.
- Upload a `.csv` file. Confirm it still works (regression check).
- Try a `.pdf` file. Confirm it's rejected client-side with the CSV/XLSX-only error, before any network call.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx
git commit -m "feat(ledger): ImportWizard accepts XLSX by uploading to the server for parsing"
```

---

### Task 12: `AccountScreen.jsx` — update the manual-import menu label

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx:382-388`

- [ ] **Step 1: Write the implementation**

In `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx`, replace:

```jsx
                <DropdownMenuItem
                  onSelect={() =>
                    navigate(`/app/m/runly.ledger/accounts/${accountId}/import`)
                  }
                >
                  <FileSpreadsheet size={13} className="mr-2" /> Importar CSV manual
                </DropdownMenuItem>
```

with:

```jsx
                <DropdownMenuItem
                  onSelect={() =>
                    navigate(`/app/m/runly.ledger/accounts/${accountId}/import`)
                  }
                >
                  <FileSpreadsheet size={13} className="mr-2" /> Importar movimientos (CSV/XLSX)
                </DropdownMenuItem>
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx
git commit -m "chore(ledger): relabel manual import menu entry to mention XLSX support"
```

---

## Phase C — Restore UI for disabled movements and categories

### Task 13: `ledger-service.js` — add `listDisabledTransactions`

**Files:**
- Modify: `apps/api/src/routes/ledger/ledger-service.js:454-472`
- Test: `apps/api/src/routes/ledger/__tests__/ledger-service.test.js`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/routes/ledger/__tests__/ledger-service.test.js`, as a new top-level `describe` block after the existing one:

```js

describe('ledger-service — listDisabledTransactions', () => {
  it('returns only disabled rows for the account, with pagination', async () => {
    const disabledRow = {
      id: 'tx-1', account_id: ACCOUNT_ID, company_id: COMPANY_ID, enabled: false,
      fecha: '2026-01-05', nombre: 'Movimiento eliminado', _total_count: 1,
    }
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'enabled = false')) return [disabledRow]
      return []
    })
    const service = createLedgerService({ prisma })
    const result = await service.listDisabledTransactions({
      companyId: COMPANY_ID, accountId: ACCOUNT_ID, page: 1, pageSize: 20,
    })
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].nombre, 'Movimiento eliminado')
    assert.equal(result.data[0]._total_count, undefined)
    assert.equal(result.pagination.total, 1)
  })

  it('returns an empty page when there are no disabled transactions', async () => {
    const prisma = buildPrismaMock(async () => [])
    const service = createLedgerService({ prisma })
    const result = await service.listDisabledTransactions({
      companyId: COMPANY_ID, accountId: ACCOUNT_ID, page: 1, pageSize: 20,
    })
    assert.deepEqual(result.data, [])
    assert.equal(result.pagination.total, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/ledger/__tests__/ledger-service.test.js`
Expected: FAIL with `service.listDisabledTransactions is not a function`.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/ledger/ledger-service.js`, add this function immediately after `setTransactionEnabled` (currently ends at line 466, right before the `return { ... }` block):

```js

  async function listDisabledTransactions({ companyId, accountId, page, pageSize, maxPageSize = 500 }) {
    const pag = normalizePagination({ page, pageSize, maxPageSize })
    try {
      const rows = await prisma.$queryRaw`
        WITH filtered AS (
          SELECT t.*, tt.code AS tipo_code, tt.name AS tipo_name
          FROM ledger_transaction t
          JOIN ledger_account a ON a.id = t.account_id AND a.company_id = ${companyId}::uuid
          LEFT JOIN ledger_transaction_type tt ON tt.id = t.tipo_id
          WHERE t.account_id = ${accountId}::uuid
            AND t.company_id = ${companyId}::uuid
            AND t.enabled = false
        ),
        paged AS (
          SELECT *, COUNT(*) OVER()::int4 AS _total_count
          FROM filtered
          ORDER BY updated_at DESC
          LIMIT ${pag.pageSize} OFFSET ${pag.offset}
        )
        SELECT * FROM paged
      `
      const total = rows.length > 0 ? (rows[0]._total_count ?? rows.length) : 0
      const data = rows.map(({ _total_count, ...r }) => r)
      return {
        data,
        pagination: { page: pag.page, pageSize: pag.pageSize, total: toCount(total) },
      }
    } catch (err) {
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }
```

Update the `return { ... }` export block (currently lines 468-471):

```js
  return {
    listAccounts, getAccount, getAccountUnchecked, createAccount, canReadAccount, canWriteAccount, updateAccount, setAccountEnabled, setAccountGroup,
    listTransactions, createTransaction, updateTransaction, setTransactionEnabled,
  }
```

to:

```js
  return {
    listAccounts, getAccount, getAccountUnchecked, createAccount, canReadAccount, canWriteAccount, updateAccount, setAccountEnabled, setAccountGroup,
    listTransactions, createTransaction, updateTransaction, setTransactionEnabled, listDisabledTransactions,
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/ledger-service.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ledger/ledger-service.js apps/api/src/routes/ledger/__tests__/ledger-service.test.js
git commit -m "feat(ledger): add listDisabledTransactions service function"
```

---

### Task 14: `accounts-routes.js` — add `GET /ledger/accounts/:id/transactions/disabled`

**Files:**
- Modify: `apps/api/src/routes/ledger/accounts-routes.js:203-233` (add after the existing `GET /transactions` route)

- [ ] **Step 1: Write the implementation**

In `apps/api/src/routes/ledger/accounts-routes.js`, add the new route immediately after the existing `GET /ledger/accounts/:id/transactions` route (currently ends at line 233, right before `app.post("/ledger/accounts/:id/transactions", ...)`):

```js

  app.get(
    "/ledger/accounts/:id/transactions/disabled",
    requirePermission("ledger.transactions.read"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canReadAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para ver esta cuenta.' }, 403)
        }
        const { page, pageSize } = c.req.query();
        return c.json(
          await service.listDisabledTransactions({ companyId, accountId, page, pageSize }),
        );
      } catch (err) {
        return handleError(c, err, "No se pudieron listar los movimientos eliminados.");
      }
    },
  );
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/api/src/routes/ledger/accounts-routes.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/ledger/accounts-routes.js
git commit -m "feat(ledger): add GET /ledger/accounts/:id/transactions/disabled route"
```

---

### Task 15: `categories-service.js` — `listCategories` gains an `includeDisabled` option

**Files:**
- Modify: `apps/api/src/routes/ledger/categories-service.js:8-23`
- Test: `apps/api/src/routes/ledger/__tests__/categories-service.test.js` (new file)

- [ ] **Step 1: Write the test file**

Create `apps/api/src/routes/ledger/__tests__/categories-service.test.js`:

```js
// apps/api/src/routes/ledger/__tests__/categories-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCategoriesService } from '../categories-service.js'
import { LedgerServiceError } from '../ledger-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const ACTOR_ID   = '01900000-0000-7000-8000-000000000002'

describe('categories-service', () => {
  it('listCategories includes disabled categories when includeDisabled is true', async () => {
    const rows = [
      { id: 'c1', company_id: COMPANY_ID, owner_id: ACTOR_ID, name: 'Activa', enabled: true, is_system: false },
      { id: 'c2', company_id: COMPANY_ID, owner_id: ACTOR_ID, name: 'Inactiva', enabled: false, is_system: false },
    ]
    const prisma = { $queryRaw: async () => rows }
    const service = createCategoriesService({ prisma })
    const result = await service.listCategories({ companyId: COMPANY_ID, actorId: ACTOR_ID, includeDisabled: true })
    assert.equal(result.data.length, 2)
  })

  it('listCategories passes includeDisabled=false to the query by default', async () => {
    let capturedValues = null
    const prisma = {
      $queryRaw: async (strings, ...values) => { capturedValues = values; return [] },
    }
    const service = createCategoriesService({ prisma })
    await service.listCategories({ companyId: COMPANY_ID, actorId: ACTOR_ID })
    assert.ok(capturedValues.includes(false), 'expected the default includeDisabled=false to be bound')
  })

  it('setCategoryEnabled refuses to change a system category', async () => {
    const systemRow = { id: 'c3', company_id: COMPANY_ID, owner_id: null, name: 'Sistema', enabled: false, is_system: true }
    const prisma = { $queryRaw: async () => [systemRow] }
    const service = createCategoriesService({ prisma })
    await assert.rejects(
      () => service.setCategoryEnabled({ companyId: COMPANY_ID, categoryId: 'c3', actorId: ACTOR_ID, enabled: true }),
      (err) => {
        assert.ok(err instanceof LedgerServiceError)
        assert.equal(err.status, 403)
        return true
      },
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/ledger/__tests__/categories-service.test.js`
Expected: the first two tests FAIL (`listCategories` doesn't accept/use `includeDisabled` yet — the "includes disabled" test also technically passes today since the mock ignores the SQL WHERE clause entirely and just returns both rows regardless, but the "passes includeDisabled=false ... bound" test FAILS because `false` is never interpolated today); the third test PASSES already (existing behavior).

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/ledger/categories-service.js`, replace the `listCategories` function (currently lines 8-23):

```js
  async function listCategories({ companyId, actorId }) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT *, (owner_id IS NULL) AS is_system
        FROM ledger_category
        WHERE company_id = ${companyId}::uuid
          AND enabled = true
          AND (owner_id IS NULL OR owner_id = ${actorId}::uuid)
        ORDER BY owner_id NULLS FIRST, name
      `
      return { data: rows }
    } catch (err) {
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }
```

with:

```js
  async function listCategories({ companyId, actorId, includeDisabled = false }) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT *, (owner_id IS NULL) AS is_system
        FROM ledger_category
        WHERE company_id = ${companyId}::uuid
          AND (enabled = true OR ${includeDisabled})
          AND (owner_id IS NULL OR owner_id = ${actorId}::uuid)
        ORDER BY owner_id NULLS FIRST, name
      `
      return { data: rows }
    } catch (err) {
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/categories-service.test.js`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ledger/categories-service.js apps/api/src/routes/ledger/__tests__/categories-service.test.js
git commit -m "feat(ledger): listCategories supports an includeDisabled option"
```

---

### Task 16: `categories-routes.js` — accept `?includeDisabled=true`

**Files:**
- Modify: `apps/api/src/routes/ledger/categories-routes.js:19-24`

- [ ] **Step 1: Write the implementation**

In `apps/api/src/routes/ledger/categories-routes.js`, replace:

```js
  app.get('/ledger/categories', canRead, async (c) => {
    try {
      return c.json(await service.listCategories({ companyId: getCompanyId(c), actorId: getActorId(c) }))
    }
    catch (err) { return handleError(c, err, 'No se pudieron listar las categorias.') }
  })
```

with:

```js
  app.get('/ledger/categories', canRead, async (c) => {
    try {
      const includeDisabled = c.req.query('includeDisabled') === 'true'
      return c.json(await service.listCategories({ companyId: getCompanyId(c), actorId: getActorId(c), includeDisabled }))
    }
    catch (err) { return handleError(c, err, 'No se pudieron listar las categorias.') }
  })
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/api/src/routes/ledger/categories-routes.js`
Expected: no output.

- [ ] **Step 3: Run the categories test file again as a full-file regression check**

Run: `node --test apps/api/src/routes/ledger/__tests__/categories-service.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/categories-routes.js
git commit -m "feat(ledger): GET /ledger/categories accepts includeDisabled query param"
```

---

### Task 17: `DeletedTransactionsSheet.jsx` — new component + wire into `AccountScreen.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.ledger/components/DeletedTransactionsSheet.jsx`
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx`

- [ ] **Step 1: Create the component**

Create `apps/desktop/src/modules/runly.ledger/components/DeletedTransactionsSheet.jsx`:

```jsx
import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/components/DeletedTransactionsSheet.jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle, Button, EmptyState } from '@runly/ui'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

function fmtCurrency(amount, currency = 'MXN') {
  return Number(amount ?? 0).toLocaleString('es-MX', {
    style: 'currency', currency, minimumFractionDigits: 2,
  })
}

export default function DeletedTransactionsSheet({ accountId, currency, open, onOpenChange }) {
  const { session } = useAuth()
  const token = session?.access_token ?? null
  const queryClient = useQueryClient()
  const headers = { Authorization: `Bearer ${token}` }

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-transactions-disabled', accountId, token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}/transactions/disabled?pageSize=200`, { headers })
      if (!res.ok) throw new Error('No se pudieron cargar los movimientos eliminados.')
      return res.json()
    },
    enabled: open && !!accountId && !!token,
  })

  const restoreMutation = useMutation({
    mutationFn: async (txId) => {
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}/transactions/${txId}/enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ enabled: true }),
      })
      if (!res.ok) throw new Error('No se pudo restaurar el movimiento.')
    },
    onSuccess: () => {
      toast.success('Movimiento restaurado.')
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions-disabled', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-account', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', accountId] })
    },
    onError: (err) => toast.error(err.message),
  })

  const rows = data?.data ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Movimientos eliminados</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-1 py-3 space-y-2">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}
            </div>
          )}

          {!isLoading && rows.length === 0 && (
            <EmptyState
              icon={Trash2}
              title="Sin movimientos eliminados"
              description="Los movimientos que elimines de esta cuenta aparecerán aquí."
            />
          )}

          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{row.nombre}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {row.fecha}
                  <span className="mx-1.5 opacity-40">·</span>
                  {row.deposito ? fmtCurrency(row.deposito, currency) : `-${fmtCurrency(row.retiro, currency)}`}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreMutation.mutate(row.id)}
                disabled={restoreMutation.isPending}
              >
                <RotateCcw size={13} className="mr-1.5" />
                Restaurar
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Wire it into `AccountScreen.jsx`**

In `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx`, add the import after the existing `AccountSummary` import (currently line 49):

```jsx
import SpreadsheetRegister from "./SpreadsheetRegister.jsx";
import AccountSummary from "./AccountSummary.jsx";
import DeletedTransactionsSheet from "../components/DeletedTransactionsSheet.jsx";
```

Add `Trash2` is already imported in the lucide-react list (line 36) — no icon import changes needed.

Add state next to the other `useState` declarations (currently lines 87-92):

```jsx
  const [activeTab, setActiveTab] = useState("registro");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
```

Add a button next to the existing import `DropdownMenu` in the export-actions row (currently the row ends right after the `</DropdownMenu>` closing tag, around line 390-391):

```jsx
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setTrashOpen(true)}
              disabled={isUsingLocalLedger}
            >
              <Trash2 size={12} />
              Movimientos eliminados
            </Button>
          </div>
        )}
```

Render the sheet near the other `Sheet`/`ConfirmDialog` elements at the bottom of the component's JSX (right after the closing `</Sheet>` of the "Editar cuenta" sheet):

```jsx
      <DeletedTransactionsSheet
        accountId={accountId}
        currency={account?.currency}
        open={trashOpen}
        onOpenChange={setTrashOpen}
      />
```

- [ ] **Step 3: Syntax-check both files**

Run:
```bash
node --check apps/desktop/src/modules/runly.ledger/components/DeletedTransactionsSheet.jsx
node --check apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx
```
Expected: no output for both.

- [ ] **Step 4: Manual verification**

Run: `pnpm dev`, open an account with at least one transaction, delete it from the register (existing delete action), then click "Movimientos eliminados". Confirm the deleted movement appears with a "Restaurar" button, and clicking it makes the movement reappear in the normal register (and disappear from the "Movimientos eliminados" list).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.ledger/components/DeletedTransactionsSheet.jsx apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx
git commit -m "feat(ledger): add Movimientos eliminados panel with restore action"
```

---

### Task 18: `CategoriesScreen.jsx` — "Mostrar desactivadas" toggle + restore action

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/CategoriesScreen.jsx`

- [ ] **Step 1: Write the implementation**

In `apps/desktop/src/modules/runly.ledger/screens/CategoriesScreen.jsx`, update the `@tanstack/react-query` import (currently line 3) to also bring in `useQuery`:

```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
```

Update the lucide-react import (currently line 7):

```jsx
import { Plus, Pencil, EyeOff, Eye, RotateCcw, Tag, ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from 'lucide-react'
```

Add a `showDisabled` state and a disabled-categories query, right after the existing `deactivateTarget` state (currently lines 52-56):

```jsx
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [showDisabled, setShowDisabled] = useState(false)

  const { data, isLoading, isError, refetch } = useLedgerCategories()

  const { data: disabledData, isLoading: disabledLoading } = useQuery({
    queryKey: ['ledger-categories-disabled', token],
    queryFn: () => apiRequest('GET', '/ledger/categories?includeDisabled=true', token),
    enabled: showDisabled && !!token,
  })
```

(This replaces the original single `const { data, isLoading, isError, refetch } = useLedgerCategories()` line — keep it, just add the two new declarations around it.)

Add the restore mutation right after the existing `deactivateMutation` (currently lines 86-92):

```jsx
  const restoreMutation = useMutation({
    mutationFn: (categoryId) => apiRequest('PATCH', `/ledger/categories/${categoryId}/enabled`, token, { enabled: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-categories'] })
      queryClient.invalidateQueries({ queryKey: ['ledger-categories-disabled'] })
    },
  })
```

Add the `disabledCategories` derived list right after the existing `system`/`personal` split (currently lines 94-96):

```jsx
  const categories = data?.data ?? []
  const system = categories.filter(c => c.is_system)
  const personal = categories.filter(c => !c.is_system)
  const disabledCategories = (disabledData?.data ?? []).filter(c => !c.enabled)
```

Add a second row-renderer for disabled categories, right after the existing `renderRows` function (currently ends at line 141):

```jsx
  function renderDisabledRows(rows) {
    return rows.map(cat => (
      <tr key={cat.id} className="border-b border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.3)] transition-colors opacity-70">
        <td className="px-4 py-3">
          <span className="flex items-center gap-3">
            <span
              className="inline-block h-6 w-6 shrink-0 rounded-lg border border-[hsl(var(--border)/0.5)] shadow-sm"
              style={{ backgroundColor: cat.color ?? '#94a3b8' }}
            />
            <span className="font-medium text-sm">{cat.name}</span>
          </span>
        </td>
        <td className="px-4 py-3">
          <Badge variant={KIND_BADGE_VARIANT[cat.kind] ?? 'secondary'}>
            {KIND_OPTIONS.find(o => o.value === cat.kind)?.label ?? cat.kind}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => restoreMutation.mutate(cat.id)}
            disabled={restoreMutation.isPending}
          >
            <RotateCcw size={13} className="mr-1" />
            Restaurar
          </Button>
        </td>
      </tr>
    ))
  }
```

Add the toggle button next to the "Nueva categoria" action in `PageHeader` (currently lines 149-154):

```jsx
        actions={
          <span className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowDisabled((v) => !v)}>
              {showDisabled ? <EyeOff size={15} className="mr-1.5" /> : <Eye size={15} className="mr-1.5" />}
              {showDisabled ? 'Ocultar desactivadas' : 'Mostrar desactivadas'}
            </Button>
            <Button onClick={openCreate} disabled={!canEdit}>
              <Plus size={15} className="mr-1.5" />
              Nueva categoria
            </Button>
          </span>
        }
```

Add the "Desactivadas" table section right after the existing `{!isLoading && !isError && categories.length > 0 && ( <Card ...> ... </Card> )}` block (currently ends at line 228, right before the "Create / Edit dialog" comment):

```jsx
      {showDisabled && !disabledLoading && disabledCategories.length > 0 && (
        <Card variant="solid" className="rounded-xl mt-4 p-0 overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Nombre</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Tipo</th>
                <th className="px-4 py-2.5 w-48" />
              </tr>
            </thead>
            <tbody>
              <tr className="bg-[hsl(var(--muted)/0.4)]">
                <td colSpan={3} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  Desactivadas
                </td>
              </tr>
              {renderDisabledRows(disabledCategories)}
            </tbody>
          </table>
        </Card>
      )}

      {showDisabled && !disabledLoading && disabledCategories.length === 0 && (
        <EmptyState
          className="mt-4"
          icon={EyeOff}
          title="Sin categorias desactivadas"
          description="Las categorias personales que desactives aparecerán aquí."
        />
      )}
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/desktop/src/modules/runly.ledger/screens/CategoriesScreen.jsx`
Expected: no output.

- [ ] **Step 3: Manual verification**

Run: `pnpm dev`, open `/app/m/runly.ledger/categories`, deactivate a personal category, click "Mostrar desactivadas", confirm it appears under "Desactivadas" with a "Restaurar" button, and confirm clicking it moves the category back into "Mis categorias" (and out of the disabled list).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.ledger/screens/CategoriesScreen.jsx
git commit -m "feat(ledger): add Mostrar desactivadas toggle and restore action to CategoriesScreen"
```

---

## Final verification (run after all tasks are complete)

- [ ] **Step 1: Run the full ledger backend test suite**

```bash
node --test apps/api/src/routes/ledger/__tests__/
```
Expected: PASS, including the 3 new/modified test files (`group-service.test.js`, `collaboration-service.test.js`, `ledger-service.test.js`) and the 2 new test files (`import-service.test.js`, `categories-service.test.js`).

- [ ] **Step 2: Run repo-wide lint and build**

```bash
pnpm lint
pnpm build
```
Expected: both succeed with no new errors.

- [ ] **Step 3: Manual end-to-end pass (per spec Section 25)**

With `pnpm dev` running:
1. Invite a test user to a group; confirm `pending` status and no access until accepted.
2. Accept from the invited user's session; confirm access granted and the nav badge updates.
3. Reject a separate pending invitation; confirm no access granted.
4. Upload a real `.xlsx` bank statement to the manual import wizard; confirm it imports successfully.
5. Delete a movement, open "Movimientos eliminados", restore it, confirm it reappears in the register.
6. Deactivate a personal category, toggle "Mostrar desactivadas", restore it, confirm it's usable again.

- [ ] **Step 4: Update `docs/TASKS.md` if this repo tracks phase completion there**

Check `docs/TASKS.md` for a relevant open item referencing ledger invites/import/restore; if one exists, mark it complete with `Verified: YYYY-MM-DD (manual pass + node --test apps/api/src/routes/ledger/__tests__/ green)`. If no such item exists, skip this step — it is not required by the spec.
