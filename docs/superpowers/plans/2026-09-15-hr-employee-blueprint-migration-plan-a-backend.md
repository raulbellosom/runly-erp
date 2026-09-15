# HR Employee Blueprint Migration — Plan A (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, reusable "cover photo" mechanism (`isCover`/`sortOrder`) to the shared `FileAsset` model, migrate `HrEmployee.profileImageFileId` onto it, and move `department`/`jobTitle`/`managerName` denormalization from the client to `hr-service.js` — the backend half of migrating HR's employee screens to `RunlyDetail`/`RunlyForm` (see Plan B for the frontend half).

**Architecture:** `FileAsset` gains `isCover`/`sortOrder` columns. Two new generic endpoints (`PATCH /files/:id/cover`, `POST /files/reorder`) scope their updates by `moduleKey`+`entityType`+`metadata.sourceEntityId` (HR's actual grouping key — confirmed by reading `files-service.js`'s existing `list()`, which already filters this way because `FileAsset.entityId` is always the **companyId**, not the owning record's id, for files uploaded through the generic `/files/upload` endpoint). A Prisma migration adds the columns, backfills `isCover = true` for each employee's existing photo, then drops `HrEmployee.profileImageFileId`. `hr-service.js` computes `department`/`jobTitle`/`managerName` server-side from the resolved relation, replicating the exact format the frontend currently computes (verified from `HrEmployeeForm.jsx`: department/jobTitle = the catalog row's `name` verbatim, managerName = `` `${firstName} ${lastName}`.trim() `` using the supervisor's own columns).

**Tech Stack:** Node.js/Hono API (`apps/api`), Prisma (raw SQL migration), `node --test` for all backend tests. No component-render test harness in this repo (per prior plans in this folder) — this plan is backend-only, so all its verification is automated (no manual browser check needed here).

---

### Task 1: Prisma migration — `FileAsset.isCover`/`sortOrder`, migrate and drop `HrEmployee.profileImageFileId`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_file_asset_cover_sort_and_drop_hr_profile_image/migration.sql`

- [ ] **Step 1: Update the Prisma schema**

In `prisma/schema.prisma`, find the `FileAsset` model and add two fields right after `enabled`:

```prisma
model FileAsset {
  id String @id @default(dbgenerated("uuidv7()")) @db.Uuid
  bucket        String
  objectKey String @map("object_key")
  originalName String @map("original_name")
  mimeType String @map("mime_type")
  sizeBytes Int @map("size_bytes")
  checksum      String?
  contentRevision Int @default(1) @map("content_revision")
  officeLock String? @map("office_lock")
  officeLockExpiresAt DateTime? @map("office_lock_expires_at")
  versions FileAssetVersion[]
  accessScope String @default("COMPANY") @map("access_scope")
  creationKey String? @map("creation_key")
  shares FileAssetShare[]
  visibility    FileVisibility @default(PRIVATE)
  moduleKey String? @map("module_key")
  entityType String? @map("entity_type")
  entityId String? @db.Uuid @map("entity_id")
  uploadedById String? @db.Uuid @map("uploaded_by_id")
  metadata      Json?
  enabled       Boolean @default(true)
  isCover       Boolean @default(false) @map("is_cover")
  sortOrder     Int     @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  hrProfileEmployees HrEmployee[] @relation("HrEmployeeProfileImage")
  calendarFiles      CalendarEventFile[]
  invItemFiles       InvItemFile[] @relation("FileAssetInvItems")
  generatedDocuments GeneratedDocument[]

  @@index([moduleKey, entityType, entityId])
  @@index([entityId, enabled, createdAt, id])
  @@index([entityId, updatedAt, id])
  @@unique([uploadedById, creationKey])
  @@map("file_asset")
}
```

Then find the `HrEmployee` model and remove the `profileImageFileId` field and its relation:

Remove this line:
```prisma
  profileImageFileId String? @db.Uuid @map("profile_image_file_id")
```

Remove this line:
```prisma
  profileImageFile FileAsset? @relation("HrEmployeeProfileImage", fields: [profileImageFileId], references: [id], onDelete: SetNull)
```

The `FileAsset` model's `hrProfileEmployees HrEmployee[] @relation("HrEmployeeProfileImage")` back-relation line must also be removed (a relation needs both sides) — remove it from the `FileAsset` model block edited above (already omitted in the corrected block shown in this step — apply that full block as the replacement).

- [ ] **Step 2: Generate the migration folder**

Run: `pnpm db:generate` — this will fail with a schema-drift error listing the pending changes; that's expected and confirms the schema edit was picked up. Do not run `pnpm db:migrate` yet — Step 3 hand-writes the SQL so the data-preservation step runs in the same transaction as the column changes.

Create the migration folder manually (Prisma's timestamp format, matching the existing `20260914020000_add_inv_item_file_sort_cover` precedent):

Run: `date -u +%Y%m%d%H%M%S` to get a fresh 14-digit UTC timestamp, then create the folder `prisma/migrations/<that-timestamp>_add_file_asset_cover_sort_and_drop_hr_profile_image/`.

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/<timestamp>_add_file_asset_cover_sort_and_drop_hr_profile_image/migration.sql`:

```sql
-- Add cover/sort columns to the shared file_asset table, generalizing the
-- isCover/sortOrder pattern that inv_item_file already has (see
-- 20260914020000_add_inv_item_file_sort_cover) so any module using the
-- generic moduleKey/entityType/entityId file-tagging convention (not just
-- Inventory's own inv_item_file join table) can offer the same cover-photo
-- picker.
ALTER TABLE "file_asset" ADD COLUMN "is_cover" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "file_asset" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Preserve every employee's current profile photo: mark their FileAsset as
-- the cover before dropping the dedicated FK column below. hr_employee's
-- profile_image_file_id pointed directly at file_asset.id (no join table),
-- so this is a plain id match.
UPDATE "file_asset"
SET "is_cover" = true
WHERE "id" IN (
  SELECT "profile_image_file_id"
  FROM "hr_employee"
  WHERE "profile_image_file_id" IS NOT NULL
);

-- Drop the now-redundant dedicated FK (its foreign key constraint is named
-- by Prisma's default convention; confirm the exact constraint name in Step
-- 4 below before assuming this line is correct).
ALTER TABLE "hr_employee" DROP CONSTRAINT IF EXISTS "hr_employee_profile_image_file_id_fkey";
ALTER TABLE "hr_employee" DROP COLUMN "profile_image_file_id";
```

- [ ] **Step 4: Confirm the exact FK constraint name before applying**

Run this against the database (via `pnpm db:studio` is not suitable for raw SQL — use a one-off script or `psql`/Prisma's `$queryRaw` in a throwaway node script) to confirm the constraint name Postgres actually assigned:

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'hr_employee'::regclass AND contype = 'f'
  AND conname LIKE '%profile_image%';
```

If the returned name differs from `hr_employee_profile_image_file_id_fkey`, update the `DROP CONSTRAINT IF EXISTS` line in Step 3's SQL to match exactly (the `IF EXISTS` guard means a wrong name would silently no-op the constraint drop and then fail on `DROP COLUMN` with a dependency error — so this must be verified, not assumed, per this plan's no-guessing rule for destructive schema changes). Delete any throwaway script used for this check afterward — do not commit temporary diagnostic scripts (per this project's local-command-safety rules).

- [ ] **Step 5: Apply the migration**

Run: `pnpm db:migrate`
Expected: the migration applies without errors; output confirms `file_asset` gained two columns and `hr_employee` lost one.

- [ ] **Step 6: Regenerate the Prisma client**

Run: `pnpm db:generate`
Expected: generates without errors, no schema-drift warning this time.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add FileAsset.isCover/sortOrder, migrate and drop HrEmployee.profileImageFileId"
```

---

### Task 2: Generic cover/reorder functions in `files-service.js`

**Files:**
- Modify: `apps/api/src/services/files-service.js`
- Test: `apps/api/src/services/__tests__/files-service.test.js` (create if it doesn't already exist — check first)

- [ ] **Step 1: Check for an existing test file**

Run: `ls apps/api/src/services/__tests__/ | grep -i files-service`
If a file exists, read it fully before Step 2 so new tests follow its existing mock conventions instead of introducing a second style. If none exists, Step 2 creates one from scratch using the same `prisma` mock shape already established elsewhere in this plan folder's precedent tests (e.g. a plain object with the Prisma methods actually called, each an `async` stub).

- [ ] **Step 2: Write the failing tests**

Add (to the existing file if found in Step 1, else create `apps/api/src/routes/fleet/__tests__/../../services/__tests__/files-service.test.js` — actually create at `apps/api/src/services/__tests__/files-service.test.js`):

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFilesService } from "../files-service.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const AUTH_USER_ID = "01900000-0000-7000-8000-000000000002";
const PROFILE_ID = "01900000-0000-7000-8000-000000000003";
const EMPLOYEE_ID = "01900000-0000-7000-8000-000000000004";
const FILE_A = "01900000-0000-7000-8000-000000000005";
const FILE_B = "01900000-0000-7000-8000-000000000006";

function buildPrismaMock({ files }) {
  const byId = new Map(files.map((f) => [f.id, { ...f }]));
  return {
    userProfile: { findUnique: async () => ({ id: PROFILE_ID }) },
    membership: {
      findFirst: async () => ({ companyId: COMPANY_ID }),
    },
    fileAsset: {
      findFirst: async ({ where }) => {
        const row = byId.get(where.id);
        if (!row) return null;
        if (where.moduleKey && row.moduleKey !== where.moduleKey) return null;
        if (where.entityType && row.entityType !== where.entityType) return null;
        return { ...row };
      },
      findMany: async ({ where }) =>
        [...byId.values()].filter(
          (row) =>
            row.moduleKey === where.moduleKey &&
            row.entityType === where.entityType &&
            row.metadata?.sourceEntityId === where.metadata.path
              ? true
              : row.metadata?.sourceEntityId === where.metadata?.equals,
        ),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of byId.values()) {
          if (
            row.moduleKey === where.moduleKey &&
            row.entityType === where.entityType &&
            row.metadata?.sourceEntityId === where.metadata?.equals
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
      update: async ({ where, data }) => {
        const row = byId.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    $transaction: async (ops) => Promise.all(ops),
  };
}

describe("files-service setFileCover / reorderFiles", () => {
  it("setFileCover marks the target file as cover and clears any other cover in the same group", async () => {
    const prisma = buildPrismaMock({
      files: [
        {
          id: FILE_A,
          moduleKey: "runly.hr",
          entityType: "HrEmployee",
          entityId: COMPANY_ID,
          metadata: { sourceEntityId: EMPLOYEE_ID },
          isCover: true,
          sortOrder: 0,
        },
        {
          id: FILE_B,
          moduleKey: "runly.hr",
          entityType: "HrEmployee",
          entityId: COMPANY_ID,
          metadata: { sourceEntityId: EMPLOYEE_ID },
          isCover: false,
          sortOrder: 1,
        },
      ],
    });
    const service = createFilesService({ prisma, supabaseAdmin: {} });
    const result = await service.setFileCover({
      authUserId: AUTH_USER_ID,
      activeContext: { companyId: COMPANY_ID },
      id: FILE_B,
    });
    assert.equal(result.isCover, true);
  });

  it("reorderFiles writes sequential sortOrder for the given group", async () => {
    const prisma = buildPrismaMock({
      files: [
        {
          id: FILE_A,
          moduleKey: "runly.hr",
          entityType: "HrEmployee",
          entityId: COMPANY_ID,
          metadata: { sourceEntityId: EMPLOYEE_ID },
          isCover: false,
          sortOrder: 0,
        },
        {
          id: FILE_B,
          moduleKey: "runly.hr",
          entityType: "HrEmployee",
          entityId: COMPANY_ID,
          metadata: { sourceEntityId: EMPLOYEE_ID },
          isCover: false,
          sortOrder: 1,
        },
      ],
    });
    const service = createFilesService({ prisma, supabaseAdmin: {} });
    const result = await service.reorderFiles({
      authUserId: AUTH_USER_ID,
      activeContext: { companyId: COMPANY_ID },
      moduleKey: "runly.hr",
      entityType: "HrEmployee",
      entityId: EMPLOYEE_ID,
      orderedIds: [FILE_B, FILE_A],
    });
    assert.equal(result.length, 2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/files-service.test.js`
Expected: FAIL — `service.setFileCover is not a function` / `service.reorderFiles is not a function`, since neither exists yet.

- [ ] **Step 4: Implement `setFileCover` and `reorderFiles`**

In `apps/api/src/services/files-service.js`, add two new methods to the object returned by `createFilesService` (place them right after the existing `delete` method, before `enrichFileAssets`):

```js
    async setFileCover({ authUserId, activeContext, id }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      const file = await ensureFileBelongsToCompany({
        fileId: id,
        companyId,
        context,
        includeDisabled: false,
      });
      const sourceEntityId = file.metadata?.sourceEntityId ?? null;
      if (!file.moduleKey || !file.entityType || !sourceEntityId) {
        throw new FilesServiceError(
          "Este archivo no pertenece a un grupo con portada.",
          400,
        );
      }
      await prisma.fileAsset.updateMany({
        where: {
          moduleKey: file.moduleKey,
          entityType: file.entityType,
          metadata: { path: ["sourceEntityId"], equals: sourceEntityId },
        },
        data: { isCover: false },
      });
      return prisma.fileAsset.update({
        where: { id: file.id },
        data: { isCover: true },
      });
    },

    async reorderFiles({ authUserId, activeContext, moduleKey, entityType, entityId, orderedIds }) {
      const context = await getUserCompanyContext(authUserId, activeContext);
      const { companyId } = context;
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) return [];
      const group = await prisma.fileAsset.findMany({
        where: {
          moduleKey,
          entityType,
          metadata: { path: ["sourceEntityId"], equals: entityId },
        },
        select: { id: true },
      });
      const groupIds = new Set(group.map((row) => row.id));
      const safeOrderedIds = orderedIds.filter((fileId) => groupIds.has(fileId));
      await prisma.$transaction(
        safeOrderedIds.map((fileId, index) =>
          prisma.fileAsset.update({
            where: { id: fileId },
            data: { sortOrder: index },
          }),
        ),
      );
      return prisma.fileAsset.findMany({
        where: { id: { in: safeOrderedIds } },
        orderBy: { sortOrder: "asc" },
      });
    },
```

Note: this uses `companyId` from `context` only implicitly via `ensureFileBelongsToCompany` (in `setFileCover`) — `reorderFiles` does NOT call `ensureFileBelongsToCompany` per-file since it filters the incoming `orderedIds` against a company-scoped `findMany` first (`groupIds`), which already excludes any id from a different company since `fileAsset.findMany` here has no explicit companyId filter — **fix this before merging**: add company scoping to the `findMany` in `reorderFiles` by checking each candidate file's `entityId` is not relevant (HR's entityId is always companyId, but that's HR-specific, not generic) — instead, scope via the same `metadata.sourceEntityId` group key combined with requiring the caller to have already proven ownership of `entityId` through whatever business-logic guard calls this generic service (e.g. the HR route handler must verify the employee belongs to the caller's company before calling `reorderFiles`, since `reorderFiles` itself has no way to know what "owning" companyId means for an arbitrary `entityId` across different modules' conventions). Document this responsibility split explicitly as a code comment above `reorderFiles`.

Add that comment now:

```js
    // Company scoping for this generic method is the caller's responsibility:
    // reorderFiles has no way to know, for an arbitrary module's entityId
    // convention, which company owns that entity (HR's entityId is always
    // companyId — see list() above — but that's HR-specific, not generic).
    // Callers (route handlers) MUST verify the entityId belongs to the
    // authenticated company before calling this.
    async reorderFiles({ authUserId, activeContext, moduleKey, entityType, entityId, orderedIds }) {
```

(Prepend this comment directly above the `async reorderFiles(...)` line already added.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/files-service.test.js`
Expected: PASS, both tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/files-service.js apps/api/src/services/__tests__/files-service.test.js
git commit -m "feat(files): add generic setFileCover/reorderFiles scoped by moduleKey+entityType+metadata.sourceEntityId"
```

---

### Task 3: New routes — `PATCH /files/:id/cover`, `POST /files/reorder`

**Files:**
- Modify: `apps/api/src/routes/files.js`
- Modify: `packages/validators/src/index.js`

- [ ] **Step 1: Add the reorder validator**

In `packages/validators/src/index.js`, add near `fileBulkDownloadSchema`:

```js
export const filesReorderSchema = z.object({
  moduleKey: z.string().trim().min(1),
  entityType: z.string().trim().min(1),
  entityId: z.string().uuid(),
  orderedIds: z
    .array(z.string().uuid())
    .min(1, "Debes incluir al menos un archivo."),
});
```

- [ ] **Step 2: Add the two routes**

In `apps/api/src/routes/files.js`, add this import alongside the existing one:

```js
import { fileBulkDownloadSchema, fileRenameSchema, filesReorderSchema } from "@runly/validators";
```

Then add these two route registrations, right after the existing `DELETE /files/:id` block (end of that handler):

```js
  app.patch(
    "/files/:id/cover",
    authMiddleware,
    requirePermission("files.assets.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const activeContext = tenantActiveContext(c);
        const id = c.req.param("id");
        const file = await filesService.setFileCover({ authUserId, activeContext, id });
        return c.json({ data: file });
      } catch (err) {
        if (err instanceof FilesServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo marcar la portada." }, 500);
      }
    },
  );

  app.post(
    "/files/reorder",
    authMiddleware,
    requirePermission("files.assets.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const activeContext = tenantActiveContext(c);
        const parsed = filesReorderSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const files = await filesService.reorderFiles({
          authUserId,
          activeContext,
          ...parsed.data,
        });
        return c.json({ data: files });
      } catch (err) {
        if (err instanceof FilesServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo reordenar." }, 500);
      }
    },
  );
```

Check the exact variable name this router file uses for the Hono instance (the survey showed `const app = new Hono();` at the top of `createFilesRouter` — confirm this before pasting, since if it's actually named differently the `app.patch`/`app.post` calls above must match).

- [ ] **Step 3: Syntax check**

Run: `node --check apps/api/src/routes/files.js`
Expected: no syntax errors (this only catches syntax issues, not logic — full verification is Task 6's integration check).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/files.js packages/validators/src/index.js
git commit -m "feat(api): add PATCH /files/:id/cover and POST /files/reorder routes"
```

---

### Task 4: SDK methods

**Files:**
- Modify: `packages/sdk/src/index.js`

- [ ] **Step 1: Add `setCover`/`reorder` to the `files` domain**

In `packages/sdk/src/index.js`, inside the `files: { ... }` domain object, add these two methods right after the existing `delete` method:

```js
  setCover: (id, token) =>
    request(`/files/${encodeURIComponent(id)}/cover`, {
      method: "PATCH",
      headers: withAuthHeaders(token),
    }),
  reorder: (payload, token) =>
    request("/files/reorder", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    }),
```

- [ ] **Step 2: Syntax check**

Run: `node --check packages/sdk/src/index.js`
Expected: no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/index.js
git commit -m "feat(sdk): add files.setCover/files.reorder methods"
```

---

### Task 5: Move `department`/`jobTitle`/`managerName` denormalization to `hr-service.js`; drop `profileImageFileId` handling

**Files:**
- Modify: `apps/api/src/services/hr-service.js`
- Modify: `packages/validators/src/index.js`
- Test: `apps/api/src/services/__tests__/hr-service.test.js` (check if it exists first — if not, create following this plan's other test-file conventions)

- [ ] **Step 1: Check for an existing hr-service test file and its conventions**

Run: `ls apps/api/src/services/__tests__/ | grep -i hr-service`
Read it fully if found, before Step 2, to match its mock style.

- [ ] **Step 2: Write the failing tests**

Add (create the file at `apps/api/src/services/__tests__/hr-service.test.js` if none exists, matching whatever mock style Step 1 found — if no file exists, use this self-contained mock):

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHrService, HrServiceError } from "../hr-service.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const AUTH_USER_ID = "01900000-0000-7000-8000-000000000002";
const PROFILE_ID = "01900000-0000-7000-8000-000000000003";
const EMPLOYEE_ID = "01900000-0000-7000-8000-000000000004";
const DEPARTMENT_ID = "01900000-0000-7000-8000-000000000005";
const SUPERVISOR_ID = "01900000-0000-7000-8000-000000000006";

function buildPrismaMock() {
  return {
    userProfile: { findUnique: async () => ({ id: PROFILE_ID }) },
    membership: { findFirst: async () => ({ companyId: COMPANY_ID }) },
    hrDepartment: {
      findFirst: async ({ where }) =>
        where.id === DEPARTMENT_ID
          ? { id: DEPARTMENT_ID, enabled: true, name: "Ingeniería" }
          : null,
    },
    hrJobTitle: { findFirst: async () => null },
    hrEmployee: {
      findFirst: async ({ where }) =>
        where.id === SUPERVISOR_ID
          ? { id: SUPERVISOR_ID, firstName: "Ana", lastName: "López" }
          : where.id === EMPLOYEE_ID
            ? { id: EMPLOYEE_ID, companyId: COMPANY_ID, enabled: true }
            : null,
      findUnique: async ({ where }) =>
        where.id === EMPLOYEE_ID
          ? { id: EMPLOYEE_ID, companyId: COMPANY_ID, firstName: "Juan", lastName: "Pérez" }
          : null,
      create: async ({ data }) => ({ id: EMPLOYEE_ID, ...data }),
      update: async ({ data }) => ({ id: EMPLOYEE_ID, ...data }),
    },
    auditLog: { create: async ({ data }) => ({ id: "audit-1", createdAt: new Date(), ...data }) },
  };
}

describe("hr-service department/jobTitle/managerName server-side resolution", () => {
  it("updateEmployee resolves department name from departmentId, ignoring any client-sent department text", async () => {
    const prisma = buildPrismaMock();
    const service = createHrService({ prisma });
    const result = await service.updateEmployee({
      authUserId: AUTH_USER_ID,
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
      payload: { departmentId: DEPARTMENT_ID },
    });
    assert.equal(result.department, "Ingeniería");
  });

  it("updateEmployee resolves managerName as 'FirstName LastName' from supervisorEmployeeId", async () => {
    const prisma = buildPrismaMock();
    const service = createHrService({ prisma });
    const result = await service.updateEmployee({
      authUserId: AUTH_USER_ID,
      companyId: COMPANY_ID,
      id: EMPLOYEE_ID,
      payload: { supervisorEmployeeId: SUPERVISOR_ID },
    });
    assert.equal(result.managerName, "Ana López");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test apps/api/src/services/__tests__/hr-service.test.js`
Expected: FAIL — `result.department` is whatever the raw payload had (or undefined), not `"Ingeniería"`, since server-side resolution doesn't exist yet.

- [ ] **Step 4: Add the resolution helper and wire it into `createEmployee`/`updateEmployee`**

In `apps/api/src/services/hr-service.js`, add this function near `assertSupervisor`/`assertProfileImage` (same section of small validation/lookup helpers):

```js
  // Resolves department/jobTitle/managerName from their relation ids so the
  // client never has to keep these denormalized text columns in sync itself
  // (see docs/superpowers/specs/2026-09-15-hr-employee-blueprint-migration-design.md,
  // goal 7). Only touches a field when its id was actually present in the
  // payload (undefined = "not part of this update", matching
  // normalizeEmployeePayload's existing convention below); an explicit null
  // id clears the denormalized text too.
  async function resolveDenormalizedFields({ departmentId, jobTitleId, supervisorEmployeeId, companyId }) {
    const result = {};
    if (departmentId !== undefined) {
      if (departmentId === null) {
        result.department = null;
      } else {
        const dept = await prisma.hrDepartment.findFirst({
          where: { id: departmentId, companyId },
          select: { name: true },
        });
        result.department = dept?.name ?? null;
      }
    }
    if (jobTitleId !== undefined) {
      if (jobTitleId === null) {
        result.jobTitle = null;
      } else {
        const jt = await prisma.hrJobTitle.findFirst({
          where: { id: jobTitleId, companyId },
          select: { name: true },
        });
        result.jobTitle = jt?.name ?? null;
      }
    }
    if (supervisorEmployeeId !== undefined) {
      if (supervisorEmployeeId === null) {
        result.managerName = null;
      } else {
        const sup = await prisma.hrEmployee.findFirst({
          where: { id: supervisorEmployeeId, companyId },
          select: { firstName: true, lastName: true },
        });
        result.managerName = sup
          ? `${sup.firstName ?? ""} ${sup.lastName ?? ""}`.trim() || null
          : null;
      }
    }
    return result;
  }
```

Then remove `department`/`jobTitle`/`managerName` from `normalizeEmployeePayload` (they're resolved separately now, not passed through from the client):

Replace:
```js
function normalizeEmployeePayload(data) {
  return {
    ...data,
    firstName: data.firstName?.trim(),
    lastName: data.lastName?.trim(),
    employeeCode: nullableString(data.employeeCode),
    userProfileId: data.userProfileId ?? undefined,
    supervisorEmployeeId: data.supervisorEmployeeId ?? undefined,
    departmentId: data.departmentId ?? undefined,
    jobTitleId: data.jobTitleId ?? undefined,
    profileImageFileId: data.profileImageFileId ?? undefined,
    workEmail: nullableString(data.workEmail),
    personalEmail: nullableString(data.personalEmail),
    phone: nullableString(data.phone),
    emergencyContactName: nullableString(data.emergencyContactName),
    emergencyContactPhone: nullableString(data.emergencyContactPhone),
    jobTitle: nullableString(data.jobTitle),
    department: nullableString(data.department),
    managerName: nullableString(data.managerName),
    employmentType: nullableString(data.employmentType),
    workLocation: nullableString(data.workLocation),
    notesMarkdown: nullableString(data.notesMarkdown),
    hireDate: normalizeDate(data.hireDate),
    terminationDate: normalizeDate(data.terminationDate),
  };
}
```

with:

```js
function normalizeEmployeePayload(data) {
  return {
    ...data,
    firstName: data.firstName?.trim(),
    lastName: data.lastName?.trim(),
    employeeCode: nullableString(data.employeeCode),
    userProfileId: data.userProfileId ?? undefined,
    supervisorEmployeeId: data.supervisorEmployeeId ?? undefined,
    departmentId: data.departmentId ?? undefined,
    jobTitleId: data.jobTitleId ?? undefined,
    workEmail: nullableString(data.workEmail),
    personalEmail: nullableString(data.personalEmail),
    phone: nullableString(data.phone),
    emergencyContactName: nullableString(data.emergencyContactName),
    emergencyContactPhone: nullableString(data.emergencyContactPhone),
    employmentType: nullableString(data.employmentType),
    workLocation: nullableString(data.workLocation),
    notesMarkdown: nullableString(data.notesMarkdown),
    hireDate: normalizeDate(data.hireDate),
    terminationDate: normalizeDate(data.terminationDate),
  };
}
```

(Removed: `profileImageFileId`, `jobTitle`, `department`, `managerName` — these three text fields and the FK are no longer accepted from the client at all.)

Now update `createEmployee` — replace:

```js
  const created = await prisma.hrEmployee.create({
    data: {
      ...normalized,
      companyId,
    },
  });
```

with:

```js
  const denormalized = await resolveDenormalizedFields({
    departmentId: normalized.departmentId,
    jobTitleId: normalized.jobTitleId,
    supervisorEmployeeId: normalized.supervisorEmployeeId,
    companyId,
  });
  const created = await prisma.hrEmployee.create({
    data: {
      ...normalized,
      ...denormalized,
      companyId,
    },
  });
```

And also remove the now-dead `assertProfileImage` call in `createEmployee` (the field no longer exists):

Replace:
```js
  await assertDepartment({ id: normalized.departmentId, companyId });
  await assertJobTitle({ id: normalized.jobTitleId, companyId });
  await assertProfileImage({
    profileImageFileId: normalized.profileImageFileId,
    companyId,
  });
```
(this exact block appears in `createEmployee`) with:
```js
  await assertDepartment({ id: normalized.departmentId, companyId });
  await assertJobTitle({ id: normalized.jobTitleId, companyId });
```

Do the identical two replacements in `updateEmployee` (same block appears there too, plus the `create`/`update` call site):

Replace:
```js
  await assertDepartment({ id: normalized.departmentId, companyId });
  await assertJobTitle({ id: normalized.jobTitleId, companyId });
  await assertProfileImage({
    profileImageFileId: normalized.profileImageFileId,
    companyId,
  });
```
with:
```js
  await assertDepartment({ id: normalized.departmentId, companyId });
  await assertJobTitle({ id: normalized.jobTitleId, companyId });
```

Replace:
```js
  const updated = await prisma.hrEmployee.update({
    where: { id },
    data: normalized,
  });
```
with:
```js
  const denormalized = await resolveDenormalizedFields({
    departmentId: normalized.departmentId,
    jobTitleId: normalized.jobTitleId,
    supervisorEmployeeId: normalized.supervisorEmployeeId,
    companyId,
  });
  const updated = await prisma.hrEmployee.update({
    where: { id },
    data: { ...normalized, ...denormalized },
  });
```

Finally, delete the now-unused `assertProfileImage` function entirely (its only two call sites were just removed):

Remove:
```js
  async function assertProfileImage({ profileImageFileId, companyId }) {
    if (!profileImageFileId) return;
    const file = await prisma.fileAsset.findFirst({
      where: {
        id: profileImageFileId,
        enabled: true,
        entityId: companyId,
      },
      select: { id: true, mimeType: true },
    });
    if (!file) {
      throw new HrServiceError("La imagen de perfil no es valida.", 400);
    }
    if (!file.mimeType?.startsWith("image/")) {
      throw new HrServiceError(
        "La imagen de perfil debe ser un archivo de imagen.",
        400,
      );
    }
  }
```
(verified exact text — delete this complete function body, lines 209-228 of `hr-service.js` as of this plan's writing).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test apps/api/src/services/__tests__/hr-service.test.js`
Expected: PASS, both new tests.

- [ ] **Step 6: Update the Zod schemas**

In `packages/validators/src/index.js`, in `hrEmployeeBaseSchema`, remove these three lines:
```js
  profileImageFileId: z.string().uuid().optional().nullable(),
```
```js
  jobTitle: z.string().trim().max(120).optional().or(z.literal("")),
  department: z.string().trim().max(120).optional().or(z.literal("")),
  managerName: z.string().trim().max(140).optional().or(z.literal("")),
```

- [ ] **Step 7: Full backend regression check**

Run: `node --test "apps/api/src/services/__tests__/*.test.js" "apps/api/src/routes/fleet/__tests__/*.test.js"`
Expected: all pass, no regressions (this also re-runs every test touched by this session's earlier work).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/hr-service.js apps/api/src/services/__tests__/hr-service.test.js packages/validators/src/index.js
git commit -m "feat(hr): resolve department/jobTitle/managerName server-side; drop profileImageFileId handling"
```

---

### Task 6: Full backend verification

**Files:** None (verification only).

- [ ] **Step 1: Full backend test suite**

Run: `node --test "apps/api/src/services/__tests__/*.test.js" "apps/api/src/routes/fleet/__tests__/*.test.js"`
Expected: all pass.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: `apps/api` build/boot check**

Run: `node --check apps/api/src/index.js && node --check apps/api/src/routes/files.js && node --check apps/api/src/services/files-service.js && node --check apps/api/src/services/hr-service.js`
Expected: no syntax errors in any modified file.

- [ ] **Step 4: Manual smoke test with `pnpm dev` running**

- Upload two files to an employee via the current (still hand-rolled, pre-Plan-B) `HrEmployeeForm.jsx` UI, then call `PATCH /files/:id/cover` and `POST /files/reorder` directly (e.g. via a REST client) against one of the uploaded file ids, confirming the response reflects the change and a second `GET /files?moduleKey=runly.hr&entityType=HrEmployee&sourceEntityId=:employeeId` (adjust query param name to whatever `list()` actually expects — confirm from the code) shows the updated `isCover`/`sortOrder`.
- Edit an employee's department/supervisor via the existing form and confirm the response's `department`/`managerName` reflect the server-resolved values even if the (still old) frontend sent different text in those fields (temporarily — Plan B removes those fields from the frontend payload entirely).
