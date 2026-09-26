-- Adds the HELP blueprint kind used by the module help system (per-module
-- and per-view markdown documentation synced through the existing
-- Blueprint table — see docs/superpowers/specs/2026-09-26-module-help-system-design.md).
-- Additive only: no existing row uses this value.

ALTER TYPE "blueprint_kind" ADD VALUE IF NOT EXISTS 'HELP';
