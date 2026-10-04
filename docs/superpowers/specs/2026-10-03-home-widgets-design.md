# Home widgets — design spec

Status: approved (autonomous roadmap decision, 2026-10-03)

## Problem

The Home redesign (commit 0f8a61d9) shipped a high-contrast navy hero whose only
function was an app search. It draws attention without giving information. Users want
Home to summarize what is going on across their modules.

## Goals

- Replace the navy hero with a light, low-contrast header: date, greeting, compact
  app search (`/` shortcut kept), "Continuar" recents, and a "Personalizar" control.
- Add a widget board between the header and the app grid. Each widget summarizes
  one module and links to it.
- Widgets are shown only when their module is available to the user (installed,
  enabled, in `availableModules`). Users can hide/show widgets; the choice is a
  per-user preference saved server-side (`home.widgets` -> `{ hidden: string[] }`),
  so new widgets appear by default.

## Initial widget catalog

| id | Module | Content | Source |
|---|---|---|---|
| `agenda` | runly.calendar | Next 7 days of events, grouped Hoy / Mañana / date, max 5 | `GET /calendar/events?start&end` |
| `pfm` | runly.pfm | Total balance, month income/expense with change vs previous month, top 3 wallets | `GET /pfm/summary`, `GET /pfm/wallets` |
| `ledger` | runly.ledger | Accounts with current balance (top 4), totals per currency | `GET /ledger/accounts` |
| `inventory` | runly.inventory | Active, assigned, pending proposals, warranties expiring in 30 days | `GET /inventory/dashboard` |
| `online` | runly.chat | Users currently online (presence), excluding self | `useGlobalPresence()` (no API) |
| `activity` | runly.activity | Last 5 activity entries | `GET /activity/recent` |

No new API endpoints. API permissions remain authoritative: a 403 renders a quiet
"Sin acceso" state in that widget, never an error toast.

## UX rules

- Grid: 1 col mobile, 2 cols md, 3 cols xl. All widgets are the same height, so
  the board reads as one block.
- Every widget: header (module icon, title, "Abrir" link), body with skeleton /
  `EmptyState compact` / access-denied states. No nested scroll regions.
- Numbers use tabular figures and text tokens; deltas carry an arrow icon + text
  (never color alone). No charts in this iteration.
- "Personalizar" opens a Popover with one `Switch` per available widget.
- When every widget is hidden, the board collapses to nothing (header button still
  allows re-enabling).

## Out of scope

Drag-and-drop ordering, widget sizes, widgets contributed by RME3/custom modules
(future: a manifest `homeWidgets` contribution point), per-company widget defaults.
