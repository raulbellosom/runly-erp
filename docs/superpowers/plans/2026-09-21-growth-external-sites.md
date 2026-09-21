# Growth External Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `runly.growth` track and manage web properties (analytics, leads) without requiring `runly.website` to be installed, by introducing a `GrowthProperty` model that either mirrors a `WebsiteSite` (when the website module manages the site) or represents an externally-hosted site connected purely through `@raulbellosom/runly-sdk`.

**Architecture:** One new Prisma model (`GrowthProperty`, owned by `runly.growth`) becomes the single thing Growth's `siteId` columns resolve against. A new `growth-property-service.js` resolves/lists/creates properties, lazily mirroring any `WebsiteSite` it doesn't yet have a row for (self-healing, no migration backfill, no write coupling from `runly.website` into `runly.growth`). The two existing call sites that queried `WebsiteSite` directly (`growth-analytics-service.js`, `storefront-capture-service.js`) are repointed at the new service. `runly.growth`'s manifest dependency on `runly.website` becomes optional. A new "Sitios conectados" screen lets a user create an external property and get the same embed snippet published `runly.website` sites already use.

**Tech Stack:** Prisma 7, Hono, Zod (`@runly/validators`), React + TanStack Query, `@runly/ui` (`DataTable`, `Dialog`), `@runly/sdk`.

---

## Task 1: `GrowthProperty` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model after `GrowthDailyMetric`, around line 1306)
- Create: `prisma/migrations/20260921190000_growth_property/migration.sql`

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Insert immediately after the `GrowthDailyMetric` model (after line 1306, before the next model):

