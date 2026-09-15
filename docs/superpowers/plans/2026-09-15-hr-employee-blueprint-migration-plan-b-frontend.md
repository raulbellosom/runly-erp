# HR Employee Blueprint Migration — Plan B (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Depends on Plan A** (`docs/superpowers/plans/2026-09-15-hr-employee-blueprint-migration-plan-a-backend.md`) being complete — this plan's blueprints reference the `PATCH /files/:id/cover`/`POST /files/reorder` endpoints and the server-resolved `department`/`jobTitle`/`managerName` fields Plan A adds.

**Goal:** Replace `HrEmployeeDetail.jsx` (1196 lines) and `HrEmployeeForm.jsx` (1050 lines) with thin wrappers over new `HR_EMPLOYEE_DETAIL`/`HR_EMPLOYEE_FORM` blueprints on `RunlyDetail`/`RunlyForm`, deleting the legacy `AuditPanel`/`AuditDetailModal` diff viewer entirely (superseded by `ActivityTimeline`'s diff feature) and porting the org-chart widget to the `component`-registry pattern.

**Architecture:** Two new blueprints (`apps/desktop/src/modules/runly.hr/blueprints/`), three new/adapted `component`-registry widgets (`runly.hr:OrgChartSection`, `runly.hr:HistorySection` — an adapted `HrEmployeeActivityPanel`, `runly.hr:AssignedEquipmentSection` — a thin adapter around the existing `InventoryEmployeeWidget`), and one small backward-compatible capability fix to `useAttachmentsController.js` (make `addPath` optional, since HR's generic `FileAsset` tagging has no per-module association endpoint to POST to, unlike Inventory's `InvItemFile`/Fleet's `fleet_vehicle_document`).

**Tech Stack:** React (`apps/desktop`, `packages/ui`), no component-render test harness in this repo — verification is `pnpm build`/`pnpm lint` + manual browser check, per the pattern established by every other plan in this folder.

---

### Task 1: Make `addPath` optional in `useAttachmentsController.js`

**Files:**
- Modify: `packages/ui/src/hooks/useAttachmentsController.js`

- [ ] **Step 1: Read the current guard and upload-complete branch**

The current code (for reference, do not skip re-reading the live file before editing — this plan was written against a specific line range that may have shifted):

```js
      if (!canUpload || !config?.addPath) {
        return { ok: false, error: "Carga de documentos no disponible." };
      }
```

and, later in the same function, after `fileAssetId` is resolved from the upload response:

```js
        const associationPayload = { file_asset_id: fileAssetId };
        if (pending.documentType?.trim()) {
          associationPayload.document_type = pending.documentType.trim();
        }
        if (pending.label?.trim()) {
          associationPayload.label = pending.label.trim();
        }

        const addPath = replacePathTokens(config.addPath, { id: effectiveRecordId });
        const addResponse = await fetch(joinUrl(apiBaseUrl, addPath), {
          method: "POST",
          headers: buildApiHeaders(token, companyId, { "Content-Type": "application/json" }),
          body: JSON.stringify(associationPayload),
        });
        const addText = await addResponse.text();
        const addPayload = parseJsonSafe(addText);

        if (!addResponse.ok) {
          throw new Error(extractErrorMessage(addPayload, "No se pudo asociar el documento."));
        }

        setPendingItems((prev) =>
          prev.map((item) =>
            item.id === pending.id
              ? {
                  ...item,
                  status: "success",
                  progress: 100,
                  error: "",
                  associationId:
                    addPayload?.data?.id ?? addPayload?.id ?? item.associationId ?? null,
                }
              : item,
          ),
        );

        return { ok: true };
```

- [ ] **Step 2: Relax the guard**

Replace:
```js
      if (!canUpload || !config?.addPath) {
        return { ok: false, error: "Carga de documentos no disponible." };
      }
```
with:
```js
      if (!canUpload || !config?.upload) {
        return { ok: false, error: "Carga de documentos no disponible." };
      }
```

- [ ] **Step 3: Skip the association POST when `addPath` isn't configured**

Replace:
```js
        const associationPayload = { file_asset_id: fileAssetId };
        if (pending.documentType?.trim()) {
          associationPayload.document_type = pending.documentType.trim();
        }
        if (pending.label?.trim()) {
          associationPayload.label = pending.label.trim();
        }

        const addPath = replacePathTokens(config.addPath, { id: effectiveRecordId });
        const addResponse = await fetch(joinUrl(apiBaseUrl, addPath), {
          method: "POST",
          headers: buildApiHeaders(token, companyId, { "Content-Type": "application/json" }),
          body: JSON.stringify(associationPayload),
        });
        const addText = await addResponse.text();
        const addPayload = parseJsonSafe(addText);

        if (!addResponse.ok) {
          throw new Error(extractErrorMessage(addPayload, "No se pudo asociar el documento."));
        }

        setPendingItems((prev) =>
          prev.map((item) =>
            item.id === pending.id
              ? {
                  ...item,
                  status: "success",
                  progress: 100,
                  error: "",
                  associationId:
                    addPayload?.data?.id ?? addPayload?.id ?? item.associationId ?? null,
                }
              : item,
          ),
        );

        return { ok: true };
```
with:
```js
        // Modules with a per-entity association table (Inventory's
        // InvItemFile, Fleet's fleet_vehicle_document) configure `addPath` to
        // create that association row. Modules using the generic FileAsset
        // moduleKey/entityType/metadata.sourceEntityId tagging (HR's
        // employee documents) have no such table — the upload itself is the
        // complete "add" operation, and the FileAsset's own id doubles as
        // its associationId.
        if (!config.addPath) {
          setPendingItems((prev) =>
            prev.map((item) =>
              item.id === pending.id
                ? {
                    ...item,
                    status: "success",
                    progress: 100,
                    error: "",
                    associationId: fileAssetId,
                  }
                : item,
            ),
          );
          return { ok: true };
        }

        const associationPayload = { file_asset_id: fileAssetId };
        if (pending.documentType?.trim()) {
          associationPayload.document_type = pending.documentType.trim();
        }
        if (pending.label?.trim()) {
          associationPayload.label = pending.label.trim();
        }

        const addPath = replacePathTokens(config.addPath, { id: effectiveRecordId });
        const addResponse = await fetch(joinUrl(apiBaseUrl, addPath), {
          method: "POST",
          headers: buildApiHeaders(token, companyId, { "Content-Type": "application/json" }),
          body: JSON.stringify(associationPayload),
        });
        const addText = await addResponse.text();
        const addPayload = parseJsonSafe(addText);

        if (!addResponse.ok) {
          throw new Error(extractErrorMessage(addPayload, "No se pudo asociar el documento."));
        }

        setPendingItems((prev) =>
          prev.map((item) =>
            item.id === pending.id
              ? {
                  ...item,
                  status: "success",
                  progress: 100,
                  error: "",
                  associationId:
                    addPayload?.data?.id ?? addPayload?.id ?? item.associationId ?? null,
                }
              : item,
          ),
        );

        return { ok: true };
```

- [ ] **Step 4: Build check**

Run: `pnpm --filter @runly/desktop build:web`
Expected: builds with no errors.

- [ ] **Step 5: Regression check — Inventory/Fleet attachments still work**

Since both Inventory and Fleet configure `addPath` explicitly, this change must be a no-op for them (the new `if (!config.addPath)` branch is never entered when `addPath` is set). Confirm by reading the diff: the only new code path is the early-return branch; every line of the pre-existing `addPath`-configured flow is unchanged. No test exists for this hook today (confirmed no `useAttachmentsController.test.js` upload-flow test exists, only the pure-function `resolveAttachmentFileType` tests from this session's earlier work) — do not add one now; this is a pure refactor with no new pure-function surface to unit test, and the real verification is Task 6's manual check across all three modules.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/hooks/useAttachmentsController.js
git commit -m "feat(ui): make AttachmentsPanel's addPath optional for association-free file tagging"
```

---

### Task 2: Extract `OrgChartSection`

**Files:**
- Create: `apps/desktop/src/modules/runly.hr/components/OrgChartSection.jsx`

- [ ] **Step 1: Create the component**

Create `apps/desktop/src/modules/runly.hr/components/OrgChartSection.jsx` — ported directly from `HrEmployeeDetail.jsx` lines 284–458 (`ORG_AVATAR_COLORS`, `orgAvatarColor`, `OrgNode`, `OrgConnector`, `OrgChartPanel`), adapted to the `component`-section contract (`{ data }` instead of `{ employee }`), with the `STATUS_HERO`-derived `dot` lookup inlined as its own small map (the full `STATUS_HERO` object has `bg`/`ring` values only used by the hero header, not needed here):

```jsx
// Registry key: runly.hr:OrgChartSection
// Props (RunlyDetail "component" section contract): { data }
// data.supervisor and data.reportees must be the nested relation objects
// getEmployee() already returns (not just their ids).
import { useNavigate } from "react-router-dom";
import { SectionCard, cn } from "@runly/ui";
import { ChevronRight, User, Users } from "lucide-react";

const STATUS_DOT = {
  active: "bg-emerald-500",
  vacation: "bg-amber-500",
  inactive: "bg-slate-400",
  terminated: "bg-red-500",
};

const ORG_AVATAR_COLORS = [
  "bg-blue-500/15 text-blue-600",
  "bg-emerald-500/15 text-emerald-600",
  "bg-violet-500/15 text-violet-600",
  "bg-amber-500/15 text-amber-600",
  "bg-rose-500/15 text-rose-600",
  "bg-cyan-500/15 text-cyan-600",
  "bg-pink-500/15 text-pink-600",
  "bg-indigo-500/15 text-indigo-600",
];

function orgAvatarColor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return ORG_AVATAR_COLORS[hash % ORG_AVATAR_COLORS.length];
}

function OrgNode({ firstName = "", lastName = "", jobTitle, status, isSelf, onClick }) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  const name = `${firstName} ${lastName}`.trim();
  const dot = STATUS_DOT[status];
  const avatarCls = isSelf
    ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]"
    : orgAvatarColor(name);

  return (
    <button
      type="button"
      disabled={isSelf || !onClick}
      onClick={onClick}
      className={cn(
        "group w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-150",
        isSelf
          ? "border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/6 cursor-default shadow-sm"
          : "border-[hsl(var(--border))]/80 bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]/30 hover:bg-[hsl(var(--muted))]/30 cursor-pointer",
        !onClick && !isSelf && "cursor-default",
      )}
    >
      <div
        className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0",
          avatarCls,
        )}
      >
        {initials || <User className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p
            className={cn(
              "text-xs font-semibold truncate",
              isSelf ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]",
            )}
          >
            {name}
          </p>
          {isSelf && (
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))]">
              Tú
            </span>
          )}
        </div>
        {jobTitle && (
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate leading-4 mt-0.5">
            {jobTitle}
          </p>
        )}
      </div>
      {dot && !isSelf && <div className={cn("h-2 w-2 rounded-full shrink-0", dot)} />}
      {!isSelf && onClick && (
        <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

function OrgConnector() {
  return (
    <div className="flex justify-center py-0.5">
      <div className="w-px h-4 bg-[hsl(var(--border))]" />
    </div>
  );
}

export default function OrgChartSection({ data }) {
  const navigate = useNavigate();
  const supervisor = data?.supervisor;
  const reportees = data?.reportees ?? [];

  return (
    <SectionCard title="Organigrama" icon={Users}>
      <div className="space-y-0.5">
        {supervisor ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] px-1 pb-1.5">
              Supervisor
            </p>
            <OrgNode
              firstName={supervisor.firstName}
              lastName={supervisor.lastName}
              status={supervisor.status}
              onClick={() => navigate(`/app/m/runly.hr/employees/${supervisor.id}`)}
            />
            <OrgConnector />
          </>
        ) : (
          <div className="flex items-center gap-2 pb-2">
            <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
              Sin supervisor
            </span>
            <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
          </div>
        )}

        <OrgNode
          firstName={data?.firstName}
          lastName={data?.lastName}
          jobTitle={data?.jobTitle}
          status={data?.status}
          isSelf
        />

        {reportees.length > 0 ? (
          <>
            <OrgConnector />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] px-1 pt-0.5 pb-1.5">
              Reportes directos ({reportees.length})
            </p>
            <div className="space-y-1.5">
              {reportees.map((r) => (
                <OrgNode
                  key={r.id}
                  firstName={r.firstName}
                  lastName={r.lastName}
                  status={r.status}
                  onClick={() => navigate(`/app/m/runly.hr/employees/${r.id}`)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <OrgConnector />
            <div className="flex items-center gap-2 pt-0.5">
              <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
                Sin reportes directos
              </span>
              <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
```

Note the navigation path fix: the original used `/app/m/runly.hr/hr/employees/${id}` (a duplicated `/hr/hr/` segment — cross-check whether that's a real working route or a latent bug in the current code before Task 5's manual QA; this extraction uses the corrected `/app/m/runly.hr/employees/${id}` matching this plan's own route table in the parent spec, section 9. If the old `/hr/hr/` path was actually necessary due to some router nesting this plan hasn't seen, revert this specific path during Task 6 manual QA.)

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.hr/components/OrgChartSection.jsx
git commit -m "feat(hr): extract OrgChartSection as a standalone component-registry widget"
```

---

### Task 3: Adapt and register the three `component`-section widgets

**Files:**
- Modify: `apps/desktop/src/modules/runly.hr/components/HrEmployeeActivityPanel.jsx`
- Create: `apps/desktop/src/modules/runly.hr/components/AssignedEquipmentSection.jsx`
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js`

- [ ] **Step 1: Adapt `HrEmployeeActivityPanel` to the component contract**

Read the current file (already known from this session's earlier work):
```jsx
import { ActivityTimeline } from "@runly/ui";
import { runly } from "../../../lib/runly";
import { HR_EMPLOYEE_ACTIVITY_FIELD_LABELS } from "../lib/activity-field-labels.js";

export default function HrEmployeeActivityPanel({ employeeId, token }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
        <h3 className="text-sm font-semibold">Actividad reciente</h3>
      </div>
      <ActivityTimeline
        sdk={runly}
        token={token}
        entityType="HrEmployee"
        entityId={employeeId}
        limit={50}
        heightClass="max-h-[480px]"
        emptyMessage="Sin actividad registrada para este colaborador."
        changeLabels={HR_EMPLOYEE_ACTIVITY_FIELD_LABELS}
      />
    </div>
  );
}
```

Replace with (drops the panel's own card chrome — `RunlyDetail`'s section wrapper already supplies a card/header, exactly like the fix applied to `InventoryDetailHistorySection.jsx` earlier this session — and accepts `data`/`token` per the component contract instead of `employeeId`):

```jsx
// Registry key: runly.hr:HistorySection
// Props (RunlyDetail "component" section contract): { data, token }
import { ActivityTimeline } from "@runly/ui";
import { runly } from "../../../lib/runly";
import { HR_EMPLOYEE_ACTIVITY_FIELD_LABELS } from "../lib/activity-field-labels.js";

export default function HrEmployeeActivityPanel({ data, token }) {
  return (
    <ActivityTimeline
      sdk={runly}
      token={token}
      entityType="HrEmployee"
      entityId={data?.id}
      limit={50}
      heightClass="max-h-[480px]"
      emptyMessage="Sin actividad registrada para este colaborador."
      changeLabels={HR_EMPLOYEE_ACTIVITY_FIELD_LABELS}
    />
  );
}
```

- [ ] **Step 2: Create the assigned-equipment adapter**

Create `apps/desktop/src/modules/runly.hr/components/AssignedEquipmentSection.jsx`:

```jsx
// Registry key: runly.hr:AssignedEquipmentSection
// Props (RunlyDetail "component" section contract): { data }
// Thin adapter — InventoryEmployeeWidget takes `employeeId` directly (it
// predates the component-registry contract and lives in a different
// module), this just bridges the two without touching that component.
import { InventoryEmployeeWidget } from "../../runly.inventory/components/InventoryEmployeeWidget.jsx";

export default function AssignedEquipmentSection({ data }) {
  return <InventoryEmployeeWidget employeeId={data?.id} />;
}
```

- [ ] **Step 3: Register all three in `moduleComponentRegistry.js`**

In `apps/desktop/src/lib/moduleComponentRegistry.js`, add these imports near the existing `runly.inventory:*` imports:

```js
import HrEmployeeActivityPanel from "../modules/runly.hr/components/HrEmployeeActivityPanel.jsx";
import OrgChartSection from "../modules/runly.hr/components/OrgChartSection.jsx";
import AssignedEquipmentSection from "../modules/runly.hr/components/AssignedEquipmentSection.jsx";
```

And add these registrations after the existing `runly.inventory:*` block:

```js
componentRegistry.register("runly.hr:HistorySection", HrEmployeeActivityPanel);
componentRegistry.register("runly.hr:OrgChartSection", OrgChartSection);
componentRegistry.register(
  "runly.hr:AssignedEquipmentSection",
  AssignedEquipmentSection,
);
```

- [ ] **Step 4: Build check**

Run: `pnpm --filter @runly/desktop build:web`
Expected: builds with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.hr/components/HrEmployeeActivityPanel.jsx apps/desktop/src/modules/runly.hr/components/AssignedEquipmentSection.jsx apps/desktop/src/lib/moduleComponentRegistry.js
git commit -m "feat(hr): register OrgChartSection/HistorySection/AssignedEquipmentSection as component-registry widgets"
```

---

### Task 4: `HR_EMPLOYEE_DETAIL` and `HR_EMPLOYEE_FORM` blueprints

**Files:**
- Create: `apps/desktop/src/modules/runly.hr/blueprints/hr-employee-detail.blueprint.js`
- Create: `apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js`

- [ ] **Step 1: Create the detail blueprint**

Create `apps/desktop/src/modules/runly.hr/blueprints/hr-employee-detail.blueprint.js`:

```js
const STATUS_OPTIONS = [
  { value: 'active', label: 'Activo' },
  { value: 'vacation', label: 'Vacaciones' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'terminated', label: 'Baja' },
]

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Tiempo completo' },
  { value: 'part_time', label: 'Medio tiempo' },
  { value: 'contractor', label: 'Contratista' },
  { value: 'intern', label: 'Becario' },
]

export const HR_EMPLOYEE_DETAIL = {
  key: 'hr.employee.detail',
  kind: 'DETAIL',
  schema: {
    entity: 'hrEmployee',
    component: 'RunlyDetail',
    apiPath: '/hr/employees',
    layout: 'two-column',
    hero: {
      titleField: 'firstName',
      subtitleFields: ['jobTitle', 'department'],
      statusField: 'status',
      imageDocsPath: '/files?moduleKey=runly.hr&entityType=HrEmployee&sourceEntityId=:id',
      fallbackIcon: 'User',
      metaChips: [
        { field: 'employeeCode', label: 'Código', icon: 'Hash' },
        { field: 'employmentType', label: 'Tipo', icon: 'Briefcase', type: 'select', options: EMPLOYMENT_TYPE_OPTIONS },
      ],
    },
    kpis: [
      { label: 'Antigüedad', field: 'tenureLabel', icon: 'Clock' },
      { label: 'Fecha de ingreso', field: 'hireDate', type: 'date', icon: 'Calendar' },
      { label: 'Fecha de baja', field: 'terminationDate', type: 'date', icon: 'Calendar' },
    ],
    sections: [
      {
        label: 'Datos laborales',
        icon: 'Briefcase',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'jobTitle', label: 'Puesto', icon: 'Briefcase' },
          { field: 'department', label: 'Departamento', icon: 'Building2' },
          { field: 'employmentType', label: 'Tipo de contrato', icon: 'Briefcase', type: 'select', options: EMPLOYMENT_TYPE_OPTIONS },
          { field: 'workLocation', label: 'Ubicación de trabajo', icon: 'MapPin' },
          { field: 'hireDate', label: 'Fecha de ingreso', type: 'date', icon: 'Calendar' },
          { field: 'terminationDate', label: 'Fecha de baja', type: 'date', icon: 'Calendar' },
        ],
      },
      {
        label: 'Contacto',
        icon: 'Phone',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'workEmail', label: 'Correo laboral', icon: 'Mail' },
          { field: 'personalEmail', label: 'Correo personal', icon: 'Mail' },
          { field: 'phone', label: 'Teléfono', icon: 'Phone' },
          { field: 'emergencyContactName', label: 'Contacto de emergencia', icon: 'Phone' },
          { field: 'emergencyContactPhone', label: 'Teléfono de emergencia', icon: 'Phone' },
        ],
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        column: 'main',
        fields: [{ field: 'notesMarkdown', label: 'Notas', type: 'markdown', icon: 'FileText' }],
      },
      {
        id: 'linked-user',
        type: 'relation-card',
        label: 'Cuenta de usuario vinculada',
        icon: 'UserCheck',
        column: 'aside',
        relationCard: {
          idField: 'userProfile.id',
          titleField: 'userProfile.displayName',
          subtitleFields: ['userProfile.email'],
          avatarField: 'userProfile.avatarFileId',
          fallbackTitle: 'Sin cuenta de usuario vinculada.',
          icon: 'UserCheck',
        },
      },
      {
        id: 'org-chart',
        type: 'component',
        label: 'Organigrama',
        icon: 'Users',
        column: 'aside',
        component: 'runly.hr:OrgChartSection',
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        column: 'aside',
        attachments: {
          listPath: '/files?moduleKey=runly.hr&entityType=HrEmployee&sourceEntityId=:id',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.hr', entityType: 'HrEmployee' },
          removePath: '/files/:docId',
          coverPath: '/files/:docId/cover',
          reorderPath: '/files/reorder',
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'id', fileName: 'originalName' },
          permissions: {
            read: 'hr.employee.read',
            create: 'hr.employee.update',
            remove: 'hr.employee.update',
            fileUpload: 'files.assets.create',
            fileRead: 'files.assets.read',
          },
        },
      },
      {
        id: 'assigned-equipment',
        type: 'component',
        label: 'Equipos asignados',
        icon: 'Boxes',
        column: 'aside',
        component: 'runly.hr:AssignedEquipmentSection',
      },
      {
        id: 'history',
        type: 'component',
        label: 'Actividad',
        icon: 'History',
        column: 'aside',
        component: 'runly.hr:HistorySection',
      },
    ],
  },
}

export default HR_EMPLOYEE_DETAIL
```

Notes on fields used here that Plan A must supply for this to render correctly:
- `tenureLabel` — Plan A's risk 3 calls for `getEmployee()` to expose a pre-formatted tenure string; if that isn't done, this KPI shows blank (acceptable degraded state, not a crash, since `resolveKpis` tolerates a missing field) — cross-check against Plan A before running this task's manual QA.
- `department`/`jobTitle` — now server-resolved text per Plan A Task 5, so these display correctly without any client-side relation lookup.
- The `attachments.removePath`/`coverPath`/`reorderPath` here intentionally have **no `addPath`** — this blueprint relies on Task 1's `addPath`-optional fix. If Task 1 isn't applied first, uploads in this section will fail with "Carga de documentos no disponible."
- `relation-card`'s `avatarField`/`idField` support dotted paths (`userProfile.id`) per `RelationCardSection`'s existing `getByPath` usage in `RunlyDetail.jsx` — confirmed generically supported, not HR-specific.

- [ ] **Step 2: Create the form blueprint**

Create `apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js`:

```js
const STATUS_OPTIONS = [
  { value: 'active', label: 'Activo' },
  { value: 'vacation', label: 'Vacaciones' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'terminated', label: 'Baja' },
]

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Tiempo completo' },
  { value: 'part_time', label: 'Medio tiempo' },
  { value: 'contractor', label: 'Contratista' },
  { value: 'intern', label: 'Becario' },
]

export const HR_EMPLOYEE_FORM = {
  key: 'hr.employee.form',
  kind: 'FORM',
  schema: {
    entity: 'hrEmployee',
    component: 'RunlyForm',
    apiPath: '/hr/employees',
    formMode: 'page',
    showCompletion: true,
    sections: [
      {
        label: 'Identidad',
        icon: 'User',
        fields: [
          { field: 'firstName', label: 'Nombre', type: 'text', required: true },
          { field: 'lastName', label: 'Apellido', type: 'text', required: true },
          { field: 'employeeCode', label: 'Código de colaborador', type: 'text', hint: 'Opcional' },
          { field: 'status', label: 'Estado', type: 'select', required: true, options: STATUS_OPTIONS },
          {
            field: 'userProfileId',
            label: 'Cuenta de usuario vinculada',
            type: 'relation',
            hint: 'Opcional — vincula este colaborador a una cuenta de acceso existente.',
            relation: {
              apiPath: '/identity/users',
              labelField: 'displayName',
              preload: true,
              clearable: true,
            },
          },
        ],
      },
      {
        label: 'Datos laborales',
        icon: 'Briefcase',
        fields: [
          {
            field: 'jobTitleId',
            label: 'Puesto',
            type: 'relation',
            hint: 'Para crear un puesto nuevo, ve primero a Catálogos de RH.',
            relation: {
              apiPath: '/hr/job-titles',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          {
            field: 'departmentId',
            label: 'Departamento',
            type: 'relation',
            hint: 'Para crear un departamento nuevo, ve primero a Catálogos de RH.',
            relation: {
              apiPath: '/hr/departments',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          {
            field: 'supervisorEmployeeId',
            label: 'Supervisor',
            type: 'relation',
            relation: {
              apiPath: '/hr/employees',
              labelField: 'firstName',
              preload: true,
              clearable: true,
            },
          },
          { field: 'employmentType', label: 'Tipo de contrato', type: 'select', options: EMPLOYMENT_TYPE_OPTIONS },
          { field: 'workLocation', label: 'Ubicación de trabajo', type: 'text', fullWidth: true },
          { field: 'hireDate', label: 'Fecha de ingreso', type: 'date' },
          { field: 'terminationDate', label: 'Fecha de baja', type: 'date' },
        ],
      },
      {
        label: 'Contacto',
        icon: 'Phone',
        fields: [
          { field: 'workEmail', label: 'Correo laboral', type: 'text' },
          { field: 'personalEmail', label: 'Correo personal', type: 'text' },
          { field: 'phone', label: 'Teléfono', type: 'text' },
          { field: 'emergencyContactName', label: 'Contacto de emergencia', type: 'text' },
          { field: 'emergencyContactPhone', label: 'Teléfono de emergencia', type: 'text' },
        ],
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        collapsible: true,
        defaultCollapsed: true,
        fields: [{ field: 'notesMarkdown', label: 'Notas', type: 'markdown' }],
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        collapsible: true,
        attachments: {
          listPath: '/files?moduleKey=runly.hr&entityType=HrEmployee&sourceEntityId=:id',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.hr', entityType: 'HrEmployee' },
          removePath: '/files/:docId',
          coverPath: '/files/:docId/cover',
          reorderPath: '/files/reorder',
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'id', fileName: 'originalName' },
          limits: { maxFiles: 20, maxSizeMB: 10, allowMultiple: true },
          permissions: {
            read: 'hr.employee.read',
            create: 'hr.employee.update',
            remove: 'hr.employee.update',
            fileUpload: 'files.assets.create',
            fileRead: 'files.assets.read',
          },
        },
      },
    ],
    submitLabel: 'Guardar colaborador',
    cancelLabel: 'Cancelar',
  },
}

export default HR_EMPLOYEE_FORM
```

Notes:
- No `department`/`jobTitle`/`managerName` text fields in this form — those are server-resolved now (Plan A), the form only sends the relation ids.
- No `profileImageFileId` field — the photo is uploaded through the standard attachments section and marked as cover there, same UX as Inventory.
- The `attachments` section here has **no `addPath`**, same as the detail blueprint — depends on Task 1.
- `userProfileId`'s relation `apiPath: '/identity/users'` — confirm this is the correct existing endpoint for listing linkable user accounts during Task 6's manual QA (the legacy form used a bespoke "Crear usuario" escape-hatch link rather than a full relation picker against this path; if `/identity/users` doesn't paginate/search the way `RelationSelectField` expects, this needs adjustment — flagged here rather than assumed correct, since Plan A/B's research did not verify this specific endpoint's shape).
- Per the parent spec's accepted non-goal, department/job-title relations have **no inline-create** (`relation.create` is omitted) — creating a new one requires going to HR's catalogs screen first, exactly matching Inventory's accepted precedent.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.hr/blueprints/hr-employee-detail.blueprint.js apps/desktop/src/modules/runly.hr/blueprints/hr-employee-form.blueprint.js
git commit -m "feat(hr): add HR_EMPLOYEE_DETAIL and HR_EMPLOYEE_FORM blueprints"
```

---

### Task 5: Replace the two screens; delete the legacy audit panel

**Files:**
- Modify (full rewrite): `apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx`
- Modify (full rewrite): `apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx`

- [ ] **Step 1: Confirm the exact current route params / permission-check pattern before rewriting**

Run: `grep -n "hasPermission\|useParams\|useAuth()" apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx | head -20`
Read the surrounding ~10 lines of each match — this plan's replacement screens below assume the same `useAuth()`/`userProfile.permissions`/`useParams` wildcard-route pattern already confirmed in this session's investigation (`hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k))`), but the exact route-param wildcard shape (`'*'`) must be re-confirmed against the live file before assuming the replacement below matches the router configuration exactly.

- [ ] **Step 2: Replace `HrEmployeeDetail.jsx`**

Replace the full contents of `apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx` with:

```jsx
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyDetail, LoadingState, ErrorState, ConfirmDialog, DetailActionBar } from '@runly/ui'
import { ArrowLeft, ShieldBan } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { runly } from '../../../lib/runly'
import { HR_EMPLOYEE_DETAIL } from '../blueprints/hr-employee-detail.blueprint.js'
import { componentRegistry } from '../../../lib/moduleComponentRegistry.js'

const API_BASE = getApiUrl()

export default function HrEmployeeDetail() {
  const { '*': wildcard } = useParams()
  const id = useMemo(() => (wildcard ?? '').split('/')[0] ?? null, [wildcard])
  const navigate = useNavigate()
  const [disableOpen, setDisableOpen] = useState(false)

  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()
  const queryClient = useQueryClient()

  const permissions = userProfile?.permissions ?? []
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k))
  const canUpdate = hasPermission('hr.employee.update')
  const canDelete = hasPermission('hr.employee.delete')

  const { data, isLoading } = useQuery({
    queryKey: ['hr-employee', id],
    queryFn: () => runly.hr.getEmployee(id, token),
    enabled: Boolean(token && id),
  })

  const toggleEnabledMutation = useMutation({
    mutationFn: (enabled) => runly.hr.setEmployeeEnabled(id, enabled, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-employee', id] })
      toast.success('Estado actualizado')
      setDisableOpen(false)
    },
    onError: (err) => toast.error(err?.message || 'No se pudo actualizar el estado'),
  })

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <LoadingState />
      </div>
    )
  }

  const employee = data?.data ?? data
  if (!employee) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Colaborador no encontrado" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <RunlyDetail
        blueprint={HR_EMPLOYEE_DETAIL}
        data={employee}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        onBack={() => navigate('/app/m/runly.hr/employees')}
        onEdit={canUpdate ? () => navigate(`/app/m/runly.hr/employees/${id}/edit`) : undefined}
        heroActions={
          <DetailActionBar
            primary={
              canUpdate
                ? { label: 'Editar', onClick: () => navigate(`/app/m/runly.hr/employees/${id}/edit`) }
                : null
            }
            secondary={[
              {
                label: 'Volver',
                icon: <ArrowLeft className="h-4 w-4" />,
                onClick: () => navigate('/app/m/runly.hr/employees'),
              },
              canDelete
                ? {
                    label: employee.enabled === false ? 'Habilitar' : 'Deshabilitar',
                    icon: <ShieldBan className="h-4 w-4" />,
                    onClick: () => setDisableOpen(true),
                    destructive: employee.enabled !== false,
                  }
                : null,
            ]}
          />
        }
      />

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title={employee.enabled === false ? 'Habilitar colaborador' : 'Deshabilitar colaborador'}
        description={
          employee.enabled === false
            ? `¿Habilitar a ${employee.firstName} ${employee.lastName}?`
            : `¿Deshabilitar a ${employee.firstName} ${employee.lastName}? No podrá acceder al sistema mientras esté deshabilitado.`
        }
        confirmLabel={employee.enabled === false ? 'Habilitar' : 'Deshabilitar'}
        onConfirm={() => toggleEnabledMutation.mutate(employee.enabled === false)}
      />
    </div>
  )
}
```

This deletes, by full-file replacement, every line of the old `AuditPanel`/`AuditDetailModal`/`computeDiff`/`fmtFieldValue`/`FIELD_LABELS`/`ACTION_LABELS`/`OrgChartPanel`/`FilesPanel`/`STATUS_VARIANT`/`STATUS_LABEL`/`STATUS_HERO`/`SectionCard`/`InfoRow`/`MarkdownDisplay` local definitions that lived in this file — `OrgChartPanel` was ported to Task 2's `OrgChartSection.jsx` already; everything else (the audit diff viewer specifically) is intentionally not ported anywhere, per this migration's goal 3.

- [ ] **Step 3: Replace `HrEmployeeForm.jsx`**

Replace the full contents of `apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx` with:

```jsx
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyForm, PageHeader, LoadingState, ErrorState } from '@runly/ui'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { runly } from '../../../lib/runly'
import { HR_EMPLOYEE_FORM } from '../blueprints/hr-employee-form.blueprint.js'

