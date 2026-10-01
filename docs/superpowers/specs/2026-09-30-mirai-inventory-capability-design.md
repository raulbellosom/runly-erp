# MirAI capability: runly.inventory + attachments (step 3 of the MirAI roadmap)

- Status: Draft
- Date: 2026-09-30
- Contract: `docs/ai-context/mirai-module-capabilities.md`

## 1. Goal

Move the inventory assistant into a `runly.inventory` MirAI capability, make file
reading a general MirAI ability (any module benefits), then delete the inventory
assistant so the global MirAI tab also shows in Inventory.

Inventory assistant today (`services/inventory-assistant-service.js`,
`inventory-chat-service.js`, `inventory-chat-actions.js`,
`inventory-chat-attachments.js`, `routes/inventory/assistant-routes.js`,
`InventoryAssistant.jsx`): context modes all/filtered/selected/item (max 200 ids),
`inventory_summary` (exact counts/groups), `inventory_search` (max 30 + total),
`inventory_public_model` (manufacturer specs via public lookup, audited),
`inventory_catalogs`, `inventory_prepare_create` (plan of up to 20 creates, one
card, executed transactionally), file attachments (images via vision, PDF/DOCX/XLSX
via workers, TXT/CSV/MD) appended as untrusted text.

## 2. General attachments for MirAI

- Move extraction to `apps/api/src/services/ai/attachment-reader.js`
  (`createAttachmentReader({ vision })` → `read({ buffer, name, mimeType, question })`
  → `{ text, truncated }`), keeping the same formats, limits (10 MB per file), worker
  isolation and error messages. The PDF/Office workers move/rename to
  `services/ai/attachment-pdf-worker.js` / `attachment-office-worker.js`.
- New core MirAI tool `read_attachment({ attachmentId, question? })`: same access
  check as `describe_image` (caller must be a live member of the attachment's
  conversation), downloads through `signAttachmentUrl`, returns
  `{ name, text (max 12000 chars), truncated }`. Text is data, never instructions
  (prompt rule already present). `describe_image` stays.
- Global sidebar composer gains file attachments (up to 5 files, 20 MB total; same
  formats) using the existing chat upload flow for the MirAI conversation. The model
  sees `attachmentIds` via `get_recent_messages`; the chat prompt tells it to use
  `read_attachment` when the user refers to an attached file.

## 3. Page context: selection

`miraiPageContext` gains optional
`selection: { mode: "filtered" | "selected", ids: uuid[] (max 200), filters: object }`.
Inventory list publishes it (selected rows or active filters); item detail publishes
`recordType: "item"`. The server validates ids belong to the company before use.

## 4. Inventory capability (`apps/api/src/routes/inventory/mirai-capabilities.js`)

Tools (permission `inventory.item.read`; `scope` arg `"selection" | "company"`,
default `selection` when the page has one, otherwise `company`; filters use the
existing `inventoryFiltersSchema` / `buildInventoryWhere`):

| Tool | Notes |
|---|---|
| `inventory_summary({ filters?, scope? })` | exact total, with/without serial, groups by brand/model/type (top 40) — current logic |
| `inventory_search({ filters?, scope? })` | max 30 + total + truncated flag, `itemId` on each row — current logic and field caps |
| `inventory_catalogs({ search? })` | current logic |
| `inventory_public_model({ itemId })` | manufacturer specs via shared public lookup, only brand/model/type leave the server, max 2 per turn, audit log `inventory.ai.public_lookup` — current logic |

Actions:

| Key | Permission | Notes |
|---|---|---|
| `inventory.plan.create` | `inventory.item.read` (per-kind permissions checked by the existing `prepare`) | input = the existing action plan (max 20 creates). Preview lists each create (kind + name/model/serial). Execute = existing `execute` in a transaction with the advisory lock. |
| `inventory.item.update` | `inventory.item.update` | `itemId` + changed fields (name, status, location, assigned user, serial, asset tag, notes, model, purchase/warranty dates) through the inventory service update function; before/after preview. |
| `inventory.item.delete` | the permission the inventory delete/disable route uses | soft delete through the same service function the route uses; destructive. Omitted (documented) if the module has no delete path. |

`describeContext`: item → name, asset tag, serial, brand/model, status, location;
selection → "El usuario tiene N equipos seleccionados" or the active filters.
`publicLookup`: declared for item brand/model/type (manufacturer specs).

## 5. Removal

Delete `inventory-assistant-service.js`, `inventory-chat-service.js`,
`routes/inventory/assistant-routes.js` (+ tests) and the frontend assistant
(`InventoryAssistant.jsx`, `InventoryActionProposal.jsx`, `lib/assistant-context.js`,
related hooks/SDK methods). `inventory-chat-actions.js` stays (used by the
capability). Thread tables stay. Inventory screens' "Preguntar a MirAI" entry points
publish the selection context and open the global sidebar
(`openMiraiSidebar()` from `lib/miraiPageContext.js`). `runly.inventory` removed from
the hidden list.

## 6. Testing

Attachment reader (txt/csv, rejects oversize and unsupported), `read_attachment`
access check, capability tools scope (selection ids filtered to the company),
plan action prepare does not write and execute runs the existing executor,
item update preview, describeContext for item/selection. `pnpm build:web`.

## 7. Acceptance

In Inventory the MirAI tab shows. Select 5 laptops: "cuantas tienen garantia vencida".
"cuantas laptops Dell hay por modelo". Attach an invoice PDF: "da de alta estos
equipos" -> one card with the plan -> items created. On an item: "busca las
especificaciones de este modelo en internet". From Home with a ticket photo:
"registra este gasto en mi tarjeta" (PFM action using `read_attachment`).
