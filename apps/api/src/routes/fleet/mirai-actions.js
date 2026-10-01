// apps/api/src/routes/fleet/mirai-actions.js
//
// runly.fleet actions MirAI can propose (spec 2026-09-30-mirai-ledger-hr-fleet
// §5). prepare() validates and resolves plate/driver names -> ids without
// writing; execute() goes through fleet-service.js/insurance-service.js
// exactly like the HTTP routes in ./vehicles-routes.js and
// ./insurance-routes.js (same permissions). Both services already call
// their own logAudit() internally after every write (activityBridge for
// vehicles, direct prisma.auditLog for insurance) — no separate effects file
// is needed, same as those HTTP routes.
//
// Map (routes/fleet/vehicles-routes.js, insurance-routes.js -> services):
//   POST  /fleet/vehicles              -> fleetService.createVehicle()      perm fleet.vehicles.create
//   PATCH /fleet/vehicles/:id          -> fleetService.updateVehicle()      perm fleet.vehicles.update
//   PATCH /fleet/vehicles/:id/enabled  -> fleetService.setVehicleEnabled()  perm fleet.vehicles.delete
//   POST  /fleet/insurance             -> insuranceService.createPolicy()   perm fleet.insurance.create
//   PATCH /fleet/insurance/:id         -> insuranceService.updatePolicy()   perm fleet.insurance.update
//
// Omitted (documented, not wired to MirAI):
//   - Vehicle "mileage" update: FleetVehicle has no odometer/mileage column —
//     odometer_km only exists per maintenance report (fleet_report), a
//     separate entity this capability doesn't touch. A bare "update vehicle
//     mileage" action isn't modeled by the service.
//   - Vehicle brand/model/type via catalog relation ids, and financing
//     fields: create/update only use the vehicle's own plain text
//     brand/model_name/color/status/driver/notes fields, matching what a
//     conversational edit needs; the relation-based catalog fields and
//     financing section stay on the Fleet screen.
//   - Insurance delete/disable: spec only asks for create/update "if the
//     service exposes a simple path" — it does for both, but not for
//     disable, which isn't requested and is left to the Fleet screen.
import { z } from "zod";

const LINK = (id) => `/app/m/runly.fleet/vehicles/${id}`;
const VEHICLE_STATUS_LABEL = { active: "activo", maintenance: "en mantenimiento", inactive: "inactivo", retired: "retirado" };

async function resolveVehicle(fleetService, actx, { vehicleId, plate }) {
  if (vehicleId) {
    const row = await fleetService.getVehicle({ companyId: actx.companyId, id: vehicleId }).catch(() => null);
    return row ? { vehicle: row } : { error: "No encontre ese vehiculo, o no pertenece a esta empresa. Usa fleet_vehicles_search para obtener su vehicleId." };
  }
  if (!plate) return { error: "Indica el vehicleId (de fleet_vehicles_search) o la matricula del vehiculo." };
  const { data } = await fleetService.listVehicles({ companyId: actx.companyId, search: plate, page: 1, pageSize: 10 });
  const q = plate.toLowerCase();
  const exact = data.filter((r) => String(r.plate).toLowerCase() === q);
  const matches = exact.length ? exact : data;
  if (matches.length === 1) {
    const row = await fleetService.getVehicle({ companyId: actx.companyId, id: matches[0].id }).catch(() => null);
    return row ? { vehicle: row } : { error: "No encontre ese vehiculo." };
  }
  if (!matches.length) return { error: `No encontre ningun vehiculo con matricula "${plate}".` };
  return { error: `Hay varios vehiculos que coinciden con "${plate}": ${matches.map((r) => r.plate).join(", ")}.` };
}

async function resolveDriver(driverService, actx, name) {
  if (name === undefined) return { skip: true };
  if (name === null) return { id: null, name: null };
  const { data } = await driverService.listDrivers({ companyId: actx.companyId, search: name, page: 1, pageSize: 10 });
  const q = name.toLowerCase();
  const exact = data.filter((r) => r.full_name.toLowerCase() === q);
  const matches = exact.length ? exact : data;
  if (matches.length === 1) return { id: matches[0].id, name: matches[0].full_name };
  if (!matches.length) return { error: `No encontre ningun chofer llamado "${name}".` };
  return { error: `Hay varios choferes que coinciden con "${name}": ${matches.map((r) => r.full_name).join(", ")}.` };
}

