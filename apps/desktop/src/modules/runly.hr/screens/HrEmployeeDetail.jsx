import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  MarkdownViewer,
  Skeleton,
  cn,
} from "@runly/ui";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Hash,
  Link2,
  Mail,
  MapPin,
  Phone,
  ShieldBan,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { AdvancedFileViewer } from "@runly/ui";
import HrEmployeeActivityPanel from "../components/HrEmployeeActivityPanel";
import { InventoryEmployeeWidget } from "../../runly.inventory/components/InventoryEmployeeWidget.jsx";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_VARIANT = {
  active: "success",
  vacation: "secondary",
  inactive: "outline",
  terminated: "destructive",
};

const STATUS_LABEL = {
  active: "Activo",
  vacation: "Vacaciones",
  inactive: "Inactivo",
  terminated: "Baja",
};

const STATUS_HERO = {
  active: {
    bg: "from-emerald-500/15 to-emerald-500/5",
    ring: "ring-emerald-500/40",
    dot: "bg-emerald-500",
  },
  vacation: {
    bg: "from-amber-500/15  to-amber-500/5",
    ring: "ring-amber-500/40",
    dot: "bg-amber-500",
  },
  inactive: {
    bg: "from-slate-400/10  to-slate-400/5",
    ring: "ring-slate-400/30",
    dot: "bg-slate-400",
  },
  terminated: {
    bg: "from-red-500/15    to-red-500/5",
    ring: "ring-red-500/40",
    dot: "bg-red-500",
  },
};

const EMPLOYMENT_TYPE_LABEL = {
  full_time: "Tiempo completo",
  part_time: "Medio tiempo",
  contractor: "Contratista",
  intern: "Practicante",
};

const ACTION_LABELS = {
  "hr.employee.create": "Colaborador creado",
  "hr.employee.update": "Datos actualizados",
  "hr.employee.enable": "Colaborador habilitado",
  "hr.employee.disable": "Colaborador deshabilitado",
  "hr.employee.file.attach": "Archivo adjuntado",
  "hr.employee.file.delete": "Archivo eliminado",
};

const FIELD_LABELS = {
  firstName: "Nombre",
  lastName: "Apellidos",
  employeeCode: "Codigo",
  status: "Estado",
  employmentType: "Tipo de empleo",
  workLocation: "Ubicacion",
  jobTitle: "Puesto",
  department: "Departamento",
  managerName: "Supervisor",
  workEmail: "Correo laboral",
  personalEmail: "Correo personal",
  phone: "Telefono",
  emergencyContactName: "Contacto emergencia",
  emergencyContactPhone: "Tel. emergencia",
  hireDate: "Fecha ingreso",
  terminationDate: "Fecha baja",
  userProfileId: "Cuenta de usuario",
  supervisorEmployeeId: "Supervisor (ID)",
  departmentId: "Departamento (ID)",
  jobTitleId: "Puesto (ID)",
  profileImageFileId: "Foto de perfil",
  enabled: "Habilitado",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function fmtDateShort(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { dateStyle: "medium" });
}

