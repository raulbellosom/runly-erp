# Plan — runly.contacts Contact 360 Redesign

Date: 2026-09-27
Status: In Progress
Spec: docs/superpowers/specs/2026-09-27-contacts-360-redesign-design.md
Agent mode: implementation in the current working directory (no worktree), one commit per stage.

Every stage ends green: `node --test` for the touched test folders plus `pnpm lint`, and from Stage 5 on also `pnpm build:web`. No source file may exceed 800 lines; split proactively.

## Stage 1 — Validators and SAT catalogs

- [ ] `packages/validators/src/sat-catalogs.js`: `REGIMEN_FISCAL`, `USO_CFDI` (code, label, `fisica`, `moral`, catalog version comment), `RFC_REGEX`, `GENERIC_RFCS`, `rfcPersonType(rfc)` returning `"fisica"`, `"moral"` or `null`.
- [ ] `packages/validators/src/contacts.js`: `contactChannelSchema`, `contactAddressSchema`, `contactPersonSchema` and `contactUpsertSchema`, which normalizes RFC to uppercase and trims it. Export them from `index.js`. Keep `contactCreateSchema` unchanged.
- [ ] Tests: RFC valid/invalid/generic, persona type, régimen filtering, and the upsert limits.

## Stage 2 — Prisma schema and migration

- [ ] Add the `Contact` columns and the `ContactChannel`, `ContactAddress` and `ContactPerson` models (uuid v7 defaults, `companyId`, cascade FK, indexes).
- [ ] `pnpm prisma migrate dev --create-only --name contacts_360`, then hand-append the GIN index on `contact.tags` and the backfill `INSERT ... SELECT` of primary channels from `email`/`phone`.
- [ ] `pnpm db:migrate`, then `pnpm db:generate`. Verify the backfill count equals the number of contacts with email plus the number with phone.

## Stage 3 — API services

- [ ] `apps/api/src/services/contacts/contact-children-service.js` (inside a `createContactChildrenService({ prisma })` factory): `replaceCollections(tx, { companyId, contactId, channels, addresses, persons })` with the id-diffing, ownership checks, primary/default invariants and the primary mirror, returning `{ email, phone }`.
- [ ] Extend `contacts-service.js`:
  - `getProfile` (includes children and the avatar signed URL, and synthesizes legacy channels).
  - `create`/`update` in a `$transaction` that uses the children service when the keys are present.
  - `findDuplicates`, `listTags`.
  - `setAvatar`/`removeAvatar`.
  - Audit writes on every mutation, bulk included.
  - Extend search to tags and channel values.
  - Add the `tag` filter and `avatarUrl` to `list`.
  - If the service passes about 600 lines, move the audit and avatar helpers into `services/contacts/`.
- [ ] `apps/api/src/services/contact-activity/`: `registry.js` plus providers `growth-leads.js`, `dispatch-tickets.js` (with a table-existence check through `to_regclass`) and `files.js`, and `contact-activity-service.js` (module installed/enabled filter, permission filter, `Promise.allSettled`, merge-sort by `occurredAt`).
- [ ] Tests (`apps/api/src/services/__tests__/`) with a prisma stub, following existing service tests:
  - The children invariants.
  - The mirror.
  - PUT without a key leaves the collection untouched; an empty array clears it.
  - A cross-company child id is rejected.
  - Duplicates exclude generic RFCs and `excludeId`.
  - The activity registry skips an uninstalled module, a missing permission and a throwing provider.

## Stage 4 — API routes and SDK

