// apps/api/src/routes/fleet/fleet-mirai-queries.js
//
// Exact runly.fleet tools for MirAI (spec 2026-09-30-mirai-ledger-hr-fleet
// §5): search/detail/summary over vehicles, drivers search and a public
// manufacturer-spec lookup. fleet-service.js/driver-service.js only expose a
// single free-text `search` param (ILIKE across plate/brand/model/economic
// number/driver name, or name/phone/license for drivers) — there is no
// separate brand/model/driver filter in the service, so those are folded
// into the same `search` string rather than invented here.
import { z } from "zod";
import { createPublicLookup } from "../../services/ai/public-lookup.js";

const LIST_MAX = 30;
const VEHICLE_STATUS_LABEL = { active: "activo", maintenance: "en mantenimiento", inactive: "inactivo", retired: "retirado" };
const COVERAGE_LABEL = { basic: "Basica", comprehensive: "Integral", third_party: "Terceros", other: "Otro" };

function toVehicleSearchRow(row) {
  return {
    vehicleId: row.id,
    placa: row.plate,
    marca: row.vehicle_brand_name ?? row.brand ?? null,
    modelo: row.vehicle_model_name ?? row.model_name ?? null,
    anio: row.vehicle_model_year ?? row.year ?? null,
    tipo: row.vehicle_type_name ?? null,
    estado: VEHICLE_STATUS_LABEL[row.status] ?? row.status,
    conductor: row.driver_name ?? null,
    numeroEconomico: row.full_economic_number ?? null,
    seguro: row.insurance_status ?? null,
  };
}

