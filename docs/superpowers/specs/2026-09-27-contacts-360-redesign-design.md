# runly.contacts — Contact 360 Redesign (Detail Page, Full-Page Form, Extended Data)

Date: 2026-09-27
Status: In Progress
Author: Claude (agent)
Spec file: docs/superpowers/specs/2026-09-27-contacts-360-redesign-design.md
Plan file: docs/superpowers/plans/2026-09-27-contacts-360-redesign-plan.md
Supersedes (partially): `2026-08-27-contacts-detail-route-design.md` — its API endpoint and URL stay; its non-goal "no new detail page UI" is lifted by this spec.

## 1. Feature title

runly.contacts — Contact 360: read-only detail page, full-page form, fiscal data, multiple channels, addresses, key people, tags, avatar and cross-module activity.

## 2. Status

Proposed

## 3. Context

Today a contact is a thin record (`type`, `name`, `legalName`, `email`, `phone`, `taxId`, `notesMarkdown`). Clicking a row in `ContactsScreen` opens `ContactFormSheet` straight in edit mode; there is no read-only view. The module works mostly as a picker that other modules reference (`GrowthLead.contactId`, `dispatch_ticket.customer_contact_id`, chat entity references, call-transcript proposals), and it does not show any of that back to the user.

The user produced a visual reference in Google Stitch (4 screens: detail desktop, detail 390px, form desktop, form 390px, plus a `DESIGN.md` "Obsidian Cyan Glass ERP"). The export is kept outside the repository. It is a **layout and information-architecture reference**, not a pixel spec: the implementation must use Runly's existing tokens, `AppShell` and `@runly/ui` components.

## 4. Problem

1. There is no way to *view* a contact without entering edit mode, and the side sheet is too narrow for anything beyond 7 fields.
2. The data model cannot hold what a Mexican SMB needs for a customer/supplier: SAT fiscal data (régimen, CP fiscal, uso de CFDI), more than one phone/email, delivery vs fiscal addresses, the people you actually talk to inside a company, and a way to segment contacts.
3. Work done in other modules for a contact (leads, dispatch tickets, files) is invisible from the contact itself.
4. Contacts have no photo/logo, so every surface (list, chat reference cards) can only show initials.

## 5. Goals

1. Full-page detail at `/contacts/:id` with a hero header (avatar, name, legal name, type/status/tag chips, quick actions, KPI strip) and tabs: Resumen, Actividad, Personas, Archivos, Historial.
2. Full-page form at `/contacts/new` and `/contacts/:id/edit` with a sticky section index, sticky header and footer, and six sections: General, Canales de contacto, Datos fiscales, Direcciones, Personas clave, Notas.
3. Extended data model: avatar, website, industry, tags, SAT fiscal fields, and three child collections (channels, addresses, key people).
4. Cross-module activity feed with a pluggable provider registry, so modules contribute only when they are installed and the user can read them.
5. Contact changes are written to `AuditLog`, which feeds the Historial tab.
6. Non-blocking duplicate warning on the form (same RFC, email or phone).
7. Backward compatibility: `Contact.email`/`Contact.phone` keep holding the primary channel so the list, picker, search, exports, offline sync, Growth, chat and calls keep working unchanged.

## 6. Non-goals

1. No SAT web-service validation (LCO/EFOS). RFC is validated by format only; the "Validado en LCO SAT" badges from the reference are not built.
2. No CFDI/invoicing counts ("CFDI timbrados", "Historial SAT" tab, "Folios restantes"). No invoicing module exists.
3. No commercial terms (credit limit, credit days, preferred currency, payment method/form). Deferred.
4. No embedded map preview and no postal-code-to-colonia autocomplete (SEPOMEX catalog). "Ver en mapa" is an external link only.
5. No contact import (CSV/Excel/vCard/OCR) and no Google Contacts. Next spec.
6. No redesign of the list screen beyond showing the avatar in the name column.
7. The Stitch chrome (top navigation bar, "Directorio fiscal" sidebar, "SAT timbrado online" status) is not adopted; `AppShell` stays.
8. Key people are child rows, not linked `Contact` records. Linking is a future enhancement.

