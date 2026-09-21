# Growth-owned forms (independent of runly.website) — design

Date: 2026-09-21
Status: approved (user directed: independent of website or reusing existing
code, but without requiring `runly.website` to be installed)

## Problem

Following `docs/superpowers/specs/2026-09-21-growth-external-sites-design.md`
(which let `runly.growth` track analytics/leads for a site without installing
`runly.website`), the same gap exists for **forms**: the admin UI for
building a form (fields, validation, settings) and viewing its submissions
lives entirely inside `runly.website` today, and its routes are gated by
`website.pages.*` permissions. A company that wants Growth's lead capture on
an externally-hosted site, without installing the Website module, currently
has no way to build/manage a form from the ERP — only to hand-code a raw
`form_submit` analytics event on their own site.

The **public** submission path is already fine: `getPublicForm`/`submitForm`
in `storefront-capture-service.js` resolve their site through
`growthPropertyService.resolveProperty` (from today's earlier change), so a
structured form, once created, already accepts submissions from any
`GrowthProperty` — internal or external. Only the **admin** side (create a
form, add fields, view submissions) is missing for the no-website case.

## Non-goals

- Rebuilding the form builder UI from scratch. `WebsiteFormsScreen.jsx` and
  its child panels are well-built and mostly reusable as-is; the design
  below reuses code, not concepts.
- Changing the public submission API shape (`/public/storefront/v1/forms/...`)
  — unaffected by this change.
- A generic multi-purpose "notification center" for form submissions beyond
  a single `notifyEmail` address per form (already a schema field, unused
  until now).

## Design

### 1. Extract form CRUD out of `website-service.js` into a shared service

`website-service.js` is 878 lines (over the 800-line proactive-split
threshold in CLAUDE.md) and its 12 form-related functions
(`listForms`, `getForm`, `createForm`, `updateForm`, `listFormAssignees`,
`softDeleteForm`, `createFormField`, `updateFormField`,
`softDeleteFormField`, `reorderFormFields`, `listSubmissions`,
`deleteSubmission`, plus the `assertFormAssignee` helper) have **no
`WebsiteSite`-specific logic** — they operate on `WebsiteForm`/
`WebsiteFormField`/`WebsiteFormSubmission` keyed by an opaque `siteId`
(no Prisma relation, same shape as `GrowthProperty`'s siblings) and a
company-scoped `Membership` check. They move verbatim into a new
`apps/api/src/services/forms-service.js` (`createFormsService({ prisma })`,
own `FormsServiceError`), used by **both** `runly.website`'s existing routes
and new `runly.growth` routes. This also brings `website-service.js` under
800 lines as a side effect.

The five Zod schemas (`createFormSchema`, `updateFormSchema`,
`createFormFieldSchema`, `updateFormFieldSchema`, `reorderFieldsSchema`) and
their local `FIELD_TYPES`/`fieldOptions` helpers move from
`apps/api/src/routes/website/validators.js` into `packages/validators/src/index.js`,
matching how growth's own schemas already live there. `website/validators.js`
re-exports them for backward compatibility. A sixth schema,
`growthFormCreateSchema`, is added next to them as
`createFormSchema.omit({ siteId: true }).extend({ propertyId: z.string().uuid() })`
— growth's public vocabulary is "property," not "site."

### 2. New `runly.growth` admin routes, same shape as website's

`apps/api/src/routes/growth/growth-form-routes.js`, mounted in
`growth-router.js`, mirrors `website/forms-routes.js` path-for-path under
`/growth/...` instead of `/website/...`:

- `GET /growth/forms?propertyId=`
- `GET /growth/forms/assignees`
- `POST /growth/forms` (body: `propertyId` + form fields)
- `GET /growth/forms/:id`
- `PATCH /growth/forms/:id`
- `DELETE /growth/forms/:id`
- `POST /growth/forms/:id/fields`
- `POST /growth/forms/:id/fields/reorder`
- `PATCH /growth/form-fields/:fieldId`
- `DELETE /growth/form-fields/:fieldId`
- `GET /growth/forms/:id/submissions`
- `DELETE /growth/forms/:id/submissions/:subId`

Unlike website's routes (which trust the caller's `siteId`), the growth
`POST /growth/forms` handler validates `propertyId` via
`growthPropertyService.assertProperty` before creating — unlike a
website-managed site, an external property is user-supplied input, so it's
worth the one extra check. New permissions `growth.forms.read`,
`growth.forms.create`, `growth.forms.update`, `growth.forms.delete`
(mirroring the existing `growth.leads.*` shape), added to the manifest and
`permission-catalog.js`, plus a "Formularios" nav entry (`/forms`).

### 3. Frontend: share the generic panels, duplicate the orchestrator

The five child components in
`apps/desktop/src/modules/runly.website/screens/` split into two groups:

- **Move as-is** (no `runly.website` coupling found): `FormPreview.jsx`
  (pure presentational) and `FormApiPanel.jsx` (already shows the
  site-agnostic *public* endpoint — unaffected by any of this).
- **Move + parameterize**: `FormFieldBuilder.jsx`, `FormSubmissionsPanel.jsx`,
  `FormSettingsPanel.jsx` each hardcode `${getApiUrl()}/website/forms/...`
  or `/website/form-fields/...` in their fetch calls (6 call sites total).
  Each gains a `basePath = '/website'` prop; the moved copies keep every
  other line unchanged.

All five move to `apps/desktop/src/components/forms/` (the existing
top-level shared-components convention — see `CompanySwitcher.jsx` etc. in
that folder — not `@runly/ui`, since these are feature screens tied to the
`WebsiteForm` data model, not generic design-system primitives).
`WebsiteFormsScreen.jsx` updates its five imports to the new path; nothing
else about it changes, and it keeps defaulting `basePath` to `/website`.

The **orchestrator** (list/detail layout, `FormCard`, `NewFormDialog`,
`FormDetailHeader`, the "how to integrate" tip) is **not** shared — it's
duplicated into a new `GrowthFormsScreen.jsx`, for two reasons: doing an
in-place refactor of a 600-line working screen into a generic component
carries real regression risk for no benefit, and — more importantly —
**the integration instructions genuinely differ**. `WebsiteFormsScreen`'s
`IntegrationTip` tells the user to add the form ID to
`src/config/forms.ts` and use `<DynamicForm>` — an Astro-site convention
specific to `runly.website`-published sites. `GrowthFormsScreen`'s
equivalent tip instead points at the same
`window.RUNLY_CONFIG`/`runly-sdk.js` embed snippet used by
`ConnectExternalSiteDialog.jsx` from the properties work, since that's what
an external SDK-connected site actually needs.

`GrowthFormsScreen.jsx` resolves its "current site" from the growth
properties list (`GET /growth/properties`, already built) via a simple
`SelectField` at the top of the screen, defaulting to the first property —
same shape as the existing site filter on `GrowthAnalyticsScreen`, not a new
pattern. New nav entry "Formularios" in the growth manifest, routed at
`runly.growth:/forms` in `ModuleOutlet.jsx`.

### 4. SMTP notification on submission

`WebsiteForm.notifyEmail` exists in the schema but nothing reads it — confirmed
via `grep -rn notifyEmail apps/api/src` (only the Zod fields and a storage
passthrough). `storefront-capture-service.js`'s `submitForm`, right after the
existing `notifyAssignee` in-app-notification block, gains:

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

`smtpService` is a new factory param on `createStorefrontCaptureService`,
defaulting to `createSmtpService({ prisma })` (existing service, already
used elsewhere for company-scoped SMTP config —
`apps/api/src/services/smtp-service.js`). A missing/unconfigured SMTP
config throws `SmtpConfigError`, caught and logged, never blocking the
submission response — a contact form must keep working even if nobody set
up SMTP for that company yet.

`buildFormSubmissionEmail({ formName, values, fields, brand = null, env = process.env })`
is a new function in `apps/api/src/services/email-templates.js`, following
the exact `build*Email` → `{ subject, html, text }` pattern already used by
`buildCompanyInvitationEmail`/`buildUserWelcomeEmail`/etc. in that file
(reuses `renderAtlasEmailLayout`/`escapeHtml` from the same file — no new
templating approach introduced). Field values are rendered as a label:value
list using `fields` (for human-readable labels) instead of raw field names.

## Error handling

- `FormsServiceError` (new, self-contained — not imported from
  `routes/website/service-helpers.js`, per the independence requirement)
  carries the same `{ message, status }` shape as the existing
  `WebsiteServiceError` it replaces internally.
- Growth's `POST /growth/forms` 404s with `growth_property_error` /
  `property_not_found` (reusing `GrowthPropertyServiceError`, same as the
  properties work) when `propertyId` doesn't resolve for the company.
- SMTP failures never surface to the external site's visitor — logged only.

## Testing

Per project convention (`node --test`), lean coverage only:

- `forms-service.test.js` — no existing coverage of forms CRUD exists today
  (confirmed: nothing under `routes/website/__tests__/` exercises
  `createForm`/`listForms`/`assertFormAssignee`), so this is a new, lean
  suite: create + list + the assignee-must-be-an-active-member validation.
- `growth-form-routes.test.js` — one test confirming `propertyId` is
  validated against `growthPropertyService.assertProperty` before create.
- Extend `storefront-capture-service.test.js` with one case: a form with
  `notifyEmail` set triggers `smtpService.sendEmail` with the right `to`;
  one case confirming a thrown `SmtpConfigError` doesn't fail the
  submission.
- No new frontend test suite — this codebase has none for `runly.website`'s
  forms screens either; manual click-through only, noted explicitly rather
  than skipped silently.

## Migration

None — no schema changes. This is a pure code-organization + new-routes +
new-screen change.
