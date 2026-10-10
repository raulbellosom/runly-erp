import test from "node:test";
import assert from "node:assert/strict";
import { alertMessage, availableAction, filterModules, freshnessOf, moduleAlerts, stepStatuses } from "../marketplace.js";

const base = { key: "custom.notes", name: "Notas", trust: "community-verified", official: false, state: "available", availability: "available", compatibility: { compatible: true, reasons: [] }, publisher: { displayName: "Acme Labs" } };

test("revoked and withdrawn are distinct alerts; revoked never uninstalls", () => {
  const revoked = moduleAlerts({ ...base, state: "installed", installedWarning: { reason: "Vulnerabilidad", replacement: { version: "0.2.0" } } });
  assert.deepEqual(revoked.map((a) => [a.kind, a.title, a.replacement]), [["revoked", "Esta versión fue revocada", "0.2.0"]]);
  assert.match(revoked[0].hint, /No se desinstala/);
  const withdrawn = moduleAlerts({ ...base, state: "installed", installedNotice: { type: "withdrawn", message: "Retirada" } });
  assert.deepEqual(withdrawn.map((a) => [a.kind, a.tone]), [["withdrawn", "notice"]]);
});

test("actions: built-ins, installed, revoked, untrusted, incompatible and blocked catalogs", () => {
  assert.equal(availableAction({ ...base, state: "built-in", builtIn: true }, { canManage: true }), null);
  assert.equal(availableAction({ ...base, state: "installed" }, { canManage: true }), null);
  assert.equal(availableAction(base, { canManage: false }), null, "viewing is not installing");
  assert.deepEqual(availableAction(base, { canManage: true }), { type: "install", disabled: false });
  assert.deepEqual(availableAction({ ...base, state: "update" }, { canManage: true }), { type: "update", disabled: false });
  for (const patch of [{ revocation: { reason: "x" } }, { trust: "untrusted" }, { availability: "withdrawn" }, { compatibility: { compatible: false, reasons: ["contracts"] } }])
    assert.equal(availableAction({ ...base, ...patch }, { canManage: true }).disabled, true, JSON.stringify(patch));
  assert.equal(availableAction(base, { canManage: true, blocked: true }).disabled, true);
});

test("install steps reflect server phases and the failing phase", () => {
  assert.deepEqual(stepStatuses({ completed: ["downloading", "verifying"], failedPhase: "preflight" }).map((s) => s.status), ["done", "done", "failed", "pending", "pending"]);
  assert.deepEqual(stepStatuses({ completed: ["downloading", "verifying", "preflight"], running: "installing" }).map((s) => s.status), ["done", "done", "done", "running", "pending"]);
});

test("filters use structured trust and alerts map per domain codes", () => {
  const modules = [base, { ...base, key: "custom.billing", name: "Facturación", trust: "official", official: true, publisher: null }];
  assert.deepEqual(filterModules(modules, { trust: "official" }).map((m) => m.key), ["custom.billing"]);
  assert.deepEqual(filterModules(modules, { query: "runly" }).map((m) => m.key), ["custom.billing"]);
  assert.deepEqual(filterModules(modules, { query: "acme" }).map((m) => m.key), ["custom.notes"]);
  assert.equal(alertMessage("catalog_official_rollback"), alertMessage("catalog_v2_rollback"));
  assert.equal(alertMessage(null), null);
});

test("freshness per trust domain: expired blocks install/update, stale stays possible with confirmation", () => {
  const data = { catalogs: { official: { freshness: "expired" }, community: { freshness: "stale" } } };
  const official = { ...base, trust: "official", source: "official" };
  assert.equal(freshnessOf(data, official), "expired");
  assert.equal(freshnessOf(data, base), "stale");
  assert.equal(availableAction(official, { canManage: true, freshness: freshnessOf(data, official) }).disabled, true);
  assert.equal(availableAction(base, { canManage: true, freshness: freshnessOf(data, base) }).disabled, false);
});
