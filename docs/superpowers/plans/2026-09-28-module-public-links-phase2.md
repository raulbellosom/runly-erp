# Plan: Module public links — phase 2 (Builder)

Spec: `docs/superpowers/specs/2026-09-28-module-public-links-design.md` (section 7)
Date: 2026-09-28
Status: Implemented 2026-09-28

## Definition contract

New optional top-level `publicLinks` array in the ModuleDefinition:

```json
{ "key": "responder", "entity": "encuesta", "mode": "submit", "title": "Responder encuesta",
  "description": "", "fields": ["titulo", "descripcion"],
  "targetEntity": "respuesta", "formFields": ["nombre", "comentario"], "linkField": "encuesta",
  "submitLabel": "Enviar", "successMessage": "Gracias, recibimos tu respuesta." }
```

- `mode: 'view'` needs `fields` (1..30). `mode: 'submit'` needs `targetEntity` and `formFields` (1..30);
  `fields` (record summary shown above the form) is optional; `linkField` is an optional same-module
  relation field of `targetEntity` pointing at `entity`, filled with the shared record id.
- Display field types: everything except `file`, `json` and external relations (same-module
  relations show their label). Form field types: text, textarea, markdown, number, decimal,
  boolean, select, multiselect, date, datetime, email, phone.
- Every required field of `targetEntity` must be in `formFields` or be the `linkField`.
- `entity` and `targetEntity` must be company scoped. Max 10 public links.

## Tasks

- [x] P1. `packages/module-compiler/src/public-links.js`: validation (called from `validateModuleDefinition`)
  and `templates/public-links.js` generators: manifest `publicResources`, `views/<key>.public.js`
  (CUSTOM, `schema.public`, path `/p/<slug>/<kebab key>`, component `runly.public:RecordPage`,
  `schema.publicPage` with field metadata) and `api/public.js` reusing the generated services and
  validators. Tests.
- [x] P2. `/public/blueprints` exposes `schema.publicPage`; desktop registers `runly.public:RecordPage`
  (generic renderer inside `PublicLinkFrame`, honeypot, success state); outlet passes the schema.
- [x] P3. `GET /modules/:key/public-resources?entity=` (resources of an entity the user can manage);
  generated record detail shows "Compartir" opening `PublicLinksPanel`.
- [x] P4. Builder: "Enlaces" tab to create/edit public links (entity, mode, fields, target, link field).
- [x] P5. Docs: Builder help article, compiler doc section, capabilities doc.

## Verification

- [x] Compiler tests; `vite build`; boot smoke; compile a sample definition and check generated files load.
  Verified: 2026-09-28 (compiler+engine+API route tests 213/213, including executing the generated
  api/public.js against a fake prisma and validating the generated view/resources with the engine;
  `vite build` ok; boot on a temporary port: /health 200, /public/blueprints 200,
  /modules/:key/public-resources without session 401).
- [ ] Manual end-to-end in the Builder UI (publish a module with a public page, share, answer from a
  private window) — pending, needs the user's dev servers.