## 7. User stories

- As a salesperson, I want to open a customer and see all their data, people and recent activity on one page, so I can prepare a call in seconds.
- As a salesperson, I want to call, WhatsApp or email a contact with one click from its page.
- As an accountant, I want the contact's RFC, régimen fiscal, CP fiscal and uso de CFDI stored and validated, so invoicing data is ready when needed.
- As an operator, I want separate fiscal and delivery addresses, so dispatch goes to the right place.
- As a manager, I want to tag contacts (Mayorista, Zona Norte) and filter by tag.
- As a user, I want to be warned before creating a second contact with the same RFC, email or phone.
- As a user, I want to upload a logo or photo so contacts are recognizable everywhere.

## 8. UX requirements

Visual language: take layout, hierarchy and density from the Stitch reference, rendered with our design tokens (`hsl(var(--...))`), so it works in both light and dark themes. No glass effects beyond what `@runly/ui` cards already do. No emojis. All copy in Spanish.

### 8.1 Detail page (`ContactDetailScreen`)

- `PageHeader` with eyebrow "Runly Contacts", breadcrumb/back to the list.
- **Hero card**:
  - `Avatar` 96px (rounded-2xl). Fallback is initials using `TYPE_AVATAR_COLORS`. With update permission, hovering shows "Cambiar foto".
  - Name (title), legal name (muted), chips for type, status and tags.
  - Quick actions: "Llamar" (`tel:`), "WhatsApp" (`https://wa.me/<digits>`), "Correo" (`mailto:`), "Copiar RFC". Each is hidden when its data is missing.
  - Primary "Editar" button. Overflow `DropdownMenu`: Activar/Desactivar, Eliminar (via `ConfirmDialog`).
  - **KPI strip**: one tile per activity provider that returned a count (for example "Leads abiertos", "Tickets", "Archivos"), plus "Última actividad" (relative time). Tiles for uninstalled modules are not rendered.
- **Tabs** (`Tabs`), with the active tab kept in `?tab=`:
  - **Resumen**: 2/3 + 1/3 grid.
    - Left column: "Datos generales" (type, industry, website, created/updated), "Datos fiscales" (RFC with copy button and "Persona moral"/"Persona física" inferred from RFC length; régimen `601 - ...`; CP fiscal; uso de CFDI), "Direcciones" (cards with kind badge and a "Ver en mapa" external link), "Notas" (`MarkdownViewer`).
    - Right column: "Medios de contacto" (all channels with label, primary marker and action icon), "Personas clave" (compact list with role and phone), "Etiquetas", meta footer.
    - Values are copyable on hover (`CopyableValue`).
  - **Actividad**: vertical timeline grouped by day, with module badge and icon, title, meta and a link to the source record. Filter chips per module. `EmptyState` "Aún no hay actividad con este contacto".
  - **Personas**: full list of key people. Add, edit and remove are done from the form.
  - **Archivos**: `AttachmentsPanel` (`moduleKey: runly.contacts`, `entityType: contact`) with drag-and-drop.
  - **Historial**: `ActivityTimeline` (`entityType="Contact"`), reading `AuditLog`.
- Loading uses skeletons. A 404 shows `ErrorState` with a link back to the list.

### 8.2 Form page (`ContactFormScreen`)

- Header with the title "Nuevo contacto" or "Editar contacto" and a footer with "Cancelar" and "Guardar contacto". Both stay fixed; only the middle scrolls.
- Left sticky section index with a scroll-spy and `FormCompletionRing` (percentage of recommended fields filled). On mobile it collapses into a top `SelectField` jump menu.
- Sections, each a `SectionCard`:
  1. **General**: avatar uploader (`ImageUploader`, square, preview, "Quitar"), type as a segmented control (Persona / Empresa / Cliente / Proveedor), Nombre (required), Razón social, Giro, Sitio web, Etiquetas (`TagsField`, "Buscar o crear...").
  2. **Canales de contacto**: repeatable phone rows (country code default +52, number, label, "Principal" radio, remove) and email rows (same pattern). Buttons "+ Agregar teléfono" and "+ Agregar correo".
  3. **Datos fiscales**: RFC (uppercased mask, inline valid/invalid state), Régimen fiscal (`ComboboxField` over the SAT catalog, filtered by persona física/moral once the RFC is valid), CP fiscal (5 digits), Uso de CFDI (`ComboboxField` over the SAT catalog).
  4. **Direcciones**: repeatable address cards. Kind (Fiscal / Entrega / Otra), label, street, ext, int, colonia, CP, city/state/country via `AddressFieldsSection`, a "Predeterminada" toggle, and remove.
  5. **Personas clave**: repeatable rows (name, role, phone, email, primary). Visible for every type except `person`.
  6. **Notas**: `MarkdownField`.
