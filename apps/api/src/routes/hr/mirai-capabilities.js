// apps/api/src/routes/hr/mirai-capabilities.js
//
// runly.hr capability for MirAI (spec 2026-09-30-mirai-ledger-hr-fleet §4).
// Builds its own createHrService the same way routes/hr-routes.js does,
// independent of the HTTP router. Field-level exposure mirrors
// hr-service.js exactly: the search tool reuses listEmployees()'s paginated
// row shape (no notesMarkdown/metadata), and the detail tool mirrors
// getEmployee()'s own return (minus the raw metadata JSON blob and the
// linked account's email/avatar, which the detail route also fetches but a
// chat answer doesn't need) — never more than what GET /hr/employees/:id
// returns to the same hr.employee.read caller. HrEmployee has no salary
// field at all, so there is nothing further to redact there.
import { createHrService } from "../../services/hr-service.js";
import { createHrMiraiQueries } from "./hr-mirai-queries.js";
import { createHrMiraiActions } from "./mirai-actions.js";

const STATUS_LABEL = { active: "activo", inactive: "inactivo", vacation: "vacaciones", terminated: "baja" };

export function createHrMiraiCapabilities({ prisma }) {
  const hrService = createHrService({ prisma });

  return {
    moduleKey: "runly.hr",
    label: "RRHH",
    summary: "Colaboradores: busqueda, expediente y conteos de plantilla; alta, edicion y baja de colaboradores.",
    tools: createHrMiraiQueries({ prisma, hrService }),
    actions: createHrMiraiActions({ hrService }),
    publicLookup: [],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType !== "employee" || !pageContext.recordId) return null;
      const row = await hrService
        .getEmployee({ authUserId: actx.actorAuthUserId, companyId: actx.companyId, id: String(pageContext.recordId) })
        .catch(() => null);
      if (!row) return null;
      const nombre = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
      const bits = [
        row.jobTitleRef?.name ?? row.jobTitle ?? null,
        row.departmentRef?.name ?? row.department ?? null,
        `estado ${STATUS_LABEL[row.status] ?? row.status}`,
      ].filter(Boolean).join(", ");
      return `El usuario esta viendo el expediente de "${nombre}" (employeeId ${row.id})${bits ? `, ${bits}` : ""}.`;
    },
  };
}
