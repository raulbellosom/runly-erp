import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RunlyCrudView, Button, PageHeader } from "@runly/ui";
import { Plus } from "lucide-react";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { componentRegistry } from "../../../lib/moduleComponentRegistry";
import { getApiUrl } from "../../../lib/runtimeConfig.js";

const API_BASE = getApiUrl();
const BASE_PATH = "/app/m/runly.fleet/vehicles";

const VEHICLE_TABLE = {
  key: "fleet.vehicle.table",
  kind: "TABLE",
  schema: {
    entity: "vehicle",
    component: "RunlyTable",
    apiPath: "/fleet/vehicles",
    primaryField: "plate",
    searchable: true,
    searchPlaceholder: "Buscar vehiculo...",
    columns: [
      {
        field: "cover_image_file_asset_id",
        label: "Imagen",
        sortable: false,
        component: "runly.fleet:VehicleImageCell",
      },
      { field: "plate", label: "Matricula", sortable: true, link: true },
      { field: "vehicle_brand_name", label: "Marca", sortable: false },
      { field: "vehicle_model_name", label: "Modelo", sortable: false },
      {
        field: "vehicle_model_year",
        label: "Anio",
        sortable: false,
        type: "number",
      },
      { field: "color", label: "Color", sortable: false, type: "color" },
      {
        field: "status",
        label: "Estado",
        sortable: true,
        component: "runly.fleet:VehicleStatusBadge",
      },
      {
        field: "is_financed",
        label: "Financiado",
        sortable: true,
        type: "boolean",
        defaultVisible: false,
      },
      {
        field: "full_economic_number",
        label: "No. Economico",
        sortable: false,
        defaultVisible: false,
      },
      { field: "vehicle_type_name", label: "Tipo", sortable: false, defaultVisible: false },
      {
        field: "driver_name",
        label: "Conductor",
        sortable: false,
        hrefTemplate: "/app/m/runly.fleet/drivers/:driver_id",
      },
      {
        field: "insurance_status",
        label: "Seguro",
        sortable: false,
        component: "runly.fleet:InsuranceBadgeCell",
        defaultVisible: false,
      },
    ],
    actions: [
      {
        label: "Crear vehiculo",
        permission: "fleet.vehicles.create",
        variant: "primary",
      },
    ],
    rowActions: [
      { label: "Ver detalle", permission: "fleet.vehicles.read" },
      { label: "Editar", permission: "fleet.vehicles.update" },
      { label: "Desactivar", permission: "fleet.vehicles.delete" },
    ],
    emptyState: { message: "No hay vehiculos registrados." },
  },
};

