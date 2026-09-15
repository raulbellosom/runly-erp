import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ComboboxField,
  ConfirmDialog,
  CreatableComboboxField,
  DatePickerField,
  DistDropZone,
  MarkdownField,
  SelectField,
  Skeleton,
  TextField,
  cn,
} from "@runly/ui";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  Download,
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
  MessageSquare,
  Phone,
  Save,
  Shield,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { AdvancedFileViewer } from "@runly/ui";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "active", label: "Activo" },
  { value: "inactive", label: "Inactivo" },
  { value: "vacation", label: "Vacaciones" },
  { value: "terminated", label: "Baja" },
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: "Tiempo completo" },
  { value: "part_time", label: "Medio tiempo" },
  { value: "contractor", label: "Contratista" },
  { value: "intern", label: "Practicante" },
];

const STATUS_RING = {
  active: "ring-emerald-500/60",
  vacation: "ring-amber-500/60",
  inactive: "ring-slate-400/40",
  terminated: "ring-red-500/60",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseForm() {
  return {
    employeeCode: "",
    userProfileId: "",
    supervisorEmployeeId: "",
    departmentId: "",
    jobTitleId: "",
    profileImageFileId: "",
    firstName: "",
    lastName: "",
    workEmail: "",
    personalEmail: "",
    phone: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    jobTitle: "",
    department: "",
    managerName: "",
    employmentType: "",
    workLocation: "",
    hireDate: "",
    terminationDate: "",
    status: "active",
    notesMarkdown: "",
  };
}

function fromEmployee(row) {
  return {
    employeeCode: row?.employeeCode ?? "",
    userProfileId: row?.userProfileId ?? "",
    supervisorEmployeeId: row?.supervisorEmployeeId ?? "",
    departmentId: row?.departmentId ?? "",
    jobTitleId: row?.jobTitleId ?? "",
    profileImageFileId: row?.profileImageFileId ?? "",
    firstName: row?.firstName ?? "",
    lastName: row?.lastName ?? "",
    workEmail: row?.workEmail ?? "",
    personalEmail: row?.personalEmail ?? "",
    phone: row?.phone ?? "",
    emergencyContactName: row?.emergencyContactName ?? "",
    emergencyContactPhone: row?.emergencyContactPhone ?? "",
    jobTitle: row?.jobTitle ?? "",
    department: row?.department ?? "",
    managerName: row?.managerName ?? "",
    employmentType: row?.employmentType ?? "",
    workLocation: row?.workLocation ?? "",
    hireDate: row?.hireDate
      ? // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date calendar value
        new Date(row.hireDate).toISOString().slice(0, 10)
      : "",
    terminationDate: row?.terminationDate
      ? // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date calendar value
        new Date(row.terminationDate).toISOString().slice(0, 10)
      : "",
    status: row?.status ?? "active",
    notesMarkdown: row?.notesMarkdown ?? "",
  };
}

function normalizeForApi(form) {
  return {
    ...form,
    hireDate: form.hireDate ? `${form.hireDate}T00:00:00.000Z` : "",
    terminationDate: form.terminationDate
      ? `${form.terminationDate}T00:00:00.000Z`
      : "",
    employmentType: form.employmentType || undefined,
    userProfileId: form.userProfileId || null,
    supervisorEmployeeId: form.supervisorEmployeeId || null,
    departmentId: form.departmentId || null,
    jobTitleId: form.jobTitleId || null,
    profileImageFileId: form.profileImageFileId || null,
  };
}

// ── File helpers ──────────────────────────────────────────────────────────────

const MAX_FILE_MB = 10;

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

function FileKindIcon({ mimeType, className = "h-4 w-4" }) {
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

// ── FilesPanel (editable) ─────────────────────────────────────────────────────

function FilesPanel({ employeeId, token }) {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [previewMap, setPreviewMap] = useState(() => new Map());
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const signedUrlCache = useRef(new Map());

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

  const uploadMutation = useMutation({
    mutationFn: async (filesToUpload) => {
      for (const file of filesToUpload) {
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          throw new Error(
            `"${file.name}" supera el límite de ${MAX_FILE_MB} MB.`,
          );
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("moduleKey", "runly.hr");
        fd.append("entityType", "HrEmployee");
        fd.append("entityId", employeeId);
        await runly.files.upload(fd, token);
      }
    },
    onMutate: () => toast.loading("Subiendo archivo(s)..."),
    onSuccess: (_data, _vars, toastId) => {
      toast.success("Archivos subidos", { id: toastId });
      queryClient.invalidateQueries({
        queryKey: ["hr-employee-files", employeeId],
      });
      queryClient.invalidateQueries({
        queryKey: ["hr-employee-audit", employeeId],
      });
    },
    onError: (err, _vars, toastId) =>
      toast.error(err?.message || "No se pudieron subir los archivos", {
        id: toastId,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId) => runly.files.delete(fileId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["hr-employee-files", employeeId],
      });
      queryClient.invalidateQueries({
        queryKey: ["hr-employee-audit", employeeId],
      });
      toast.success("Archivo eliminado");
      setDeleteTarget(null);
    },
    onError: () => toast.error("No se pudo eliminar el archivo"),
  });

  useEffect(() => {
    if (!token) return;
    const files = filesQuery.data?.data ?? [];
    const uncached = files
      .filter(
        (f) =>
          getFileKind(f.mimeType) === "image" &&
          !previewMap.has(f.id) &&
          !signedUrlCache.current.has(f.id),
      )
      .map((f) => f.id);
    if (uncached.length === 0) return;
    runly.files
      .batchSignedUrls(uncached, token)
      .then((res) => {
        const urlMap = res?.data ?? {};
        uncached.forEach((id) => {
          if (urlMap[id]) signedUrlCache.current.set(id, urlMap[id]);
        });
        setPreviewMap((prev) => {
          const next = new Map(prev);
          uncached.forEach((id) => {
            if (urlMap[id]) next.set(id, urlMap[id]);
          });
          return next;
        });
      })
      .catch(() => {});
  }, [filesQuery.data, token, previewMap]);

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
          if (previewMap.has(f.id)) return previewMap.get(f.id);
          const res = await runly.files.getSignedUrl(f.id, token);
          return res?.data?.signedUrl ?? null;
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Eliminar archivo"
        description={`¿Eliminar ${deleteTarget?.originalName}?`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
      />

      <SectionCard title="Documentos" className="border-dashed">
        <DistDropZone
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          maxSizeMB={MAX_FILE_MB}
          fullScreenOverlay
          overlayLabel="Suelta los archivos aqui"
          overlayHint="Imágenes, PDF, documentos"
          isUploading={uploadMutation.isPending}
          onFiles={(files) => uploadMutation.mutate(files)}
          emptyLabel="Arrastra archivos o clic para subir"
          emptyHint={`Imágenes, PDF, documentos · Máx ${MAX_FILE_MB} MB`}
          dragActiveLabel="Suelta los archivos aqui"
        />

        <div className="space-y-1.5 max-h-64 overflow-auto pr-0.5">
          {filesQuery.isLoading && (
            <>
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
            </>
          )}
          {!filesQuery.isLoading && files.length === 0 && (
            <p className="text-xs text-center text-[hsl(var(--muted-foreground))] py-3">
              Sin documentos adjuntos.
            </p>
          )}
          {files.map((file) => {
            const kind = getFileKind(file.mimeType);
            const preview = kind === "image" ? previewMap.get(file.id) : null;
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
                    <FileKindIcon mimeType={file.mimeType} />
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
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(file)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-red-500/10 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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

// ── IconLabel ─────────────────────────────────────────────────────────────────

function IL({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
      {children}
    </span>
  );
}

// ── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({ title, children, className }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 space-y-4",
        className,
      )}
    >
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── AvatarUploadZone ──────────────────────────────────────────────────────────

function AvatarUploadZone({
  profileImageUrl,
  uploading,
  onUpload,
  status,
  disabled,
}) {
  const ring = STATUS_RING[status] ?? STATUS_RING.active;
  if (disabled) {
    return (
      <div
        className={cn(
          "relative w-24 h-24 rounded-2xl overflow-hidden bg-muted ring-2 shrink-0",
          ring,
        )}
      >
        {profileImageUrl ? (
          <img
            src={profileImageUrl}
            alt="Foto de perfil"
            className="h-full w-full object-cover"
          />
        ) : (
          <User className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground" />
        )}
      </div>
    );
  }
  return (
    <DistDropZone
      variant="avatar"
      accept="image/*"
      maxSizeMB={10}
      src={profileImageUrl}
      isUploading={uploading}
      onFile={onUpload}
      emptyLabel="Clic para cambiar"
      className={cn("bg-muted ring-2 shrink-0", ring)}
    />
  );
}

// ── HrEmployeeForm ────────────────────────────────────────────────────────────

export default function HrEmployeeForm({ employeeId }) {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) =>
    Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canCreate = hasPermission("hr.employee.create");
  const canUpdate = hasPermission("hr.employee.update");

  const isNew = !employeeId;
  const prevIdRef = useRef(null);
  const [form, setForm] = useState(baseForm());

  // ── data queries ──────────────────────────────────────────────────────────

  const employeeQuery = useQuery({
    queryKey: ["hr-employee", employeeId],
    queryFn: () => runly.hr.getEmployee(employeeId, token),
    enabled: Boolean(token && employeeId),
  });
  const selected = employeeQuery.data?.data ?? null;

  const profileImageQuery = useQuery({
    queryKey: ["hr-profile-image-url", selected?.profileImageFileId],
    queryFn: async () => {
      const res = await runly.files.getSignedUrl(
        selected.profileImageFileId,
        token,
      );
      return res?.data?.signedUrl ?? "";
    },
    enabled: Boolean(token && selected?.profileImageFileId),
    staleTime: 2 * 60 * 1000,
  });

  const userOptionsQuery = useQuery({
    queryKey: ["hr-user-options"],
    queryFn: () => runly.hr.listUserOptions(token, { limit: 100 }),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });
  const employeesQuery = useQuery({
    queryKey: ["hr-employees-all"],
    queryFn: () => runly.hr.listEmployees(token, { limit: 500, enabled: true }),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });
  const departmentsQuery = useQuery({
    queryKey: ["hr-departments"],
    queryFn: () =>
      runly.hr.listDepartments(token, { limit: 200, enabled: true }),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });
  const jobTitlesQuery = useQuery({
    queryKey: ["hr-job-titles"],
    queryFn: () => runly.hr.listJobTitles(token, { limit: 200, enabled: true }),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });

  // ── options ───────────────────────────────────────────────────────────────

  const userOptions = useMemo(
    () =>
      (userOptionsQuery.data?.data ?? []).map((r) => ({
        value: r.id,
        label: `${r.label} (${r.email})`,
      })),
    [userOptionsQuery.data],
  );
  const departmentOptions = useMemo(
    () =>
      (departmentsQuery.data?.data ?? []).map((row) => ({
        value: row.id,
        label: row.name,
      })),
    [departmentsQuery.data],
  );
  const jobTitleOptions = useMemo(
    () =>
      (jobTitlesQuery.data?.data ?? []).map((row) => ({
        value: row.id,
        label: row.name,
      })),
    [jobTitlesQuery.data],
  );
  const supervisorOptions = useMemo(
    () =>
      (employeesQuery.data?.data ?? [])
        .filter((row) => row.id !== selected?.id)
        .map((row) => ({
          value: row.id,
          label: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
        })),
    [employeesQuery.data, selected?.id],
  );

  // ── sync form on load ─────────────────────────────────────────────────────

  useEffect(() => {
    if (selected && selected.id !== prevIdRef.current) {
      prevIdRef.current = selected.id;
      setForm(fromEmployee(selected));
    }
  }, [selected]);

  // ── mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = normalizeForApi(form);
      if (isNew) return runly.hr.createEmployee(payload, token);
      return runly.hr.updateEmployee(selected.id, payload, token);
    },
    onMutate: () =>
      toast.loading(isNew ? "Creando colaborador..." : "Guardando cambios..."),
    onSuccess: (res, _vars, toastId) => {
      const savedId = res?.data?.id ?? selected?.id;
      toast.success(isNew ? "Colaborador creado" : "Cambios guardados", {
        id: toastId,
      });
      queryClient.invalidateQueries({ queryKey: ["hr-employees"] });
      queryClient.invalidateQueries({ queryKey: ["hr-employee", employeeId] });
      navigate(`/app/m/runly.hr/hr/employees/${savedId}`);
    },
    onError: (err, _vars, toastId) => {
      toast.error(err?.message || "No se pudo guardar el colaborador", {
        id: toastId,
      });
    },
  });

  const uploadProfileImageMutation = useMutation({
    mutationFn: async (file) => {
      if (!selected?.id)
        throw new Error("Primero guarda el colaborador para cargar la foto.");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("moduleKey", "runly.hr");
      fd.append("entityType", "HrEmployee");
      fd.append("entityId", selected.id);
      const upload = await runly.files.upload(fd, token);
      const fileId = upload?.data?.id;
      if (!fileId) throw new Error("No se pudo procesar la foto.");
      await runly.hr.updateEmployee(
        selected.id,
        normalizeForApi({
          ...fromEmployee(selected),
          profileImageFileId: fileId,
        }),
        token,
      );
      return fileId;
    },
    onMutate: () => toast.loading("Subiendo foto de perfil..."),
    onSuccess: (fileId, _vars, toastId) => {
      toast.success("Foto actualizada", { id: toastId });
      setForm((prev) => ({ ...prev, profileImageFileId: fileId }));
      queryClient.invalidateQueries({ queryKey: ["hr-employee", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["hr-profile-image-url"] });
    },
    onError: (err, _vars, toastId) => {
      toast.error(err?.message || "No se pudo actualizar la foto", {
        id: toastId,
      });
    },
  });

  const createDepartmentMutation = useMutation({
    mutationFn: (name) =>
      runly.hr.createDepartment({ name: name.trim() }, token),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["hr-departments"] });
      const created = res?.data;
      if (created?.id) {
        setForm((prev) => ({
          ...prev,
          departmentId: created.id,
          department: created.name ?? prev.department,
        }));
      }
      toast.success("Departamento creado");
    },
    onError: (err) =>
      toast.error(err?.message || "No se pudo crear el departamento"),
  });

  const createJobTitleMutation = useMutation({
    mutationFn: (name) => runly.hr.createJobTitle({ name: name.trim() }, token),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["hr-job-titles"] });
      const created = res?.data;
      if (created?.id) {
        setForm((prev) => ({
          ...prev,
          jobTitleId: created.id,
          jobTitle: created.name ?? prev.jobTitle,
        }));
      }
      toast.success("Puesto creado");
    },
    onError: (err) => toast.error(err?.message || "No se pudo crear el puesto"),
  });

  // ── derived state ─────────────────────────────────────────────────────────

  const isBusy = saveMutation.isPending || uploadProfileImageMutation.isPending;
  const title = isNew
    ? "Nuevo colaborador"
    : selected
      ? `Editar: ${selected.firstName} ${selected.lastName}`.trim()
      : "Editar colaborador";

  function setField(key) {
    return (e) => setForm((p) => ({ ...p, [key]: e.target.value }));
  }

  function handleCancel() {
    if (isNew) navigate("/app/m/runly.hr/hr/employees");
    else navigate(`/app/m/runly.hr/hr/employees/${employeeId}`);
  }

  const canSubmit = isNew ? canCreate : canUpdate;

  if (!isNew && employeeQuery.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 rounded-xl bg-[hsl(var(--muted))]" />
        <div className="h-48 rounded-2xl bg-[hsl(var(--muted))]" />
        <div className="h-40 rounded-2xl bg-[hsl(var(--muted))]" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-5 max-w-4xl"
    >
      {/* header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Colaboradores
          </button>
          <span className="text-[hsl(var(--muted-foreground))]">/</span>
          <h1 className="text-base font-semibold text-[hsl(var(--foreground))]">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isBusy}>
            <X className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
          {canSubmit && (
            <Button onClick={() => saveMutation.mutate()} disabled={isBusy}>
              {saveMutation.isPending ? (
                <span className="mr-2 h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          )}
        </div>
      </div>

      {/* ── IDENTIDAD ──────────────────────────────────────────────── */}
      <SectionCard title="Identidad">
        <div className="flex gap-6">
          {/* avatar */}
          {!isNew && (
            <AvatarUploadZone
              profileImageUrl={profileImageQuery.data}
              uploading={uploadProfileImageMutation.isPending}
              onUpload={(file) => uploadProfileImageMutation.mutate(file)}
              status={form.status}
              disabled={isBusy}
            />
          )}
          {/* fields grid */}
          <div className="flex-1 grid gap-3 sm:grid-cols-2">
            <TextField
              label={<IL icon={User}>Nombre(s)</IL>}
              value={form.firstName}
              onChange={setField("firstName")}
              disabled={isBusy}
              required
            />
            <TextField
              label={<IL icon={User}>Apellidos</IL>}
              value={form.lastName}
              onChange={setField("lastName")}
              disabled={isBusy}
              required
            />
            <TextField
              label={<IL icon={Hash}>Codigo de colaborador</IL>}
              value={form.employeeCode}
              onChange={setField("employeeCode")}
              disabled={isBusy}
              placeholder="EMP-001"
            />
            <SelectField
              label={<IL icon={Shield}>Estado</IL>}
              value={form.status || "active"}
              options={STATUS_OPTIONS}
              onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}
              disabled={isBusy}
            />
          </div>
        </div>

        {/* user account */}
        <div className="pt-2 border-t border-[hsl(var(--border))]">
          <ComboboxField
            label={<IL icon={Link2}>Cuenta de usuario vinculada</IL>}
            value={form.userProfileId || "__none__"}
            options={[
              { value: "__none__", label: "Sin vincular" },
              ...userOptions,
            ]}
            onChange={(v) =>
              setForm((p) => ({
                ...p,
                userProfileId: v === "__none__" ? "" : v,
              }))
            }
            placeholder="Seleccionar cuenta..."
            searchPlaceholder="Buscar usuario..."
            disabled={isBusy}
          />
          <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            Vinculacion opcional con cuenta de usuario para trazabilidad y
            permisos.{" "}
            <button
              type="button"
              className="font-medium text-[hsl(var(--primary))] hover:underline"
              onClick={() =>
                navigate("/app/m/runly.identity/identity/users/new")
              }
            >
              Crear usuario
            </button>
          </p>
        </div>
      </SectionCard>

      {/* ── DATOS LABORALES ────────────────────────────────────────── */}
      <SectionCard title="Datos laborales">
        <div className="grid gap-3 sm:grid-cols-2">
          <CreatableComboboxField
            label={<IL icon={Briefcase}>Puesto</IL>}
            value={form.jobTitleId || "__none__"}
            options={[
              { value: "__none__", label: "Sin asignar" },
              ...jobTitleOptions,
            ]}
            onChange={(v) => {
              const opt = jobTitleOptions.find((o) => o.value === v);
              setForm((p) => ({
                ...p,
                jobTitleId: v === "__none__" ? "" : v,
                jobTitle: v === "__none__" ? "" : (opt?.label ?? p.jobTitle),
              }));
            }}
            onCreate={(name) => createJobTitleMutation.mutate(name)}
            isCreating={createJobTitleMutation.isPending}
            placeholder="Seleccionar puesto..."
            searchPlaceholder="Buscar o crear puesto..."
            disabled={isBusy}
          />
          <CreatableComboboxField
            label={<IL icon={Building2}>Departamento</IL>}
            value={form.departmentId || "__none__"}
            options={[
              { value: "__none__", label: "Sin asignar" },
              ...departmentOptions,
            ]}
            onChange={(v) => {
              const opt = departmentOptions.find((o) => o.value === v);
              setForm((p) => ({
                ...p,
                departmentId: v === "__none__" ? "" : v,
                department:
                  v === "__none__" ? "" : (opt?.label ?? p.department),
              }));
            }}
            onCreate={(name) => createDepartmentMutation.mutate(name)}
            isCreating={createDepartmentMutation.isPending}
            placeholder="Seleccionar departamento..."
            searchPlaceholder="Buscar o crear departamento..."
            disabled={isBusy}
          />
          <ComboboxField
            label={<IL icon={Users}>Supervisor</IL>}
            value={form.supervisorEmployeeId || "__none__"}
            options={[
              { value: "__none__", label: "Sin supervisor" },
              ...supervisorOptions,
            ]}
            onChange={(v) => {
              const opt = supervisorOptions.find((o) => o.value === v);
              setForm((p) => ({
                ...p,
                supervisorEmployeeId: v === "__none__" ? "" : v,
                managerName:
                  v === "__none__" ? "" : (opt?.label ?? p.managerName),
              }));
            }}
            placeholder="Seleccionar supervisor..."
            searchPlaceholder="Buscar colaborador..."
            disabled={isBusy}
          />
          <SelectField
            label={<IL icon={User}>Tipo de empleo</IL>}
            value={form.employmentType || "__none__"}
            options={[
              { value: "__none__", label: "Sin especificar" },
              ...EMPLOYMENT_TYPE_OPTIONS,
            ]}
            onValueChange={(v) =>
              setForm((p) => ({
                ...p,
                employmentType: v === "__none__" ? "" : v,
              }))
            }
            disabled={isBusy}
          />
          <TextField
            label={<IL icon={MapPin}>Ubicacion de trabajo</IL>}
            value={form.workLocation}
            onChange={setField("workLocation")}
            disabled={isBusy}
            className="sm:col-span-2"
          />
          <DatePickerField
            label={<IL icon={Calendar}>Fecha de ingreso</IL>}
            value={form.hireDate}
            onChange={(val) => setForm((p) => ({ ...p, hireDate: val ?? "" }))}
            disabled={isBusy}
          />
          <DatePickerField
            label={<IL icon={Calendar}>Fecha de baja</IL>}
            value={form.terminationDate}
            onChange={(val) =>
              setForm((p) => ({ ...p, terminationDate: val ?? "" }))
            }
            disabled={isBusy}
          />
        </div>
      </SectionCard>

      {/* ── CONTACTO ───────────────────────────────────────────────── */}
      <SectionCard title="Contacto">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={<IL icon={Mail}>Correo laboral</IL>}
            value={form.workEmail}
            onChange={setField("workEmail")}
            disabled={isBusy}
          />
          <TextField
            label={<IL icon={Mail}>Correo personal</IL>}
            value={form.personalEmail}
            onChange={setField("personalEmail")}
            disabled={isBusy}
          />
          <TextField
            label={<IL icon={Phone}>Telefono</IL>}
            value={form.phone}
            onChange={setField("phone")}
            disabled={isBusy}
          />
        </div>
        <div className="pt-3 border-t border-[hsl(var(--border))]">
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-widest mb-3">
            Contacto de emergencia
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={<IL icon={User}>Nombre</IL>}
              value={form.emergencyContactName}
              onChange={setField("emergencyContactName")}
              disabled={isBusy}
            />
            <TextField
              label={<IL icon={Phone}>Telefono</IL>}
              value={form.emergencyContactPhone}
              onChange={setField("emergencyContactPhone")}
              disabled={isBusy}
            />
          </div>
        </div>
      </SectionCard>

      {/* ── NOTAS ──────────────────────────────────────────────────── */}
      <SectionCard title="Notas" className="pb-5">
        <MarkdownField
          label={<IL icon={MessageSquare}>Observaciones</IL>}
          value={form.notesMarkdown}
          onChange={(e) =>
            setForm((p) => ({ ...p, notesMarkdown: e.target.value }))
          }
          maxLength={10000}
          disabled={isBusy}
        />
      </SectionCard>

      {/* ── DOCUMENTOS (solo en edicion) ───────────────────────────── */}
      {!isNew && employeeId && (
        <FilesPanel key={employeeId} employeeId={employeeId} token={token} />
      )}

      {/* bottom save bar */}
      <div className="flex justify-end gap-2 pt-2 pb-8">
        <Button variant="outline" onClick={handleCancel} disabled={isBusy}>
          <X className="mr-2 h-4 w-4" />
          Cancelar
        </Button>
        {canSubmit && (
          <Button onClick={() => saveMutation.mutate()} disabled={isBusy}>
            {saveMutation.isPending ? (
              <span className="mr-2 h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saveMutation.isPending ? "Guardando..." : "Guardar colaborador"}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
