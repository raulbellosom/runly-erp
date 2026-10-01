import test from "node:test";
import assert from "node:assert/strict";
import { createFleetMiraiQueries } from "../fleet-mirai-queries.js";
import { createFleetMiraiActions } from "../mirai-actions.js";
import { createFleetMiraiCapabilities } from "../mirai-capabilities.js";
import { createPublicLookup } from "../../../services/ai/public-lookup.js";

const actx = { companyId: "co1", actorProfileId: "me", actorAuthUserId: "auth1" };

function fakeFleetService({ vehicles = [], byId = new Map() } = {}) {
  return {
    async listVehicles({ search }) {
      const q = String(search ?? "").toLowerCase();
      const filtered = q ? vehicles.filter((v) => v.plate.toLowerCase().includes(q)) : vehicles;
      return { data: filtered, pagination: { total: filtered.length } };
    },
    async getVehicle({ id }) {
      const row = byId.get(id);
      if (!row) throw new Error("not found");
      return row;
    },
    async createVehicle({ data }) {
      return { id: "new1", plate: data.plate };
    },
    async updateVehicle({ id, data }) {
      return { ...byId.get(id), ...data, id };
    },
    async setVehicleEnabled({ id, enabled }) {
      return { ...byId.get(id), id, enabled };
    },
  };
}

function fakeDriverService({ drivers = [] } = {}) {
  return {
    async listDrivers({ search }) {
      const q = String(search ?? "").toLowerCase();
      const filtered = q ? drivers.filter((d) => d.full_name.toLowerCase().includes(q)) : drivers;
      return { data: filtered, pagination: { total: filtered.length } };
    },
  };
}

function fakeInsuranceService({ byId = new Map() } = {}) {
  return {
    async createPolicy({ data }) {
      return { id: "pol1", insurer_name: data.insurer_name, policy_number: data.policy_number };
    },
    async getPolicy({ id }) {
      const row = byId.get(id);
      if (!row) throw new Error("not found");
      return row;
    },
    async updatePolicy({ id, data }) {
      return { ...byId.get(id), ...data, id };
    },
  };
}

test("fleet_vehicles_search: filters by text and caps stable ids", async () => {
  const vehicles = [{ id: "v1", plate: "ABC-123", vehicle_brand_name: "Nissan", vehicle_model_name: "NP300", status: "active" }];
  const [search] = createFleetMiraiQueries({ prisma: {}, fleetService: fakeFleetService({ vehicles }), driverService: fakeDriverService() });
  const out = await search.run({ search: "abc" }, actx);
  assert.equal(out.total, 1);
  assert.equal(out.vehiculos[0].vehicleId, "v1");
  assert.equal(out.vehiculos[0].estado, "activo");
});

test("fleet_vehicle_detail: returns an error when the vehicle is not accessible", async () => {
  const [, detail] = createFleetMiraiQueries({ prisma: {}, fleetService: fakeFleetService(), driverService: fakeDriverService() });
  const out = await detail.run({ vehicleId: "nope" }, actx);
  assert.ok(out.error);
});

test("fleet_vehicle_detail: surfaces the active insurance policy with its polizaId", async () => {
  const byId = new Map([
    ["v1", { id: "v1", plate: "ABC-123", status: "active", active_insurance_policy: { id: "pol1", insurer_name: "GNP", policy_number: "P-1", expiry_date: "2026-12-01", coverage_type_label: "Integral" } }],
  ]);
  const [, detail] = createFleetMiraiQueries({ prisma: {}, fleetService: fakeFleetService({ byId }), driverService: fakeDriverService() });
  const out = await detail.run({ vehicleId: "v1" }, actx);
  assert.equal(out.seguroActivo.polizaId, "pol1");
  assert.equal(out.seguroActivo.aseguradora, "GNP");
});

test("fleet_summary: groupBy status uses Prisma's exact groupBy, and exact expiring-insurance count", async () => {
  const prisma = {
    fleetVehicle: { groupBy: async () => [{ status: "active", _count: { id: 5 } }, { status: "retired", _count: { id: 1 } }] },
    $queryRaw: async (strings) => (String(strings[0]).includes("COUNT(*)::int AS total") ? [{ total: 2 }] : [{ policyId: "p1", plate: "ABC-123", expiryDate: "2026-10-01" }]),
  };
  const [, , summary] = createFleetMiraiQueries({ prisma, fleetService: fakeFleetService(), driverService: fakeDriverService() });
  const out = await summary.run({ groupBy: "status" }, actx);
  assert.equal(out.totalVehiculos, 6);
  assert.equal(out.segurosPorVencer.total, 2);
  assert.equal(out.segurosPorVencer.polizas.length, 1);
});

test("fleet_drivers_search: returns stable ids and the exact total", async () => {
  const drivers = [{ id: "d1", full_name: "Juan Perez", phone: "555", license_number: "L1", status: "active" }];
  const [, , , driversSearch] = createFleetMiraiQueries({ prisma: {}, fleetService: fakeFleetService(), driverService: fakeDriverService({ drivers }) });
  const out = await driversSearch.run({ search: "juan" }, actx);
  assert.equal(out.total, 1);
  assert.equal(out.choferes[0].driverId, "d1");
});

