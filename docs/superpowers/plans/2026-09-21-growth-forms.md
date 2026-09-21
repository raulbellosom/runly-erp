# Growth Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `runly.growth` create/manage forms (fields, settings,
submissions) and notify a `notifyEmail` address on submit, without
requiring `runly.website` to be installed, by extracting the already
site-agnostic form CRUD logic into a shared service and building a
growth-owned admin screen on top of it.

**Architecture:** The 12 form-CRUD functions in `website-service.js` (no
`WebsiteSite`-specific logic today) move into a new, independent
`forms-service.js`, used by both `runly.website`'s existing routes and new
`runly.growth` routes. The five Zod schemas backing them move into
`@runly/validators`, alongside a sixth (`growthFormCreateSchema`) that
renames `siteId` to `propertyId` for growth's API surface. Three of the five
frontend form-admin panels get a `basePath` prop and move to a shared
components folder; the list/detail orchestrator screen is duplicated (not
shared) into growth because its "how to integrate" instructions are
genuinely different for an SDK-connected external site. `submitForm` gains
an SMTP notification, reusing the existing `email-templates.js`
`build*Email` pattern and `smtp-service.js`.

**Tech Stack:** Prisma 7, Hono, Zod (`@runly/validators`), React + TanStack
Query, `@runly/ui`, nodemailer (via `smtp-service.js`).

---

## Task 1: Move form validators into `@runly/validators`

**Files:**
- Modify: `packages/validators/src/index.js` (insert after
  `growthPropertyUpdateSchema`, around line 912)
- Modify: `apps/api/src/routes/website/validators.js:139-201` (remove, replace
  with re-export)

- [ ] **Step 1: Add the schemas to `packages/validators/src/index.js`**

Insert after `growthPropertyUpdateSchema` (before the `documentBlockIdSchema`
line):

```js
const FORM_FIELD_TYPES = [
  "text", "email", "phone", "tel", "textarea", "select", "radio",
  "checkbox", "number", "date", "chip_multi", "card_select",
];

const formFieldOptions = z
  .array(
    z.union([
      z.string(),
      z.object({
        value: z.string(),
        label: z.string(),
        description: z.string().optional(),
      }),
    ]),
  )
  .optional()
  .nullable();

export const createFormSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  submitLabel: z.string().optional(),
  successMessage: z.string().optional(),
  notifyEmail: z.string().email().optional().nullable(),
  createsLead: z.boolean().default(true),
  defaultAssigneeUserId: z.string().uuid().optional().nullable(),
  honeypotEnabled: z.boolean().default(true),
  turnstileRequired: z.boolean().default(false),
  wizardMode: z.boolean().default(false),
});

export const growthFormCreateSchema = createFormSchema
  .omit({ siteId: true })
  .extend({ propertyId: z.string().uuid() });

export const updateFormSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  submitLabel: z.string().optional(),
  successMessage: z.string().optional(),
  notifyEmail: z.string().email().optional().nullable(),
  createsLead: z.boolean().optional(),
  defaultAssigneeUserId: z.string().uuid().optional().nullable(),
  honeypotEnabled: z.boolean().optional(),
  turnstileRequired: z.boolean().optional(),
  wizardMode: z.boolean().optional(),
});

export const createFormFieldSchema = z.object({
  label: z.string().min(1).max(255),
  name: z.string().min(1).max(100).regex(/^[a-z_][a-z0-9_]*$/),
  fieldType: z.enum(FORM_FIELD_TYPES).default("text"),
  semanticKey: z
    .enum(["name", "email", "phone", "company", "message", "custom"])
    .default("custom"),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  options: formFieldOptions,
  sortOrder: z.number().int().default(0),
  stepNumber: z.number().int().min(1).default(1),
  stepTitle: z.string().optional().nullable(),
});

export const updateFormFieldSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(100).regex(/^[a-z_][a-z0-9_]*$/).optional(),
  fieldType: z.enum(FORM_FIELD_TYPES).optional(),
  semanticKey: z
    .enum(["name", "email", "phone", "company", "message", "custom"])
    .optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  options: formFieldOptions,
  sortOrder: z.number().int().optional(),
  stepNumber: z.number().int().min(1).optional(),
  stepTitle: z.string().optional().nullable(),
});

export const reorderFieldsSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })),
});
```

- [ ] **Step 2: Replace the local definitions in `website/validators.js`**

Delete lines 139-201 (the `FIELD_TYPES` constant through
`reorderFieldsSchema`) and replace with:

```js
export {
  createFormSchema,
  updateFormSchema,
  createFormFieldSchema,
  updateFormFieldSchema,
  reorderFieldsSchema,
} from "@runly/validators";
```

Keep this re-export block at the same position (after `saveBlogDraftSchema`,
before whatever follows) so `forms-routes.js`'s existing
`import { ... } from './validators.js'` keeps working unchanged.

- [ ] **Step 3: Syntax-check and commit**

Run: `node --check apps/api/src/routes/website/validators.js`

```bash
git add packages/validators/src/index.js apps/api/src/routes/website/validators.js
git commit -m "feat(forms): move form validators into @runly/validators"
```

---

## Task 2: Extract `forms-service.js`, repoint website's routes at it

**Files:**
- Create: `apps/api/src/services/forms-service.js`
- Modify: `apps/api/src/routes/website/website-service.js` (remove
  `assertFormAssignee` at lines 23-40, the 12 form functions at lines
  695-825, and their 12 entries in the returned object at lines 865-876)
- Modify: `apps/api/src/routes/website/forms-routes.js` (swap `websiteSvc`
  for `formsService`, swap the error class)
- Modify: `apps/api/src/routes/website/index.js` (construct and pass
  `formsService`)
- Test: `apps/api/src/services/__tests__/forms-service.test.js`

- [ ] **Step 1: Create `forms-service.js`**