const VEHICLE_FORM = {
  key: "fleet.vehicle.form",
  kind: "FORM",
  schema: {
    entity: "vehicle",
    component: "RunlyForm",
    apiPath: "/fleet/vehicles",
    sections: [
      {
        label: "Identificacion del vehiculo",
        icon: "Truck",
        collapsible: true,
        fields: [
          {
            field: "plate",
            label: "Matricula",
            type: "text",
            required: true,
            hint: "Placa oficial de circulacion (ej. ABC-1234)",
          },
          {
            field: "vehicle_model_id",
            label: "Modelo de vehiculo",
            type: "relation",
            required: true,
            hint: "Selecciona la marca, modelo y año del vehiculo",
            relation: {
              apiPath: "/fleet/catalogs/vehicle-models",
              labelField: ["brand_name", "name", "year"],
              labelSeparator: " · ",
              pageSize: 50,
              preload: false,
              clearable: true,
              disabledField: "enabled",
              dependsOn: ["vehicle_brand_id", "vehicle_type_id"],
              queryParams: {
                brand_id: "vehicle_brand_id",
                type_id: "vehicle_type_id",
              },
              create: {
                enabled: true,
                label: "Crear modelo de vehiculo",
                mode: "modal",
                title: "Crear modelo de vehiculo",
                apiPath: "/fleet/catalogs/vehicle-models",
                viewKey: "fleet.catalog.vehicle_models.form",
                selectCreated: true,
                refreshOptions: true,
                permissionKey: "fleet.catalogs.create",
              },
            },
          },
          {
            field: "color",
            label: "Color del vehiculo",
            type: "color",
            hint: "Color exterior principal del vehiculo",
          },
          {
            field: "status",
            label: "Estado operativo",
            type: "select",
            required: true,
            hint: "Estado actual del vehiculo dentro de la flota",
            options: ["active", "maintenance", "inactive", "retired"],
          },
          {
            field: "economic_individual_number",
            label: "No. Economico individual",
            type: "text",
            hint: "Numero de unidad asignado internamente (ej. 042)",
          },
        ],
      },
      {
        label: "Asignacion de conductor",
        icon: "UserCheck",
        collapsible: true,
        fields: [
          {
            field: "driver_id",
            label: "Conductor asignado",
            type: "relation",
            hint: "Conductor principal responsable de esta unidad",
            relation: {
              apiPath: "/fleet/drivers",
              labelField: "driver_name",
              preload: false,
              clearable: true,
              disabledField: "enabled",
            },
          },
        ],
      },
      {
        label: "Financiamiento",
        icon: "Landmark",
        collapsible: true,
        fields: [
          {
            field: "is_financed",
            label: "Vehiculo financiado",
            type: "boolean",
            fullWidth: true,
            hint: "Activa esta opcion si la unidad se adquirio mediante financiamiento",
          },
          {
            field: "financing_institution",
            label: "Financiera",
            type: "text",
            hint: "Nombre de la institucion financiera (opcional)",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_contract_number",
            label: "No. de contrato",
            type: "text",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_start_date",
            label: "Fecha de inicio",
            type: "date",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_end_date",
            label: "Fecha de termino",
            type: "date",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_monthly_payment",
            label: "Mensualidad",
            type: "currency",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_notes",
            label: "Notas de financiamiento",
            type: "markdown",
            visibleWhen: { field: "is_financed", truthy: true },
          },
        ],
      },
      {
        label: "Notas",
        icon: "FileText",
        collapsible: true,
        fields: [
          {
            field: "notes",
            label: "Observaciones adicionales",
            type: "markdown",
            hint: "Informacion relevante sobre el vehiculo: condiciones especiales, historial, etc.",
          },
        ],
      },
      {
        id: "attachments",
        type: "attachments",
        label: "Documentos del vehiculo",
        placement: "aside",
        collapsible: true,
        attachments: {
          createMode: "stage-until-parent-create",
          editMode: "upload-immediately",
          listPath: "/fleet/vehicles/:id/documents",
          addPath: "/fleet/vehicles/:id/documents",
          removePath: "/fleet/vehicles/:id/documents/:docId",
          upload: {
            endpoint: "/files/upload",
            moduleKey: "runly.fleet",
            entityType: "FleetVehicle",
          },
          signedUrl: { endpointTemplate: "/files/:fileId/signed-url" },
          fields: {
            id: "id",
            fileAssetId: "file_asset_id",
            documentType: "document_type",
            label: "label",
            createdAt: "created_at",
            enabled: "enabled",
            fileAsset: "file_asset",
            fileName: "originalName",
            mimeType: "mimeType",
            sizeBytes: "sizeBytes",
          },
          permissions: {
            read: "fleet.vehicles.read",
            create: "fleet.vehicles.update",
            remove: "fleet.vehicles.update",
            fileUpload: "files.assets.create",
            fileRead: "files.assets.read",
          },
          limits: { maxFiles: 20, maxSizeMB: 10, allowMultiple: true },
        },
      },
    ],
    submitLabel: "Guardar vehiculo",
    cancelLabel: "Cancelar",
  },
};