function fmtTenure(hireDate) {
  if (!hireDate) return null;
  const start = new Date(hireDate);
  const now = new Date();
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (months < 1) return "Menos de 1 mes";
  if (months < 12) return `${months} mes${months > 1 ? "es" : ""}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0
    ? `${years} año${years > 1 ? "s" : ""} y ${rem} mes${rem > 1 ? "es" : ""}`
    : `${years} año${years > 1 ? "s" : ""}`;
}

function getFileKind(mimeType = "") {
  const v = String(mimeType || "").toLowerCase();
  if (v.startsWith("image/")) return "image";
  if (v === "application/pdf") return "pdf";
  if (v.includes("spreadsheet") || v.includes("excel") || v.includes("csv"))
    return "sheet";
  if (v.includes("word") || v.includes("document")) return "doc";
  if (v.startsWith("text/") || v.includes("json")) return "text";
  return "generic";
}

function formatBytes(bytes = 0) {
  const n = Math.max(0, Number(bytes || 0));
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileKindIcon({ mimeType, className = "h-8 w-8" }) {
  const kind = getFileKind(mimeType);
  const Icon =
    kind === "image"
      ? FileImage
      : kind === "pdf"
        ? FileType2
        : kind === "sheet"
          ? FileSpreadsheet
          : kind === "doc" || kind === "text"
            ? FileText
            : File;
  return <Icon className={className} />;
}

function computeDiff(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    const oldStr = before[key] == null ? "—" : String(before[key]);
    const newStr = after[key] == null ? "—" : String(after[key]);
    if (oldStr !== newStr)
      changes.push({
        key,
        label: FIELD_LABELS[key] ?? key,
        oldVal: oldStr,
        newVal: newStr,
      });
  }
  return changes;
}

function fmtFieldValue(val) {
  if (val === "—") return val;
  if (val === "true") return "Sí";
  if (val === "false") return "No";
  if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
    try {
      return new Date(val).toLocaleString("es-MX", { dateStyle: "medium" });
    } catch {
      return val;
    }
  }
  return EMPLOYMENT_TYPE_LABEL[val] ?? STATUS_LABEL[val] ?? val;
}

// ── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children, className }) {
  return (
    <Card variant="solid" className={cn("p-5 space-y-4", className)}>
      {title && (
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
          )}
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            {title}
          </h3>
        </div>
      )}
      {children}
    </Card>
  );
}

// ── InfoRow ───────────────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, label, value, href }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
      )}
      <div className="min-w-0">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{label}</p>
        {href ? (
          <a
            href={href}
            className="text-sm font-medium text-[hsl(var(--primary))] hover:underline truncate block"
          >
            {value}
          </a>
        ) : (
          <p className="text-sm font-medium text-[hsl(var(--foreground))] wrap-break-word">
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

// ── MarkdownDisplay ───────────────────────────────────────────────────────────

function MarkdownDisplay({ value }) {
  return (
    <MarkdownViewer
      value={value}
      emptyText="Sin notas."
      className="[&_.tiptap]:leading-6"
    />
  );
}

// ── OrgChartPanel ─────────────────────────────────────────────────────────────

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

function OrgNode({
  firstName = "",
  lastName = "",
  jobTitle,
  status,
  isSelf,
  onClick,
}) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  const name = `${firstName} ${lastName}`.trim();
  const dot = STATUS_HERO[status]?.dot;
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
              isSelf
                ? "text-[hsl(var(--primary))]"
                : "text-[hsl(var(--foreground))]",
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
      {dot && !isSelf && (
        <div className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
      )}
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

function OrgChartPanel({ employee }) {
  const navigate = useNavigate();
  const supervisor = employee.supervisor;
  const reportees = employee.reportees ?? [];

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
              onClick={() =>
                navigate(`/app/m/runly.hr/hr/employees/${supervisor.id}`)
              }
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
          firstName={employee.firstName}
          lastName={employee.lastName}
          jobTitle={employee.jobTitle}
          status={employee.status}
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
                  onClick={() =>
                    navigate(`/app/m/runly.hr/hr/employees/${r.id}`)
                  }
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

// ── FilesPanel (read-only) ────────────────────────────────────────────────────

function FilesPanel({ employeeId, token }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const filesQuery = useQuery({
    queryKey: ["hr-employee-files", employeeId],
    queryFn: () =>
      runly.files.list(
        {
          moduleKey: "runly.hr",
          entityType: "HrEmployee",
          sourceEntityId: employeeId,
          pageSize: 100,
        },
        token,
      ),
    enabled: Boolean(token && employeeId),
  });

  const files = filesQuery.data?.data ?? [];
  const imageFiles = files.filter((f) => getFileKind(f.mimeType) === "image");

  function handleOpenViewer(file) {
    const idx = imageFiles.findIndex((f) => f.id === file.id);
    setViewerIndex(Math.max(0, idx));
    setViewerOpen(true);
  }

  return (
    <>
      <AdvancedFileViewer
        open={viewerOpen && imageFiles.length > 0}
        onOpenChange={setViewerOpen}
        files={imageFiles}
        activeIndex={viewerIndex}
        onIndexChange={setViewerIndex}
        onResolveSignedUrl={async (f) => {
          if (f.signedUrl) return f.signedUrl;
          const res = await runly.files.getSignedUrl(f.id, token);
          return res?.data?.signedUrl ?? null;
        }}
      />

      <SectionCard title="Documentos" icon={File}>
        <div className="space-y-1.5 max-h-80 overflow-auto pr-0.5">
          {filesQuery.isLoading && (
            <>
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
            </>
          )}
          {!filesQuery.isLoading && files.length === 0 && (
            <p className="text-xs text-center text-[hsl(var(--muted-foreground))] py-4">
              Sin documentos adjuntos.
            </p>
          )}
          {files.map((file) => {
            const kind = getFileKind(file.mimeType);
            const preview = kind === "image" ? (file.signedUrl ?? null) : null;
            return (
              <div
                key={file.id}
                className="group flex items-center gap-3 rounded-xl border border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]/20 px-3 py-2 hover:bg-[hsl(var(--muted))]/40 transition-colors"
              >
                <button
                  type="button"
                  onClick={() =>
                    kind === "image" ? handleOpenViewer(file) : undefined
                  }
                  className={cn(
                    "h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-[hsl(var(--border))]/60 bg-[hsl(var(--background))] overflow-hidden",
                    kind === "image" && "cursor-pointer",
                  )}
                >
                  {preview ? (
                    <img
                      src={preview}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <FileKindIcon
                      mimeType={file.mimeType}
                      className="h-4 w-4 text-[hsl(var(--muted-foreground))]"
                    />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
                    {file.originalName}
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {formatBytes(file.sizeBytes)}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {kind === "image" && (
                    <button
                      type="button"
                      onClick={() => handleOpenViewer(file)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await runly.files.getSignedUrl(
                        file.id,
                        token,
                      );
                      const url = res?.data?.signedUrl;
                      if (url) {
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = file.originalName;
                        a.click();
                      }
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

// ── AuditDetailModal ──────────────────────────────────────────────────────────

function AuditDetailModal({ log, onClose }) {
  if (!log) return null;
  const diff = computeDiff(log.before, log.after);
  const actionLabel = ACTION_LABELS[log.action] ?? log.action;
  const actor = log.actor?.displayName || log.actor?.email || "Sistema";
  const isFileEvent =
    log.action === "hr.employee.file.attach" ||
    log.action === "hr.employee.file.delete";
  const fileMeta = isFileEvent ? log.metadata : null;
  const isDelete = log.action === "hr.employee.file.delete";

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md" className="px-0 pt-0 pb-0 md:p-0 gap-0 overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[hsl(var(--border))] pr-12">
          <div>
            <p className="font-semibold text-[hsl(var(--foreground))]">
              {actionLabel}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {actor} · {fmtDate(log.createdAt)}
            </p>
          </div>
        </div>
        <div className="max-h-96 overflow-auto px-5 py-4 space-y-3">
          {fileMeta && (
            <div
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-3",
                isDelete
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-emerald-500/30 bg-emerald-500/5",
              )}
            >
              <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-lg border border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]">
                <FileKindIcon
                  mimeType={fileMeta.mimeType}
                  className={cn(
                    "h-5 w-5",
                    isDelete ? "text-red-500/70" : "text-emerald-600/70",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                  {fileMeta.originalName ?? "Archivo desconocido"}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {fileMeta.mimeType?.split("/")[1] ?? "archivo"}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full",
                  isDelete
                    ? "bg-red-500/10 text-red-500"
                    : "bg-emerald-500/10 text-emerald-600",
                )}
              >
                {isDelete ? "Eliminado" : "Adjuntado"}
              </span>
            </div>
          )}
          {!fileMeta && diff.length === 0 && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-4">
              Sin detalle de cambios disponible.
            </p>
          )}
          {diff.map((change, i) => (
            <div
              key={change.key}
              className={cn(
                "py-3 grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 text-sm",
                i < diff.length - 1 &&
                  "border-b border-[hsl(var(--border))]/50",
              )}
            >
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))] pt-0.5">
                {change.label}
              </span>
              <div className="space-y-1 min-w-0">
                {change.oldVal !== "—" && (
                  <div className="flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0 h-2 w-2 rounded-full bg-red-400/70" />
                    <span className="text-xs text-[hsl(var(--muted-foreground))] line-through wrap-break-word">
                      {fmtFieldValue(change.oldVal)}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0 h-2 w-2 rounded-full bg-emerald-400/70" />
                  <span className="text-xs text-[hsl(var(--foreground))] wrap-break-word font-medium">
                    {fmtFieldValue(change.newVal)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── AuditPanel ────────────────────────────────────────────────────────────────

function AuditPanel({ employeeId, token }) {
  const [selectedLog, setSelectedLog] = useState(null);

  const auditQuery = useQuery({
    queryKey: ["hr-employee-audit", employeeId],
    queryFn: () => runly.hr.getEmployeeAudit(employeeId, token, { limit: 50 }),
    enabled: Boolean(token && employeeId),
  });

  const logs = auditQuery.data?.data ?? [];

  return (
    <>
      {selectedLog && (
        <AuditDetailModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}

      <SectionCard title="Historial de cambios" icon={Clock}>
        <div className="space-y-1.5 max-h-72 overflow-auto pr-0.5">
          {auditQuery.isLoading && (
            <>
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
            </>
          )}
          {logs.map((log) => {
            const isFileEvent =
              log.action === "hr.employee.file.attach" ||
              log.action === "hr.employee.file.delete";
            const hasDiff = Boolean(log.before || log.after) || isFileEvent;
            const actionLabel = ACTION_LABELS[log.action] ?? log.action;
            const actor =
              log.actor?.displayName || log.actor?.email || "Sistema";
            return (
              <button
                key={log.id}
                type="button"
                onClick={() => hasDiff && setSelectedLog(log)}
                className={cn(
                  "w-full rounded-xl border border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]/20 px-3 py-2.5 text-left transition-colors",
                  hasDiff
                    ? "hover:bg-[hsl(var(--muted))]/50 hover:border-[hsl(var(--border))] cursor-pointer"
                    : "cursor-default",
                )}
              >
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
                      {actionLabel}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {actor} · {fmtDate(log.createdAt)}
                    </p>
                  </div>
                  {hasDiff && (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  )}
                </div>
              </button>
            );
          })}
          {!auditQuery.isLoading && logs.length === 0 && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] text-center py-3">
              Sin cambios registrados.
            </p>
          )}
        </div>
      </SectionCard>
    </>
  );
}

// ── HrEmployeeDetail ──────────────────────────────────────────────────────────

export default function HrEmployeeDetail({ employeeId }) {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) =>
    Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canUpdate = hasPermission("hr.employee.update");

  const employeeQuery = useQuery({
    queryKey: ["hr-employee", employeeId],
    queryFn: () => runly.hr.getEmployee(employeeId, token),
    enabled: Boolean(token && employeeId),
  });

  const employee = employeeQuery.data?.data ?? null;

  const profileImageQuery = useQuery({
    queryKey: ["hr-profile-image-url", employee?.profileImageFileId],
    queryFn: async () => {
      const res = await runly.files.getSignedUrl(
        employee.profileImageFileId,
        token,
      );
      return res?.data?.signedUrl ?? "";
    },
    enabled: Boolean(token && employee?.profileImageFileId),
    staleTime: 2 * 60 * 1000,
  });

  const userAvatarQuery = useQuery({
    queryKey: ["hr-user-avatar", employee?.userProfile?.id],
    queryFn: async () => {
      const res = await runly.identity.getUserAvatarSignedUrl(
        employee.userProfile.id,
        token,
        { variant: "card" },
      );
      return res?.data?.signedUrl ?? "";
    },
    enabled: Boolean(
      token && employee?.userProfile?.id && employee?.userProfile?.avatarFileId,
    ),
    staleTime: 2 * 60 * 1000,
  });

  const [enabledConfirm, setEnabledConfirm] = useState(false);

  const toggleEnabledMutation = useMutation({
    mutationFn: (enabled) =>
      runly.hr.setEmployeeEnabled(employee.id, enabled, token),
    onMutate: (enabled) =>
      toast.loading(
        enabled
          ? "Habilitando colaborador..."
          : "Deshabilitando colaborador...",
      ),
    onSuccess: (_, enabled, toastId) => {
      toast.success(
        enabled ? "Colaborador habilitado" : "Colaborador deshabilitado",
        { id: toastId },
      );
      queryClient.invalidateQueries({ queryKey: ["hr-employees"] });
      queryClient.invalidateQueries({ queryKey: ["hr-employee", employeeId] });
      setEnabledConfirm(false);
    },
    onError: (_, enabled, toastId) =>
      toast.error(
        enabled
          ? "No se pudo habilitar el colaborador"
          : "No se pudo deshabilitar el colaborador",
        { id: toastId },
      ),
  });

  if (employeeQuery.isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-5"
      >
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-36 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
          <Skeleton className="h-52 rounded-2xl" />
        </div>
      </motion.div>
    );
  }

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Colaborador no encontrado.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/app/m/runly.hr/hr/employees")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
      </div>
    );
  }

  const hero = STATUS_HERO[employee.status] ?? STATUS_HERO.active;
  const initials =
    `${employee.firstName?.[0] ?? ""}${employee.lastName?.[0] ?? ""}`.toUpperCase();
  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  const tenure = fmtTenure(employee.hireDate);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-5"
    >
      {/* enable/disable confirm dialog */}
      <ConfirmDialog
        open={enabledConfirm}
        onOpenChange={setEnabledConfirm}
        title={
          employee?.enabled
            ? "Deshabilitar colaborador"
            : "Habilitar colaborador"
        }
        description={
          employee?.enabled
            ? `¿Deseas deshabilitar a ${fullName}? No podrá acceder al sistema mientras esté deshabilitado.`
            : `¿Deseas habilitar nuevamente a ${fullName}?`
        }
        confirmLabel={employee?.enabled ? "Deshabilitar" : "Habilitar"}
        onConfirm={() => toggleEnabledMutation.mutate(!employee.enabled)}
        loading={toggleEnabledMutation.isPending}
      />

      {/* back */}
      <button
        type="button"
        onClick={() => navigate("/app/m/runly.hr/hr/employees")}
        className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Colaboradores
      </button>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          "rounded-2xl border border-[hsl(var(--border))] bg-linear-to-br p-6",
          hero.bg,
        )}
      >
        <div className="flex flex-wrap items-start gap-5">
          {/* avatar — no status dot */}
          <div
            className={cn(
              "flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-2",
              hero.ring,
            )}
          >
            {profileImageQuery.data ? (
              <img
                src={profileImageQuery.data}
                alt={fullName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] text-2xl font-bold">
                {initials || <User className="h-8 w-8" />}
              </div>
            )}
          </div>

          {/* identity */}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">
              {fullName}
            </h1>
            {employee.jobTitle && (
              <p className="text-sm text-[hsl(var(--foreground))]/70 mt-0.5">
                {employee.jobTitle}
              </p>
            )}
            {employee.department && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {employee.department}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Badge variant={STATUS_VARIANT[employee.status] ?? "outline"}>
                {STATUS_LABEL[employee.status] ?? employee.status}
              </Badge>
              {!employee.enabled && (
                <Badge variant="destructive" className="text-xs">
                  Deshabilitado
                </Badge>
              )}
              {employee.employmentType && (
                <Badge variant="outline" className="text-xs">
                  {EMPLOYMENT_TYPE_LABEL[employee.employmentType] ??
                    employee.employmentType}
                </Badge>
              )}
              {employee.employeeCode && (
                <Badge variant="secondary" className="text-xs">
                  <Hash className="mr-1 h-3 w-3" />
                  {employee.employeeCode}
                </Badge>
              )}
              {tenure && employee.hireDate && (
                <Badge variant="outline" className="text-xs">
                  <Calendar className="mr-1 h-3 w-3" />
                  {tenure}
                </Badge>
              )}
            </div>
          </div>

          {/* actions */}
          <div className="flex items-center gap-2 shrink-0">
            {canUpdate && (
              <Button
                variant="outline"
                onClick={() =>
                  navigate(`/app/m/runly.hr/hr/employees/${employeeId}/edit`)
                }
              >
                <Edit3 className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
            {canUpdate && (
              <Button
                variant="outline"
                disabled={toggleEnabledMutation.isPending}
                onClick={() => setEnabledConfirm(true)}
              >
                {toggleEnabledMutation.isPending ? (
                  <span className="mr-2 h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                ) : (
                  <ShieldBan className="mr-2 h-4 w-4" />
                )}
                {employee.enabled ? "Deshabilitar" : "Habilitar"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── BODY: two columns ─────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* LEFT COLUMN */}
        <div className="space-y-5">
          {/* user account card */}
          {employee.userProfile && (
            <SectionCard title="Cuenta de usuario vinculada" icon={Link2}>
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[hsl(var(--muted))] ring-1 ring-[hsl(var(--border))]">
                  {userAvatarQuery.data ? (
                    <img
                      src={userAvatarQuery.data}
                      alt={employee.userProfile.displayName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-base font-bold text-[hsl(var(--muted-foreground))]">
                      {employee.userProfile.displayName?.[0]?.toUpperCase() ?? (
                        <User className="h-5 w-5" />
                      )}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
                    {employee.userProfile.displayName}
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                    {employee.userProfile.email}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">
                  Vinculado
                </Badge>
              </div>
            </SectionCard>
          )}

          {/* work info */}
          <SectionCard title="Datos laborales" icon={Briefcase}>
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoRow
                icon={Briefcase}
                label="Puesto"
                value={employee.jobTitle}
              />
              <InfoRow
                icon={Building2}
                label="Departamento"
                value={employee.department}
              />
              {employee.employmentType && (
                <InfoRow
                  icon={User}
                  label="Tipo de empleo"
                  value={EMPLOYMENT_TYPE_LABEL[employee.employmentType]}
                />
              )}
              <InfoRow
                icon={MapPin}
                label="Ubicacion"
                value={employee.workLocation}
              />
              <InfoRow
                icon={Calendar}
                label="Fecha de ingreso"
                value={fmtDateShort(employee.hireDate)}
              />
              {employee.terminationDate && (
                <InfoRow
                  icon={Calendar}
                  label="Fecha de baja"
                  value={fmtDateShort(employee.terminationDate)}
                />
              )}
            </div>
          </SectionCard>

          {/* contact */}
          <SectionCard title="Contacto" icon={Mail}>
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoRow
                icon={Mail}
                label="Correo laboral"
                value={employee.workEmail}
                href={
                  employee.workEmail ? `mailto:${employee.workEmail}` : null
                }
              />
              <InfoRow
                icon={Mail}
                label="Correo personal"
                value={employee.personalEmail}
                href={
                  employee.personalEmail
                    ? `mailto:${employee.personalEmail}`
                    : null
                }
              />
              <InfoRow
                icon={Phone}
                label="Telefono"
                value={employee.phone}
                href={employee.phone ? `tel:${employee.phone}` : null}
              />
            </div>

            {(employee.emergencyContactName ||
              employee.emergencyContactPhone) && (
              <div className="pt-3 border-t border-[hsl(var(--border))]">
                <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest mb-3">
                  Contacto de emergencia
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow
                    icon={User}
                    label="Nombre"
                    value={employee.emergencyContactName}
                  />
                  <InfoRow
                    icon={Phone}
                    label="Telefono"
                    value={employee.emergencyContactPhone}
                    href={
                      employee.emergencyContactPhone
                        ? `tel:${employee.emergencyContactPhone}`
                        : null
                    }
                  />
                </div>
              </div>
            )}
          </SectionCard>

          {/* notes */}
          {employee.notesMarkdown?.trim() && (
            <SectionCard title="Notas">
              <MarkdownDisplay value={employee.notesMarkdown} />
            </SectionCard>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-5">
          <OrgChartPanel employee={employee} />
          {/* Files - key forces remount on employee change to clear cache */}
          <FilesPanel key={employeeId} employeeId={employeeId} token={token} />
          <InventoryEmployeeWidget employeeId={employeeId} />
          <HrEmployeeActivityPanel employeeId={employeeId} token={token} />
          <AuditPanel employeeId={employeeId} token={token} />
        </div>
      </div>
    </motion.div>
  );
}