- **Duplicate banner**: debounced (500 ms) check on RFC, email and phone. It shows "Ya existe un contacto con este RFC — Ver contacto" and does not block saving.
- Validation uses React Hook Form + Zod (shared schema) and shows inline errors. On save, the user goes to the detail page and a toast appears.

### 8.3 Mobile (<768px)

- Detail: the hero stacks, quick actions become a 4-icon grid, the KPIs become a 2x2 grid, and the tabs scroll horizontally.
- Form: the section index becomes the jump menu, and the footer buttons stay pinned.

## 9. Routes/screens

Module key: `runly.contacts`. Routes are registered in `apps/desktop/src/app/ModuleOutlet.jsx`.

| Route | Screen |
|---|---|
| `/app/m/runly.contacts/contacts` | `ContactsScreen` (list; row click navigates to the detail page, the "Editar" row action goes to `/edit`) |
| `/app/m/runly.contacts/contacts/new` | `ContactFormScreen` (create) |
| `/app/m/runly.contacts/contacts/:id` | `ContactDetailScreen` |
| `/app/m/runly.contacts/contacts/:id/edit` | `ContactFormScreen` (edit) |

`/contacts/new` must be matched before `/contacts/:id`. `ContactFormSheet` is deleted, and deep links from chat (`/contacts/:id`) now land on the detail page.

## 10. Data model

### `Contact` (modified — new nullable/defaulted columns)

| Field | Type | Notes |
|---|---|---|
| avatarFileId | uuid? | Points to a `FileAsset` (not a FK constraint, same as `UserProfile.avatarFileId`) |
| website | text? | |
| industry | text? | "Giro" |
| tags | text[] default `{}` | Lowercase-trimmed for matching, stored as typed |
| taxRegime | text? | SAT `c_RegimenFiscal` code, e.g. `601` |
| fiscalPostalCode | varchar(5)? | |
| cfdiUse | text? | SAT `c_UsoCFDI` code, e.g. `G03` |

`email` and `phone` are kept. They are written server-side from the primary email/phone channel on every save.

### `ContactChannel` (new, table `contact_channel`)

`id uuid v7`, `companyId`, `contactId` (FK, cascade), `kind` (`phone`|`email`), `label` (`office`|`mobile`|`billing`|`other`), `value`, `countryCode?` (phones), `isPrimary bool`, `sortOrder int`, timestamps. Index `(contactId)`, `(companyId, kind, value)`.

### `ContactAddress` (new, table `contact_address`)

`id`, `companyId`, `contactId` (FK, cascade), `kind` (`fiscal`|`shipping`|`other`), `label?`, `street`, `extNumber?`, `intNumber?`, `neighborhood?`, `postalCode?`, `city?`, `state?`, `country` default `MX`, `isDefault bool`, `sortOrder`, timestamps. Index `(contactId)`.

### `ContactPerson` (new, table `contact_person`)

`id`, `companyId`, `contactId` (FK, cascade), `name`, `role?`, `phone?`, `email?`, `isPrimary bool`, `sortOrder`, `notes?`, timestamps. Index `(contactId)`.

### Invariants (enforced in the service)

- At most one primary channel per `(contact, kind)`. If rows exist but none is marked primary, the first row becomes primary.
- At most one default address per `(contact, kind)`.
- At most one primary person.

### SAT catalogs

