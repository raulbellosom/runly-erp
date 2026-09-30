# Plan — runly.purchases core redesign

Spec: `docs/superpowers/specs/2026-09-30-purchases-core-redesign-design.md`
(the API contract in spec section 6 is binding for all three workstreams).

Rules for every workstream: JavaScript only, UI text in Spanish, code/comments
in English, no emojis, no file over 800 lines, `@runly/ui` components only (no
native inputs, no `window.confirm`), Tailwind only, TanStack Query, never run
`pnpm db:migrate` / `db:reset` / seeds (shared database), never start/stop the
dev servers on 4010/5173.

## Workstream A — Backend (API, schema, SDK)

- [x] A1. Forward migration `prisma/migrations/20260930120000_purchases_redesign/migration.sql`
      (tables + columns from spec §3, indexes, FKs, RLS block) and matching
      models/fields in `prisma/schema.prisma`; `pnpm db:generate`.
      Verified: 2026-09-30 (migration 20260930120000_purchases_redesign written, NOT applied; schema.prisma models PurchaseRequest/Quote/Approval/Receipt/ReceiptLine + new columns; `pnpm db:generate` OK)
- [x] A2. `purchase-policies.js`: `evaluatePolicies`, `buildStageMap`,
      `STAGE_LABELS`, status/transition tables. Unit tests.
      Verified: 2026-09-30 (purchase-policies.js; purchase-policies.test.js 7/7 pass)
- [x] A3. Split services (each < 500 lines):
      `purchases-service.js` (settings/workflow/capabilities/`assertCapability`/dashboard),
      `purchase-documents-service.js` (orders + invoices CRUD, lines, transitions),
      `purchase-procurement-service.js` (cases, requests, quotes, approvals),
      `purchase-receipts-service.js`, `purchase-relations-service.js`
      (hydration, bulk, propagation, inventory summary/candidates, create items
      from line via `createInventoryService`), `purchase-suppliers-service.js`,
      `purchases-assistant-context.js` (spec §10). Shared helpers in
      `purchases-shared.js` (errors, numbering, audit, money).
      Verified: 2026-09-30 (services split, largest purchase-procurement-service.js 369 lines; extra helpers purchase-case-bundle.js, purchase-listing.js, purchase-relation-hydration.js, purchase-inventory-bridge.js; node --check clean)
- [x] A4. Routes split under `apps/api/src/routes/purchases/` (`index.js`
      composes `documents-routes.js`, `procurement-routes.js`,
      `relations-routes.js`, `settings-routes.js`); permission + capability
      guard on every route.
      Verified: 2026-09-30 (routes/purchases/{index,settings,documents,procurement,relations}-routes + route-helpers.js; import smoke ok; router contract tests pass)
- [x] A5. Manifest (`purchasesMap`): navigation per spec §8, new permissions
      (spec §7) + `permission-catalog.js`; `/runtime/modules` capability filter
      in `apps/api/src/index.js` driven by a `PURCHASES_NAV_CAPABILITY` map
      exported from `purchases-service.js`.
      Verified: 2026-09-30 (10 nav entries + 25 permissions, all present in PERMISSION_CATALOG; /runtime/modules uses isPurchasesNavVisible/PURCHASES_NAV_CAPABILITY; contract test)
- [x] A6. SDK `runly.purchases` methods for every endpoint (names in the
      table below).
      Verified: 2026-09-30 (all 23 SDK methods + 5 legacy aliases; createRunlyClient import smoke lists them)
- [x] A7. Tests: update `purchases-core-contract.test.js`; add
      `purchase-policies.test.js`, `purchase-receipts.test.js` (partial
      receipt math, over-receipt rejected), relation hydration isolation.
      `node --test apps/api/src/services/__tests__/purchase*.test.js`, `pnpm lint`.
      Verified: 2026-09-30 (`node --test apps/api/src/services/__tests__/purchase*.test.js` 22/22 pass; eslint clean on all touched files; `pnpm lint` only fails on git-ignored custom.encuestas bundles)

SDK method names (binding for B and C):

