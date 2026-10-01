# MirAI capabilities: projects, notes, contacts, purchases (step 4 of the MirAI roadmap)

- Status: Implemented, pending manual acceptance (§5)
- Date: 2026-09-30
- Contract and definition of done: `docs/ai-context/mirai-module-capabilities.md`.
  Templates: `routes/calendar|pfm|inventory/mirai-capabilities.js`.

## 1. Goal

Give MirAI real abilities in `runly.projects`, `runly.notes`, `runly.contacts` and
`runly.purchases`, each meeting the 7-point definition of done. Retire the
corresponding core tools (`list_my_tasks`, `search_runly` stays for people/companies
across modules).

## 2. Common rules

- Every tool/action calls the module's existing service functions, and actions
  replicate the side effects the HTTP route performs after the service call
  (activity, notifications, realtime broadcast). If those side effects are inline in
  the route, extract them to a `<module>-effects` helper shared by route and action
  (calendar precedent: `calendar-event-effects.js`), keeping route behavior identical.
- Permissions: the same keys the corresponding HTTP routes require.
- Aggregates are exact (computed in SQL/Prisma), lists return `total` + max 30 rows
  with stable ids.
- Each module's detail screen publishes `useMiraiRecordContext` (frontend), and its
  `describeContext` describes that record.
- Help `overview.md` of the module gets 3-4 example MirAI requests.

## 3. Per module

### runly.projects (tasks)
- Tools: list/search tasks across the caller's projects (assignee, status, priority,
  due range, project, text; overdue flag), task summary (counts by status / assignee /
  project, overdue count, due this week), list projects (with progress).
- Actions: create task (project by name, title, assignee by name, due date, priority,
  description), update task (status, assignee, due date, priority, title), delete task
  (if the module supports it; otherwise omit and document).
- Context: task detail and project detail.
- Removes core `list_my_tasks` from `apps/api/src/routes/chat/mirai-tools.js`.

### runly.notes
- Tools: search notes (title/content text, tag, folder) with `noteId` and a short
  excerpt, get note content (capped 6000 chars, permission/share checked).
- Actions: create note (title, content as plain text/markdown converted the way the
  module stores it, folder, tags), append to a note, rename/move, delete (soft, if
  supported). Collaborative docs (`ydoc`) must go through the service path that keeps
  the Y.Doc consistent; if appending to Y.Doc content is not safely supported by the
  service, omit "append" and document it.
- Context: open note.

### runly.contacts
- Tools: search contacts (name, email, phone, company, type, tags) with `contactId`,
  contact detail (fields, related company), summary (counts by type/tag/created month).
- Actions: create contact, update contact fields, archive/delete (whatever the module
  uses: soft-delete `enabled: false`).
- `publicLookup`: company contacts — `publicFields: ["companyName", "website", "city"]`
  (public company info). Never person emails/phones.
- Context: contact detail.

### runly.purchases
- Tools: build on `services/purchases-assistant-context.js` (pending actions:
  approvals, overdue invoices, orders awaiting receipt, drafts) plus search documents
  (requests/orders/invoices by status, supplier, date, number) and spend summary
  (totals by supplier/month/status, per currency).
- Actions: create purchase request (draft), approve/reject a pending approval assigned
  to the caller, register a receipt only if the service exposes a simple path — each
  through the existing services/policies; anything not cleanly supported is omitted
  and documented.
- `publicLookup`: supplier — `publicFields: ["name", "website"]` (public company info).
- Context: purchase document detail.

## 4. Testing

Per module, fake services: each tool returns exact totals and ids; each action's
prepare does not write and execute calls the service; permission filtering;
`describeContext` returns null for inaccessible records. Existing route tests pass
after any effects extraction. `pnpm build:web`.

## 5. Acceptance

- "que tareas tengo vencidas" / "crea una tarea para Ana en el proyecto X para el viernes".
- "busca mis notas sobre el proveedor X" / "crea una nota con el resumen de esta llamada".
- "cuantos clientes dimos de alta este mes" / "actualiza el telefono de este contacto".
- "que tengo pendiente en compras" / "cuanto le compramos a X este trimestre vs el anterior".
