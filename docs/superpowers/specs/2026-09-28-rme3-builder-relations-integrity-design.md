# RME3 Module Builder — relation integrity, labels and related-record tabs

Date: 2026-09-28
Status: Approved design (product owner, Module Builder session)
Plan: `docs/superpowers/plans/2026-09-28-rme3-builder-relations-integrity-plan.md`

## 1. Goal

Relation fields between entities of the same Builder module become safe and
readable:

1. A relation can only point to an existing, enabled record of the same company.
2. Disabling a record that others reference follows a per-relation rule:
   Bloquear (default), Dejar vacío, Desactivar también.
3. Tables, details and pickers show the target's display field, not its UUID.
4. The detail can show "related records" sections (e.g. Pedidos of a Cliente).

## 2. Why application-level integrity (not DB foreign keys)

- Records are soft-deleted (`enabled = false`), so `ON DELETE` never fires.
- The RME3 migration engine only allows additive `ADD COLUMN`; adding
  constraints to existing tables would need an engine extension.
DB-level FKs stay out of scope; all rules run in the generated API.

## 3. Contract (relation field in the ModuleDefinition)

```js
{ key: 'cliente', type: 'relation', targetEntity: 'cliente',
  labelField: 'nombre',          // optional; default: target's first text/email/phone field
  onDisable: 'restrict' }        // 'restrict' | 'setNull' | 'cascade' (default 'restrict')
```

Compiler diagnostics:

| Code | Rule |
|---|---|
| `RELATION_LABEL_FIELD_NOT_FOUND` | `labelField` must be a non-relation, non-file field of the target |
| `RELATION_INVALID_ON_DISABLE` | onDisable must be restrict, setNull or cascade |
| `RELATION_SET_NULL_REQUIRED` | `setNull` is not allowed on a required field |
| `RELATION_CASCADE_CYCLE` | cascade edges (target -> source entity) must not form a cycle |

Rules only apply to `targetEntity` relations (same module). `onDisable` is
ignored when the target entity has `softDelete: false` (it cannot be disabled).

Layout section `{ key, type: 'related', label, source: { entity, field } }`:
detail-only; `source.field` must be a relation of `source.entity` targeting
this entity (`LAYOUT_RELATED_INVALID_SOURCE`). The form skips it.

## 4. Generated API

- `api/<entity>-relations.js` (only when the entity has outbound same-module
  relations or inbound ones with a disable rule):
  - `assertRelationTargets(db, { companyId, data })`: for each set relation
    value, the target row must exist, be enabled and (if company scoped)
    share the company → else 400 `El registro seleccionado en "<label>" no
    existe o está inactivo.`
  - `beforeDisable(db, { companyId, id, actorId })`: restrict checks first
    (active referencing rows → 409 `No se puede desactivar: N <plural> lo
    usan.`), then setNull (`UPDATE ... SET field = NULL`), then cascade (each
    active child disabled through its own service, so its rules apply too).
- Service: create/update call `assertRelationTargets`; `set<X>Enabled` with
  `enabled: false` and inbound rules runs inside `prisma.$transaction`
  (re-entering itself with the transaction client), so the whole cascade is
  atomic.
- List/get select `<field>__label` via `LEFT JOIN` on the target (company
  scoped). List accepts `?<relationField>=<uuid>` filters.

## 5. Generated views

- Table: relation columns show `<field>__label`.
- Detail: relation fields render `<field>__label`.
- Form: relation picker uses `labelField` (was hard-coded `name`).
- Related section → detail `type: 'relation-list'` with
  `apiPath: /<slug>/<children>?<field>=:id&pageSize=50`, `titleField` = the
  child's label field, up to 2 subtitle fields, `hrefTemplate` to the child's
  detail page.

## 6. Builder

- FieldSheet (relation): "Campo a mostrar" and "Al desactivar el registro
  relacionado" (Bloquear / Dejar vacío — disabled when required / Desactivar
  también).
- Layout tree: "Agregar registros relacionados" lists `(entity, field)` pairs
  pointing to this entity; related sections render as a chip in the tree and
  a placeholder list in previews.

## 7. Testing

Compiler (diagnostics, relations module generation incl. in-process checks
with a fake `$queryRaw`, label joins, filters, related section emission),
builder helpers, build + lint.

## 8. Out of scope

DB foreign keys, cross-module relations, re-enable cascade, creating child
records from the related section.
