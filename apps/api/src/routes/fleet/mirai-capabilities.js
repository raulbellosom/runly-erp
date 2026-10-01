// apps/api/src/routes/fleet/mirai-capabilities.js
//
// runly.fleet capability for MirAI (spec 2026-09-30-mirai-ledger-hr-fleet
// §5). Builds its own fleet/driver/insurance services the same way
// routes/fleet/vehicles-routes.js does, independent of the HTTP router.
import { createFleetService } from "./fleet-service.js";
import { createDriverService } from "./driver-service.js";
import { createInsuranceService } from "./insurance-service.js";
import { createPublicLookup } from "../../services/ai/public-lookup.js";
import { createFleetMiraiQueries } from "./fleet-mirai-queries.js";
import { createFleetMiraiActions } from "./mirai-actions.js";

const VEHICLE_STATUS_LABEL = { active: "activo", maintenance: "en mantenimiento", inactive: "inactivo", retired: "retirado" };

export function createFleetMiraiCapabilities({ prisma, publicLookup = createPublicLookup({ env: process.env }) }) {
  const fleetService = createFleetService({ prisma });
  const driverService = createDriverService({ prisma });
  const insuranceService = createInsuranceService({ prisma });

  return {
    moduleKey: "runly.fleet",
    label: "Flota",
    summary: "Vehiculos y choferes: busqueda, detalle, seguros por vencer y especificaciones publicas del fabricante; crear, editar y dar de baja vehiculos y polizas.",
    tools: createFleetMiraiQueries({ prisma, fleetService, driverService, publicLookup }),
    actions: createFleetMiraiActions({ fleetService, driverService, insuranceService }),
    publicLookup: [{ model: "vehicle", publicFields: ["brand", "model", "year"] }],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType !== "vehicle" || !pageContext.recordId) return null;
      const row = await fleetService.getVehicle({ companyId: actx.companyId, id: String(pageContext.recordId) }).catch(() => null);
      if (!row) return null;
      const bits = [
        row.vehicle_brand_name ? `marca ${row.vehicle_brand_name}` : null,
        row.vehicle_model_name ? `modelo ${row.vehicle_model_name}` : null,
        `estado ${VEHICLE_STATUS_LABEL[row.status] ?? row.status}`,
        row.driver_name ? `conductor ${row.driver_name}` : null,
      ].filter(Boolean).join(", ");
      return `El usuario esta viendo el vehiculo "${row.plate}" (vehicleId ${row.id}), ${bits}.`;
    },
  };
}
