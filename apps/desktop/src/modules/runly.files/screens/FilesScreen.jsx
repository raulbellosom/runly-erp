import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  SelectField,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FileUploader,
  PageHeader,
  useOfficeActions,
} from "@runly/ui";
import { getOfficeFormat } from "@runly/core";
import {
  CheckCircle2,
  File as FileIcon,
  Loader2,
  ChevronLeft,
  ChevronRight,
  SearchX,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";
import { useFilesExplorer } from "../hooks/useFilesExplorer";
import { FilesToolbar } from "../components/FilesToolbar";
import { FilesWorkspaceTable } from "../components/FilesWorkspaceTable";
import { FilesWorkspaceHeader } from "../components/FilesWorkspaceHeader";
import { CreateDocumentDialog } from "../components/CreateDocumentDialog";
import { FileSharingDialog } from "../components/FileSharingDialog";
import { FileInvitations } from "../components/FileInvitations";
import { FilesCardView } from "../components/FilesCardView";
import { FilesGridView } from "../components/FilesGridView";
import { AdvancedFileViewer, getFileKind } from "@runly/ui";
import { FileDetailPanel } from "../components/FileDetailPanel";
import { FileRenameModal } from "../components/FileRenameModal";

function useFileIdFromPath(pathname) {
  return useMemo(() => {
    const match = pathname.match(/\/app\/m\/runly\.files\/files\/([^/?#]+)/i);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }, [pathname]);
}

export default function FilesScreen() {
  const office = useOfficeActions();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const routeFileId = useFileIdFromPath(location.pathname);
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) =>
    Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canReadFiles = hasPermission("files.assets.read");
  const canUploadFiles = hasPermission("files.assets.create");

  const isAdmin = Boolean(
    hasPermission("files.assets.update") ||
    hasPermission("files.assets.delete"),
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [showUpload, setShowUpload] = useState(false);
  const [newFormat, setNewFormat] = useState(null);
  const [shareFile, setShareFile] = useState(null);
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(searchParams.get("page"), 10) || 1),
  );
  const pageSize = [20, 50, 100].includes(Number(searchParams.get("pageSize")))
    ? Number(searchParams.get("pageSize"))
    : 20;
  const workspace = [
    "documents",
    "attachments",
    "shared",
    "invitations",
  ].includes(searchParams.get("workspace"))
    ? searchParams.get("workspace")
    : "all";
  const queryParams = {
    page,
    pageSize,
    workspace,
    q: searchParams.get("q") || "",
    kind: searchParams.get("kind") || "",
    moduleKey: searchParams.get("moduleKey") || "",
    enabled: searchParams.get("enabled") || "",
    sortBy: searchParams.get("sortBy") || "updatedAt",
    sortDir: searchParams.get("sortDir") || "desc",
  };
  function changeQuery(changes, resetPage = true) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === "" || value == null) next.delete(key);
          else next.set(key, String(value));
        }
        if (resetPage) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }
  const [viewerOpen, setViewerOpen] = useState(false);
  const [toggleTarget, setToggleTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailFile, setDetailFile] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [previewMap, setPreviewMap] = useState(() => new Map());
  const signedUrlCacheRef = useRef(new Map());
  const previewFetchPendingRef = useRef(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]);

  function getApiErrorMessage(error, fallback) {
    try {
      return JSON.parse(error?.message || "{}").error || fallback;
    } catch {
      return fallback;
    }
  }

  const filesQuery = useQuery({
    queryKey: ["files-list", session?.user?.id, queryParams],
    queryFn: () => runly.files.list(queryParams, token),
    enabled: Boolean(token) && canReadFiles && workspace !== "invitations",
  });
  const files = useMemo(() => filesQuery.data?.data ?? [], [filesQuery.data]);
  const pagination = filesQuery.data?.pagination;
  useEffect(() => {
    if (pagination && page > pagination.totalPages)
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("page", String(Math.max(1, pagination.totalPages)));
          return next;
        },
        { replace: true },
      );
  }, [pagination, page, setSearchParams]);
  const moduleOptions = [
    "files",
    "company",
    "contacts",
    "hr",
    "projects",
    "inventory",
    "fleet",
    "growth",
  ].map((key) => ({
    value: `atlas.${key}`,
    label: {
      files: "Archivos",
      company: "Empresa",
      contacts: "Contactos",
      hr: "Personal",
      projects: "Proyectos",
      inventory: "Inventario",
      fleet: "Flota",
      growth: "Ventas",
    }[key],
  }));
  const explorerState = useFilesExplorer(files, { server: true });
  const explorer = {
    ...explorerState,
    search: queryParams.q,
    filters: {
      enabled: queryParams.enabled,
      kind: queryParams.kind,
      moduleKey: queryParams.moduleKey,
    },
    sort: { by: queryParams.sortBy, dir: queryParams.sortDir },
    setSearch: (q) => changeQuery({ q }),
    setFilters: (filters) =>
      changeQuery({ enabled: "", kind: "", moduleKey: "", ...filters }),
    setSort: (sort) => changeQuery({ sortBy: sort.by, sortDir: sort.dir }),
  };
  const resetSelection = explorerState.setSelectedIds;
  explorer.selectVisible = () => {
    resetSelection(files.slice(0, 50).map((file) => file.id));
    if (files.length > 50)
      toast.info("Se seleccionaron los primeros 50 archivos de esta página.");
  };
  explorer.toggleSelect = (id) => {
    if (!explorer.selectedSet.has(id) && explorer.selectedCount >= 50) {
      toast.info("Puedes seleccionar hasta 50 archivos por descarga.");
      return;
    }
    explorerState.toggleSelect(id);
  };
  const queryIdentity = searchParams.toString();
  useEffect(() => {
    resetSelection([]);
  }, [queryIdentity, resetSelection]);
  const routeQuery = useQuery({
    queryKey: ["file-detail", session?.user?.id, routeFileId],
    queryFn: () => runly.files.get(routeFileId, token),
    enabled: Boolean(routeFileId && token && canReadFiles),
    staleTime: 0,
    gcTime: 0,
  });
  const setEnabledMutation = useMutation({
    mutationFn: ({ id, enabled }) => runly.files.setEnabled(id, enabled, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files-list"] });
      setToggleTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => runly.files.delete(id, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files-list"] });
      setDeleteTarget(null);
    },
  });

  const handleUploadFiles = useCallback(
    async (filesToUpload) => {
      if (!token || !canUploadFiles || !filesToUpload?.length) return;
      const files = Array.from(filesToUpload);
      const newItems = files.map((file, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        status: "pending",
        _file: file,
      }));
      setUploadQueue((prev) => [...prev, ...newItems]);

      for (const item of newItems) {
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "uploading" } : q,
          ),
        );
        try {
          const formData = new FormData();
          formData.append("file", item._file);
          formData.append("moduleKey", "runly.files");
          formData.append("entityType", "AtlasFile");
          await runly.files.upload(formData, token);
          setUploadQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, status: "done" } : q)),
          );
        } catch {
          setUploadQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, status: "error" } : q)),
          );
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["files-list"] });

      setTimeout(() => {
        setUploadQueue((prev) => prev.filter((q) => q.status === "error"));
      }, 3500);
    },
    [token, queryClient, canUploadFiles],
  );

  useEffect(() => {
    if (!token) return;
    let counter = 0;

    function onDragEnter(e) {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      counter++;
      setIsDragOver(true);
    }

    function onDragLeave() {
      counter = Math.max(0, counter - 1);
      if (counter === 0) setIsDragOver(false);
    }

    function onDrop(e) {
      e.preventDefault();
      counter = 0;
      setIsDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer?.files || []);
      if (droppedFiles.length) handleUploadFiles(droppedFiles);
    }

    function onDragOver(e) {
      e.preventDefault();
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [token, handleUploadFiles]);

  const renameMutation = useMutation({
    mutationFn: ({ id, originalName }) =>
      runly.files.rename(id, { originalName }, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files-list"] });
      setRenameTarget(null);
      setRenameValue("");
    },
  });

  const bulkDownloadMutation = useMutation({
    mutationFn: ({ mode }) =>
      runly.files.bulkDownload(
        {
          fileIds: explorer.selectedIds,
          mode,
        },
        token,
      ),
  });

  const resolveSignedUrl = useCallback(
    async (file) => {
      if (!file?.id || !token) return null;
      const cached = signedUrlCacheRef.current.get(file.id);
      if (cached) return cached;
      const response = await runly.files.getSignedUrl(file.id, token);
      const url = response?.data?.signedUrl;
      if (url) {
        signedUrlCacheRef.current.set(file.id, url);
      }
      return url || null;
    },
    [token],
  );

  useEffect(() => {
    if (!explorer.filteredFiles.length || !token) return;

    const imageFiles = explorer.filteredFiles
      .filter((file) => getFileKind(file.mimeType) === "image")
      .slice(0, 24);

    // Apply cached URLs immediately without a network request.
    for (const file of imageFiles) {
      if (!file?.id) continue;
      const cached = signedUrlCacheRef.current.get(file.id);
      if (cached) {
        setPreviewMap((prev) => {
          if (prev.get(file.id) === cached) return prev;
          const next = new Map(prev);
          next.set(file.id, cached);
          return next;
        });
      }
    }

    const uncachedIds = imageFiles
      .filter(
        (f) =>
          f?.id &&
          !signedUrlCacheRef.current.has(f.id) &&
          !previewFetchPendingRef.current.has(f.id),
      )
      .map((f) => f.id);

    if (uncachedIds.length === 0) return;

    for (const id of uncachedIds) previewFetchPendingRef.current.add(id);

    runly.files
      .batchSignedUrls(uncachedIds, token)
      .then((response) => {
        const urlMap = response?.data ?? {};
        setPreviewMap((prev) => {
          const next = new Map(prev);
          for (const [id, url] of Object.entries(urlMap)) {
            if (url) {
              signedUrlCacheRef.current.set(id, url);
              next.set(id, url);
            }
          }
          return next;
        });
      })
      .catch(() => {
        // Ignore thumbnail prefetch failures.
      })
      .finally(() => {
        for (const id of uncachedIds) previewFetchPendingRef.current.delete(id);
      });
  }, [explorer.filteredFiles, token]);

  // AdvancedFileViewer's filmstrip uses thumbnailUrl directly (no +/-3-file
  // window limit) — reuse the previewMap this screen already resolves for
  // its own grid/card/table thumbnails instead of leaving the viewer to
  // re-fetch each one through its own narrower window.
  const viewerFiles = useMemo(
    () =>
      explorer.filteredFiles.map((file) => ({
        ...file,
        thumbnailUrl: previewMap.get(file.id) ?? null,
      })),
    [explorer.filteredFiles, previewMap],
  );

  useEffect(() => {
    if (routeQuery.data?.data) {
      setDetailFile(routeQuery.data.data);
      setDetailOpen(true);
    }
  }, [routeQuery.data]);

  function openViewer(file) {
    if (office?.enabled && file.enabled !== false && getOfficeFormat(file)) {
      office.open(file.id);
      return;
    }
    if (!files.some((item) => item.id === file.id)) {
      openDetail(file);
      return;
    }
    explorer.openById(file.id);
    setViewerOpen(true);
  }

  async function downloadFile(file) {
    try {
      const url = await resolveSignedUrl(file);
      if (!url) throw new Error("missing url");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.originalName;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch {
      toast.error("No se pudo descargar el archivo");
    }
  }

  async function copyLink(file) {
    try {
      const native =
        window.location.protocol === "tauri:" ||
        window.location.hostname === "tauri.localhost";
      const url = native
        ? (await runly.files.getAccess(file.id, token))?.data?.shareUrl
        : new URL(
            `/app/m/runly.files/files/${encodeURIComponent(file.id)}`,
            window.location.origin,
          ).href;
      if (!url) {
        toast.error(
          "Configura la URL web de Runly en el servidor para compartir enlaces.",
        );
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Enlace de Runly copiado");
    } catch {
      toast.error("No se pudo copiar el enlace");
    }
  }

  function openDetail(file, pushRoute = true) {
    setDetailFile(file);
    setDetailOpen(true);
    if (pushRoute) {
      navigate(
        `/app/m/runly.files/files/${encodeURIComponent(file.id)}${location.search}`,
      );
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetailFile(null);
    if (routeFileId) {
      navigate(`/app/m/runly.files/files${location.search}`, { replace: true });
    }
  }

  async function handleBulkDirect() {
    try {
      const response = await toast.promise(
        bulkDownloadMutation.mutateAsync({ mode: "direct" }),
        {
          loading: "Preparando enlaces de descarga...",
          success: "Descarga iniciada",
          error: (error) =>
            getApiErrorMessage(error, "No se pudo descargar la seleccion"),
        },
      );
      const filesData = response?.data?.files ?? [];
      if (!filesData.length) {
        toast.error("No se encontraron archivos para descargar");
        return;
      }
      filesData.forEach((item) => {
        if (!item?.signedUrl) return;
        const anchor = document.createElement("a");
        anchor.href = item.signedUrl;
        anchor.download = item.originalName;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
      });
    } catch {
      // handled by toast.promise
    }
  }

  async function handleBulkZip() {
    try {
      const response = await toast.promise(
        bulkDownloadMutation.mutateAsync({ mode: "zip" }),
        {
          loading: "Construyendo ZIP...",
          success: "ZIP preparado",
          error: (error) =>
            getApiErrorMessage(error, "No se pudo preparar el ZIP"),
        },
      );
      const url = response?.data?.signedUrl;
      if (!url) {
        toast.error("No se pudo preparar el ZIP");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // handled by toast.promise
    }
  }

  if (!canReadFiles) {
    return (
      <div className="files-workspace flex flex-col min-h-full">
        <div className="flex-1 p-4 md:p-6 space-y-6">
          <PageHeader
            eyebrow="Runly Files"
            title="Explorador de archivos"
            description="Visualiza, organiza, renombra y descarga archivos por lote o individualmente."
          />
          <ErrorState message="No tienes permisos para ver los archivos." />
        </div>
      </div>
    );
  }

  return (
    <div className="files-workspace flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-6">
        <FilesWorkspaceHeader
          onCreate={setNewFormat}
          onUpload={() => setShowUpload(true)}
          canCreate={canUploadFiles && hasPermission("files.assets.update")}
          canUpload={canUploadFiles}
          officeAvailable={Boolean(
            office?.enabled && office?.available !== false,
          )}
        />
        <Dialog open={showUpload} onOpenChange={setShowUpload}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Subir archivos</DialogTitle>
              <DialogDescription>
                Agrega archivos a este espacio. Se conserva el acceso de la
                empresa.
              </DialogDescription>
            </DialogHeader>
            <FileUploader
              multiple
              onUploadMany={handleUploadFiles}
              maxSizeMB={10}
              accept="image/*,application/pdf,text/*,.csv,.xlsx,.doc,.docx,.pptx,.md"
              disabled={!canUploadFiles}
            />
          </DialogContent>
        </Dialog>
        <nav className="files-workspace-tabs" aria-label="Vistas de archivos">
          {[
            ["all", "Todos"],
            ["documents", "Documentos"],
            ["shared", "Compartidos conmigo"],
            ["attachments", "Adjuntos del ERP"],
            ["invitations", "Invitaciones"],
          ].map(([key, label]) => (
            <Button
              key={key}
              variant={workspace === key ? "secondary" : "ghost"}
              aria-current={workspace === key ? "page" : undefined}
              onClick={() => changeQuery({ workspace: key })}
            >
              {label}
            </Button>
          ))}
        </nav>
        {routeQuery.isError && (
          <ErrorState
            title="No se pudo abrir el archivo enlazado"
            description="Comprueba que tengas acceso y que el archivo siga disponible."
            onRetry={() => routeQuery.refetch()}
          />
        )}
        {workspace === "invitations" ? (
          <FileInvitations
            token={token}
            userId={session?.user?.id}
            onOpen={openViewer}
          />
        ) : (
          <>
            <FilesToolbar
              search={explorer.search}
              onSearchChange={explorer.setSearch}
              filters={explorer.filters}
              onFiltersChange={explorer.setFilters}
              viewMode={explorer.viewMode}
              onViewModeChange={explorer.setViewMode}
              selectedCount={explorer.selectedCount}
              onSelectVisible={explorer.selectVisible}
              onClearSelection={explorer.clearSelection}
              onBulkDirect={handleBulkDirect}
              onBulkZip={handleBulkZip}
              bulkLoading={bulkDownloadMutation.isPending}
              sort={explorer.sort}
              onSortChange={explorer.setSort}
              moduleOptions={moduleOptions}
            />

            {filesQuery.isLoading ? (
              <div className="h-40 rounded-xl border border-[hsl(var(--border))] flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" />
              </div>
            ) : filesQuery.isError ? (
              <ErrorState
                title="No se pudieron cargar los archivos"
                message="Reintenta la carga para continuar."
                onRetry={() => filesQuery.refetch()}
              />
            ) : explorer.filteredFiles.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Sin resultados"
                description="No hay archivos que coincidan con los filtros actuales."
              />
            ) : explorer.viewMode === "table" ? (
              <FilesWorkspaceTable
                files={explorer.filteredFiles}
                selectedSet={explorer.selectedSet}
                onToggleSelect={explorer.toggleSelect}
                onSelectVisible={explorer.selectVisible}
                onClearSelection={explorer.clearSelection}
                onShare={setShareFile}
                onPreview={openViewer}
                onDownload={downloadFile}
                onCopyLink={copyLink}
                onRename={(file) => {
                  setRenameTarget(file);
                  setRenameValue(file.originalName || "");
                }}
                onDetail={(file) => openDetail(file, true)}
                onToggleEnabled={(file) =>
                  setToggleTarget({
                    id: file.id,
                    enabled: !file.enabled,
                    name: file.originalName,
                  })
                }
                onDelete={(file) => setDeleteTarget(file)}
                canUpdate={hasPermission("files.assets.update")}
                canDelete={hasPermission("files.assets.delete")}
                profileId={userProfile?.id}
                isCompanyAdmin={userProfile?.isAdmin}
                isAdmin={isAdmin}
                previewMap={previewMap}
              />
            ) : explorer.viewMode === "cards" ? (
              <FilesCardView
                files={explorer.filteredFiles}
                selectedSet={explorer.selectedSet}
                onToggleSelect={explorer.toggleSelect}
                onPreview={openViewer}
                onDownload={downloadFile}
                onCopyLink={copyLink}
                onRename={(file) => {
                  setRenameTarget(file);
                  setRenameValue(file.originalName || "");
                }}
                onDetail={(file) => openDetail(file, true)}
                previewMap={previewMap}
                isAdmin={isAdmin}
                onDelete={(file) => setDeleteTarget(file)}
              />
            ) : (
              <FilesGridView
                files={explorer.filteredFiles}
                selectedSet={explorer.selectedSet}
                onToggleSelect={explorer.toggleSelect}
                onPreview={openViewer}
                onDownload={downloadFile}
                onDetail={(file) => openDetail(file, true)}
                previewMap={previewMap}
                isAdmin={isAdmin}
                onDelete={(file) => setDeleteTarget(file)}
              />
            )}
            <div className="files-workspace-pagination">
              <span
                className="text-sm text-[hsl(var(--muted-foreground))]"
                role="status"
              >
                {filesQuery.isFetching
                  ? "Actualizando…"
                  : `${pagination?.total ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, pagination?.total ?? 0)} de ${pagination?.total ?? 0} archivos`}
              </span>
              <div>
                <SelectField
                  id="files-page-size"
                  label="Por página"
                  value={String(pageSize)}
                  options={[20, 50, 100].map((size) => ({
                    value: String(size),
                    label: String(size),
                  }))}
                  onChange={(value) => changeQuery({ pageSize: value })}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Página anterior"
                  disabled={page <= 1 || filesQuery.isFetching}
                  onClick={() => changeQuery({ page: page - 1 }, false)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-sm whitespace-nowrap">
                  {page} / {pagination?.totalPages ?? 1}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Página siguiente"
                  disabled={
                    page >= (pagination?.totalPages ?? 1) ||
                    filesQuery.isFetching
                  }
                  onClick={() => changeQuery({ page: page + 1 }, false)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
        {newFormat && (
          <CreateDocumentDialog
            key={newFormat}
            format={newFormat}
            token={token}
            onClose={() => setNewFormat(null)}
            onCreated={(file) => {
              setNewFormat(null);
              openViewer(file);
            }}
          />
        )}
        {shareFile && (
          <FileSharingDialog
            key={shareFile.id}
            file={shareFile}
            token={token}
            userId={session?.user?.id}
            onClose={() => setShareFile(null)}
            onCopyLink={copyLink}
          />
        )}
      </div>

      {isDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-4 rounded-3xl bg-[hsl(var(--primary))]/8 border-2 border-dashed border-[hsl(var(--primary))]/50 backdrop-blur-sm" />
          <div className="relative flex flex-col items-center gap-4 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/15">
              <Upload className="h-12 w-12 text-[hsl(var(--primary))]" />
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-[hsl(var(--foreground))]">
                Suelta los archivos aqui
              </p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Se subiran a Runly Files · Max. 10 MB por archivo
              </p>
            </div>
          </div>
        </div>
      )}

      {uploadQueue.length > 0 && (
        <div className="fixed bottom-6 right-6 z-40 w-80 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 backdrop-blur-sm shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--border))]">
            {uploadQueue.some(
              (q) => q.status === "pending" || q.status === "uploading",
            ) ? (
              <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--muted-foreground))] shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-none">
                {uploadQueue.some(
                  (q) => q.status === "pending" || q.status === "uploading",
                )
                  ? "Subiendo archivos"
                  : "Carga completada"}
              </p>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                {uploadQueue.filter((q) => q.status === "done").length} /{" "}
                {uploadQueue.length} archivos
              </p>
            </div>
            <button
              type="button"
              onClick={() => setUploadQueue([])}
              className="ml-1 rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-[hsl(var(--border))]">
            {uploadQueue.map((item) => (
              <div key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                <FileIcon className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate text-[hsl(var(--foreground))]">
                    {item.name}
                  </p>
                  {item.status === "uploading" && (
                    <div className="mt-1 h-1 rounded-full bg-[hsl(var(--muted))]">
                      <div className="h-1 w-1/2 rounded-full bg-[hsl(var(--primary))] animate-pulse" />
                    </div>
                  )}
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    {item.status === "pending" && "En cola..."}
                    {item.status === "uploading" && "Subiendo..."}
                    {item.status === "done" && "Listo"}
                    {item.status === "error" && "Error al subir"}
                  </p>
                </div>
                <div className="shrink-0 mt-0.5">
                  {(item.status === "pending" ||
                    item.status === "uploading") && (
                    <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--muted-foreground))]" />
                  )}
                  {item.status === "done" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  )}
                  {item.status === "error" && (
                    <XCircle className="h-4 w-4 text-[hsl(var(--destructive))]" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AdvancedFileViewer
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        files={viewerFiles}
        activeIndex={explorer.activeIndex}
        onIndexChange={explorer.setActiveIndex}
        onResolveSignedUrl={resolveSignedUrl}
        onOpenInOffice={(f) => office?.enabled && office.open(f.id)}
        canOpenInOffice={(f) => f?.enabled !== false}
      />

      <FileDetailPanel
        onShare={(file) => {
          closeDetail();
          setShareFile(file);
        }}
        open={detailOpen}
        onOpenChange={(v) => {
          if (!v) {
            closeDetail();
            return;
          }
          setDetailOpen(true);
        }}
        file={detailFile}
        onGoOrigin={(path) => {
          closeDetail();
          navigate(path);
        }}
      />

      <FileRenameModal
        open={Boolean(renameTarget)}
        onOpenChange={(v) => !v && setRenameTarget(null)}
        file={renameTarget}
        previewUrl={
          renameTarget ? (previewMap.get(renameTarget.id) ?? null) : null
        }
        value={renameValue}
        onChange={setRenameValue}
        onSave={() =>
          toast.promise(
            renameMutation.mutateAsync({
              id: renameTarget.id,
              originalName: renameValue,
            }),
            {
              loading: "Guardando nombre...",
              success: "Nombre de archivo actualizado",
              error: (error) =>
                getApiErrorMessage(error, "No se pudo renombrar el archivo"),
            },
          )
        }
        isPending={renameMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="¿Eliminar archivo?"
        description="Esta acción es irreversible. El archivo se eliminará permanentemente del almacenamiento."
        detail={deleteTarget?.originalName}
        confirmLabel="Eliminar"
        onConfirm={() =>
          toast.promise(deleteMutation.mutateAsync(deleteTarget.id), {
            loading: "Eliminando archivo...",
            success: "Archivo eliminado",
            error: (error) =>
              getApiErrorMessage(error, "No se pudo eliminar el archivo"),
          })
        }
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onOpenChange={(v) => !v && setToggleTarget(null)}
        title={
          toggleTarget?.enabled
            ? "¿Habilitar archivo?"
            : "¿Deshabilitar archivo?"
        }
        description="El archivo cambiara de estado."
        detail={toggleTarget?.name}
        confirmLabel={toggleTarget?.enabled ? "Habilitar" : "Deshabilitar"}
        onConfirm={() =>
          toast.promise(
            setEnabledMutation.mutateAsync({
              id: toggleTarget.id,
              enabled: toggleTarget.enabled,
            }),
            {
              loading: "Actualizando estado del archivo...",
              success: "Estado de archivo actualizado",
              error: (error) =>
                getApiErrorMessage(
                  error,
                  "No se pudo actualizar el estado del archivo",
                ),
            },
          )
        }
        loading={setEnabledMutation.isPending}
      />

      <div className="px-6 pb-6">
        <Badge variant="outline">
          Limite descarga masiva: 50 archivos o 250 MB por solicitud
        </Badge>
      </div>
    </div>
  );
}