```js
export class FormsServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "FormsServiceError";
    this.status = status;
  }
}

function notFound(entity) {
  return new FormsServiceError(`${entity} no encontrado.`, 404);
}

export function createFormsService({ prisma }) {
  async function assertFormAssignee({ companyId, userId }) {
    if (!userId) return;
    const membership = await prisma.membership.findFirst({
      where: {
        companyId,
        userId,
        enabled: true,
        user: { enabled: true },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new FormsServiceError(
        "El responsable debe ser un usuario activo de la empresa.",
        422,
      );
    }
  }

  async function listForms({ companyId, siteId }) {
    return prisma.websiteForm.findMany({
      where: { companyId, siteId, enabled: true },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { fields: true, submissions: true } } },
    });
  }

  async function getForm({ companyId, formId }) {
    const form = await prisma.websiteForm.findFirst({
      where: { id: formId, companyId, enabled: true },
      include: { fields: { where: { enabled: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!form) throw notFound("Formulario");
    return form;
  }

  async function createForm({ companyId, siteId, data }) {
    await assertFormAssignee({ companyId, userId: data.defaultAssigneeUserId });
    return prisma.websiteForm.create({
      data: {
        companyId,
        siteId,
        name: data.name,
        description: data.description ?? null,
        submitLabel: data.submitLabel ?? "Enviar",
        successMessage: data.successMessage ?? null,
        notifyEmail: data.notifyEmail ?? null,
        createsLead: data.createsLead ?? true,
        defaultAssigneeUserId: data.defaultAssigneeUserId ?? null,
        honeypotEnabled: data.honeypotEnabled ?? true,
        turnstileRequired: data.turnstileRequired ?? false,
        wizardMode: data.wizardMode ?? false,
      },
    });
  }

  async function updateForm({ companyId, formId, data }) {
    const form = await prisma.websiteForm.findFirst({ where: { id: formId, companyId } });
    if (!form) throw notFound("Formulario");
    await assertFormAssignee({ companyId, userId: data.defaultAssigneeUserId });
    return prisma.websiteForm.update({ where: { id: formId }, data });
  }

  async function listFormAssignees({ companyId }) {
    const memberships = await prisma.membership.findMany({
      where: { companyId, enabled: true, user: { enabled: true } },
      orderBy: { user: { displayName: "asc" } },
      select: { user: { select: { id: true, displayName: true, email: true } } },
    });
    return memberships.map((membership) => membership.user);
  }

  async function softDeleteForm({ companyId, formId }) {
    const form = await prisma.websiteForm.findFirst({ where: { id: formId, companyId } });
    if (!form) throw notFound("Formulario");
    return prisma.websiteForm.update({ where: { id: formId }, data: { enabled: false } });
  }

  async function createFormField({ companyId, formId, data }) {
    const form = await prisma.websiteForm.findFirst({ where: { id: formId, companyId } });
    if (!form) throw notFound("Formulario");
    return prisma.websiteFormField.create({
      data: {
        companyId,
        formId,
        label: data.label,
        name: data.name,
        fieldType: data.fieldType ?? "text",
        semanticKey: data.semanticKey ?? "custom",
        placeholder: data.placeholder ?? null,
        required: data.required ?? false,
        options: data.options ?? null,
        sortOrder: data.sortOrder ?? 0,
        stepNumber: data.stepNumber ?? 1,
        stepTitle: data.stepTitle ?? null,
      },
    });
  }

  async function updateFormField({ companyId, fieldId, data }) {
    const field = await prisma.websiteFormField.findFirst({ where: { id: fieldId, companyId } });
    if (!field) throw notFound("Campo");
    return prisma.websiteFormField.update({ where: { id: fieldId }, data });
  }

  async function softDeleteFormField({ companyId, fieldId }) {
    const field = await prisma.websiteFormField.findFirst({ where: { id: fieldId, companyId } });
    if (!field) throw notFound("Campo");
    return prisma.websiteFormField.update({ where: { id: fieldId }, data: { enabled: false } });
  }

  async function reorderFormFields({ companyId, items }) {
    return prisma.$transaction(
      items.map(({ id, sortOrder }) =>
        prisma.websiteFormField.update({ where: { id, companyId }, data: { sortOrder } }),
      ),
    );
  }

  async function listSubmissions({ companyId, formId, page = 1, pageSize = 20 }) {
    const skip = (page - 1) * pageSize;
    const where = { formId, companyId };
    const [data, total] = await Promise.all([
      prisma.websiteFormSubmission.findMany({ where, orderBy: { submittedAt: "desc" }, skip, take: pageSize }),
      prisma.websiteFormSubmission.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async function deleteSubmission({ companyId, submissionId }) {
    const sub = await prisma.websiteFormSubmission.findFirst({ where: { id: submissionId, companyId } });
    if (!sub) throw notFound("Envio");
    return prisma.websiteFormSubmission.delete({ where: { id: submissionId } });
  }

  return {
    listForms,
    getForm,
    createForm,
    updateForm,
    listFormAssignees,
    softDeleteForm,
    createFormField,
    updateFormField,
    softDeleteFormField,
    reorderFormFields,
    listSubmissions,
    deleteSubmission,
  };
}
```

- [ ] **Step 2: Remove the extracted code from `website-service.js`**

Delete `assertFormAssignee` (lines 23-40), the 12 form functions (lines
695-825), and their 12 entries in the final `return { ... }` (lines
865-876 — `listForms` through `deleteSubmission`). Leave everything else
(`getSite` through `softDeleteBlogPost`) untouched.

- [ ] **Step 3: Repoint `website/forms-routes.js`**

Change the top imports:

```js
import { createFormsRouter } from './forms-routes.js'
```
stays the same in `index.js`; inside `forms-routes.js` itself, change:

```js
import { WebsiteServiceError } from './service-helpers.js'
```
to:
```js
import { FormsServiceError } from '../../services/forms-service.js'
```

Then in the same file, `export function createFormsRouter({ websiteSvc, requirePermission })` becomes
`export function createFormsRouter({ formsService, requirePermission })`, and every
`websiteSvc.X(...)` call becomes `formsService.X(...)` (12 call sites), and
every `err instanceof WebsiteServiceError` becomes `err instanceof FormsServiceError`
(8 call sites). No other logic changes.

- [ ] **Step 4: Repoint `website/index.js`**

```js
import { createFormsService } from '../../services/forms-service.js'
```

and inside `createWebsiteRouter`, after `const websiteSvc = createWebsiteService({ prisma })`:

```js
  const formsService = createFormsService({ prisma })
```

and change the forms mount line:

```js
  app.route('/website', createFormsRouter({ formsService, requirePermission }))
```

- [ ] **Step 5: Write the new service test**

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { FormsServiceError, createFormsService } from "../forms-service.js";

const COMPANY_ID = "11111111-1111-7111-8111-111111111111";
const SITE_ID = "22222222-2222-7222-8222-222222222222";
const USER_ID = "33333333-3333-7333-8333-333333333333";