const VEHICLE_DETAIL = {
  key: "fleet.vehicle.detail",
  kind: "DETAIL",
  schema: {
    entity: "vehicle",
    component: "RunlyDetail",
    apiPath: "/fleet/vehicles",
    layout: "two-column",
    hero: {
      titleField: "plate",
      subtitleFields: [
        "vehicle_brand_name",
        "vehicle_model_name",
        "vehicle_model_year",
      ],
      statusField: "status",
      imageField: "cover_image_file_asset_id",
      imageDocsPath: "/fleet/vehicles/:id/documents",
      fallbackIcon: "Truck",
      accentColorField: "color",
      metaChips: [
        { field: "vehicle_type_name", label: "Tipo", icon: "Layers" },
        { field: "full_economic_number", label: "No. Economico", icon: "Hash" },
        { field: "color", label: "Color", type: "color" },
      ],
    },
    kpis: [
      { label: "Matricula", field: "plate", icon: "Hash" },
      { label: "No. Economico", field: "full_economic_number", icon: "Hash" },
      { label: "Tipo", field: "vehicle_type_name", icon: "Layers" },
      { label: "Financiado", field: "is_financed", type: "boolean", icon: "Landmark" },
      {
        label: "Operador",
        field: "driver_name",
        icon: "UserCheck",
        hrefTemplate: "/app/m/runly.fleet/drivers/:driver_id",
      },
      {
        label: "Poliza",
        field: "active_insurance_policy.expiry_date",
        type: "date",
        icon: "ShieldCheck",
      },
    ],
    sections: [
      {
        label: "Identificacion del vehiculo",
        column: "main",
        columns: 2,
        fields: [
          { field: "plate", label: "Matricula", icon: "Hash" },
          {
            field: "full_economic_number",
            label: "Numero economico",
            icon: "Hash",
          },
          { field: "vehicle_brand_name", label: "Marca", icon: "Tag" },
          { field: "vehicle_model_name", label: "Modelo", icon: "Truck" },
          { field: "vehicle_model_year", label: "Año", icon: "CalendarDays" },
          {
            field: "vehicle_type_name",
            label: "Tipo de vehiculo",
            icon: "Layers",
          },
        ],
      },
      {
        label: "Estado y apariencia",
        column: "main",
        columns: 2,
        fields: [
          { field: "status", label: "Estado operativo", icon: "Activity" },
          {
            field: "color",
            label: "Color del vehiculo",
            type: "color",
            icon: "Palette",
          },
        ],
      },
      {
        label: "Financiamiento",
        column: "main",
        columns: 2,
        fields: [
          {
            field: "is_financed",
            label: "Vehiculo financiado",
            type: "boolean",
            icon: "Landmark",
          },
          {
            field: "financing_institution",
            label: "Financiera",
            icon: "Building2",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_contract_number",
            label: "No. contrato",
            icon: "Hash",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_start_date",
            label: "Inicio",
            type: "date",
            icon: "CalendarDays",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_end_date",
            label: "Termino",
            type: "date",
            icon: "CalendarDays",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_monthly_payment",
            label: "Mensualidad",
            type: "currency",
            icon: "Tag",
            visibleWhen: { field: "is_financed", truthy: true },
          },
          {
            field: "financing_notes",
            label: "Notas",
            type: "markdown",
            icon: "FileText",
            visibleWhen: { field: "is_financed", truthy: true },
          },
        ],
      },
      {
        id: "assigned_driver",
        type: "relation-card",
        label: "Conductor asignado",
        column: "aside",
        relationCard: {
          idField: "driver_id",
          titleField: "driver_name",
          subtitleFields: ["driver_license_number", "driver_phone"],
          fallbackTitle: "Sin conductor asignado",
          hrefTemplate: "/app/m/runly.fleet/drivers/:id",
          icon: "UserCheck",
          avatarField: "driver_photo_asset_id",
          contactActions: [
            { type: "call", field: "driver_phone", label: "Llamar" },
          ],
        },
      },
      {
        id: "active_insurance",
        type: "relation-card",
        label: "Poliza de seguro activa",
        column: "aside",
        relationCard: {
          idField: "active_insurance_policy.id",
          titleField: "active_insurance_policy.insurer_name",
          subtitleFields: [
            "active_insurance_policy.policy_number",
            "active_insurance_policy.coverage_type_label",
            "active_insurance_policy.expiry_date",
          ],
          subtitleTypes: ["text", "text", "date"],
          fallbackTitle: "Sin poliza de seguro activa",
          hrefTemplate: "/app/m/runly.fleet/insurance/:id",
          icon: "ShieldCheck",
        },
      },
      {
        id: "insurance_history",
        type: "relation-list",
        label: "Historial de polizas",
        column: "aside",
        relationList: {
          apiPath: "/fleet/vehicles/:id/insurance",
          idField: "id",
          titleField: "insurer_name",
          subtitleFields: [
            "policy_number",
            "coverage_type_label",
            "expiry_date",
          ],
          subtitleLabels: ["No.", "Cobertura:", "Vence:"],
          subtitleTypes: ["text", "text", "date"],
          hrefTemplate: "/app/m/runly.fleet/insurance/:id",
          emptyMessage: "Este vehiculo no tiene polizas registradas.",
        },
      },
      {
        label: "Observaciones",
        column: "main",
        fields: [
          {
            field: "notes",
            label: "Notas",
            type: "markdown",
            icon: "FileText",
          },
        ],
      },
      {
        id: "documents",
        type: "documents",
        label: "Documentos del vehiculo",
        column: "aside",
        documents: {
          listPath: "/fleet/vehicles/:id/documents",
          addPath: "/fleet/vehicles/:id/documents",
          removePath: "/fleet/vehicles/:id/documents/:docId",
          upload: {
            endpoint: "/files/upload",
            moduleKey: "runly.fleet",
            entityType: "FleetVehicle",
          },
          fields: {
            associationId: "id",
            fileAssetId: "file_asset_id",
            documentType: "document_type",
            label: "label",
            createdAt: "created_at",
            enabled: "enabled",
            fileAsset: "file_asset",
            fileName: "originalName",
            mimeType: "mimeType",
            sizeBytes: "sizeBytes",
          },
          signedUrl: { endpointTemplate: "/files/:fileId/signed-url" },
          permissions: {
            read: "fleet.vehicles.read",
            create: "fleet.vehicles.update",
            remove: "fleet.vehicles.update",
            fileUpload: "files.assets.create",
            fileRead: "files.assets.read",
          },
        },
      },
      {
        id: "history",
        type: "component",
        label: "Actividad",
        icon: "History",
        column: "aside",
        component: "runly.fleet:HistorySection",
      },
    ],
    headerActions: [
      {
        key: "download_pdf",
        label: "Exportar PDF",
        method: "GET",
        pathTemplate: "/fleet/vehicles/:id/pdf",
        download: true,
        downloadFileName: "vehiculo.pdf",
        refreshAfter: false,
        variant: "outline",
      },
    ],
    actions: [
      { label: "Editar", permission: "fleet.vehicles.update" },
      { label: "Desactivar", permission: "fleet.vehicles.delete" },
    ],
  },
};