export function createFleetMiraiQueries({ prisma, fleetService, driverService, publicLookup = createPublicLookup({ env: process.env }) }) {
  const fleet_vehicles_search = {
    name: "fleet_vehicles_search",
    permission: "fleet.vehicles.read",
    definition: {
      description: "Busca vehiculos por matricula, marca, modelo, numero economico o conductor (texto libre) y/o estado. Devuelve hasta 30 con vehicleId y el total real.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Matricula, marca, modelo, numero economico o nombre del conductor." },
          status: { type: "string", enum: ["active", "maintenance", "inactive", "retired"] },
        },
      },
    },
    async run(args, actx) {
      const result = await fleetService.listVehicles({ companyId: actx.companyId, page: 1, pageSize: LIST_MAX, status: args?.status, search: args?.search });
      return { total: result.pagination.total, vehiculos: result.data.map(toVehicleSearchRow) };
    },
  };

  const fleet_vehicle_detail = {
    name: "fleet_vehicle_detail",
    permission: "fleet.vehicles.read",
    definition: {
      description: "Obtiene el detalle de un vehiculo: conductor asignado, poliza de seguro activa y su vencimiento.",
      parameters: { type: "object", properties: { vehicleId: { type: "string" } }, required: ["vehicleId"] },
    },
    async run(args, actx) {
      const row = await fleetService.getVehicle({ companyId: actx.companyId, id: String(args?.vehicleId ?? "") }).catch(() => null);
      if (!row) return { error: "No encontre ese vehiculo, o no pertenece a esta empresa." };
      const policy = row.active_insurance_policy ?? null;
      return {
        vehicleId: row.id,
        placa: row.plate,
        marca: row.vehicle_brand_name ?? row.brand ?? null,
        modelo: row.vehicle_model_name ?? row.model_name ?? null,
        anio: row.vehicle_model_year ?? row.year ?? null,
        tipo: row.vehicle_type_name ?? null,
        estado: VEHICLE_STATUS_LABEL[row.status] ?? row.status,
        color: row.color ?? null,
        numeroEconomico: row.full_economic_number ?? null,
        financiado: Boolean(row.is_financed),
        conductor: row.driver_name ? { nombre: row.driver_name, telefono: row.driver_phone ?? null, licencia: row.driver_license_number ?? null } : null,
        seguroActivo: policy
          ? { polizaId: policy.id, aseguradora: policy.insurer_name, poliza: policy.policy_number, cobertura: policy.coverage_type_label ?? COVERAGE_LABEL[policy.coverage_type] ?? policy.coverage_type, vence: policy.expiry_date }
          : null,
        notas: row.notes ? String(row.notes).slice(0, 1000) : null,
      };
    },
  };

  const fleet_summary = {
    name: "fleet_summary",
    permission: "fleet.vehicles.read",
    definition: {
      description:
        "Conteos exactos de vehiculos activos por estado o tipo, y polizas de seguro (no verificacion vehicular, que este modulo no modela) que vencen en los proximos N dias (30 por defecto).",
      parameters: {
        type: "object",
        properties: {
          groupBy: { type: "string", enum: ["status", "type"] },
          expiringInsuranceDays: { type: "number", description: "Horizonte en dias para polizas por vencer (por defecto 30)." },
        },
      },
    },
    async run(args, actx) {
      const groupBy = args?.groupBy === "type" ? "type" : "status";
      const days = Number.isFinite(Number(args?.expiringInsuranceDays)) && Number(args.expiringInsuranceDays) > 0 ? Math.min(365, Math.floor(Number(args.expiringInsuranceDays))) : 30;

      const groups =
        groupBy === "status"
          ? await prisma.fleetVehicle.groupBy({ by: ["status"], where: { companyId: actx.companyId, enabled: true }, _count: { id: true } }).then((rows) =>
              rows.map((g) => ({ grupo: VEHICLE_STATUS_LABEL[g.status] ?? g.status, vehiculos: g._count.id })),
            )
          : await prisma.$queryRaw`
              SELECT COALESCE(vt_m.name, vt.name, 'Sin tipo') AS grupo, COUNT(*)::int AS vehiculos
              FROM fleet_vehicle fv
              LEFT JOIN fleet_vehicle_model vm ON vm.id = fv.vehicle_model_id
              LEFT JOIN fleet_vehicle_type vt_m ON vt_m.id = vm.type_id
              LEFT JOIN fleet_vehicle_type vt ON vt.id = fv.vehicle_type_id
              WHERE fv.company_id = ${actx.companyId}::uuid AND fv.enabled = true
              GROUP BY grupo ORDER BY vehiculos DESC`;

      const total = groups.reduce((sum, g) => sum + g.vehiculos, 0);

      const expiringRows = await prisma.$queryRaw`
        SELECT fip.id::text AS "policyId", fip.policy_number AS "policyNumber", fip.insurer_name AS "insurerName",
               fip.expiry_date::text AS "expiryDate", fv.plate AS plate, fv.id::text AS "vehicleId"
        FROM fleet_insurance_policy fip
        JOIN fleet_vehicle fv ON fv.id = fip.vehicle_id AND fv.company_id = fip.company_id
        WHERE fip.company_id = ${actx.companyId}::uuid AND fip.enabled = true
          AND fip.expiry_date::date >= CURRENT_DATE
          AND fip.expiry_date::date <= (CURRENT_DATE + make_interval(days => ${days}::int))
        ORDER BY fip.expiry_date ASC
        LIMIT 30`;
      const expiringCountRows = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS total
        FROM fleet_insurance_policy fip
        JOIN fleet_vehicle fv ON fv.id = fip.vehicle_id AND fv.company_id = fip.company_id
        WHERE fip.company_id = ${actx.companyId}::uuid AND fip.enabled = true
          AND fip.expiry_date::date >= CURRENT_DATE
          AND fip.expiry_date::date <= (CURRENT_DATE + make_interval(days => ${days}::int))`;

      return {
        totalVehiculos: total,
        grupos: groups,
        segurosPorVencer: { total: Number(expiringCountRows?.[0]?.total ?? 0), dias: days, polizas: expiringRows },
      };
    },
  };

  const fleet_drivers_search = {
    name: "fleet_drivers_search",
    permission: "fleet.drivers.read",
    definition: {
      description: "Busca choferes por nombre, telefono o numero de licencia (texto libre) y/o estado. Devuelve hasta 30 con driverId y el total real.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string" },
          status: { type: "string", enum: ["active", "inactive", "suspended"] },
        },
      },
    },
    async run(args, actx) {
      const result = await driverService.listDrivers({ companyId: actx.companyId, page: 1, pageSize: LIST_MAX, status: args?.status, search: args?.search });
      return {
        total: result.pagination.total,
        choferes: result.data.map((r) => ({
          driverId: r.id,
          nombre: r.full_name,
          telefono: r.phone ?? null,
          licencia: r.license_number ?? null,
          vencimientoLicencia: r.license_expiry_date ?? null,
          estadoLicencia: r.license_status ?? null,
          vehiculoAsignado: r.assigned_plate ?? null,
          estado: r.status,
        })),
      };
    },
  };

  const fleet_public_vehicle_info = {
    name: "fleet_public_vehicle_info",
    permission: "fleet.vehicles.read",
    definition: {
      description: "Busca en internet informacion publica (especificaciones del fabricante) de la marca, modelo y anio de un vehiculo autorizado. Solo cuando el usuario lo pida explicitamente; nunca envia placas ni numeros de serie.",
      parameters: { type: "object", properties: { vehicleId: { type: "string" } }, required: ["vehicleId"] },
    },
    async run(args, actx) {
      if (!publicLookup?.enabled) return { error: "La busqueda en internet no esta configurada." };
      const parsed = z.object({ vehicleId: z.string().min(1) }).safeParse(args);
      if (!parsed.success) return { error: "Identificador invalido." };
      const row = await fleetService.getVehicle({ companyId: actx.companyId, id: parsed.data.vehicleId }).catch(() => null);
      if (!row) return { error: "Vehiculo no disponible en esta empresa." };
      const brand = row.vehicle_brand_name ?? row.brand ?? null;
      const model = row.vehicle_model_name ?? row.model_name ?? null;
      if (!brand || !model) return { error: "Falta la marca o el modelo para buscar informacion publica." };
      actx.turn ??= {};
      actx.turn.fleetPublicLookupBudget ??= publicLookup.createTurnBudget();
      return publicLookup.lookup({ subject: { brand, model, year: row.vehicle_model_year ?? row.year ?? null }, budget: actx.turn.fleetPublicLookupBudget });
    },
  };

  return [fleet_vehicles_search, fleet_vehicle_detail, fleet_summary, fleet_drivers_search, fleet_public_vehicle_info];
}