const API_BASE = getApiUrl()

export default function HrEmployeeForm() {
  const { '*': wildcard } = useParams()
  const id = useMemo(() => {
    const parts = (wildcard ?? '').split('/')
    return parts[1] === 'edit' ? parts[0] : null
  }, [wildcard])
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const permissions = userProfile?.permissions ?? []
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k))
  const canSubmit = isEdit
    ? hasPermission('hr.employee.update')
    : hasPermission('hr.employee.create')

  const employeeQuery = useQuery({
    queryKey: ['hr-employee', id],
    queryFn: () => runly.hr.getEmployee(id, token),
    enabled: Boolean(token && isEdit && id),
  })
  const editEmployee = employeeQuery.data?.data ?? employeeQuery.data ?? null

  if (isEdit && employeeQuery.isLoading) {
    return <LoadingState message="Cargando colaborador..." />
  }
  if (isEdit && employeeQuery.isError) {
    return <ErrorState message="No se pudo cargar el colaborador" />
  }
  if (!canSubmit) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="No tienes permiso para esta acción" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        eyebrow={isEdit ? 'Editar colaborador' : 'Recursos Humanos'}
        title={isEdit ? (editEmployee ? `${editEmployee.firstName} ${editEmployee.lastName}` : 'Editar colaborador') : 'Nuevo colaborador'}
        description={isEdit ? undefined : 'Completa la información del colaborador'}
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={HR_EMPLOYEE_FORM}
          initialData={isEdit ? editEmployee : {}}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          onSuccess={(result) => {
            const savedId = result?.data?.id ?? editEmployee?.id
            navigate(savedId ? `/app/m/runly.hr/employees/${savedId}` : '/app/m/runly.hr/employees')
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  )
}
```

This deletes, by full-file replacement, `fromEmployee`/`normalizeForApi`/`AvatarUploadZone`/the editable `FilesPanel`/`getFileKind`/`formatBytes`/`FileKindIcon`/`SectionCard`/`IL`/`createDepartmentMutation`/`createJobTitleMutation`/the combobox denormalization `onChange` handlers — all superseded by `RunlyForm` + the blueprint's `relation` fields + the standard `attachments` section.

- [ ] **Step 4: Build check**

Run: `pnpm --filter @runly/desktop build:web`
Expected: builds with no errors. Pay attention to any "X is defined but never used" warnings surfaced by the build for imports this plan may have over-included (e.g. if `Users`/`Boxes`/other lucide icons end up unused in the final files) — trim them if the build/lint flags them in Task 6.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx
git commit -m "feat(hr): migrate employee detail/form screens to RunlyDetail/RunlyForm blueprints"
```

