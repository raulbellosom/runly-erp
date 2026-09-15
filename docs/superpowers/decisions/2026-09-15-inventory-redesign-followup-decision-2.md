# Decision Log — Inventory Redesign Follow-Up (2)

Date: 2026-09-15
Feature: Rediseño de Inventario — pase de acabado
Spec: docs/superpowers/specs/2026-09-15-inventory-redesign-followup-design.md

---

## Decision

`DetailActionBar` no longer hides Volver/Eliminar behind a "···" overflow menu. It now renders every action (primary and secondary) as a directly visible button.

## What the spec said

Section 5, Goal 3 and Section 8 (UX requirements) specified a filled primary "Editar" plus a "···" menu holding Volver/Eliminar, based on the user's own explicit choice between two options presented during brainstorming (`docs/superpowers/specs/2026-09-15-inventory-redesign-followup-design.md`, brainstorming transcript: "Primary Editar + overflow menu (Recommended)").

## What was implemented instead

After the overflow-menu version shipped and the user tried it live, they said plainly: "los botones de eliminar y volver no me gusta que esten ocultos" (I don't like Eliminar and Volver being hidden). `DetailActionBar` was rewritten to show every action as a visible button — secondary actions as outline buttons (Eliminar tinted red), primary Editar as the filled button, no `DropdownMenu` involved at all.

## Reason

Stakeholder decision made during/after implementation, after seeing the actual built UI — the user's own earlier approval of the overflow-menu approach didn't survive contact with the real thing. This is exactly the kind of case the decision-log process exists for: a design choice that looked right on paper turned out wrong in practice, and the fix is to follow the live correction rather than defend the original approved design.

## Impact on spec

Spec update required: Yes

Updated: Section 5 (Goal 3) and Section 8 (UX requirements) of `2026-09-15-inventory-redesign-followup-design.md` should be read as superseded by this decision for the "primary + overflow menu" detail: `DetailActionBar` shows primary + secondary actions all directly visible, not a menu. This document stands in for that spec edit rather than editing the already-approved spec file after the fact. No other part of the spec is affected — `DetailActionBar` as a named, reusable component in `@runly/ui` still exists and is still the thing `InventoryItemDetail.jsx` uses; only its internal rendering changed.
