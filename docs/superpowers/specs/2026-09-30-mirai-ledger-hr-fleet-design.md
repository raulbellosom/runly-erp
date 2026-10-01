# MirAI capabilities: runly.ledger, runly.hr, runly.fleet (step 5 of the MirAI roadmap)

- Status: Draft
- Date: 2026-09-30
- Contract and definition of done: `docs/ai-context/mirai-module-capabilities.md`;
  common rules: `2026-09-30-mirai-remaining-modules-design.md` §2.

## 1. Goal

Give MirAI the 7-point definition of done in `runly.ledger` (integrating its existing
AI statement import), `runly.hr` and `runly.fleet`; retire the core tools they
replace (`list_bank_accounts`; also `search_inventory`, now duplicated by the
inventory capability).

## 2. Shared: chat attachment access for capabilities

Extract the access check + download used by `read_attachment` (`chat/mirai-tools.js`)
into `apps/api/src/routes/chat/chat-attachment-access.js`:
`createChatAttachmentAccess({ prisma, listMessages, signAttachmentUrl })` →
`fetchForActor(attachmentId, ctx)` → `{ buffer, name, mimeType }` or throws a
404-style error when the caller is not a live member of the attachment's
conversation. `read_attachment` and `describe_image` use it; the wiring passes it to
capabilities that need files (`deps.attachments`). Actions read
`actx.turn` for `actorAuthUserId`/`companyId`.

## 3. runly.ledger

- Tools: accounts with balances (`accountId`, bank, currency, balance) — replaces core
  `list_bank_accounts`; search transactions (account, date range, type, category,
  text, amount range) with `transactionId`, `total` + sums per currency; summary
  (income/expense by category / month / account, per currency, previous-period
  comparison); categories.
- Actions: create transaction, update transaction, delete transaction (same
  services/permissions/effects as the routes); **import statement from attachment**
  `ledger.statement.import`: args `attachmentId`, `account` (name or id). Prepare
  fetches the attachment, runs the existing recognition pipeline (same code path as
  `POST /ledger/imports/recognize`: PDF text/vision pages, spreadsheet mapping, dedup),
  stores the recognized rows + batch key as the proposal input (no proof token
  needed: the input is server-produced and stored server-side), preview = row count,
  date range, totals by type, duplicates skipped, first 10 rows. Execute = the same
  `commit` the route calls. Permission `ledger.import`. Max 15 MB.
- Context: account detail screen.
- publicLookup: not applicable; exchange rates via `web_search`.

## 4. runly.hr

- Tools: search employees (name, department, position, status) with `employeeId`;
  employee detail (fields the caller may read — respect the same field-level
  restrictions the HR routes apply, never salary/PII beyond what the route returns);
  headcount summary (by department / position / status / hire month, exact).
- Actions: create employee, update employee fields (non-sensitive fields the route
  allows), deactivate employee (soft) — only what HR routes support with the same
  permissions; anything sensitive or multi-step is omitted and documented.
- Context: employee detail.

## 5. runly.fleet

- Tools: search vehicles (plate, brand/model, status, driver) with `vehicleId`;
  vehicle detail (driver, insurance, upcoming expirations); fleet summary (counts by
  status/type, insurance/verification expiring in N days, exact); drivers search.
- Actions: create vehicle, update vehicle (status, driver assignment if the route
  allows, mileage, notes), deactivate vehicle; insurance create/update only if the
  service exposes a simple path.
- publicLookup: vehicle `publicFields: ["brand", "model", "year"]` (manufacturer specs,
  recall/maintenance info). Never plates or VINs.
- Context: vehicle detail.

## 6. Testing / acceptance

Per module per the common rules. Acceptance:
- Ledger: "cuanto entro y salio de BBVA este mes vs el anterior"; attach a bank PDF:
  "importa este estado de cuenta a la cuenta BBVA" -> card with rows -> transactions
  created, duplicates skipped.
- HR: "cuantos empleados hay por departamento"; "dame los datos de contacto de X".
- Fleet: "que seguros vencen este mes"; "busca las especificaciones de este modelo".
