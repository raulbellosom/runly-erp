# RME3 Module Builder — conditional visibility and independent detail layout

Date: 2026-09-28
Status: Approved design (product owner, Module Builder session)
Builds on: `2026-09-27-rme3-builder-layout-media-design.md`
Plan: `docs/superpowers/plans/2026-09-28-rme3-builder-conditional-layout-plan.md`

## 1. Goal

1. Tabs, sections and individual fields of a Builder-made entity can be shown
   only when a condition on another field holds ("Mostrar si Tipo = Empresa").
2. The detail can have its own tab/section tree instead of inheriting the
   form's.

Required fields inside hidden elements are required **only while visible**,
enforced identically by the UI and the generated API.

## 2. Contract (`entity.layout`)

Rule shape (the one the renderer already evaluates for fields):

```js
{ field: 'tipo', equals: 'EMPRESA' }   // or notEquals | in: [..] | truthy: true|false
```

- `tab.visibleWhen`, `section.visibleWhen` (fields and attachments sections).
- `section.fieldRules: { <fieldKey>: rule }` for single fields placed in that
  section (keeps entity field definitions untouched).
- `layout.detail.tabs` (same shape as `layout.tabs`) — optional independent
  detail tree. Absent: the detail uses `layout.tabs`.

Validation (compiler):

| Code | Rule |
|---|---|
| `LAYOUT_RULE_FIELD_NOT_FOUND` | rule field must be an entity field |
| `LAYOUT_RULE_FIELD_TYPE` | rule field must be `select` or `boolean` |
| `LAYOUT_RULE_INVALID` | exactly one operator; `in` non-empty array; `truthy` boolean |
| `LAYOUT_RULE_UNKNOWN_OPTION` | `equals`/`notEquals`/`in` values must be declared select options (booleans: true/false) |
| `LAYOUT_RULE_SELF_HIDING` | the rule field cannot be inside the element it controls |
| `LAYOUT_RULE_FIELD_NOT_PLACED` | `fieldRules` keys must be fields of that section |

`layout.detail.tabs` gets the same structural validation as `layout.tabs`
(keys unique within the detail tree, fields exist and appear once). Detail
unplaced fields are appended to "Otros datos" like the form.

## 3. Runtime (`@runly/ui`)

- Shared pure helper `matchesVisibilityRule(rule, values)` (moved from
  RunlyDetail's private `matchesFieldRule`; same semantics).
- Compiler emits `tab.visibleWhen` in `schema.tabs[]`, `section.visibleWhen`
  on sections, and `visibleWhen` on the field specs from `fieldRules`.
- `RunlyForm`: evaluates against live form values; hidden tabs/sections are
  not rendered and their fields are skipped by validation and payload (so
  stored values are kept). If the active tab becomes hidden, the first visible
  tab is selected.
- `RunlyDetail`: evaluates against the record.

## 4. API (generated)

- Validators: a `required` field that is conditional (its field rule, its
  section rule or its tab rule) is emitted as optional in the create schema.
- Routes: generated `<entity>-visibility.js` exports
  `CONDITIONAL_REQUIRED = [{ field, label, rules: [rule...] }]` and
  `findMissingConditionalRequired(values)`; create checks the payload, update
  checks `{ ...existing, ...payload }` (loaded with the service's get-by-id).
  Missing → 400 `El campo <label> es requerido.` Entities without conditional
  required fields do not get the file or the checks.

## 5. Builder

- Tree rows (tab, section, field) get "Condición..." in their menu → a small
  dialog: field (select/boolean), operator (es igual a / no es igual a / es
  uno de / tiene valor / está vacío), value(s); "Quitar condición". Rows with
  a rule show a badge with the rule summary.
- Designer header: segmented "Formulario / Detalle". "Detalle con diseño
  propio" switch copies the form tree into `layout.detail.tabs`; turning it
  off removes it. The tree edits whichever tree is selected.
- Real preview gets a "Valores de prueba" strip with the select/boolean
  fields used by rules, so the author sees elements appear/disappear.

## 6. Testing

Compiler (rules validation, emission, detail tree, validators/visibility
module + route checks via in-process Hono requests), UI pure helpers
(`matchesVisibilityRule`, visible tab/section filtering), builder helpers
(rules, detail tree copy), build + lint.

## 7. Out of scope

AND/OR rule groups, rules on non select/boolean fields, server-side hiding of
values in API responses (visibility is presentation + required-ness only).
