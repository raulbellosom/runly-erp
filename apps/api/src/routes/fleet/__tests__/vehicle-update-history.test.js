// apps/api/src/routes/fleet/__tests__/vehicle-update-history.test.js
//
// Guards the fleet.vehicle.update audit/diff wiring added alongside Inventory's
// modification-history feature: updateVehicle() must send activity-bridge.js's
// logAndPublish a before/after pair in the SAME flat shape (not the raw
// UPDATE...RETURNING * row against the richer getVehicle() join), or
// computeFieldChanges would report every joined/computed column as a false
// "changed to null".
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFleetService } from "../fleet-service.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const VEHICLE_ID = "01900000-0000-7000-8000-000000000002";
const USER_ID = "01900000-0000-7000-8000-000000000003";

function buildVehicleRow(overrides = {}) {
  return {
    id: VEHICLE_ID,
    company_id: COMPANY_ID,
    plate: "PVR-8109",
    brand: null,
    model_name: null,
    year: 2020,
    color: "Rojo",
    status: "active",
    driver_id: null,
    driver_name: null,
    notes: null,
    economic_group_number: null,
    economic_individual_number: null,
    vehicle_type_id: null,
    vehicle_brand_id: null,
    vehicle_model_id: null,
    vehicle_type_name: null,
    vehicle_brand_name: null,
    vehicle_model_name: null,
    is_financed: false,
    financing_institution: null,
    financing_contract_number: null,
    financing_start_date: null,
    financing_end_date: null,
    financing_monthly_payment: null,
    financing_notes: null,
    cover_image_file_asset_id: null,
    active_insurance_policy: null,
    name: "PVR-8109",
    ...overrides,
  };
}

function buildPrismaMock({ beforeRow, updatedRow, afterRow }) {
  const queryRawCalls = [];
  return {
    _queryRawCalls: queryRawCalls,
    $queryRaw: async (strings, ..._values) => {
      const sql = strings.join(" ");
      queryRawCalls.push(sql);
      if (sql.includes("UPDATE fleet_vehicle")) return [updatedRow];
      // Every other call in this test is a getVehicle() SELECT — first call
      // is the pre-update "before" fetch, second is the post-update "after"
      // re-fetch that updateVehicle now does.
      const selectCalls = queryRawCalls.filter((s) => s.includes("SELECT")).length;
      return [selectCalls === 1 ? beforeRow : afterRow];
    },
    auditLog: { create: async ({ data }) => ({ id: "audit-1", createdAt: new Date(), ...data }) },
  };
}

describe("fleet-service updateVehicle audit history", () => {
  it("sends flat, matching-shape before/after to logAndPublish so the diff is clean", async () => {
    const beforeRow = buildVehicleRow({ color: "Rojo" });
    const updatedRow = buildVehicleRow({ color: "Azul" }); // raw UPDATE...RETURNING * (no joined columns)
    const afterRow = buildVehicleRow({ color: "Azul", vehicle_brand_name: null });
    const prisma = buildPrismaMock({ beforeRow, updatedRow, afterRow });

    let captured = null
    const activityBridge = {
      logAndPublish: async (args) => { captured = args },
    }
    const service = createFleetService({ prisma, activityBridge })

    await service.updateVehicle({
      companyId: COMPANY_ID,
      id: VEHICLE_ID,
      data: { color: "Azul" },
      actorId: USER_ID,
    })

    assert.ok(captured, "logAndPublish was called")
    assert.equal(captured.auditEntry.action, "fleet.vehicle.update")
    assert.equal(captured.companyId, COMPANY_ID)
    // Neither snapshot should carry raw/internal columns through to the diff.
    assert.equal(captured.auditEntry.before.id, undefined)
    assert.equal(captured.auditEntry.before.company_id, undefined)
    assert.equal(captured.auditEntry.before.cover_image_file_asset_id, undefined)
    // The field that actually changed is present in both, with the real values.
    assert.equal(captured.auditEntry.before.color, "Rojo")
    assert.equal(captured.auditEntry.after.color, "Azul")
    // A field neither snapshot has data for (vehicle_brand_name stayed null in
    // both) must not appear as a false change once computeFieldChanges runs.
    assert.equal(captured.auditEntry.before.vehicle_brand_name, null)
    assert.equal(captured.auditEntry.after.vehicle_brand_name, null)
  })
})
