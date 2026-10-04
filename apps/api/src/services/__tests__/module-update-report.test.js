import test from "node:test";
import assert from "node:assert/strict";
import { buildUpdateReport, describeOperation, invalidPackageReport } from "../module-update-report.js";

const staged = {
  manifest: { version: "1.2.0" },
  inspection: { files: 10, hasComponents: true },
  views: [{ key: "x.panel", kind: "CUSTOM", schema: { title: "Panel", component: "custom.x:Panel", path: "/app/m/custom.x/panel" } }, { key: "x.t", kind: "TABLE" }],
};

test("safe changes are listed; unsupported ones and drift block, mirroring publish", () => {
  const report = buildUpdateReport({
    staged,
    moduleRow: { status: "INSTALLED", version: "1.1.0" },
    preflight: { schemaMigration: { canAutoApply: false, operations: [
      { type: "ADD_COLUMN", table: "x_cliente", column: { name: "rfc" }, safety: "SAFE" },
      { type: "DROP_COLUMN", table: "x_cliente", column: "edad", safety: "DESTRUCTIVE" },
    ], drift: [] }, missingRequired: ["runly.catalog"] },
    noChanges: false,
    preview: { id: "11111111-1111-4111-8111-111111111111" },
  });
  assert.equal(report.blocked, true);
  assert.deepEqual(report.changes, ["Se agregará la columna rfc en x_cliente."]);
  assert.match(report.blockers[0], /eliminaría la columna edad/);
  assert.ok(report.warnings.some((warning) => warning.includes("runly.catalog")));
  assert.deepEqual(report.customViews, [{ key: "x.panel", title: "Panel", component: "custom.x:Panel", path: "/app/m/custom.x/panel" }]);
  assert.deepEqual(report.preview, { id: "11111111-1111-4111-8111-111111111111" });
});

test("a clean update is not blocked but warns when the version did not increase", () => {
  const report = buildUpdateReport({ staged, moduleRow: { status: "INSTALLED", version: "1.2.0" }, preflight: { schemaMigration: { canAutoApply: true, operations: [], drift: [] } }, noChanges: false, preview: { error: "Unexpected token" } });
  assert.equal(report.blocked, false);
  assert.equal(report.versionNotIncreased, true);
  assert.ok(report.warnings.some((warning) => warning.includes("Unexpected token")));
  assert.equal(report.preview, null);
});

test("invalid packages and operation texts", () => {
  const report = invalidPackageReport({ message: "MANIFEST_KEY_MISMATCH", details: { expected: "custom.a", found: "custom.b" } });
  assert.equal(report.blocked, true);
  assert.match(report.blockers[0], /custom\.a.*custom\.b/);
  assert.equal(describeOperation({ type: "CREATE_TABLE", table: "x_nota" }), "Se creará la tabla x_nota.");
});

test("design review findings are passed through and never block", () => {
  const finding = { file: "components/A.jsx", line: 3, rule: "native-select", severity: "error", message: "x" };
  const report = buildUpdateReport({ staged, moduleRow: null, preflight: {}, noChanges: false, preview: null, designReview: [finding] });
  assert.deepEqual(report.designReview, [finding]);
  assert.equal(report.blocked, false);
  assert.deepEqual(buildUpdateReport({ staged, moduleRow: null, preflight: {}, noChanges: false, preview: null }).designReview, []);
});

test("operations waiting for a decision are listed in structure, not as blockers", () => {
  const report = buildUpdateReport({
    staged,
    moduleRow: { status: "INSTALLED", version: "1.1.0" },
    preflight: { schemaMigration: { canAutoApply: false, drift: [], operations: [
      { id: "SET_NOT_NULL:x_cliente:rfc", type: "SET_NOT_NULL", table: "x_cliente", column: "rfc", sqlType: "VARCHAR(255)", safety: "NEEDS_BACKFILL", failingRows: 3 },
      { id: "RENAME_COLUMN:x_cliente:nombre", type: "RENAME_COLUMN", table: "x_cliente", from: "razon", column: "nombre", safety: "SAFE" },
    ], blockers: [{ id: "SET_NOT_NULL:x_cliente:rfc", reason: "backfill_required" }] } },
    noChanges: false,
  });
  assert.equal(report.blocked, false);
  assert.equal(report.decisionsPending, true);
  assert.match(report.changes[0], /renombrará la columna razon a nombre/);
  assert.deepEqual(report.structure.map((row) => [row.id, row.needs, row.failingRows, row.blocker]), [
    ["SET_NOT_NULL:x_cliente:rfc", "backfill", 3, "backfill_required"],
    ["RENAME_COLUMN:x_cliente:nombre", null, null, null],
  ]);
});
