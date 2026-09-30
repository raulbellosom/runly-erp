# Inventory: dashboard

Date: 2026-09-29
Status: Approved 2026-09-29 (product owner request in session)
Module: `runly.inventory`

## Goal

A landing dashboard for the module (replaces the "Resumen" screen at
`/inventory/summary`, which becomes the module's first navigation entry and the
default route) with statistics and charts of the inventory.

## Content

- KPIs: total, one per administrative status (existing), plus assigned %,
  total purchase value (non-deregistered), warranties expiring in 30 days.
- Monthly trend (last 12 months, company time zone): altas (registrations —
  `registeredAt`, else `createdAt`) vs bajas (`deregisteredAt`); toggle to
  asignaciones vs devoluciones (`InvAssignment.assignedAt` / `returnedAt`).
  Grouped bars, two series, legend + tooltip.
- Top lists (non-deregistered items, top 8, bar lists with count + share):
  by type, brand, model, location, and collaborators with most assigned items.
- Existing breakdowns: administrative status, condition, operational status.
- Warranties: expired count, expiring in 30/90 days, next 8 items to expire.
- Pending baja proposals queue (existing).

## API

`GET /inventory/dashboard?months=12` (`inventory.item.read`) — one payload with
all the above; `GET /inventory/summary` stays for compatibility.

## Out of scope

Custom date ranges, exports, per-location drill-down pages.