function createPrismaStub() {
  const forms = [];
  return {
    websiteForm: {
      findMany: async ({ where }) =>
        forms.filter((f) => f.companyId === where.companyId && f.siteId === where.siteId && f.enabled === where.enabled),
      findFirst: async ({ where }) =>
        forms.find((f) => f.id === where.id && f.companyId === where.companyId) ?? null,
      create: async ({ data }) => {
        const created = { id: `form-${forms.length}`, enabled: true, ...data };
        forms.push(created);
        return created;
      },
    },
    membership: {
      findFirst: async ({ where }) =>
        where.userId === USER_ID && where.companyId === COMPANY_ID ? { id: "membership-1" } : null,
    },
  };
}

test("createForm rejects a defaultAssigneeUserId that isn't an active member", async () => {
  const service = createFormsService({ prisma: createPrismaStub() });
  await assert.rejects(
    () =>
      service.createForm({
        companyId: COMPANY_ID,
        siteId: SITE_ID,
        data: { name: "Contacto", defaultAssigneeUserId: "44444444-4444-7444-8444-444444444444" },
      }),
    (error) => {
      assert.ok(error instanceof FormsServiceError);
      assert.equal(error.status, 422);
      return true;
    },
  );
});

test("createForm + listForms happy path", async () => {
  const service = createFormsService({ prisma: createPrismaStub() });
  const created = await service.createForm({
    companyId: COMPANY_ID,
    siteId: SITE_ID,
    data: { name: "Contacto", defaultAssigneeUserId: USER_ID },
  });
  assert.equal(created.name, "Contacto");

  const list = await service.listForms({ companyId: COMPANY_ID, siteId: SITE_ID });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
});
```

- [ ] **Step 6: Run tests, syntax-check, commit**

Run: `node --test apps/api/src/services/__tests__/forms-service.test.js`
Expected: PASS (2 tests)

Run: `node --check apps/api/src/services/forms-service.js && node --check apps/api/src/routes/website/website-service.js && node --check apps/api/src/routes/website/forms-routes.js && node --check apps/api/src/routes/website/index.js`

```bash
git add apps/api/src/services/forms-service.js apps/api/src/services/__tests__/forms-service.test.js apps/api/src/routes/website/website-service.js apps/api/src/routes/website/forms-routes.js apps/api/src/routes/website/index.js
git commit -m "refactor(forms): extract form CRUD out of website-service.js into a shared forms-service"
```

---

## Task 3: `runly.growth` admin routes for forms

**Files:**
- Create: `apps/api/src/routes/growth/growth-form-routes.js`
- Modify: `apps/api/src/routes/growth/growth-router.js`
- Modify: `apps/api/src/manifests/official/feature-modules.js` (growth's
  `permissions`/`navigation`)
- Modify: `apps/api/src/permission-catalog.js`
- Test: `apps/api/src/routes/growth/__tests__/growth-form-routes.test.js`

- [ ] **Step 1: Create the routes file**

```js
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { FormsServiceError } from "../../services/forms-service.js";
import { GrowthPropertyServiceError } from "./growth-property-service.js";
import {
  createFormFieldSchema,
  growthFormCreateSchema,
  reorderFieldsSchema,
  updateFormFieldSchema,
  updateFormSchema,
} from "./growth-validators.js";

function companyId(c) {
  return c.get("companyId") ?? null;
}