```
dashboard, getSettings, updateSettings, getCapabilities,
list(kind, params), get(kind, id), create(kind, data), update(kind, id, data),
transition(kind, id, action, payload),
listApprovals(params), decideApproval(id, data),
listRelations(params), createRelation(data), bulkRelate(data), deleteRelation(id),
propagationPreview(params),
inventorySummary(itemId), inventoryCandidates(params), createInventoryFromLine(lineId, data),
searchDocuments(params),
listSuppliers(params), getSupplier(contactId), updateSupplierProfile(contactId, data)
```
Every method takes `token` as its last argument, like the rest of the SDK.
Keep the old names (`listOrders`, `createOrder`, `listInvoices`,
`createInvoice`, `listCases`) as thin aliases.

## Workstream B — Purchases frontend (`apps/desktop/src/modules/runly.purchases/`)

- [x] B1. Foundation: `lib/purchases-constants.js` (statuses, labels, tones,
      stage meta, currency/tax options, base path), `lib/format.js`,
      `hooks/usePurchases.js` (queries/mutations over the SDK above,
      `usePurchasesCan`, `useCapabilities`), `components/PurchaseStatusBadge.jsx`,
      `components/PurchaseFlowRibbon.jsx` (horizontal + vertical variants),
      `components/PurchasesHero.jsx`, `components/MoneyText.jsx`.
      Verified: 2026-09-30 (lib/purchases-constants.js, format.js, document-math.js (+4 node tests), hooks/usePurchases.js, PurchaseStatusBadge, PurchaseFlowRibbon (horizontal/vertical, light/dark), MoneyText; hero lives in components/dashboard/PipelineHero.jsx + detail/DocumentHero.jsx).