const createArgs = z.object({
  plate: z.string().trim().min(1).max(20),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  color: z.string().trim().max(100).optional(),
  status: z.enum(["active", "maintenance", "inactive", "retired"]).optional(),
  driver: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
});
const updateArgs = z.object({
  vehicleId: z.string().min(1).optional(),
  plate: z.string().trim().min(1).max(20).optional(),
  status: z.enum(["active", "maintenance", "inactive", "retired"]).optional(),
  driver: z.string().trim().max(200).nullable().optional(),
  color: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(5000).optional(),
});
const targetArgs = z.object({ vehicleId: z.string().min(1).optional(), plate: z.string().trim().min(1).max(20).optional() });

const insuranceCreateArgs = z.object({
  vehicleId: z.string().min(1).optional(),
  plate: z.string().trim().min(1).max(20).optional(),
  insurer: z.string().trim().min(1).max(100),
  policyNumber: z.string().trim().min(1).max(50),
  coverageType: z.enum(["basic", "comprehensive", "third_party", "other"]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  premium: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().trim().max(3000).optional(),
});
const insuranceUpdateArgs = z.object({
  policyId: z.string().min(1),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  premium: z.number().min(0).optional(),
  coverageType: z.enum(["basic", "comprehensive", "third_party", "other"]).optional(),
  notes: z.string().trim().max(3000).optional(),
});

export function createFleetMiraiActions({ fleetService, driverService, insuranceService }) {
  const createVehicle = {
    key: "fleet.vehicle.create",
    moduleKey: "runly.fleet",
    operation: "create",
    label: "Crear vehiculo",
    permission: "fleet.vehicles.create",
    description: "Da de alta un vehiculo (matricula, marca, modelo, anio, color, estado, conductor asignado).",
    parameters: {
      type: "object",
      properties: {
        plate: { type: "string" },
        brand: { type: "string" },
        model: { type: "string" },
        year: { type: "number" },
        color: { type: "string" },
        status: { type: "string", enum: ["active", "maintenance", "inactive", "retired"] },
        driver: { type: "string", description: "Nombre del chofer a asignar." },
        notes: { type: "string" },
      },
      required: ["plate"],
    },
    async prepare(args, actx) {
      const parsed = createArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica al menos la matricula del vehiculo." };
      const a = parsed.data;
      const driver = await resolveDriver(driverService, actx, a.driver);
      if (driver.error) return { error: driver.error };
      const payload = {
        plate: a.plate, brand: a.brand, model_name: a.model, year: a.year, color: a.color,
        status: a.status, driver_id: driver.skip ? undefined : driver.id, notes: a.notes,
      };
      return {
        input: payload,
        preview: {
          title: "Crear vehiculo",
          fields: [
            { label: "Matricula", value: a.plate },
            a.brand ? { label: "Marca", value: a.brand } : null,
            a.model ? { label: "Modelo", value: a.model } : null,
            a.driver ? { label: "Conductor", value: a.driver } : null,
            a.status ? { label: "Estado", value: VEHICLE_STATUS_LABEL[a.status] } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const row = await fleetService.createVehicle({ companyId: actx.companyId, data: input, actorId: actx.actorProfileId });
      return { id: row.id, summary: `Vehiculo creado: ${row.plate}`, link: LINK(row.id) };
    },
  };

  const updateVehicle = {
    key: "fleet.vehicle.update",
    moduleKey: "runly.fleet",
    operation: "update",
    label: "Editar vehiculo",
    permission: "fleet.vehicles.update",
    description: "Cambia el estado, conductor asignado, color o notas de un vehiculo existente. Usa el vehicleId de fleet_vehicles_search o la matricula; envia solo los campos que cambian.",
    parameters: {
      type: "object",
      properties: {
        vehicleId: { type: "string" },
        plate: { type: "string" },
        status: { type: "string", enum: ["active", "maintenance", "inactive", "retired"] },
        driver: { type: "string", description: "Nombre del chofer a asignar; usa null/omite para no tocarlo." },
        color: { type: "string" },
        notes: { type: "string" },
      },
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el vehiculo a editar y los campos a cambiar." };
      const a = parsed.data;
      const found = await resolveVehicle(fleetService, actx, a);
      if (found.error) return { error: found.error };
      const row = found.vehicle;
      const data = {};
      const fields = [{ label: "Vehiculo", value: row.plate }];

      if (a.status !== undefined && a.status !== row.status) {
        data.status = a.status;
        fields.push({ label: "Estado", before: VEHICLE_STATUS_LABEL[row.status] ?? row.status, value: VEHICLE_STATUS_LABEL[a.status] });
      }
      if (a.color !== undefined && a.color !== (row.color ?? "")) {
        data.color = a.color;
        fields.push({ label: "Color", before: row.color ?? "(vacio)", value: a.color });
      }
      if (a.notes !== undefined && a.notes !== (row.notes ?? "")) {
        data.notes = a.notes;
        fields.push({ label: "Notas", before: row.notes ? "(con contenido)" : "(vacio)", value: a.notes ? "(con contenido)" : "(vacio)" });
      }
      if (a.driver !== undefined) {
        const driver = a.driver === null ? { id: null, name: null } : await resolveDriver(driverService, actx, a.driver);
        if (driver.error) return { error: driver.error };
        const before = row.driver_name ?? null;
        if ((driver.name ?? null) !== before) {
          data.driver_id = driver.id;
          fields.push({ label: "Conductor", before: before ?? "(sin conductor)", value: driver.name ?? "(sin conductor)" });
        }
      }

      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto al vehiculo actual." };
      return { input: { vehicleId: row.id, data }, targetId: row.id, preview: { title: "Editar vehiculo", fields } };
    },
    async execute(input, actx) {
      const row = await fleetService.updateVehicle({ companyId: actx.companyId, id: input.vehicleId, data: input.data, actorId: actx.actorProfileId });
      return { id: row.id, summary: `Vehiculo actualizado: ${row.plate}`, link: LINK(row.id) };
    },
  };

  const deactivateVehicle = {
    key: "fleet.vehicle.deactivate",
    moduleKey: "runly.fleet",
    operation: "delete",
    label: "Desactivar vehiculo",
    permission: "fleet.vehicles.delete",
    description: "Desactiva (da de baja logica) a un vehiculo existente. Usa el vehicleId de fleet_vehicles_search o la matricula.",
    parameters: { type: "object", properties: { vehicleId: { type: "string" }, plate: { type: "string" } } },
    async prepare(args, actx) {
      const parsed = targetArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el vehiculo a desactivar." };
      const found = await resolveVehicle(fleetService, actx, parsed.data);
      if (found.error) return { error: found.error };
      return {
        input: { vehicleId: found.vehicle.id },
        targetId: found.vehicle.id,
        preview: { title: "Desactivar vehiculo", fields: [{ label: "Vehiculo", value: found.vehicle.plate }, { label: "Estado actual", value: VEHICLE_STATUS_LABEL[found.vehicle.status] ?? found.vehicle.status }] },
      };
    },
    async execute(input, actx) {
      const row = await fleetService.setVehicleEnabled({ companyId: actx.companyId, id: input.vehicleId, enabled: false, actorId: actx.actorProfileId });
      return { id: row.id, summary: `Vehiculo desactivado: ${row.plate}` };
    },
  };

  const createInsurancePolicy = {
    key: "fleet.insurance.create",
    moduleKey: "runly.fleet",
    operation: "create",
    label: "Crear poliza de seguro",
    permission: "fleet.insurance.create",
    description: "Crea una poliza de seguro para un vehiculo (aseguradora, numero, vigencia). Usa el vehicleId de fleet_vehicles_search o la matricula.",
    parameters: {
      type: "object",
      properties: {
        vehicleId: { type: "string" },
        plate: { type: "string" },
        insurer: { type: "string" },
        policyNumber: { type: "string" },
        coverageType: { type: "string", enum: ["basic", "comprehensive", "third_party", "other"] },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        expiryDate: { type: "string", description: "YYYY-MM-DD" },
        premium: { type: "number" },
        currency: { type: "string", description: "Codigo de 3 letras, por defecto MXN." },
        notes: { type: "string" },
      },
      required: ["insurer", "policyNumber", "startDate", "expiryDate"],
    },
    async prepare(args, actx) {
      const parsed = insuranceCreateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el vehiculo, la aseguradora, el numero de poliza y la vigencia (inicio y vencimiento)." };
      const a = parsed.data;
      const found = await resolveVehicle(fleetService, actx, a);
      if (found.error) return { error: found.error };
      if (a.expiryDate < a.startDate) return { error: "La fecha de vencimiento debe ser igual o posterior al inicio de vigencia." };
      const payload = {
        vehicle_id: found.vehicle.id, insurer_name: a.insurer, policy_number: a.policyNumber,
        coverage_type: a.coverageType ?? null, start_date: a.startDate, expiry_date: a.expiryDate,
        premium: a.premium ?? null, currency: a.currency ?? "MXN", notes: a.notes ?? null,
      };
      return {
        input: payload,
        preview: {
          title: "Crear poliza de seguro",
          fields: [
            { label: "Vehiculo", value: found.vehicle.plate },
            { label: "Aseguradora", value: a.insurer },
            { label: "Poliza", value: a.policyNumber },
            { label: "Vigencia", value: `${a.startDate} a ${a.expiryDate}` },
          ],
        },
      };
    },
    async execute(input, actx) {
      const row = await insuranceService.createPolicy({ companyId: actx.companyId, actorId: actx.actorProfileId, data: input });
      return { id: row.id, summary: `Poliza creada: ${row.insurer_name} ${row.policy_number}`, link: LINK(input.vehicle_id) };
    },
  };

  const updateInsurancePolicy = {
    key: "fleet.insurance.update",
    moduleKey: "runly.fleet",
    operation: "update",
    label: "Editar poliza de seguro",
    permission: "fleet.insurance.update",
    description: "Cambia el vencimiento, la prima, la cobertura o las notas de una poliza existente. Usa el polizaId que devuelve fleet_vehicle_detail.",
    parameters: {
      type: "object",
      properties: {
        policyId: { type: "string" },
        expiryDate: { type: "string", description: "YYYY-MM-DD" },
        premium: { type: "number" },
        coverageType: { type: "string", enum: ["basic", "comprehensive", "third_party", "other"] },
        notes: { type: "string" },
      },
      required: ["policyId"],
    },
    async prepare(args, actx) {
      const parsed = insuranceUpdateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el polizaId (de fleet_vehicle_detail) y los campos a cambiar." };
      const a = parsed.data;
      const before = await insuranceService.getPolicy({ companyId: actx.companyId, id: a.policyId }).catch(() => null);
      if (!before) return { error: "No encontre esa poliza, o no pertenece a esta empresa." };
      const data = {};
      const fields = [{ label: "Poliza", value: `${before.insurer_name} ${before.policy_number}` }];
      if (a.expiryDate !== undefined && a.expiryDate !== before.expiry_date) {
        data.expiry_date = a.expiryDate;
        fields.push({ label: "Vencimiento", before: before.expiry_date, value: a.expiryDate });
      }
      if (a.premium !== undefined && a.premium !== (before.premium != null ? Number(before.premium) : null)) {
        data.premium = a.premium;
        fields.push({ label: "Prima", before: before.premium ?? "(vacio)", value: a.premium });
      }
      if (a.coverageType !== undefined && a.coverageType !== before.coverage_type) {
        data.coverage_type = a.coverageType;
        fields.push({ label: "Cobertura", before: before.coverage_type_label ?? before.coverage_type ?? "(vacio)", value: a.coverageType });
      }
      if (a.notes !== undefined && a.notes !== (before.notes ?? "")) {
        data.notes = a.notes;
        fields.push({ label: "Notas", before: before.notes ? "(con contenido)" : "(vacio)", value: a.notes ? "(con contenido)" : "(vacio)" });
      }
      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto a la poliza actual." };
      return { input: { policyId: a.policyId, data }, targetId: a.policyId, preview: { title: "Editar poliza de seguro", fields } };
    },
    async execute(input, actx) {
      const row = await insuranceService.updatePolicy({ companyId: actx.companyId, actorId: actx.actorProfileId, id: input.policyId, data: input.data });
      return { id: row.id, summary: `Poliza actualizada: ${row.insurer_name} ${row.policy_number}` };
    },
  };

  return [createVehicle, updateVehicle, deactivateVehicle, createInsurancePolicy, updateInsurancePolicy];
}