```prisma
model GrowthProperty {
  id                 String    @id @default(uuid(7)) @db.Uuid
  companyId          String    @db.Uuid @map("company_id")
  kind               String    @default("external_sdk") @map("kind")
  websiteSiteId      String?   @db.Uuid @map("website_site_id")
  name               String
  domain             String?
  status             String    @default("active")
  analyticsMode      String    @default("standard") @map("analytics_mode")
  turnstileSiteKey   String?   @map("turnstile_site_key")
  turnstileSecretKey String?   @map("turnstile_secret_key")
  capabilities       Json?
  verifiedAt         DateTime? @map("verified_at")
  enabled            Boolean   @default(true)
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@unique([companyId, websiteSiteId])
  @@index([companyId, enabled])
  @@index([companyId, domain])
  @@map("growth_property")
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:migrate --name growth_property` (this both writes the SQL file and applies it against the Supabase instance; requires the dev machine's IP to be allowlisted, which is already the case for normal `pnpm dev` work).

If the command cannot reach the database from this environment, hand-write
`prisma/migrations/20260921190000_growth_property/migration.sql` with:

```sql
-- CreateTable
CREATE TABLE "growth_property" (
    "id" UUID NOT NULL DEFAULT uuid(7)(),
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'external_sdk',
    "website_site_id" UUID,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "analytics_mode" TEXT NOT NULL DEFAULT 'standard',
    "turnstile_site_key" TEXT,
    "turnstile_secret_key" TEXT,
    "capabilities" JSONB,
    "verified_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_property_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "growth_property_company_id_website_site_id_key" ON "growth_property"("company_id", "website_site_id");

-- CreateIndex
CREATE INDEX "growth_property_company_id_enabled_idx" ON "growth_property"("company_id", "enabled");

-- CreateIndex
CREATE INDEX "growth_property_company_id_domain_idx" ON "growth_property"("company_id", "domain");
```

Note the actual `uuid(7)` default expression must match whatever the
immediately-preceding migration in `prisma/migrations/` uses for other
`GrowthX` tables (copy it verbatim from
`prisma/migrations/*/migration.sql` for the migration that created
`growth_daily_metric` — do not guess the syntax).

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm db:generate`
Expected: exits 0, no errors about `GrowthProperty`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(growth): add GrowthProperty model for site-independent tracking"
```

---

## Task 2: `growth-property-service.js`

**Files:**
- Create: `apps/api/src/routes/growth/growth-property-service.js`
- Test: `apps/api/src/routes/growth/__tests__/growth-property-service.test.js`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { createGrowthPropertyService } from "../growth-property-service.js";

const COMPANY_ID = "11111111-1111-7111-8111-111111111111";
const SITE_ID = "22222222-2222-7222-8222-222222222222";

function createPrismaStub({ growthProperties = [], websiteSites = [], growthEvents = [] } = {}) {
  const properties = [...growthProperties];
  return {
    growthProperty: {
      findFirst: async ({ where }) =>
        properties.find(
          (p) =>
            p.companyId === where.companyId &&
            (!where.id || p.id === where.id) &&
            (where.enabled === undefined || p.enabled === where.enabled),
        ) ?? null,
      findMany: async ({ where }) =>
        properties.filter((p) => p.companyId === where.companyId && p.enabled === where.enabled),
      upsert: async ({ where, create }) => {
        const key = where.companyId_websiteSiteId;
        const existing = properties.find(
          (p) => p.companyId === key.companyId && p.websiteSiteId === key.websiteSiteId,
        );
        if (existing) return existing;
        const created = { id: `mirrored-${key.websiteSiteId}`, enabled: true, ...create };
        properties.push(created);
        return created;
      },
      create: async ({ data }) => {
        const created = { id: `new-${properties.length}`, enabled: true, ...data };
        properties.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const target = properties.find((p) => p.id === where.id);
        Object.assign(target, data);
        return target;
      },
    },
    websiteSite: {
      findFirst: async ({ where }) =>
        websiteSites.find((s) => s.companyId === where.companyId && s.id === where.id) ?? null,
      findMany: async ({ where }) =>
        websiteSites.filter((s) => s.companyId === where.companyId && s.enabled === where.enabled),
    },
    growthEvent: {
      findFirst: async ({ where }) =>
        growthEvents.find((e) => e.companyId === where.companyId && e.siteId === where.siteId) ?? null,
    },
  };
}

test("resolveProperty mirrors a WebsiteSite on first call and reuses it on the second", async () => {
  const prisma = createPrismaStub({
    websiteSites: [{ id: SITE_ID, companyId: COMPANY_ID, name: "Acme", domain: "acme.test", analyticsMode: "standard", enabled: true }],
  });
  const service = createGrowthPropertyService({ prisma });

  const first = await service.resolveProperty({ companyId: COMPANY_ID, propertyId: SITE_ID });
  assert.equal(first.kind, "website_module");
  assert.equal(first.websiteSiteId, SITE_ID);

  const mirroredCount = (await prisma.growthProperty.findMany({ where: { companyId: COMPANY_ID, enabled: true } })).length;
  assert.equal(mirroredCount, 1);

  const second = await service.resolveProperty({ companyId: COMPANY_ID, propertyId: SITE_ID });
  assert.equal(second.id, first.id);
});

test("resolveProperty returns null when neither a GrowthProperty nor a WebsiteSite match", async () => {
  const prisma = createPrismaStub();
  const service = createGrowthPropertyService({ prisma });
  const result = await service.resolveProperty({ companyId: COMPANY_ID, propertyId: SITE_ID });
  assert.equal(result, null);
});

test("createExternalProperty + verifyProperty happy path", async () => {
  const prisma = createPrismaStub();
  const service = createGrowthPropertyService({ prisma });

  const created = await service.createExternalProperty({
    companyId: COMPANY_ID,
    name: "runly.mx",
    domain: "https://runly.mx",
  });
  assert.equal(created.kind, "external_sdk");
  assert.equal(created.status, "pending_verification");

  const notYet = await service.verifyProperty({ companyId: COMPANY_ID, propertyId: created.id });
  assert.equal(notYet.verified, false);

  prisma.growthProperty.findFirst = async ({ where }) =>
    where.id === created.id ? created : null;
  const withEvent = createPrismaStub({ growthProperties: [created], growthEvents: [{ companyId: COMPANY_ID, siteId: created.id }] });
  const service2 = createGrowthPropertyService({ prisma: withEvent });
  const verified = await service2.verifyProperty({ companyId: COMPANY_ID, propertyId: created.id });
  assert.equal(verified.verified, true);
  assert.equal(verified.property.status, "active");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/growth/__tests__/growth-property-service.test.js`
Expected: FAIL — `Cannot find module '../growth-property-service.js'`

- [ ] **Step 3: Write the implementation**

```js
export class GrowthPropertyServiceError extends Error {
  constructor(message, status = 400, code = "growth_property_error") {
    super(message);
    this.name = "GrowthPropertyServiceError";
    this.status = status;
    this.code = code;
  }
}

function normalizeDomain(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function sortByCreatedAt(list) {
  return [...list].sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
}

export function createGrowthPropertyService({ prisma, now = () => new Date() }) {
  async function mirrorWebsiteSite({ companyId, site }) {
    return prisma.growthProperty.upsert({
      where: { companyId_websiteSiteId: { companyId, websiteSiteId: site.id } },
      update: {
        name: site.name,
        domain: site.domain,
        analyticsMode: site.analyticsMode,
        turnstileSiteKey: site.turnstileSiteKey ?? null,
        turnstileSecretKey: site.turnstileSecretKey ?? null,
      },
      create: {
        companyId,
        kind: "website_module",
        websiteSiteId: site.id,
        name: site.name,
        domain: site.domain,
        status: "active",
        analyticsMode: site.analyticsMode ?? "standard",
        turnstileSiteKey: site.turnstileSiteKey ?? null,
        turnstileSecretKey: site.turnstileSecretKey ?? null,
        verifiedAt: now(),
      },
    });
  }

  async function listProperties({ companyId }) {
    const [properties, websiteSites] = await Promise.all([
      prisma.growthProperty.findMany({ where: { companyId, enabled: true } }),
      prisma.websiteSite.findMany({ where: { companyId, enabled: true } }),
    ]);

    const mirroredSiteIds = new Set(
      properties.filter((p) => p.websiteSiteId).map((p) => p.websiteSiteId),
    );
    const missing = websiteSites.filter((site) => !mirroredSiteIds.has(site.id));
    if (missing.length === 0) return sortByCreatedAt(properties);

    const created = await Promise.all(missing.map((site) => mirrorWebsiteSite({ companyId, site })));
    return sortByCreatedAt([...properties, ...created]);
  }

  async function resolveProperty({ companyId, propertyId }) {
    if (!propertyId) {
      const list = await listProperties({ companyId });
      return list[0] ?? null;
    }
    const existing = await prisma.growthProperty.findFirst({
      where: { companyId, id: propertyId, enabled: true },
    });
    if (existing) return existing;

    const site = await prisma.websiteSite.findFirst({
      where: { companyId, id: propertyId, enabled: true },
    });
    if (site) return mirrorWebsiteSite({ companyId, site });

    return null;
  }

  async function assertProperty({ companyId, propertyId }) {
    if (!propertyId) return null;
    const property = await resolveProperty({ companyId, propertyId });
    if (!property) {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    }
    return property;
  }

  async function createExternalProperty({ companyId, name, domain }) {
    const normalizedDomain = normalizeDomain(domain);
    if (normalizedDomain) {
      const existing = await prisma.growthProperty.findFirst({
        where: { companyId, domain: normalizedDomain, enabled: true },
      });
      if (existing) {
        throw new GrowthPropertyServiceError(
          "Ya existe un sitio conectado con ese dominio.",
          409,
          "property_domain_conflict",
        );
      }
    }
    return prisma.growthProperty.create({
      data: {
        companyId,
        kind: "external_sdk",
        name: String(name).trim(),
        domain: normalizedDomain,
        status: "pending_verification",
        analyticsMode: "standard",
      },
    });
  }

  async function updateProperty({ companyId, propertyId, patch }) {
    const property = await prisma.growthProperty.findFirst({
      where: { companyId, id: propertyId },
    });
    if (!property) {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    }
    const data = {};
    if (patch.name !== undefined) data.name = String(patch.name).trim();
    if (patch.domain !== undefined) data.domain = normalizeDomain(patch.domain);
    if (patch.enabled !== undefined) data.enabled = Boolean(patch.enabled);
    return prisma.growthProperty.update({ where: { id: propertyId }, data });
  }

  async function verifyProperty({ companyId, propertyId }) {
    const property = await prisma.growthProperty.findFirst({
      where: { companyId, id: propertyId },
    });
    if (!property) {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    }
    if (property.status === "active") {
      return { property, verified: true };
    }
    const hasEvent = await prisma.growthEvent.findFirst({
      where: { companyId, siteId: propertyId },
      select: { id: true },
    });
    if (!hasEvent) {
      return { property, verified: false };
    }
    const updated = await prisma.growthProperty.update({
      where: { id: propertyId },
      data: { status: "active", verifiedAt: now() },
    });
    return { property: updated, verified: true };
  }

  return {
    listProperties,
    resolveProperty,
    assertProperty,
    createExternalProperty,
    updateProperty,
    verifyProperty,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/growth/__tests__/growth-property-service.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/growth/growth-property-service.js apps/api/src/routes/growth/__tests__/growth-property-service.test.js
git commit -m "feat(growth): add growth-property-service with self-healing site mirroring"
```

---

## Task 3: Validators

**Files:**
- Modify: `packages/validators/src/index.js` (add after the existing growth analytics schemas, near line 893)
- Modify: `apps/api/src/routes/growth/growth-validators.js`

- [ ] **Step 1: Add schemas to `packages/validators/src/index.js`**

Add after `growthAnalyticsExportQuerySchema`:

```js
export const growthPropertyCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(300).optional(),
});

export const growthPropertyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    domain: z.string().trim().min(1).max(300).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No hay cambios para aplicar.",
  });
```

- [ ] **Step 2: Re-export from `apps/api/src/routes/growth/growth-validators.js`**

Add `growthPropertyCreateSchema` and `growthPropertyUpdateSchema` to the existing `export { ... } from "@runly/validators";` list (alphabetical, matching the existing style).

- [ ] **Step 3: Commit**

```bash
git add packages/validators/src/index.js apps/api/src/routes/growth/growth-validators.js
git commit -m "feat(growth): add validators for GrowthProperty create/update"
```

---

## Task 4: Routes, manifest, permissions

**Files:**
- Create: `apps/api/src/routes/growth/growth-property-routes.js`
- Modify: `apps/api/src/routes/growth/growth-router.js`
- Modify: `apps/api/src/manifests/official/feature-modules.js:381-471` (`runlyGrowthManifest`)
- Modify: `apps/api/src/permission-catalog.js` (after line 1109, the `growth.analytics.export` entry)

- [ ] **Step 1: Create the routes file**

```js
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { GrowthPropertyServiceError } from "./growth-property-service.js";
import {
  growthPropertyCreateSchema,
  growthPropertyUpdateSchema,
} from "./growth-validators.js";

function companyId(c) {
  return c.get("companyId") ?? null;
}

function handleError(c, error) {
  if (error instanceof GrowthPropertyServiceError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  console.error("[runly.growth.properties]", error);
  return c.json({ error: "Error interno de sitios Growth." }, 500);
}

export function createGrowthPropertyRoutes({ service, requirePermission }) {
  const app = new Hono();

  app.get("/growth/properties", requirePermission("growth.access"), async (c) => {
    try {
      const data = await service.listProperties({ companyId: companyId(c) });
      return c.json({ data });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post(
    "/growth/properties",
    requirePermission("growth.properties.manage"),
    zValidator("json", growthPropertyCreateSchema),
    async (c) => {
      try {
        const data = await service.createExternalProperty({
          companyId: companyId(c),
          ...c.req.valid("json"),
        });
        return c.json({ data }, 201);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.patch(
    "/growth/properties/:id",
    requirePermission("growth.properties.manage"),
    zValidator("json", growthPropertyUpdateSchema),
    async (c) => {
      try {
        const data = await service.updateProperty({
          companyId: companyId(c),
          propertyId: c.req.param("id"),
          patch: c.req.valid("json"),
        });
        return c.json({ data });
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.post(
    "/growth/properties/:id/verify",
    requirePermission("growth.properties.manage"),
    async (c) => {
      try {
        const result = await service.verifyProperty({
          companyId: companyId(c),
          propertyId: c.req.param("id"),
        });
        return c.json({ data: result.property, verified: result.verified });
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  return app;
}
```

- [ ] **Step 2: Mount it in `growth-router.js`**

```js
import { createGrowthAnalyticsRoutes } from "./growth-analytics-routes.js";
import { createGrowthAnalyticsService } from "./growth-analytics-service.js";
import { createGrowthCommentRoutes } from "./growth-comment-routes.js";
import { createCommentsService } from "../../services/comments-service.js";
import { createGrowthLeadRoutes } from "./growth-lead-routes.js";
import { createGrowthLeadService } from "./growth-lead-service.js";
import { createGrowthPropertyRoutes } from "./growth-property-routes.js";
import { createGrowthPropertyService } from "./growth-property-service.js";
```

and inside `createGrowthRouter`, after `const analyticsService = ...`:

```js
  const propertyService = createGrowthPropertyService({ prisma });
```

and, alongside the other `app.route(...)` calls:

```js
  app.route(
    "",
    createGrowthPropertyRoutes({ service: propertyService, requirePermission }),
  );
```

- [ ] **Step 3: Update the manifest** (`apps/api/src/manifests/official/feature-modules.js`)

Change the `dependencies` array (line 381-385):

```js
  dependencies: [
    { key: "runly.core" },
    { key: "runly.website", optional: true },
    { key: "runly.contacts" },
  ],
```

Add `"GrowthProperty"` / `"growth_property"` to `ownedEntities` / `ownedTables` (lines 392-407):

```js
    ownedEntities: [
      "GrowthVisitor",
      "GrowthSession",
      "GrowthEvent",
      "GrowthLead",
      "GrowthLeadActivity",
      "GrowthDailyMetric",
      "GrowthProperty",
    ],
    ownedTables: [
      "growth_visitor",
      "growth_session",
      "growth_event",
      "growth_lead",
      "growth_lead_activity",
      "growth_daily_metric",
      "growth_property",
    ],
```

Add a nav entry and permission (in `navigation`, after the "Leads" entry, and in `permissions`, after `growth.analytics.export`):

```js
    {
      label: "Sitios conectados",
      path: "/sites",
      icon: "Globe",
      layout: "main",
      permissionKey: "growth.access",
    },
```

```js
    { key: "growth.properties.manage", name: "Gestionar sitios conectados" },
```

- [ ] **Step 4: Add the permission catalog entry** (`apps/api/src/permission-catalog.js`, after the `growth.analytics.export` block around line 1109)

```js
  "growth.properties.manage": {
    displayNameEs: "Gestionar sitios conectados",
    descriptionEs: "Permite conectar, renombrar y desactivar sitios rastreados por Growth.",
    groupKey: "growth",
    order: 22,
  },
```

- [ ] **Step 5: Reseed permissions/manifest into the DB**

Run: `pnpm db:seed`
Expected: exits 0, seeds the new `growth.properties.manage` permission and updated manifest.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/growth/growth-property-routes.js apps/api/src/routes/growth/growth-router.js apps/api/src/manifests/official/feature-modules.js apps/api/src/permission-catalog.js
git commit -m "feat(growth): expose /growth/properties API and make website dependency optional"
```

---

## Task 5: Repoint `growth-analytics-service.js`

**Files:**
- Modify: `apps/api/src/routes/growth/growth-analytics-service.js:173-194`
- Modify: `apps/api/src/routes/growth/__tests__/growth-analytics-service.test.js` (only if it stubs `prisma.websiteSite` for `listSites`/`assertSite` — adjust those fixtures to also satisfy `growthPropertyService`, or stub `growthPropertyService` directly)

- [ ] **Step 1: Inject the property service with a safe default**

Change the factory signature (line 173-176):

```js
import { createGrowthPropertyService } from "./growth-property-service.js";

export function createGrowthAnalyticsService({
  prisma,
  now = () => new Date(),
  growthPropertyService = createGrowthPropertyService({ prisma }),
}) {
```

- [ ] **Step 2: Replace `listSites` and `assertSite`** (lines 177-194)

```js
  async function listSites({ companyId }) {
    const properties = await growthPropertyService.listProperties({ companyId });
    return properties.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      kind: p.kind,
      status: p.status,
    }));
  }

  async function assertSite({ companyId, siteId }) {
    if (!siteId) return;
    await growthPropertyService.assertProperty({ companyId, propertyId: siteId });
  }
```

Note: `assertProperty` already throws `GrowthPropertyServiceError` with `status: 404`. `growth-analytics-routes.js`'s `handleError` only special-cases `GrowthAnalyticsServiceError` — add a second `instanceof` branch so the 404 still surfaces correctly instead of falling through to the generic 500:

In `apps/api/src/routes/growth/growth-analytics-routes.js`, update `handleError`:

```js
import { GrowthAnalyticsServiceError } from "./growth-analytics-service.js";
import { GrowthPropertyServiceError } from "./growth-property-service.js";
...
function handleError(c, error) {
  if (error instanceof GrowthAnalyticsServiceError || error instanceof GrowthPropertyServiceError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  console.error("[runly.growth.analytics]", error);
  return c.json({ error: "Error interno de analitica Growth." }, 500);
}
```

- [ ] **Step 3: Run the existing analytics service/routes tests**

Run: `node --test apps/api/src/routes/growth/__tests__/growth-analytics-service.test.js apps/api/src/routes/growth/__tests__/growth-analytics-routes.test.js`
Expected: PASS. If a test constructs `createGrowthAnalyticsService({ prisma })` with a bare Prisma stub that only implements `websiteSite`, add a matching `growthProperty`/`growthEvent` stub (empty `findMany`/`findFirst` returning `[]`/`null` is enough) so the default `growthPropertyService` doesn't throw — or pass an explicit `growthPropertyService` test double with `listProperties`/`assertProperty` stubs, whichever requires less fixture rework.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/growth/growth-analytics-service.js apps/api/src/routes/growth/growth-analytics-routes.js apps/api/src/routes/growth/__tests__/growth-analytics-service.test.js apps/api/src/routes/growth/__tests__/growth-analytics-routes.test.js
git commit -m "refactor(growth): resolve analytics site filter via GrowthProperty"
```

---

## Task 6: Repoint `storefront-capture-service.js`

**Files:**
- Modify: `apps/api/src/services/storefront-capture-service.js:63-183`
- Modify: `apps/api/src/services/__tests__/storefront-capture-service.test.js` (adjust the Prisma stub used in `resolveSite`-dependent tests)

- [ ] **Step 1: Inject the property service with a safe default**

```js
import { createGrowthPropertyService } from "../routes/growth/growth-property-service.js";

export function createStorefrontCaptureService({
  prisma,
  verifyTurnstile = async () => false,
  notificationService = null,
  now = () => new Date(),
  growthPropertyService = createGrowthPropertyService({ prisma, now }),
}) {
```

- [ ] **Step 2: Replace the body of `resolveSite`** (lines 144-183) — keep the company lookup, replace the `prisma.websiteSite.findFirst` block:

```js
  async function resolveSite({ companySlug, siteId, origin }) {
    const normalizedCompanySlug = String(companySlug ?? "").trim();
    if (!normalizedCompanySlug) {
      throw new StorefrontCaptureError(
        "company_required",
        "La empresa es requerida.",
        400,
      );
    }

    const company = await prisma.company.findFirst({
      where: { slug: normalizedCompanySlug, enabled: true },
      select: { id: true, slug: true },
    });
    if (!company) {
      throw new StorefrontCaptureError(
        "company_not_found",
        "Empresa no encontrada.",
        404,
      );
    }

    const site = await growthPropertyService.resolveProperty({
      companyId: company.id,
      propertyId: siteId,
    });
    if (!site) {
      throw new StorefrontCaptureError(
        "site_not_found",
        "Sitio no encontrado.",
        404,
      );
    }

    assertAllowedOrigin(site, origin);
    return { company, site };
  }
```

`site.domain`, `site.analyticsMode`, `site.turnstileSiteKey` keep the same
field names on `GrowthProperty` as they had on `WebsiteSite`, so every other
function in this file (`getPublicConfig`, `captureEvents`,
`assertAnalyticsPolicy`, the form endpoints) needs no changes — they only
ever read those three fields plus `site.id` off whatever `resolveSite`
returns.

- [ ] **Step 3: Run the existing capture service tests**

Run: `node --test apps/api/src/services/__tests__/storefront-capture-service.test.js apps/api/src/routes/storefront/__tests__/storefront-capture-routes.test.js`
Expected: PASS. Where a test's Prisma stub only implements `websiteSite.findFirst`, either add `growthProperty`/`growthEvent`/`websiteSite.findMany` stubs so the default `growthPropertyService` resolves correctly (mirroring pattern from Task 2's test stub), or construct the service under test with an explicit `growthPropertyService` double.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/storefront-capture-service.js apps/api/src/services/__tests__/storefront-capture-service.test.js apps/api/src/routes/storefront/__tests__/storefront-capture-routes.test.js
git commit -m "refactor(growth): resolve public capture site via GrowthProperty"
```

---

## Task 7: SDK client methods

**Files:**
- Modify: `packages/sdk/src/domains/growth.js`
- Test: `packages/sdk/src/__tests__/growth-domain.test.js` (extend with the new methods, following the existing test's shape for `listAnalyticsSites`)

- [ ] **Step 1: Add methods** (in `createGrowthDomain`, after `listAnalyticsSites`)

```js
    listProperties: (token) =>
      request("/growth/properties", {
        headers: withAuthHeaders(token),
      }),

    createProperty: (payload, token) =>
      request("/growth/properties", {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    updateProperty: (propertyId, payload, token) =>
      request(`/growth/properties/${encodeURIComponent(propertyId)}`, {
        method: "PATCH",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    verifyProperty: (propertyId, token) =>
      request(`/growth/properties/${encodeURIComponent(propertyId)}/verify`, {
        method: "POST",
        headers: withAuthHeaders(token),
      }),
```

- [ ] **Step 2: Read the existing test file to match its exact mock-`request` shape**, then add one test asserting `listProperties` calls `request("/growth/properties", ...)` with auth headers — mirror the existing `listAnalyticsSites` test case exactly (same fixture setup), just swap the method/path.

- [ ] **Step 3: Run the SDK test**

Run: `node --test packages/sdk/src/__tests__/growth-domain.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/domains/growth.js packages/sdk/src/__tests__/growth-domain.test.js
git commit -m "feat(sdk): add growth property client methods"
```

---

## Task 8: `ConnectExternalSiteDialog`

**Files:**
- Create: `apps/desktop/src/modules/runly.growth/components/ConnectExternalSiteDialog.jsx`

- [ ] **Step 1: Write the component**

```jsx
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
} from "@runly/ui";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

const PUBLIC_SDK_URL =
  `${import.meta.env.VITE_RUNLY_API_URL ?? ""}/public/site/runly-sdk.js`;

function buildSnippet({ companySlug, propertyId }) {
  return [
    "<script>",
    `  window.RUNLY_CONFIG = { company: "${companySlug}", siteId: "${propertyId}" };`,
    "</script>",
    `<script src="${PUBLIC_SDK_URL}" async></script>`,
  ].join("\n");
}

export function ConnectExternalSiteDialog({
  open,
  onOpenChange,
  companySlug,
  onCreate,
  onVerify,
  creating,
  verifying,
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [property, setProperty] = useState(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName("");
    setDomain("");
    setProperty(null);
    setCopied(false);
  }

  async function handleCreate() {
    const created = await onCreate({ name, domain: domain || undefined });
    if (created) setProperty(created);
  }

  async function handleVerify() {
    const result = await onVerify(property.id);
    if (result?.verified) {
      setProperty(result.data);
      toast.success("Sitio verificado: ya estamos recibiendo datos.");
    } else {
      toast.info("Aun no recibimos eventos de ese sitio. Verifica que el snippet este publicado.");
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(buildSnippet({ companySlug, propertyId: property.id }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar sitio externo</DialogTitle>
        </DialogHeader>

        {!property ? (
          <div className="space-y-4">
            <TextField
              label="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sitio principal"
            />
            <TextField
              label="Dominio"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="runly.mx"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Pega este fragmento antes de {"</body>"} en tu sitio externo:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs">
              {buildSnippet({ companySlug, propertyId: property.id })}
            </pre>
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copiado" : "Copiar snippet"}
            </Button>
          </div>
        )}

        <DialogFooter>
          {!property ? (
            <Button type="button" onClick={handleCreate} disabled={!name || creating}>
              {creating ? "Creando..." : "Crear sitio"}
            </Button>
          ) : (
            <Button type="button" onClick={handleVerify} disabled={verifying}>
              {verifying ? "Verificando..." : "Verificar conexion"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.growth/components/ConnectExternalSiteDialog.jsx
git commit -m "feat(growth): add external site connect wizard dialog"
```

---

## Task 9: `GrowthPropertiesScreen` + routing

**Files:**
- Create: `apps/desktop/src/modules/runly.growth/screens/GrowthPropertiesScreen.jsx`
- Modify: `apps/desktop/src/app/ModuleOutlet.jsx:237-245` (add route entry)

- [ ] **Step 1: Write the screen**

```jsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
} from "@runly/ui";
import { Globe, Plus } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../../../auth/AuthProvider.jsx";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider.jsx";
import { runly } from "../../../lib/runly.js";
import { ConnectExternalSiteDialog } from "../components/ConnectExternalSiteDialog.jsx";

const KIND_LABEL = {
  website_module: "Sitio del modulo Web",
  external_sdk: "Sitio externo (SDK)",
};

const STATUS_VARIANT = {
  active: "success",
  pending_verification: "warning",
  disabled: "secondary",
};

export default function GrowthPropertiesScreen() {
  const { session, userProfile } = useAuth();
  const { activeCompany } = useActiveCompany();
  const token = session?.access_token;
  const permissions = userProfile?.permissions ?? [];
  const canManage = Boolean(
    userProfile?.isAdmin || permissions.includes("growth.properties.manage"),
  );
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["growth", "properties"],
    queryFn: () => runly.growth.listProperties(token),
    enabled: Boolean(token),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => runly.growth.createProperty(payload, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["growth", "properties"] }),
    onError: (err) => toast.error(err?.message || "No se pudo crear el sitio"),
  });

  const verifyMutation = useMutation({
    mutationFn: (propertyId) => runly.growth.verifyProperty(propertyId, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["growth", "properties"] }),
  });

  const properties = data?.data ?? [];

  const columns = useMemo(
    () => [
      { accessorKey: "name", header: "Nombre" },
      { accessorKey: "domain", header: "Dominio" },
      {
        accessorKey: "kind",
        header: "Tipo",
        cell: ({ row }) => KIND_LABEL[row.original.kind] ?? row.original.kind,
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status] ?? "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
    ],
    [],
  );

  if (!canManage && properties.length === 0 && !isLoading) {
    return (
      <div className="min-h-dvh p-4 md:p-6">
        <PageHeader eyebrow="Runly Growth" title="Sitios conectados" />
        <ErrorState description="No tienes permisos para gestionar sitios conectados." />
      </div>
    );
  }

  return (
    <div className="min-h-dvh space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Runly Growth"
        title="Sitios conectados"
        description="Sitios rastreados por Growth, ya sea publicados con el modulo Web o conectados externamente via SDK."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Conectar sitio externo
            </Button>
          ) : null
        }
      />

      {isError ? (
        <ErrorState description={error?.message} onRetry={() => refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={properties}
          isLoading={isLoading}
          emptyIcon={Globe}
          emptyTitle="Sin sitios conectados"
          emptyDescription="Conecta un sitio externo o instala el modulo Web para empezar a rastrear."
          showToolbar={false}
        />
      )}

      <ConnectExternalSiteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companySlug={activeCompany?.slug}
        creating={createMutation.isPending}
        verifying={verifyMutation.isPending}
        onCreate={(payload) => createMutation.mutateAsync(payload).then((res) => res.data)}
        onVerify={(propertyId) => verifyMutation.mutateAsync(propertyId)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `ModuleOutlet.jsx`**

Add after the `"runly.growth:/leads/:id"` entry (line 245):

```js
  "runly.growth:/sites": lazy(
    () => import("../modules/runly.growth/screens/GrowthPropertiesScreen.jsx"),
  ),
```

- [ ] **Step 3: Start the dev server and click through it manually**

Run: `pnpm dev:frontend` (or use the already-running `pnpm dev`), open the Growth module, navigate to "Sitios conectados", create a test external property, confirm the snippet renders with the right company slug and property id, and that "Verificar conexion" returns `verified: false` for a brand-new property (no events yet). This is real UI verification, not a substitute for it — do not skip.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.growth/screens/GrowthPropertiesScreen.jsx apps/desktop/src/app/ModuleOutlet.jsx
git commit -m "feat(growth): add connected-sites management screen"
```

---

## Task 10: Final verification

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: exits 0.

- [ ] **Step 2: Full backend test sweep for touched areas**

Run:
```bash
node --test apps/api/src/routes/growth/__tests__/
node --test apps/api/src/services/__tests__/storefront-capture-service.test.js
node --test apps/api/src/routes/storefront/__tests__/storefront-capture-routes.test.js
node --test packages/sdk/src/__tests__/growth-domain.test.js
```
Expected: all PASS.

- [ ] **Step 3: Syntax-check every new/modified JS file**

Run: `node --check apps/api/src/routes/growth/growth-property-service.js && node --check apps/api/src/routes/growth/growth-property-routes.js && node --check apps/api/src/services/storefront-capture-service.js`
Expected: no output (success).

- [ ] **Step 4: Confirm the file-size ceiling wasn't crossed**

None of the modified files (`growth-analytics-service.js`, `storefront-capture-service.js`, `growth-router.js`) were close to 800 lines before this change and this plan adds under 40 lines to each — no split needed. `GrowthAnalyticsScreen.jsx`/`GrowthLeadsScreen.jsx` are untouched by this plan.

- [ ] **Step 5: Final commit if any verification step required fixes**

```bash
git add -A
git commit -m "fix(growth): address verification findings for external sites feature"
```

(Skip this commit if Steps 1-4 required no changes.)