- [x] B2. Dashboard redesign (hero with flow ribbon pipeline, metric tiles,
      12-month area chart, supplier bars, attention panels, recent activity).
      Reuse inventory `Panel` pattern by copying its grammar into
      `components/dashboard/` (no cross-module import).
      Verified: 2026-09-30 (screens/PurchasesDashboard.jsx + components/dashboard/* (PipelineHero, MetricTiles, DashboardCharts, AttentionPanel); pnpm build:web ok).
- [x] B3. Lists: one `PurchaseDocumentList.jsx` screen driven by a config map
      (cases, requests, orders, receipts, invoices, payments), status chips
      (`SegmentedControl`), search, supplier filter, `RunlyTable` or
      `DataTable`, row click → detail route. Remove `PurchasesSubnav`.
      Verified: 2026-09-30 (screens/PurchaseDocumentList.jsx driven by lib/list-config.js (cases, requests, orders, receipts, invoices, payments with overdue chip), DataTable + server paging; PurchasesSubnav, PurchaseListScreen, CreatePurchaseDocumentDialog deleted (no remaining imports)).
- [x] B4. Editor: `PurchaseDocumentEditor.jsx` full-page (orders, invoices,
      requests) with React Hook Form + Zod, `LineItemsEditor.jsx`,
      `TotalsCard.jsx` (sticky), `SupplierField.jsx`, `InventoryItemPicker.jsx`
      (multi-select dialog over `inventoryCandidates`), linked orders picker +
      propagation prompt for invoices.
      Verified: 2026-09-30 (screens/PurchaseDocumentEditor.jsx + components/editor/* (HeaderFields, LineItemsEditor, TotalsCard, InventoryItemPicker, LinkedInventoryCard, LinkedOrdersField with propagation switch) + SupplierField; ?inventoryId= (repeatable), ?orderId=, ?caseId= supported).
- [x] B5. Detail: `PurchaseDocumentDetail.jsx` (hero, flow ribbon, policy
      alerts, action bar with transitions, tabs: Conceptos / Inventario /
      Relacionados / Archivos / Actividad), `ReceiveOrderDialog.jsx` (partial
      quantities), `CreateInventoryFromLineDialog.jsx`, `PaymentDialog.jsx`,
      `QuotesCompare.jsx` (case/request detail), `CaseDetail` variant with
      all documents.
      Verified: 2026-09-30 (screens/PurchaseDocumentDetail.jsx (orders, invoices, requests, receipts, cases) + components/detail/* (DocumentHero, DocumentActionBar, PolicyAlerts, LinesPanel, InventoryRelationsPanel, RelatedDocumentsPanel, ReceiveOrderDialog, PaymentDialog, CreateInventoryFromLineDialog, QuotesCompare, QuoteDialog, TransitionConfirmDialog); lib/document-actions.js (+3 node tests)).
- [x] B6. Approvals inbox, Suppliers list (cards + table toggle) and Supplier
      detail, Settings redesign (preset cards with ribbon preview, capability
      switches, stage mode `SegmentedControl`, policies editor).
      Verified: 2026-09-30 (screens/PurchaseApprovalsScreen.jsx, PurchaseSuppliersScreen.jsx (cards/table + suppliers/all scope), PurchaseSupplierDetail.jsx + SupplierProfileDialog, PurchaseSettingsScreen.jsx + components/settings/* (PresetCards, StagesPanel, PoliciesEditor)).
- [x] B7. Routing: `ModuleOutlet.jsx` SCREEN_MAP + `module-screen-resolver.js`
      for every path in spec §8 plus `/new`, `/:id`, `/:id/edit`.
      Verified: 2026-09-30 (ModuleOutlet SCREEN_MAP (9 purchases keys) + module-screen-resolver regex routes for every spec section 8 path plus /new, /:id, /:id/edit; resolver covered by document-actions.test.js).
- [x] B8. `pnpm build:web` + `pnpm lint`.
      Verified: 2026-09-30 (pnpm build:web built in 5.06s; eslint over apps/desktop/src exit 0; root pnpm lint fails only on 8 pre-existing errors in git-ignored generated custom.encuestas bundles (apps/api/bundles, modules/custom/.previews|.staging)).

## Workstream C — Inventory integration, help and docs

- [x] C1. Redesign `components/InventoryPurchaseSection.jsx` over
      `inventorySummary`: adaptive vertical timeline (only enabled stages with
      data), document cards with number/status/total/origin, navigate to the
      purchase detail, create order/invoice (navigate to the purchases editor
      with `?inventoryId=`), link existing via `searchDocuments` with search +
      paging, unlink with `ConfirmDialog`. Delete `CreatePurchaseDocumentDialog.jsx`
      and `LinkExistingPurchaseDialog.jsx` if no longer used.
      Verified: 2026-09-30 (section split into `InventoryPurchaseSection.jsx` + `InventoryPurchaseTimeline.jsx` / `InventoryPurchaseLinkDialog.jsx` / `InventoryPurchaseMeta.js`, eslint clean on touched files; `LinkExistingPurchaseDialog.jsx` deleted, `CreatePurchaseDocumentDialog.jsx` kept because `screens/PurchaseListScreen.jsx` still imports it; runtime pending A's SDK `inventorySummary`/`searchDocuments`)
- [x] C2. Inventory item form/detail: add `acquisitionOrigin` (`SelectField`,
      PURCHASE/DONATION/TRANSFER/LEASE/INTERNAL/INITIAL_STOCK/OTHER) to the
      blueprint and API validator; label legacy purchase fields as "Datos
      heredados" (read-only in detail, hidden in the form when Compras is
      enabled and has relations).
      Verified: 2026-09-30 (`normalizeAcquisitionOrigin` + Zod enum; legacy section in detail via `hasLegacyPurchaseData`, in the form only when the item already has legacy data; `node --test apps/api/src/services/__tests__/inventory*.test.js` 135/135, `apps/desktop/src/modules/runly.inventory/lib/__tests__/*.test.js` 7/7, `node --check` on touched API files)
- [x] C3. Help content `apps/api/src/manifests/official/help/runly.purchases/`
      (`overview.md` + one `views/*.md` per screen), following the inventory
      help format.
      Verified: 2026-09-30 (overview + 10 view articles registered with `loadHelpBlueprints` in `purchasesMap`; manifest import lists 11 HELP blueprints; `help-service.test.js` 13/13, `load-help-blueprints.test.js` 5/5)
- [x] C4. Docs: `docs/03_core_modules.md` section for `runly.purchases`,
      `docs/TASKS.md` purchases line, MirAI integration note.
      Verified: 2026-09-30 (`docs/03_core_modules.md` runly.purchases section incl. MirAI integration points; TASKS line updated; help overview has a MirAI note; `pnpm lint` errors only in git-ignored generated `custom.encuestas` bundles)

## Verification (owner of the session)

- [ ] V1. Contract cross-check between B/C calls and A's SDK.
- [ ] V2. `node --test apps/api/src/services/__tests__/`, `pnpm lint`,
      `pnpm build:web`.
- [ ] V3. After the owner applies the migration: API boot + curl smoke.
