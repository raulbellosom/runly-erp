# Decision Log — Inventory Redesign Follow-Up

Date: 2026-09-15
Feature: Rediseño de Inventario — pase de acabado
Spec: docs/superpowers/specs/2026-09-15-inventory-redesign-followup-design.md

---

## Decision

Two additional bugs in `RunlyDetail`, not identified during spec/plan writing, were fixed as part of implementing this plan's Task 5/6: (1) `normalizeSections()` never propagated a blueprint section's `column` value onto the normalized section object, so `splitSectionsByColumn()` could never place anything in the aside column; (2) the new section-card accent border/glow used `hsl(var(--primary))`, a CSS custom property that is never defined in this codebase.

## What the spec said

Section 17 (Blueprint impact) described reordering the `aside` column's sections and renaming one label, assuming the existing `column: 'aside'` mechanism already worked (it was inherited, unchanged, from the parent spec `2026-09-14-inventory-glass-redesign-design.md`, which introduced `layout: "two-column"` and `column: 'aside'` sections). Section 24 (Risks) did not anticipate the `column` split itself being broken. Section 5, Goal 5 described the accent color as `hsl(var(--primary))`-equivalent brand color, assuming that token existed.

## What was implemented instead

1. Live QA (screenshot from the user after Task 1-6 landed) showed the detail page's right column rendering completely empty — no Archivos/Asignación/Actividad/Comentarios anywhere, with the two-column grid otherwise visibly active. Reading `RunlyDetail.jsx`'s `normalizeSections()` confirmed none of its branches (`attachments`, `relation-card`, `relation-list`, `component`, and even `fields`) copied `entry.column` onto the returned section object — `splitSectionsByColumn()` therefore always found zero `column === "aside"` sections, for every module using `RunlyDetail`'s two-column layout, not just Inventory (Fleet's vehicle detail blueprint declares `column: "aside"` on four sections that were equally affected). Added `normalizeSectionColumn()` in `detail-presentation.js` and applied it in every `normalizeSections()` branch and in `normalizeComponentSection()`.
2. Grepping the whole codebase for a `--primary:` definition found none — only `--brand-primary` (a raw hex custom property chain) and Tailwind's generated `--color-primary` exist. `hsl(var(--primary))` is invalid CSS and very likely explains the "destello" (flash) the user reported specifically at the "Identificación" header, right where the new inset box-shadow sat. Switched the accent border/shadow to `var(--brand-primary)` via the `border-l-(--brand-primary)` arbitrary-property syntax `Button.jsx` already establishes, and confirmed in the compiled CSS output that it resolves to a real color this time.

## Reason

Both are discovered technical defects blocking this plan's own acceptance criteria (AC5: sidebar order visible; AC6: visible accent on section cards) — not scope creep, not stakeholder-requested changes. Neither could have been caught by this repo's automated test suite (no component-render test harness exists) or by a plain code read without tracing `splitSectionsByColumn`'s actual input shape end-to-end and grepping for the CSS token's real definition; both surfaced only once the user did live browser QA, which is exactly the discovery step this decision log documents.

## Impact on spec

Spec update required: Yes

Updated: Section 24 (Risks) of `2026-09-15-inventory-redesign-followup-design.md` should note, for any future work touching `RunlyDetail`'s two-column layout, that the `column` propagation bug affected Fleet too (its four `column: "aside"` sections on the vehicle detail screen now also correctly render in the sidebar as a side effect of this fix — not a regression, but a behavior change beyond Inventory that the original spec's Section 24 Risk 2 did not anticipate). Fleet's detail screen should get the same 390px/1440px manual regression check called for in Section 26 before this is considered fully verified, with particular attention to whether its sidebar content (driver/insurance/documents) now renders as intended. This document stands in for that spec edit rather than editing the already-approved spec file after the fact.

Also noted for later cleanup, out of scope here: `hsl(var(--primary))` (and its opacity variants) is used in several other pre-existing components (`FormCompletionRing.jsx`, `RingProgress.jsx`, `ProgressMeter.jsx`, `AttachmentsPanel.jsx`, `DynamicFieldsSection.jsx`, `AdvancedFileViewer.jsx`, `date-picker-shared.jsx`, `CostsSummaryPanel.jsx`, `ReportPartsEditor.jsx`, `SwipeableRow.jsx`, `SyncStatusBar.jsx`, `SyncStatusPopover.jsx`, `DistDropZone.jsx`) with the same invalid-token problem. None of these were touched by this plan; worth a dedicated follow-up pass.
