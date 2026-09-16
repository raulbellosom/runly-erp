import { toLocalIso } from '../../../lib/localDate.js';
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RunlyTable, Button, ErrorState, LoadingState, PageHeader } from "@runly/ui";
import { FileSpreadsheet, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { runly } from "../../../lib/runly";
import { buildHrEmployeesTableProps } from "../lib/hr-employees-table-props.js";
import { resolveHrScreenAccess } from "../lib/hr-screen-access.js";

import HrEmployeeDetail from "./HrEmployeeDetail";
import HrEmployeeForm from "./HrEmployeeForm";
import HrOrgChartScreen from "./HrOrgChartScreen";
import HrCatalogsScreen from "./HrCatalogsScreen";

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: "Tiempo completo" },
  { value: "part_time", label: "Medio tiempo" },
  { value: "contractor", label: "Contratista" },
  { value: "intern", label: "Practicante" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Activo" },
  { value: "vacation", label: "Vacaciones" },
  { value: "inactive", label: "Inactivo" },
  { value: "terminated", label: "Baja" },
];

const HR_EMPLOYEES_BLUEPRINT = {
  key: "hr.employees.table",
  schema: {
    apiPath: "/hr/employees",
    primaryField: "full_name",
    searchable: true,
    searchPlaceholder: "Buscar colaborador...",
    columns: [
      {
        field: "photo_file_id",
        label: "Foto",
        type: "image-asset",
        sortable: false,
        // Own cover photo wins; if the row has none, falls back to the
        // linked account's avatar (user_profile_id); if there's no photo
        // at all, shows initials from full_name instead of a bare icon.
        avatarUserField: "user_profile_id",
        avatarLabelField: "full_name",
      },
      { field: "full_name", label: "Nombre", sortable: true, link: true },
      { field: "employee_code", label: "Codigo", sortable: false },
      { field: "job_title", label: "Puesto", sortable: false },
      { field: "department", label: "Departamento", sortable: false },
      {
        field: "status",
        label: "Estado",
        sortable: true,
        type: "select",
        options: STATUS_OPTIONS,
      },
      {
        field: "employment_type",
        label: "Tipo",
        sortable: false,
        type: "select",
        options: EMPLOYMENT_TYPE_OPTIONS,
      },
      { field: "hire_date", label: "Ingreso", sortable: true, type: "date" },
      { field: "work_email", label: "Email trabajo", sortable: false, defaultVisible: false },
      { field: "phone", label: "Telefono", sortable: false, defaultVisible: false },
      { field: "work_location", label: "Ubicacion", sortable: false, defaultVisible: false },
      { field: "manager_name", label: "Manager", sortable: false, defaultVisible: false },
      { field: "termination_date", label: "Fecha baja", sortable: false, type: "date", defaultVisible: false },
      { field: "personal_email", label: "Email personal", sortable: false, defaultVisible: false },
    ],
    filters: [
      { key: "status", label: "Estado", type: "select", options: STATUS_OPTIONS },
      { key: "employment_type", label: "Tipo de empleo", type: "select", options: EMPLOYMENT_TYPE_OPTIONS },
    ],
    emptyState: { message: "No hay colaboradores registrados." },
  },
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HrScreen() {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) =>
    Boolean(userProfile?.isAdmin || permissions.includes(key));
  const screenAccess = resolveHrScreenAccess({ token, userProfile });
  const canCreateEmployees = hasPermission("hr.employee.create");
  const { "*": wildcard } = useParams();
  const navigate = useNavigate();

  const isOrgChartRoute = wildcard === "hr/org-chart";
  const isCatalogsRoute = wildcard === "hr/catalogs";
  const isNewRoute = wildcard === "hr/employees/new";

  const editMatch = wildcard?.match(/^hr\/employees\/([^/]+)\/edit$/);
  const editEmployeeId = editMatch?.[1] ?? null;

  const detailMatch = !editMatch && wildcard?.match(/^hr\/employees\/([^/]+)$/);
  const detailEmployeeId = detailMatch?.[1] ?? null;

  const bulkActions = useMemo(() => [
    {
      label: "Exportar Excel",
      icon: FileSpreadsheet,
      onClick: async (selectedRows) => {
        try {
          const ids = selectedRows.map((r) => r.id).filter(Boolean);
          const blob = await runly.hr.exportEmployeesExcel(ids, token);
          downloadBlob(blob, `colaboradores-${toLocalIso()}.xlsx`);
          toast.success("Excel generado");
        } catch {
          toast.error("No se pudo exportar el archivo Excel.");
        }
      },
    },
    {
      label: "Exportar PDF",
      icon: FileText,
      onClick: async (selectedRows) => {
        try {
          const ids = selectedRows.map((r) => r.id).filter(Boolean);
          const blob = await runly.hr.exportEmployeesPdf(ids, token);
          downloadBlob(blob, `colaboradores-${toLocalIso()}.pdf`);
          toast.success("PDF generado");
        } catch {
          toast.error("No se pudo generar el PDF.");
        }
      },
    },
  ], [token]);

  if (isOrgChartRoute) return <HrOrgChartScreen />;
  if (isCatalogsRoute) return <HrCatalogsScreen />;

  if (isNewRoute) {
    return (
      <div className="p-4 md:p-6 min-h-dvh">
        <HrEmployeeForm employeeId={null} />
      </div>
    );
  }

  if (editEmployeeId) {
    return (
      <div className="p-4 md:p-6 min-h-dvh">
        <HrEmployeeForm employeeId={editEmployeeId} />
      </div>
    );
  }

  if (detailEmployeeId) {
    return (
      <div className="p-4 md:p-6 min-h-dvh">
        <HrEmployeeDetail employeeId={detailEmployeeId} />
      </div>
    );
  }

  if (screenAccess === "loading") {
    return (
      <div className="p-4 md:p-6 space-y-6 min-h-dvh">
        <PageHeader
          eyebrow="Runly HR"
          title="Colaboradores"
          description="Directorio y expedientes del equipo."
        />
        <LoadingState
          title="Cargando colaboradores"
          description="Preparando permisos y datos del modulo."
        />
      </div>
    );
  }

  if (screenAccess === "forbidden") {
    return (
      <div className="p-4 md:p-6 space-y-6 min-h-dvh">
        <PageHeader
          eyebrow="Runly HR"
          title="Colaboradores"
          description="Directorio y expedientes del equipo."
        />
        <ErrorState message="No tienes permisos para ver los colaboradores." />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly HR"
        title="Colaboradores"
        description="Directorio y expedientes del equipo."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/app/m/runly.hr/hr/org-chart")}
            >
              Organigrama
            </Button>
            {canCreateEmployees && (
              <Button onClick={() => navigate("/app/m/runly.hr/hr/employees/new")}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo colaborador
              </Button>
            )}
          </div>
        }
      />
      <RunlyTable
        {...buildHrEmployeesTableProps({
          blueprint: HR_EMPLOYEES_BLUEPRINT,
          token,
          companyId: activeCompanyId,
          onView: (row) => navigate(`/app/m/runly.hr/hr/employees/${row.id}`),
          bulkActions,
        })}
      />
    </div>
  );
}
