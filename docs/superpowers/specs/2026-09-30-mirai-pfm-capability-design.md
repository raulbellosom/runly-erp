# MirAI capability: runly.pfm (step 2 of the MirAI roadmap)

- Status: Implemented, pending manual acceptance (§5)
- Date: 2026-09-30
- Contract: `docs/ai-context/mirai-module-capabilities.md`, spec `2026-09-30-mirai-global-capabilities-design.md`

## 1. Goal

Move everything the PFM assistant does into a `runly.pfm` MirAI capability, go beyond
it (exact cross-wallet analysis, edit/delete), then delete the PFM assistant so the
global MirAI tab also shows in PFM.

What the PFM assistant does today (`routes/pfm/assistant-*.js`,
`PfmAssistantSidebar.jsx`): overview, wallets, movements of one wallet, budgets,
upcoming charges, categories, and `propose_movement` (client-side create card). No
attachments, no internet.

## 2. Capability (`apps/api/src/routes/pfm/mirai-capabilities.js`)

PFM service context is `{ companyId, actorId }`; `actorId = actx.actorProfileId`.
All data is limited to wallets the caller can read (`wallets.listWallets`), and
every amount aggregate is grouped by currency (never summed across currencies).

### Tools

| Tool | Permission | Returns |
|---|---|---|
| `pfm_overview({ month? })` | `pfm.wallets.read` | `summary.getOverview` (exact) |
| `pfm_list_wallets()` | `pfm.wallets.read` | `walletId`, name, kind, currency, balance, credit limit, `bankLinked` |
| `pfm_search_movements({ from?, to?, month?, walletId?, categoryId?, direction?, status?, search? })` | `pfm.movements.read` | across readable wallets: `total`, sums by currency, up to 30 rows with `movementId`, wallet, category name, date, amount, direction, merchant, status |
| `pfm_spending_summary({ from, to, groupBy, direction?, compareWithPrevious? })` | `pfm.movements.read` | exact sums/counts grouped by `category` \| `month` \| `merchant` \| `wallet` (+ currency); `compareWithPrevious` adds the same totals for the previous period of equal length and the difference/percentage |
| `pfm_budgets({ month? })` | `pfm.movements.read` | `budgets.listBudgets` |
| `pfm_upcoming({ days? })` | `pfm.movements.read` | `summary.getUpcoming` (max 60 days) |
| `pfm_categories({ kind? })` | `pfm.categories.read` | `categoryId`, name, kind |

Only `POSTED`, `enabled` movements count in aggregates unless `status` is given.
Date range max 366 days.

### Actions

| Key | Permission | Notes |
|---|---|---|
| `pfm.movement.create` | `pfm.movements.create` | args `wallet` (name or id; optional when the user has exactly one writable non-bank wallet), `direction`, `amount`, `occurredOn?` (default today), `category?` (name or id, matched to kind), `merchant?`, `note?`. Rejects bank-linked wallets with the same message as the route. Validated with `createMovementSchema`. Executes `movements.createMovement`. |
| `pfm.movement.update` | `pfm.movements.update` | `movementId` + changed fields (amount, occurredOn, category, merchant, note, direction); `updateMovementSchema`; preview before/after. Executes `movements.updateMovement`. |
| `pfm.movement.delete` | `pfm.movements.delete` | `movementId`; destructive. Executes `movements.setMovementEnabled({ enabled: false })`. |

### describeContext

`recordType: "wallet"` (WalletDetailScreen): wallet name, kind, currency, balance.
Otherwise `El usuario esta en el modulo Finanzas personales.`

### publicLookup

Not applicable (personal finance data never leaves the server). Market/exchange-rate
questions use `web_search` with generic queries.

## 3. Removal

- Backend: delete `routes/pfm/assistant-service.js`, `assistant-tools.js`,
  `assistant-routes.js` and their tests; remove from `routes/pfm/index.js`
  (`app.pfmServices.assistant` too). Existing assistant thread tables stay (no data
  migration); the `pfm.assistant.use` permission stays in the catalog, marked
  deprecated in its description (removing it would churn seeded roles).
- Frontend: delete `PfmAssistantSidebar.jsx`, `AssistantMessageList.jsx`,
  `AssistantActionCard.jsx` (if unused elsewhere); `ModuleOutlet.jsx` stops wrapping
  PFM; `runly.pfm` removed from the hidden list in `lib/miraiPageContext.js`;
  `pfm.assistant` SDK methods removed.
- `WalletDetailScreen` publishes `useMiraiRecordContext({ recordType: "wallet", ... })`.

## 4. Testing

Fake services/prisma: create action resolves a wallet by name and rejects a
bank-linked wallet, prepare does not write; update preview has before/after;
`pfm_spending_summary` groups by currency and computes the previous-period
comparison; tools only see readable wallets; capability wiring adds `runly.pfm` to
`list_modules`. `pnpm build:web`.

## 5. Acceptance

In PFM, the MirAI tab shows. "cuanto gaste en comida este mes vs el anterior" ->
exact comparison. "apunta 250 de gasolina en mi tarjeta" -> create card -> movement
appears in the wallet. With a wallet open: "cual es mi gasto mas grande aqui este mes".