Static constants in `packages/validators/src/sat-catalogs.js`. `REGIMEN_FISCAL` holds `{ code, label, fisica, moral }`, `USO_CFDI` holds `{ code, label, fisica, moral }`, and there is an `RFC_REGEX`.

## 11. Prisma impact

- `Contact` modified. New models `ContactChannel`, `ContactAddress`, `ContactPerson`, with `Contact.channels/addresses/persons` relations.
- One new forward migration `contacts_360`, which also creates a GIN index on `contact.tags`. No existing migration is edited.
- Backfill in the same migration: for every contact with `email`/`phone`, insert a primary channel (`label='other'`), with `uuidv7()` as the DB default.

## 12. API contract

All routes require auth and company scope (`c.get("companyId")`). Service errors keep using `ContactsServiceError` (400/404).

| Method | Path | Permission | Request | Response |
|---|---|---|---|---|
| GET | `/contacts/tags` | read | `?q=` | `{ data: string[] }` (distinct tags in the company, max 50) |
| GET | `/contacts/duplicates` | read | `?taxId=&email=&phone=&excludeId=` | `{ data: [{ id, name, matchedOn: "taxId"\|"email"\|"phone" }] }` |
| GET | `/contacts/:id` | read | — | unchanged base contact (compat) |
| GET | `/contacts/:id/profile` | read | — | `{ data: { ...contact, avatarUrl, channels[], addresses[], persons[] } }` |
| POST | `/contacts` | create | `contactUpsertSchema` | `{ data: profile }` 201 |
| PUT | `/contacts/:id` | update | `contactUpsertSchema.partial()` — `channels`/`addresses`/`persons`, when present, **replace the whole collection** (rows with `id` are updated, rows without are created, missing rows are deleted) in one transaction | `{ data: profile }` |
| POST | `/contacts/:id/avatar` | update | multipart `file` (image/*, ≤5 MB) | `{ data: { avatarFileId, avatarUrl } }` |
| DELETE | `/contacts/:id/avatar` | update | — | `{ data: { avatarFileId: null } }` |
| GET | `/contacts/:id/activity` | read | `?module=&limit=50&before=` | `{ data: { summary: [{ module, key, label, count }], lastActivityAt, items: [{ id, module, kind, title, meta, occurredAt, url }] } }` |

Static paths (`tags`, `duplicates`, `picker`, `export`) must be registered before `/:id`. The existing list, picker, bulk, export, enable and delete endpoints stay. The list response adds `avatarUrl` (batched signed URLs) and supports `?tag=`.

### Activity provider registry

`apps/api/src/services/contact-activity/registry.js`. Each provider is `{ key, moduleKey, label, permission, count(ctx, contactId), list(ctx, contactId, opts) }`. The service runs only providers whose module is `INSTALLED` and enabled and whose permission the user holds, and it tolerates the failure of any single provider (it is logged and skipped). The initial providers are:

- `growth.leads` — `GrowthLead.contactId`.
- `dispatch.tickets` — `$queryRaw` on `dispatch_ticket.customer_contact_id`; only when the table exists.
- `files` — `FileAsset` linked to the contact.

## 13. SDK contract

`runly.contacts` gains the following methods. Each takes `token` as its last argument:

- `getProfile(id, token)`
- `uploadAvatar(id, file, token)`, `removeAvatar(id, token)`
- `getActivity(id, { module, limit, before }, token)`
- `findDuplicates({ taxId, email, phone, excludeId }, token)`
- `listTags(q, token)`

`create`/`update` accept the extended payload.

## 14. Validator contract

In `@runly/validators`:

- `contactChannelSchema`, `contactAddressSchema`, `contactPersonSchema`.
- `contactUpsertSchema`, which extends `contactCreateSchema` with `website` (url or ""), `industry`, `tags` (≤20, each ≤40 characters), `taxId` (optional, `RFC_REGEX` when non-empty, uppercased), `taxRegime` (catalog code), `fiscalPostalCode` (`^\d{5}$`), `cfdiUse` (catalog code), `channels[]` (≤20), `addresses[]` (≤10) and `persons[]` (≤30).
- `contactCreateSchema` stays as is for existing callers (Growth convert, calls proposals).

## 15. Module manifest impact

`runly.contacts` in `apps/api/src/manifests/official/feature-modules.js`: dependency `{ key: "runly.files", optional: true }` is added (avatar + Archivos tab), and the version is bumped. No new navigation entries. Help content in `runly.contacts` help blueprints is updated for the new screens.

## 16. Navigation impact

None. The sidebar entry "Contactos" is unchanged, and the new routes are sub-routes.

## 17. Blueprint impact

`contacts.contact.entity` stays for compat (other renderers), with the new scalar fields appended. The new form is a hand-built screen using `@runly/ui` fields, not `DynamicForm`, because of the repeatable sections. `contacts.list` gains an avatar in the name cell and a `tag` filter.

## 18. RBAC/permissions

No new keys.

- `contacts.contacts.read`: detail, profile, activity, tags, duplicates.
- `contacts.contacts.update`: edit, avatar.
- `contacts.contacts.create`: new.
- `contacts.contacts.delete`: delete.
- Archivos tab: requires `files.assets.read` to show and `files.assets.create` to upload.
- Activity providers additionally check their own module's read permission.

## 19. Multi-company behavior

Every query filters by the active `companyId`. Child rows carry `companyId` and are validated to belong to the parent contact's company. Duplicates, tags and activity are company-scoped. A child `id` from another contact or company in a PUT payload is rejected with 400.

## 20. Files/storage impact

- Avatar: uploaded through the files service with `moduleKey: runly.contacts`, `entityType: contact_avatar`, following the `lib/upload-identity-avatar.js` pattern. Replacing an avatar disables the previous `FileAsset`. Signed URLs come from `lib/signed-url-by-file-id.js`.
- Attachments: the standard `AttachmentsPanel` convention with `entityType: contact`.

## 21. Export/import requirements

The Excel export adds these columns: Giro, Sitio web, Régimen fiscal, CP fiscal, Uso CFDI, Etiquetas, Dirección fiscal. The PDF export is unchanged. Import is out of scope.

## 22. Audit log requirements

The contacts service writes `AuditLog` with `moduleKey: runly.contacts`, `entityType: "Contact"`, `entityId`, `actorId` (the profile) and `companyId`:

- `contacts.contact.created` — `after` = profile snapshot.
- `contacts.contact.updated` — `before`/`after` limited to changed fields; collections are summarized as counts plus changed labels.
- `contacts.contact.enabled` / `contacts.contact.disabled`.
- `contacts.contact.deleted` — `before` = snapshot.
- `contacts.contact.avatar_changed`.

Bulk operations write one entry per contact.

## 23. Edge cases

1. A legacy contact has `email`/`phone` but no channels (or the backfill missed it): the profile synthesizes channel rows for display, and the first save persists them.
2. The primary channel is deleted: the next remaining channel of that kind becomes primary. When none remain, `Contact.email`/`phone` becomes null.
3. RFC is in lowercase or has spaces: it is normalized to uppercase and trimmed before validation. A generic RFC (`XAXX010101000`, `XEXX010101000`) is valid and is excluded from the duplicate check.
4. The RFC changes between persona física and moral with an incompatible régimen already selected: an inline warning appears, and the régimen is not silently cleared.
5. The dispatch module is uninstalled or its table was dropped: the provider is skipped, with no error and no KPI tile.
6. A user lacks growth read permission: lead items and the KPI are omitted for that user only.
7. `/contacts/new` is visited without create permission: `ErrorState`. `/contacts/:id/edit` without update permission redirects to the detail page.
8. The contact is deleted in another tab while the detail page is open: the next fetch returns 404 and shows `ErrorState` with a link to the list.
9. Offline desktop: `Contact` scalar columns sync as before. The child collections are not synced, so the detail page shows base data and, for the collections, "Disponible con conexión".
10. The avatar upload fails or the file is not an image: a toast error appears, and the previous avatar is kept.
11. There are concurrent edits: last write wins, the same as today (no optimistic locking in this version).
12. The WhatsApp link needs digits only, including the country code; `countryCode` is prefixed when the stored number lacks it.

## 24. Risks

1. **Breaking existing consumers of `email`/`phone`.** Mitigation: the primary-mirror invariant, plus tests that the Growth convert path and the picker are unchanged.
2. **`contacts-routes.js` (491 lines) and the service grow past 1000 lines.** Mitigation: new routes go in `routes/contacts/contacts-profile-routes.js` and `contacts-activity-routes.js`; child-collection sync goes in `services/contacts/contact-children-service.js`.
3. **Collection-replace semantics deleting data by accident** (a client sends a partial array). Mitigation: collections are replaced only when the key is present, and the form always sends the full arrays.
4. **SAT catalogs going stale.** Mitigation: a single constants file with its catalog version noted, and codes (not labels) stored.
5. **Activity queries being slow on large companies.** Mitigation: the per-provider limit, indexed FKs, and counts run in parallel with a timeout.

## 25. Acceptance criteria

1. Given a contact, when the user clicks its row, then `/contacts/:id` opens a read-only detail page (not a form).
2. Given the detail page, when the contact has a phone, then "Llamar" and "WhatsApp" open `tel:` and `wa.me` links with the right digits.
3. Given the form with two phones and the second marked "Principal", when saved, then `Contact.phone` equals the second phone and the list shows it.
4. Given a valid RFC of 12 characters, when choosing a régimen, then only catalog entries flagged `moral` are offered.
5. Given an invalid RFC, when saving, then an inline error "RFC no válido" blocks the save.
6. Given an existing contact with RFC X, when typing X in a new contact's form, then the duplicate banner links to the existing contact and saving is still allowed.
7. Given a PUT without `addresses` in the body, when saved, then the existing addresses are untouched.
8. Given a PUT with `addresses: []`, when saved, then all addresses are deleted.
9. Given a lead converted to this contact in Growth, when opening Actividad, then the lead appears with a link to it and the "Leads" KPI counts it.
10. Given the dispatch module is not installed, when opening the detail page, then there is no tickets KPI and no error.
11. Given an update, when opening Historial, then an entry `contacts.contact.updated` shows who changed what.
12. Given a contact in company A, when requested with company B active, then every contacts endpoint returns 404.
13. Given a 390px viewport, the detail and form pages have no horizontal page scroll, and the form footer stays visible.
14. Given the light theme, both pages keep readable contrast (no hardcoded dark colors).

## 26. Verification plan

- `node --test apps/api/src/services/__tests__/` (new: children sync invariants, primary mirror, duplicates, activity registry skip/permission, company isolation), plus `packages/validators` RFC/catalog tests.
- `pnpm lint`, `pnpm build:web`.
- `pnpm db:migrate` against the dev instance, then `pnpm db:generate`.
- Real API boot plus a curl smoke test with `$RUNLY_TOKEN` on profile, PUT with collections, duplicates, tags, activity and avatar.
- Manual UI check of both screens at desktop and 390px in both themes, and `docs/ai-context/ui-screen-audit-checklist.md` (14 aspects).
- Regression: the Growth "convert lead to contact" flow, the chat contact reference card, the calls transcript contact proposal, Excel/PDF export, and offline sync pull.

## 27. Rollback plan

- UI: revert the frontend commits. The old list keeps working against the extended API because the base contact shape is unchanged.
- API: revert the route and service commits. The new columns and tables are unused but harmless.
- DB: the migration is additive (nullable columns, new tables). If removal is required, create a new forward migration that drops the three tables and the new columns. Do not edit `contacts_360`.

## 28. Future enhancements

- Import from CSV/Excel/vCard with column mapping and dedupe (next spec). Business-card OCR (Groq vision). Creating contacts from CFDI XML. Google Contacts once the Calendar Google integration is stable.
- Link key people to real `Contact` records of type `person`.
- Commercial terms (credit limit and days, currency, payment method/form).
- SAT LCO/EFOS validation, postal-code-to-colonia autocomplete, map preview.
- Merge duplicates, follow-up reminders in Calendar, vCard/QR export, a MirAI "resumen del cliente".
- Avatar in the chat reference cards (`chat-entity-references-service.js`).
- More activity providers (documents, calls, projects, ledger).