function parseModeAndId(wildcard) {
  const segs = String(wildcard ?? "")
    .replace(/^\/+/, "")
    .replace(/^vehicles\/?/, "")
    .split("/")
    .filter(Boolean);
  if (segs[0] === "new") return { initialMode: "create", recordId: null };
  if (segs[1] === "edit") return { initialMode: "edit", recordId: segs[0] };
  if (segs[0]) return { initialMode: "detail", recordId: segs[0] };
  return { initialMode: "list", recordId: null };
}

export default function VehiclesScreen() {
  const { "*": wildcard } = useParams();
  const navigate = useNavigate();
  const { session, userProfile } = useAuth();
  const token = session?.access_token ?? null;
  const { activeCompanyId } = useActiveCompany();
  const canCreate = Boolean(userProfile?.isAdmin || userProfile?.permissions?.includes("fleet.vehicles.create"));

  const { initialMode, recordId } = useMemo(
    () => parseModeAndId(wildcard),
    [wildcard],
  );

  const handleNavigate = useCallback(
    ({ mode, recordId }) => {
      const path =
        mode === "create"
          ? `${BASE_PATH}/new`
          : mode === "detail" && recordId
            ? `${BASE_PATH}/${recordId}`
            : mode === "edit" && recordId
              ? `${BASE_PATH}/${recordId}/edit`
              : BASE_PATH;
      navigate(path, { replace: true });
    },
    [navigate],
  );

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      {initialMode === "list" && (
        <PageHeader
          eyebrow="Runly Fleet"
          title="Vehiculos"
          description="Registro y control de unidades de la flota."
          actions={
            canCreate && (
              <Button onClick={() => navigate(`${BASE_PATH}/new`)}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo vehiculo
              </Button>
            )
          }
        />
      )}
      <RunlyCrudView
        tableBlueprint={VEHICLE_TABLE}
        formBlueprint={VEHICLE_FORM}
        detailBlueprint={VEHICLE_DETAIL}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        initialMode={initialMode}
        recordId={recordId}
        onNavigate={handleNavigate}
        componentRegistry={componentRegistry}
        suppressToolbarCreate
      />
    </div>
  );
}
