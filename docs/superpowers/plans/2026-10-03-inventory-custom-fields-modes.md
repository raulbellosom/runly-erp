# Plan: Campos personalizados por tipo y a demanda

Spec: docs/superpowers/specs/2026-10-03-inventory-custom-fields-modes-design.md

- [x] 1. Migration `inv_custom_field.on_demand` + schema.prisma; `pnpm db:migrate`.
- [x] 2. Catalog service: `onDemand` create/update; type list excludes on-demand.
- [x] 3. Item service: `removedCustomFieldIds`; nullable attached values; field select adds `categoryId`/`onDemand`.
- [x] 4. UI: `DynamicFieldsSection` extra fields + library search + creator scopes; RunlyForm seeding/payload.
- [x] 5. Catalog panel "Solo a demanda"; item detail custom fields section.
- [x] 6. `sr-only` scroll fix. Tests, lint, build.

Also fixed while here: inventory item update/delete/return wrote AuditLog with `actorId: 'system'` (not a uuid), so the write failed silently and edits never reached the audit trail; they now use the real actor. Custom field ids from requests are checked against the company.

Verified: 2026-10-03 (migration applied, `prisma migrate status` up to date; custom-fields-values + custom-field-key + renderer + inventory router/service tests pass; eslint clean; `vite build` OK). Pending: browser check by the owner.
