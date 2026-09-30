# Plan: inventory dashboard

Spec: `docs/superpowers/specs/2026-09-29-inventory-dashboard-design.md`.

- [x] `inventory-dashboard-service.js`: monthly trends (raw SQL, company time zone), top groupings, purchase value, warranties, merged with the admin summary.
- [x] `GET /inventory/dashboard` + SDK `getDashboard`.
- [x] Desktop: `InventorySummaryScreen` becomes the dashboard (`components/dashboard/DashboardParts.jsx`: stat tiles, bar lists, monthly grouped-bar chart with legend + tooltip, palette slots 1-2 per theme).
- [x] Navigation: "Dashboard" first entry; module root resolves to it.
- [x] Help `views/dashboard.md`.

Verified: 2026-09-29 (month key / alignment unit test; inventory suites 163/163; eslint; vite build). Not verified: the SQL against a database (requires `pnpm db:migrate` for the admin-status columns) and a live UI walkthrough.