---

### Task 6: Full frontend verification

**Files:** None (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: no new errors (fix any unused-import warnings surfaced from Task 5's rewrite before considering this done).

- [ ] **Step 2: Full workspace build**

Run: `pnpm build`
Expected: `apps/api`, `apps/desktop`, `packages/ui` all build with no errors.

- [ ] **Step 3: Manual QA — create/edit, 390px and 1440px**

With `pnpm dev` running:
- Create a new employee, filling every section, uploading a photo in the Archivos section, marking it as cover.
- Edit that employee: change department, job title, supervisor; confirm the saved record's `department`/`jobTitle`/`managerName` (visible in the detail view) reflect the new selections correctly (this is the real end-to-end check that Plan A's server-side resolution works).
- Upload a second photo and mark it as cover instead of the first; confirm the detail hero image updates to the new photo.
- Confirm no `AuditPanel`/`AuditDetailModal` component exists anywhere in the running UI — the only history view is the "Actividad" card, and it shows real field diffs for the edits just made.
- Confirm the organigrama section renders correctly for an employee with a supervisor and at least one reportee, and for one with neither.
- Confirm `DetailActionBar` shows "Editar" as primary; confirm Volver and Habilitar/Deshabilitar are visible (not hidden in a menu); confirm a user without `hr.employee.update` doesn't see "Editar".
- Repeat all of the above at 390px, checking for horizontal overflow.

- [ ] **Step 4: Regression check — Inventory and Fleet attachments still work**

Since Task 1 changed shared `useAttachmentsController.js` code, re-verify (at least once each, not full re-QA):
- Uploading/removing/setting cover on an Inventory item's attachments still works.
- Uploading/removing a Fleet vehicle document still works (Fleet has no cover feature configured, so just confirm upload/remove, not cover).

- [ ] **Step 5: Spec acceptance criteria**

Walk through all 7 acceptance criteria in `docs/superpowers/specs/2026-09-15-hr-employee-blueprint-migration-design.md` section 25 against the running app, confirming each one explicitly.