test("fleet_public_vehicle_info: errors when lookup is not configured, and when brand/model are missing", async () => {
  const byId = new Map([["v1", { id: "v1", plate: "ABC-123", brand: null, model_name: null }]]);
  const disabled = createPublicLookup({ search: null, env: {} });
  const [, , , , lookupTool] = createFleetMiraiQueries({ prisma: {}, fleetService: fakeFleetService({ byId }), driverService: fakeDriverService(), publicLookup: disabled });
  assert.ok((await lookupTool.run({ vehicleId: "v1" }, actx)).error);

  const enabled = createPublicLookup({ search: async () => ({ results: [] }) });
  const [, , , , lookupTool2] = createFleetMiraiQueries({ prisma: {}, fleetService: fakeFleetService({ byId }), driverService: fakeDriverService(), publicLookup: enabled });
  const out = await lookupTool2.run({ vehicleId: "v1" }, { ...actx, turn: {} });
  assert.ok(out.error); // missing brand/model
});

test("describeContext returns null when the vehicle is not found", async () => {
  const cap = createFleetMiraiCapabilities({ prisma: {} });
  const line = await cap.describeContext({ recordType: "vehicle", recordId: "v1" }, actx);
  assert.equal(line, null);
});

test("create vehicle: prepare writes nothing; execute calls the service", async () => {
  const actions = Object.fromEntries(createFleetMiraiActions({ fleetService: fakeFleetService(), driverService: fakeDriverService(), insuranceService: fakeInsuranceService() }).map((a) => [a.key, a]));
  const prepared = await actions["fleet.vehicle.create"].prepare({ plate: "XYZ-999" }, actx);
  assert.equal(prepared.input.plate, "XYZ-999");
  const res = await actions["fleet.vehicle.create"].execute(prepared.input, actx);
  assert.equal(res.id, "new1");
});

test("update vehicle: ambiguous plate lists the matches instead of guessing", async () => {
  const vehicles = [{ id: "v1", plate: "ABC-111", status: "active" }, { id: "v2", plate: "ABC-222", status: "active" }];
  const actions = Object.fromEntries(createFleetMiraiActions({ fleetService: fakeFleetService({ vehicles }), driverService: fakeDriverService(), insuranceService: fakeInsuranceService() }).map((a) => [a.key, a]));
  const out = await actions["fleet.vehicle.update"].prepare({ plate: "ABC", status: "maintenance" }, actx);
  assert.ok(out.error.includes("ABC-111"));
  assert.ok(out.error.includes("ABC-222"));
});

test("deactivate vehicle: calls setVehicleEnabled(false)", async () => {
  const byId = new Map([["v1", { id: "v1", plate: "ABC-123", status: "active" }]]);
  const actions = Object.fromEntries(createFleetMiraiActions({ fleetService: fakeFleetService({ byId }), driverService: fakeDriverService(), insuranceService: fakeInsuranceService() }).map((a) => [a.key, a]));
  const prepared = await actions["fleet.vehicle.deactivate"].prepare({ vehicleId: "v1" }, actx);
  assert.equal(prepared.targetId, "v1");
  const res = await actions["fleet.vehicle.deactivate"].execute(prepared.input, actx);
  assert.equal(res.id, "v1");
});

test("insurance create: resolves the vehicle by plate and validates the date range", async () => {
  const byId = new Map([["v1", { id: "v1", plate: "ABC-123", status: "active" }]]);
  const vehicles = [{ id: "v1", plate: "ABC-123" }];
  const actions = Object.fromEntries(createFleetMiraiActions({ fleetService: fakeFleetService({ byId, vehicles }), driverService: fakeDriverService(), insuranceService: fakeInsuranceService() }).map((a) => [a.key, a]));
  const badRange = await actions["fleet.insurance.create"].prepare({ plate: "ABC-123", insurer: "GNP", policyNumber: "P-1", startDate: "2026-12-01", expiryDate: "2026-01-01" }, actx);
  assert.ok(badRange.error);
  const prepared = await actions["fleet.insurance.create"].prepare({ plate: "ABC-123", insurer: "GNP", policyNumber: "P-1", startDate: "2026-01-01", expiryDate: "2026-12-01" }, actx);
  assert.equal(prepared.input.vehicle_id, "v1");
  const res = await actions["fleet.insurance.create"].execute(prepared.input, actx);
  assert.equal(res.id, "pol1");
});

test("insurance update: no-op change is rejected", async () => {
  const byId = new Map([["pol1", { id: "pol1", insurer_name: "GNP", policy_number: "P-1", expiry_date: "2026-12-01", premium: 100, coverage_type: "basic", coverage_type_label: "Basica", notes: null }]]);
  const actions = Object.fromEntries(createFleetMiraiActions({ fleetService: fakeFleetService(), driverService: fakeDriverService(), insuranceService: fakeInsuranceService({ byId }) }).map((a) => [a.key, a]));
  const out = await actions["fleet.insurance.update"].prepare({ policyId: "pol1", expiryDate: "2026-12-01" }, actx);
  assert.ok(out.error);
});