- [ ] Move contact routes into `apps/api/src/routes/contacts/` (`index.js`, the existing handlers, `contacts-profile-routes.js` and `contacts-activity-routes.js`). Register static paths before `/:id`. Keep the existing paths identical.
- [ ] Avatar multipart upload following `lib/upload-identity-avatar.js` (image/*, ≤5 MB).
- [ ] Excel export: add the new columns.
- [ ] Manifest: add the optional `runly.files` dependency and bump the version.
- [ ] `packages/sdk`: `getProfile`, `uploadAvatar`, `removeAvatar`, `getActivity`, `findDuplicates` and `listTags`, with extended create/update payloads.
- [ ] Real API boot and a curl smoke test with `$RUNLY_TOKEN` against every new endpoint, including a 404 across companies.

## Stage 5 — `@runly/ui` additions

- [ ] `TagsField`: a multi-value creatable combobox with chips, async suggestions and a `placeholder="Buscar o crear..."`.
- [ ] `CopyableValue`: a label/value pair with a copy button shown on hover or focus, plus a toast.
- [ ] `SectionIndex`: a sticky scroll-spy list that becomes a `SelectField` jump menu below `md`.
- [ ] Export all three from `packages/ui/src/index.js` and document them in `docs/ai-context/rme3-runtime-capabilities.md`.

## Stage 6 — Detail screen

The files live in `apps/desktop/src/modules/runly.contacts/`:

- [ ] `screens/ContactDetailScreen.jsx`: queries for profile and activity, tab state in `?tab=`, and skeleton/404 states.
- [ ] `components/detail/ContactHeroCard.jsx`: avatar with a change action, chips, quick actions, overflow menu, and the KPI strip.
- [ ] `components/detail/ContactSummaryTab.jsx`: the general, fiscal, addresses and notes cards on the left; channels, people and tags on the right.
- [ ] `components/detail/ContactActivityTab.jsx`: the timeline grouped by day, module filter chips, and "Cargar más".
- [ ] `components/detail/ContactPeopleTab.jsx`, `ContactFilesTab.jsx` (`AttachmentsPanel`) and `ContactHistoryTab.jsx` (`ActivityTimeline`).
- [ ] `lib/contactLinks.js` (`tel`/`wa.me`/`mailto`/maps URL builders), with unit tests.

## Stage 7 — Form screen

- [ ] `screens/ContactFormScreen.jsx`: React Hook Form with the `contactUpsertSchema` resolver, `useFieldArray` per collection, fixed header and footer, `SectionIndex` and `FormCompletionRing`, create and edit modes, and permission guards.
- [ ] One section component each under `components/form/`: `GeneralSection` (avatar, type segmented, tags), `ChannelsSection`, `FiscalSection` (RFC state, filtered catalogs, incompatibility warning), `AddressesSection` (reusing `AddressFieldsSection`), `PeopleSection` and `NotesSection`.
- [ ] `hooks/useDuplicateCheck.js`: debounced, and feeds the banner.
- [ ] Avatar flow: on create, upload after the contact is created and before navigating. On edit, upload immediately.

## Stage 8 — Wiring and cleanup

- [ ] Add the `ModuleOutlet.jsx` routes `/contacts/new`, `/contacts/:id` and `/contacts/:id/edit`, with `new` ordered before `:id`.
- [ ] `ContactsScreen.jsx`: row click navigates to the detail page, "Nuevo contacto" goes to `/new`, the "Editar" row action goes to `/edit`, the avatar shows in the name cell, and a tag filter is added. Remove the sheet state and the URL-sync effect.
- [ ] Delete `ContactFormSheet.jsx`. Update the `contacts.contact.entity` blueprint fields and the help content.
- [ ] Update `docs/TASKS.md`.

## Stage 9 — Verification

- [ ] Full `node --test` for the API services and validators, `pnpm lint`, `pnpm build:web`.
- [ ] A manual walk of acceptance criteria 1–14 at desktop and 390px, in both themes.
- [ ] `docs/ai-context/ui-screen-audit-checklist.md` for both screens.
- [ ] Regression: Growth convert, the chat contact reference, the calls transcript contact proposal, exports, and offline sync pull.
- [ ] Mark the spec `Complete` with `Verified: YYYY-MM-DD (...)` evidence.