function handleError(c, error) {
  if (error instanceof FormsServiceError || error instanceof GrowthPropertyServiceError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  console.error("[runly.growth.forms]", error);
  return c.json({ error: "Error interno de formularios Growth." }, 500);
}

export function createGrowthFormRoutes({ formsService, growthPropertyService, requirePermission }) {
  const app = new Hono();

  app.get("/growth/forms", requirePermission("growth.forms.read"), async (c) => {
    const propertyId = c.req.query("propertyId");
    if (!propertyId) return c.json({ data: [] });
    try {
      const data = await formsService.listForms({ companyId: companyId(c), siteId: propertyId });
      return c.json({ data });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/growth/forms/assignees", requirePermission("growth.forms.read"), async (c) => {
    const data = await formsService.listFormAssignees({ companyId: companyId(c) });
    return c.json({ data });
  });

  app.post(
    "/growth/forms",
    requirePermission("growth.forms.create"),
    zValidator("json", growthFormCreateSchema),
    async (c) => {
      const { propertyId, ...data } = c.req.valid("json");
      try {
        await growthPropertyService.assertProperty({ companyId: companyId(c), propertyId });
        const form = await formsService.createForm({ companyId: companyId(c), siteId: propertyId, data });
        return c.json(form, 201);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.get("/growth/forms/:id", requirePermission("growth.forms.read"), async (c) => {
    try {
      const form = await formsService.getForm({ companyId: companyId(c), formId: c.req.param("id") });
      return c.json(form);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.patch(
    "/growth/forms/:id",
    requirePermission("growth.forms.update"),
    zValidator("json", updateFormSchema),
    async (c) => {
      try {
        const form = await formsService.updateForm({
          companyId: companyId(c),
          formId: c.req.param("id"),
          data: c.req.valid("json"),
        });
        return c.json(form);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.delete("/growth/forms/:id", requirePermission("growth.forms.delete"), async (c) => {
    try {
      await formsService.softDeleteForm({ companyId: companyId(c), formId: c.req.param("id") });
      return c.json({ success: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post(
    "/growth/forms/:id/fields",
    requirePermission("growth.forms.update"),
    zValidator("json", createFormFieldSchema),
    async (c) => {
      try {
        const field = await formsService.createFormField({
          companyId: companyId(c),
          formId: c.req.param("id"),
          data: c.req.valid("json"),
        });
        return c.json(field, 201);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.post(
    "/growth/forms/:id/fields/reorder",
    requirePermission("growth.forms.update"),
    zValidator("json", reorderFieldsSchema),
    async (c) => {
      const { items } = c.req.valid("json");
      await formsService.reorderFormFields({ companyId: companyId(c), items });
      return c.json({ success: true });
    },
  );

  app.patch(
    "/growth/form-fields/:fieldId",
    requirePermission("growth.forms.update"),
    zValidator("json", updateFormFieldSchema),
    async (c) => {
      try {
        const field = await formsService.updateFormField({
          companyId: companyId(c),
          fieldId: c.req.param("fieldId"),
          data: c.req.valid("json"),
        });
        return c.json(field);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.delete("/growth/form-fields/:fieldId", requirePermission("growth.forms.update"), async (c) => {
    try {
      await formsService.softDeleteFormField({ companyId: companyId(c), fieldId: c.req.param("fieldId") });
      return c.json({ success: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/growth/forms/:id/submissions", requirePermission("growth.forms.read"), async (c) => {
    const { page, pageSize } = c.req.query();
    try {
      const result = await formsService.listSubmissions({
        companyId: companyId(c),
        formId: c.req.param("id"),
        page: parseInt(page ?? "1", 10),
        pageSize: parseInt(pageSize ?? "20", 10),
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete("/growth/forms/:id/submissions/:subId", requirePermission("growth.forms.delete"), async (c) => {
    try {
      await formsService.deleteSubmission({ companyId: companyId(c), submissionId: c.req.param("subId") });
      return c.json({ success: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
```

- [ ] **Step 2: Add the 4 schemas to `growth-validators.js`**

Add to the existing `export { ... } from "@runly/validators"` list:
`createFormFieldSchema`, `growthFormCreateSchema`, `reorderFieldsSchema`,
`updateFormFieldSchema`, `updateFormSchema`.

- [ ] **Step 3: Mount in `growth-router.js`**

```js
import { createFormsService } from "../../services/forms-service.js";
import { createGrowthFormRoutes } from "./growth-form-routes.js";
```

and inside `createGrowthRouter`, after `const propertyService = ...`:

```js
  const formsService = createFormsService({ prisma });
```

and add a new `app.route(...)`:

```js
  app.route(
    "",
    createGrowthFormRoutes({ formsService, growthPropertyService: propertyService, requirePermission }),
  );
```

- [ ] **Step 4: Manifest — permissions + navigation**

In `runlyGrowthManifest`, add to `permissions` (after `growth.properties.manage`):

```js
    { key: "growth.forms.read", name: "Ver formularios" },
    { key: "growth.forms.create", name: "Crear formularios" },
    { key: "growth.forms.update", name: "Editar formularios" },
    { key: "growth.forms.delete", name: "Eliminar formularios" },
```

Add to `navigation` (after "Sitios conectados"):

```js
    {
      label: "Formularios",
      path: "/forms",
      icon: "FileText",
      layout: "main",
      permissionKey: "growth.forms.read",
    },
```

- [ ] **Step 5: `permission-catalog.js`**

Add after the `growth.properties.manage` entry:

```js
  "growth.forms.read": {
    displayNameEs: "Ver formularios",
    descriptionEs: "Permite consultar formularios y sus envios en Growth.",
    groupKey: "growth",
    order: 23,
  },
  "growth.forms.create": {
    displayNameEs: "Crear formularios",
    descriptionEs: "Permite crear formularios en Growth.",
    groupKey: "growth",
    order: 24,
  },
  "growth.forms.update": {
    displayNameEs: "Editar formularios",
    descriptionEs: "Permite editar campos y configuracion de formularios en Growth.",
    groupKey: "growth",
    order: 25,
  },
  "growth.forms.delete": {
    displayNameEs: "Eliminar formularios",
    descriptionEs: "Permite eliminar formularios y envios en Growth.",
    groupKey: "growth",
    order: 26,
  },
```

- [ ] **Step 6: Reseed, test, commit**

Run: `pnpm db:seed`

Write `growth-form-routes.test.js` with one focused test: `POST /growth/forms`
with a `propertyId` that `growthPropertyService.assertProperty` rejects
returns the property-service's 404, and never calls `formsService.createForm`.

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

import { createGrowthFormRoutes } from "../growth-form-routes.js";
import { GrowthPropertyServiceError } from "../growth-property-service.js";

function buildApp() {
  const createForm = () => {
    throw new Error("should not be called");
  };
  const formsService = { createForm, listFormAssignees: async () => [] };
  const growthPropertyService = {
    assertProperty: async () => {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    },
  };
  const requirePermission = () => async (c, next) => {
    c.set("companyId", "11111111-1111-7111-8111-111111111111");
    await next();
  };
  const app = new Hono();
  app.route("", createGrowthFormRoutes({ formsService, growthPropertyService, requirePermission }));
  return app;
}

test("POST /growth/forms 404s when propertyId doesn't resolve, without calling createForm", async () => {
  const app = buildApp();
  const res = await app.request("/growth/forms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyId: "22222222-2222-7222-8222-222222222222", name: "Contacto" }),
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, "property_not_found");
});
```

Run: `node --test apps/api/src/routes/growth/__tests__/growth-form-routes.test.js`
Expected: PASS

```bash
git add apps/api/src/routes/growth/growth-form-routes.js apps/api/src/routes/growth/growth-router.js apps/api/src/routes/growth/growth-validators.js apps/api/src/manifests/official/feature-modules.js apps/api/src/permission-catalog.js apps/api/src/routes/growth/__tests__/growth-form-routes.test.js
git commit -m "feat(growth): add /growth/forms admin API"
```

---

## Task 4: SMTP notification on submission

**Files:**
- Modify: `apps/api/src/services/email-templates.js` (add
  `buildFormSubmissionEmail`)
- Modify: `apps/api/src/services/storefront-capture-service.js`
- Test: `apps/api/src/services/__tests__/storefront-capture-service.test.js`

- [ ] **Step 1: Add `buildFormSubmissionEmail` to `email-templates.js`**

Add near the other `build*Email` functions:

```js
export function buildFormSubmissionEmail({ formName, values, fields = [], brand = null, env = process.env }) {
  const labelByName = new Map(fields.map((f) => [f.name, f.label]));
  const rows = Object.entries(values ?? {})
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:4px 12px 4px 0;font-size:13px;color:#64748b;white-space:nowrap;vertical-align:top">${escapeHtml(labelByName.get(key) ?? key)}</td>
          <td style="padding:4px 0;font-size:13px;color:#334155">${escapeHtml(String(value))}</td>
        </tr>`,
    )
    .join("");

  const bodyHtml = `
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#334155">
          Nuevo envio en <strong>${escapeHtml(formName)}</strong>.
        </p>
        <table style="border-collapse:collapse;width:100%">${rows}</table>`;

  const html = renderAtlasEmailLayout({
    kicker: "Formulario",
    heading: "Nuevo envio de formulario",
    bodyHtml,
    footnote: `Recibiste este correo porque configuraste notificaciones para el formulario "${formName}" en Runly ERP.`,
    brand,
    env,
  });

  const text = [
    `Nuevo envio en ${formName}`,
    "",
    ...Object.entries(values ?? {}).map(([key, value]) => `${labelByName.get(key) ?? key}: ${value}`),
  ].join("\n");

  return { subject: `Nuevo envio: ${formName}`, html, text };
}
```

- [ ] **Step 2: Wire it into `submitForm`**

Add the import at the top of `storefront-capture-service.js`:

```js
import { createSmtpService } from "./smtp-service.js";
import { buildFormSubmissionEmail } from "./email-templates.js";
```

Add `smtpService` to the factory params:

```js
export function createStorefrontCaptureService({
  prisma,
  verifyTurnstile = async () => false,
  notificationService = null,
  now = () => new Date(),
  growthPropertyService = createGrowthPropertyService({ prisma, now }),
  smtpService = createSmtpService({ prisma }),
}) {
```

In `submitForm`, right after the existing
`if (transactionResult.notifyAssignee && notificationService?.publish) { ... }`
block (the one ending around where `console.error("[growth.lead.created]", ...)` is), add:

```js
      if (form.notifyEmail) {
        try {
          const { subject, html, text } = buildFormSubmissionEmail({
            formName: form.name,
            values: cleanValues,
            fields: form.fields,
          });
          await smtpService.sendEmail({
            to: form.notifyEmail,
            subject,
            html,
            text,
            companyId: company.id,
          });
        } catch (error) {
          console.error("[website.form.notifyEmail]", error?.message ?? error);
        }
      }
```

- [ ] **Step 3: Add two tests to `storefront-capture-service.test.js`**

Find the existing `describe("submitForm", ...)` (or equivalent) block and
add, using the file's existing `buildPrisma()`/form fixture helpers:

```js
it("sends an SMTP notification when the form has notifyEmail set", async () => {
  const sentEmails = [];
  const service = createService(buildPrisma({ formOverrides: { notifyEmail: "owner@example.com" } }), {
    smtpService: { sendEmail: async (args) => { sentEmails.push(args); } },
  });

  await service.submitForm({
    companySlug: "acme",
    siteId: SITE_ID,
    formId: FORM_ID,
    origin: "https://shop.example.com",
    idempotencyKey: "idem-notify-1",
    payload: { values: { full_name: "Ana", email: "ana@example.com" }, honeypot: "" },
  });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "owner@example.com");
});

it("does not fail the submission when SMTP is unconfigured", async () => {
  const service = createService(buildPrisma({ formOverrides: { notifyEmail: "owner@example.com" } }), {
    smtpService: { sendEmail: async () => { throw new Error("SMTP no configurado"); } },
  });

  const result = await service.submitForm({
    companySlug: "acme",
    siteId: SITE_ID,
    formId: FORM_ID,
    origin: "https://shop.example.com",
    idempotencyKey: "idem-notify-2",
    payload: { values: { full_name: "Ana", email: "ana@example.com" }, honeypot: "" },
  });

  assert.ok(result.submissionId);
});
```

This requires two small, exact changes to the test file's existing helpers:

`buildPrisma` (currently `function buildPrisma(overrides = {}) { ... const form = { id: FORM_ID, ..., enabled: true, fields: [...] }; ...`,
at the top of the file) — change the signature and the end of the `form`
object literal:

```js
function buildPrisma({ formOverrides = {}, ...overrides } = {}) {
```
and, at the closing of the `form` object literal (after the `fields: [...]`
array, before the closing `};`):
```js
    ...formOverrides,
  };
```

`createService` (`function createService(prisma, options = {}) { return createStorefrontCaptureService({ prisma, now: () => NOW, verifyTurnstile: ..., notificationService: options.notificationService }); }`)
— add one line to the passthrough:
```js
function createService(prisma, options = {}) {
  return createStorefrontCaptureService({
    prisma,
    now: () => NOW,
    verifyTurnstile: options.verifyTurnstile ?? (async () => true),
    notificationService: options.notificationService,
    smtpService: options.smtpService,
  });
}
```

Then in the two new test cases, call
`buildPrisma({ formOverrides: { notifyEmail: "owner@example.com" } })` and
`createService(prisma, { smtpService: { sendEmail: ... } })` exactly as
shown in Step 3's snippets above.

- [ ] **Step 4: Run tests, syntax-check, commit**

Run: `node --test apps/api/src/services/__tests__/storefront-capture-service.test.js`
Expected: PASS (all, including the 2 new ones)

Run: `node --check apps/api/src/services/email-templates.js && node --check apps/api/src/services/storefront-capture-service.js`

```bash
git add apps/api/src/services/email-templates.js apps/api/src/services/storefront-capture-service.js apps/api/src/services/__tests__/storefront-capture-service.test.js
git commit -m "feat(forms): notify notifyEmail via SMTP on form submission"
```

---

## Task 5: Move and parameterize the shared form-admin panels

**Files:**
- Create: `apps/desktop/src/components/forms/FormFieldBuilder.jsx` (from
  `apps/desktop/src/modules/runly.website/screens/FormFieldBuilder.jsx`)
- Create: `apps/desktop/src/components/forms/FormSubmissionsPanel.jsx`
- Create: `apps/desktop/src/components/forms/FormSettingsPanel.jsx`
- Create: `apps/desktop/src/components/forms/FormApiPanel.jsx`
- Create: `apps/desktop/src/components/forms/FormPreview.jsx`
- Delete: the 5 original files under `runly.website/screens/`
- Modify: `apps/desktop/src/modules/runly.website/screens/WebsiteFormsScreen.jsx`
  (update the 5 imports only)

- [ ] **Step 1: Copy `FormApiPanel.jsx` and `FormPreview.jsx` unchanged**

These have no `/website/...` fetch calls. Copy their exact current content
to the new path, only fixing the relative import depth: they currently sit
at `modules/runly.website/screens/` (3 levels under `src/`) and move to
`components/` (1 level under `src/`), so `../../../lib/runtimeConfig.js`
becomes `../../lib/runtimeConfig.js` and `../../../auth/AuthProvider.jsx`
becomes `../../auth/AuthProvider.jsx` (adjust every relative import in both
files by removing one `../`).

- [ ] **Step 2: Copy + parameterize `FormFieldBuilder.jsx`**

Same import-depth fix as step 1 (remove one `../` from every relative
import), plus:
- Function signature: `export default function FormFieldBuilder({ formId, fields = [], onRefresh, wizardMode = false, basePath = '/website' })`
- Line ~144-146 (create/update field mutation URL):
  ```js
  const url = isEdit
    ? `${getApiUrl()}${basePath}/form-fields/${field.id}`
    : `${getApiUrl()}${basePath}/forms/${formId}/fields`
  ```
- Line ~419 (reorder mutation URL):
  ```js
  const res = await companyFetch(`${getApiUrl()}${basePath}/forms/${formId}/fields/reorder`, {
  ```
- Line ~432 (delete field mutation URL):
  ```js
  const res = await companyFetch(`${getApiUrl()}${basePath}/form-fields/${fieldId}`, {
  ```

The file has 3 nested components between the mutation and the exported
default: `FieldForm({ formId, field, isEdit, onOpenChange, onSaved, wizardMode, maxStep = 1 })`
(line 113, owns the create/update mutation at lines 144-146) is rendered by
`FieldDialog({ formId, field, open, onOpenChange, onSaved, wizardMode, maxStep })`
(line 298), which is rendered by the default-exported
`FormFieldBuilder({ formId, fields = [], onRefresh, wizardMode = false })`
(line 399, owns the reorder/delete mutations at lines 419/432). Add
`basePath` to all three signatures and thread it prop-to-prop:
`FormFieldBuilder({ ..., basePath = '/website' })` →
`<FieldDialog ... basePath={basePath} />` →
`<FieldForm ... basePath={basePath} />`, and use it in `FieldForm`'s
mutation URL exactly as shown above.

- [ ] **Step 3: Copy + parameterize `FormSubmissionsPanel.jsx`**

Same import-depth fix, plus:
- Function signature: `export default function FormSubmissionsPanel({ formId, basePath = '/website' })`
- Line ~84 (list query):
  ```js
  `${getApiUrl()}${basePath}/forms/${formId}/submissions?page=${page}&pageSize=20`,
  ```
- Line ~99 (delete mutation):
  ```js
  `${getApiUrl()}${basePath}/forms/${formId}/submissions/${subId}`,
  ```

- [ ] **Step 4: Copy + parameterize `FormSettingsPanel.jsx`**

Same import-depth fix, plus:
- Function signature: `export default function FormSettingsPanel({ form, token, assignees, turnstileConfigured, onSaved, basePath = '/website' })`
- Line ~29 (update mutation):
  ```js
  const res = await companyFetch(`${getApiUrl()}${basePath}/forms/${form.id}`, {
  ```

- [ ] **Step 5: Delete the 5 originals, update `WebsiteFormsScreen.jsx`**

```bash
git rm apps/desktop/src/modules/runly.website/screens/FormFieldBuilder.jsx \
       apps/desktop/src/modules/runly.website/screens/FormSubmissionsPanel.jsx \
       apps/desktop/src/modules/runly.website/screens/FormSettingsPanel.jsx \
       apps/desktop/src/modules/runly.website/screens/FormApiPanel.jsx \
       apps/desktop/src/modules/runly.website/screens/FormPreview.jsx
```

In `WebsiteFormsScreen.jsx`, change the 5 imports (currently `./FormFieldBuilder.jsx` etc.) to:

```js
import FormFieldBuilder from '../../../components/forms/FormFieldBuilder.jsx'
import FormSubmissionsPanel from '../../../components/forms/FormSubmissionsPanel.jsx'
import FormSettingsPanel from '../../../components/forms/FormSettingsPanel.jsx'
import FormPreview from '../../../components/forms/FormPreview.jsx'
import FormApiPanel from '../../../components/forms/FormApiPanel.jsx'
```

No other change to `WebsiteFormsScreen.jsx` — it never passes `basePath`,
so all 5 keep defaulting to `/website`, identical behavior to today.

- [ ] **Step 6: Verify via Vite dev-server transform + lint**

Run (from repo root): `pnpm lint`
Expected: exits 0.

Start `pnpm dev:frontend` in the background, then:
```bash
curl -s "http://localhost:5173/src/modules/runly.website/screens/WebsiteFormsScreen.jsx" -o /dev/null -w "HTTP %{http_code}\n"
curl -s "http://localhost:5173/src/components/forms/FormFieldBuilder.jsx" -o /dev/null -w "HTTP %{http_code}\n"
curl -s "http://localhost:5173/src/components/forms/FormSubmissionsPanel.jsx" -o /dev/null -w "HTTP %{http_code}\n"
curl -s "http://localhost:5173/src/components/forms/FormSettingsPanel.jsx" -o /dev/null -w "HTTP %{http_code}\n"
curl -s "http://localhost:5173/src/components/forms/FormApiPanel.jsx" -o /dev/null -w "HTTP %{http_code}\n"
curl -s "http://localhost:5173/src/components/forms/FormPreview.jsx" -o /dev/null -w "HTTP %{http_code}\n"
```
Expected: all `HTTP 200`. Stop the dev server after.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/forms apps/desktop/src/modules/runly.website/screens/WebsiteFormsScreen.jsx
git commit -m "refactor(forms): move shared form-admin panels to components/forms, parameterize basePath"
```

---

## Task 6: `GrowthFormsScreen.jsx` + routing

**Files:**
- Create: `apps/desktop/src/modules/runly.growth/screens/GrowthFormsScreen.jsx`
- Modify: `apps/desktop/src/app/ModuleOutlet.jsx` (add route entry)

- [ ] **Step 1: Write the screen**

Structurally mirrors `WebsiteFormsScreen.jsx` (list/detail layout, `FormCard`,
`NewFormDialog`, delete confirm) but: resolves its site from
`GET /growth/properties` (via `runly.growth.listProperties`) instead of
`/website/site`; all fetches target `/growth/forms...` (passed as
`basePath="/growth"` to the shared panels, `propertyId` instead of `siteId`
in query params); and its "how to integrate" tip shows the SDK embed
snippet instead of the Astro `DynamicForm` convention.

```jsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Button, Card, ComboboxField, ConfirmDialog, Dialog, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState,
  LoadingState, PageHeader, SelectField, SwitchField, Tabs, TabsContent,
  TabsList, TabsTrigger, TextField,
} from "@runly/ui";
import { Code2, Eye, FileText, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../../../auth/AuthProvider.jsx";
import { runly } from "../../../lib/runly.js";
import FormFieldBuilder from "../../../components/forms/FormFieldBuilder.jsx";
import FormSubmissionsPanel from "../../../components/forms/FormSubmissionsPanel.jsx";
import FormSettingsPanel from "../../../components/forms/FormSettingsPanel.jsx";
import FormPreview from "../../../components/forms/FormPreview.jsx";
import FormApiPanel from "../../../components/forms/FormApiPanel.jsx";

const BASE_PATH = "/growth";

const NEW_FORM_DEFAULTS = {
  name: "", description: "", submitLabel: "Enviar", successMessage: "",
  notifyEmail: "", createsLead: true, defaultAssigneeUserId: "",
  honeypotEnabled: true, turnstileRequired: false, wizardMode: false,
};

function FormCard({ form, active, onClick }) {
  const fieldCount = form._count?.fields ?? 0;
  const subCount = form._count?.submissions ?? 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={[
        "w-full text-left rounded-xl border p-3.5 cursor-pointer",
        active
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] shadow-sm"
          : "border-[hsl(var(--border))]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-sm font-semibold leading-tight truncate ${active ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"}`}>
          {form.name}
        </span>
        <FileText size={13} className={`shrink-0 mt-0.5 ${active ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
      </div>
      <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
        <span>{fieldCount} campo{fieldCount !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span className="flex items-center gap-1"><Send size={10} />{subCount}</span>
      </div>
    </div>
  );
}

function IntegrationTip({ formId }) {
  const snippet = `window.RunlyERP.forms.submit("${formId}", { values: { /* ... */ } })`;
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-2 bg-[hsl(var(--muted)/0.4)]">
      <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
        Como usar en un sitio externo
      </p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Con el snippet de <code className="font-mono">runly-sdk.js</code> ya instalado (ver "Sitios conectados"),
        envia este formulario desde JavaScript:
      </p>
      <pre className="overflow-x-auto rounded-md bg-[hsl(var(--background))] border border-[hsl(var(--border))] p-3 text-xs font-mono">
        {snippet}
      </pre>
    </div>
  );
}

function NewFormDialog({ open, onOpenChange, propertyId, token, assignees, onCreated }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState(NEW_FORM_DEFAULTS);
  const set = (key, val) => setData((d) => ({ ...d, [key]: val }));

  const mutation = useMutation({
    mutationFn: (payload) => runly.growth.createForm(payload, token),
    onSuccess: (form) => {
      toast.success("Formulario creado");
      queryClient.invalidateQueries({ queryKey: ["growth", "forms", propertyId] });
      setData(NEW_FORM_DEFAULTS);
      onCreated(form.data?.id ?? form.id);
    },
    onError: (err) => toast.error(err.message || "Error al crear formulario"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setData(NEW_FORM_DEFAULTS); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nuevo formulario</DialogTitle></DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({
              ...data,
              propertyId,
              description: data.description.trim() || undefined,
              successMessage: data.successMessage.trim() || undefined,
              notifyEmail: data.notifyEmail.trim() || null,
              defaultAssigneeUserId: data.defaultAssigneeUserId || null,
            });
          }}
          className="space-y-4 py-2"
        >
          <TextField label="Nombre" value={data.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
          <TextField label="Notificar por email" type="email" value={data.notifyEmail} onChange={(e) => set("notifyEmail", e.target.value)} placeholder="tu@empresa.com" />
          <ComboboxField
            label="Responsable"
            options={[{ value: "", label: "Sin responsable" }, ...assignees.map((a) => ({ value: a.id, label: a.displayName }))]}
            value={data.defaultAssigneeUserId}
            onChange={(v) => set("defaultAssigneeUserId", v)}
          />
          <SwitchField id="gf-lead" label="Crear lead automaticamente" checked={data.createsLead} onChange={(v) => set("createsLead", v)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending || !data.name.trim()}>
              {mutation.isPending ? "Creando..." : "Crear formulario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function GrowthFormsScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFormId = searchParams.get("form");
  const setSelectedFormId = (id) => setSearchParams(id ? { form: id } : {}, { replace: true });
  const [activeTab, setActiveTab] = useState("campos");
  const [newFormOpen, setNewFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const propertiesQuery = useQuery({
    queryKey: ["growth", "properties"],
    queryFn: () => runly.growth.listProperties(token),
    enabled: Boolean(token),
  });
  const properties = propertiesQuery.data?.data ?? [];
  const [propertyId, setPropertyId] = useState(null);
  const activePropertyId = propertyId ?? properties[0]?.id ?? null;

  const formsQuery = useQuery({
    queryKey: ["growth", "forms", activePropertyId],
    queryFn: () => runly.growth.listForms(token, { propertyId: activePropertyId }),
    enabled: Boolean(token) && Boolean(activePropertyId),
  });
  const forms = formsQuery.data?.data ?? [];
  const activeFormId = selectedFormId ?? forms[0]?.id ?? null;

  const formDetailQuery = useQuery({
    queryKey: ["growth", "form-detail", activeFormId],
    queryFn: () => runly.growth.getForm(activeFormId, token),
    enabled: Boolean(token) && Boolean(activeFormId),
  });
  const formDetail = formDetailQuery.data ?? null;

  const { data: assigneesData } = useQuery({
    queryKey: ["growth", "form-assignees"],
    queryFn: () => runly.growth.listFormAssignees(token),
    enabled: Boolean(token),
  });
  const assignees = assigneesData?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (formId) => runly.growth.deleteForm(formId, token),
    onSuccess: () => {
      toast.success("Formulario eliminado");
      setSelectedFormId(null);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["growth", "forms", activePropertyId] });
    },
    onError: () => { toast.error("Error al eliminar"); setDeleteTarget(null); },
  });

  if (propertiesQuery.isPending) return <LoadingState variant="page" />;

  if (!activePropertyId) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader eyebrow="Runly Growth" title="Formularios" />
        <EmptyState title="Sin sitios conectados" description='Conecta un sitio primero en "Sitios conectados".' />
      </div>
    );
  }

  const selectedForm = forms.find((f) => f.id === activeFormId) ?? null;
  const subCount = selectedForm?._count?.submissions ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Growth"
        title="Formularios"
        description="Define campos y notificaciones para formularios en sitios internos o externos."
        actions={<Button onClick={() => setNewFormOpen(true)}>Nuevo formulario</Button>}
      />

      {properties.length > 1 && (
        <SelectField
          label="Sitio"
          value={activePropertyId}
          options={properties.map((p) => ({ value: p.id, label: p.domain ? `${p.name} - ${p.domain}` : p.name }))}
          onValueChange={(id) => { setPropertyId(id); setSelectedFormId(null); }}
        />
      )}

      {formsQuery.isPending ? (
        <LoadingState message="Cargando formularios..." />
      ) : forms.length === 0 ? (
        <EmptyState
          title="Sin formularios"
          description="Crea tu primer formulario para capturar envios desde este sitio."
          action={{ label: "Crear primer formulario", onClick: () => setNewFormOpen(true) }}
        />
      ) : (
        <div className="flex gap-5 items-start">
          <div className="w-56 shrink-0 space-y-2">
            {forms.map((form) => (
              <FormCard
                key={form.id}
                form={form}
                active={activeFormId === form.id}
                onClick={() => { setSelectedFormId(form.id); setActiveTab("campos"); }}
              />
            ))}
          </div>

          <div key={activeFormId} className="flex-1 min-w-0 space-y-4">
            {selectedForm ? (
              <>
                <Card className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-bold text-[hsl(var(--foreground))] truncate">{selectedForm.name}</h2>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(selectedForm)}
                      className="flex items-center gap-1.5 shrink-0 text-xs text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.1)] px-2.5 py-1.5 rounded-md transition-colors"
                    >
                      <Trash2 size={12} />Eliminar
                    </button>
                  </div>
                  <IntegrationTip formId={selectedForm.id} />
                </Card>

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="campos">Campos</TabsTrigger>
                    <TabsTrigger value="preview"><Eye size={13} className="mr-1.5" />Vista previa</TabsTrigger>
                    <TabsTrigger value="configuracion">Configuracion</TabsTrigger>
                    <TabsTrigger value="api"><Code2 size={13} className="mr-1.5" />API</TabsTrigger>
                    <TabsTrigger value="envios">
                      Envios
                      {subCount > 0 && (
                        <span className="ml-1.5 text-[10px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-full px-1.5 py-0.5 leading-none">
                          {subCount}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="campos">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando campos..." />
                    ) : (
                      <FormFieldBuilder
                        formId={selectedForm.id}
                        fields={formDetail?.fields ?? []}
                        wizardMode={formDetail?.wizardMode ?? false}
                        basePath={BASE_PATH}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["growth", "form-detail", selectedForm.id] })}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="preview">
                    {formDetailQuery.isPending ? <LoadingState message="Cargando..." /> : <FormPreview form={formDetail} />}
                  </TabsContent>

                  <TabsContent value="configuracion">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando..." />
                    ) : formDetailQuery.isError ? (
                      <ErrorState title="No se pudo cargar" message={formDetailQuery.error?.message} onRetry={() => formDetailQuery.refetch()} />
                    ) : (
                      <FormSettingsPanel
                        key={formDetail?.id}
                        form={formDetail}
                        token={token}
                        assignees={assignees}
                        turnstileConfigured={false}
                        basePath={BASE_PATH}
                        onSaved={() => {
                          formDetailQuery.refetch();
                          queryClient.invalidateQueries({ queryKey: ["growth", "forms", activePropertyId] });
                        }}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="api">
                    {formDetailQuery.isPending ? <LoadingState message="Cargando..." /> : <FormApiPanel form={formDetail} />}
                  </TabsContent>

                  <TabsContent value="envios">
                    <FormSubmissionsPanel formId={selectedForm.id} basePath={BASE_PATH} />
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un formulario.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <NewFormDialog
        open={newFormOpen}
        onOpenChange={setNewFormOpen}
        propertyId={activePropertyId}
        token={token}
        assignees={assignees}
        onCreated={(id) => { setSelectedFormId(id); setNewFormOpen(false); }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Eliminar formulario"
        description={`Se eliminara permanentemente "${deleteTarget?.name}" con todos sus campos y envios.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget?.id)}
      />
    </div>
  );
}
```

Note `turnstileConfigured={false}` is a deliberate simplification for this
pass — `GrowthProperty` already carries `turnstileSiteKey`/
`turnstileSecretKey` fields (mirrored from `WebsiteSite` today), but wiring
the Turnstile toggle's enabled/disabled state through the growth properties
list is not needed for the core "forms work without website" capability and
is left for a follow-up if the user asks for it.

- [ ] **Step 2: Add the 5 SDK client methods it calls**

In `packages/sdk/src/domains/growth.js`, add after the property methods:

```js
    listForms: (token, { propertyId } = {}) =>
      request(`/growth/forms${toQueryString({ propertyId })}`, {
        headers: withAuthHeaders(token),
      }),

    listFormAssignees: (token) =>
      request("/growth/forms/assignees", {
        headers: withAuthHeaders(token),
      }),

    getForm: (formId, token) =>
      request(`/growth/forms/${encodeURIComponent(formId)}`, {
        headers: withAuthHeaders(token),
      }),

    createForm: (payload, token) =>
      request("/growth/forms", {
        method: "POST",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      }),

    deleteForm: (formId, token) =>
      request(`/growth/forms/${encodeURIComponent(formId)}`, {
        method: "DELETE",
        headers: withAuthHeaders(token),
      }),
```

Extend `packages/sdk/src/__tests__/growth-domain.test.js`'s exhaustive-keys
list and request-shape test the same way Task 7 of the properties plan did
(add the 5 new names alphabetically to the `Object.keys(domain).sort()`
array, add 5 matching `client.growth.X(...)` calls + assertions).

- [ ] **Step 3: Register the route in `ModuleOutlet.jsx`**

Add after the `"runly.growth:/sites"` entry:

```js
  "runly.growth:/forms": lazy(
    () => import("../modules/runly.growth/screens/GrowthFormsScreen.jsx"),
  ),
```

- [ ] **Step 4: Lint, dev-server smoke check, commit**

Run: `pnpm lint`

Start `pnpm dev:frontend`, curl `http://localhost:5173/src/modules/runly.growth/screens/GrowthFormsScreen.jsx` and `.../src/app/ModuleOutlet.jsx`, expect `HTTP 200` both. Stop the server.

```bash
git add apps/desktop/src/modules/runly.growth/screens/GrowthFormsScreen.jsx apps/desktop/src/app/ModuleOutlet.jsx packages/sdk/src/domains/growth.js packages/sdk/src/__tests__/growth-domain.test.js
git commit -m "feat(growth): add Formularios screen backed by /growth/forms"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full backend test sweep for touched files**

```bash
node --test apps/api/src/services/__tests__/forms-service.test.js
node --test apps/api/src/routes/growth/__tests__/growth-form-routes.test.js
node --test apps/api/src/services/__tests__/storefront-capture-service.test.js
node --test packages/sdk/src/__tests__/growth-domain.test.js
node --test apps/api/src/routes/growth/__tests__/growth-analytics-service.test.js
node --test apps/api/src/routes/growth/__tests__/growth-analytics-routes.test.js
```
Expected: all PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint` — expected: exits 0.

- [ ] **Step 3: `pnpm db:seed` re-run** (confirms manifest/permission changes seed cleanly)

- [ ] **Step 4: File-size check**

```bash
wc -l apps/api/src/routes/website/website-service.js apps/api/src/services/forms-service.js
```
Expected: `website-service.js` now under 800 (was 878); `forms-service.js`
is a new, focused ~180-line file.

- [ ] **Step 5: Commit any fixes found during verification**

```bash
git add -A
git commit -m "fix(forms): address verification findings for growth forms feature"
```
(Skip if nothing needed fixing.)
