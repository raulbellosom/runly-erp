import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  LayoutGrid,
  List,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { LoadingState } from "./LoadingState.jsx";
import { OfficeAttachmentAction } from "./OfficeAttachmentAction.jsx";
import { Alert, AlertDescription, AlertTitle } from "./Alert.jsx";
import { Input } from "./Input.jsx";
import { AdvancedFileViewer } from "./AdvancedFileViewer.jsx";
import {
  resolveAttachmentFileType,
  useAttachmentsController,
} from "../hooks/useAttachmentsController.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(sizeBytes) {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizePlacement(value) {
  const placement = String(value ?? "embedded")
    .trim()
    .toLowerCase();
  return placement === "aside" ? "aside" : "embedded";
}

const FILE_TYPE_STYLES = {
  image: {
    icon: FileImage,
    iconClass:
      "bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300",
    labelClass:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300",
  },
  pdf: {
    icon: FileType2,
    iconClass:
      "bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300",
    labelClass:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
  },
  word: {
    icon: FileText,
    iconClass:
      "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300",
    labelClass:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300",
  },
  spreadsheet: {
    icon: FileSpreadsheet,
    iconClass:
      "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300",
    labelClass:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  text: {
    icon: FileText,
    iconClass:
      "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300",
    labelClass:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  },
  archive: {
    icon: FileArchive,
    iconClass:
      "bg-fuchsia-500/10 text-fuchsia-600 dark:bg-fuchsia-500/20 dark:text-fuchsia-300",
    labelClass:
      "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
  },
  file: {
    icon: File,
    iconClass:
      "bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
    labelClass:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-300",
  },
};

const ACTIVE_STATUS = new Set(["uploading", "attaching"]);

function getTypeStyle(item) {
  const typeInfo = resolveAttachmentFileType({
    mimeType: item?.mimeType,
    fileName: item?.fileName,
  });
  return {
    ...typeInfo,
    ...(FILE_TYPE_STYLES[typeInfo.kind] ?? FILE_TYPE_STYLES.file),
  };
}

function FileTypeBadge({ typeStyle }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold leading-4 ${typeStyle.labelClass}`}
      aria-label={`Tipo: ${typeStyle.label}`}
    >
      {typeStyle.label}
    </span>
  );
}

function FileVisual({ item, typeStyle }) {
  if (typeStyle.kind === "image" && item?.previewUrl) {
    return (
      <img
        src={item.previewUrl}
        alt={item.fileName ?? "Archivo"}
        className="h-9 w-9 shrink-0 rounded-lg border border-[hsl(var(--border))] object-cover"
      />
    );
  }
  const Icon = typeStyle.icon;
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${typeStyle.iconClass}`}
      aria-hidden="true"
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  destructive = false,
  children,
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        destructive
          ? "text-[hsl(var(--muted-foreground))] hover:bg-rose-500/10 hover:text-rose-500 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
          : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function PendingCard({ item, hasRecord, onOpen, onRetry, onRemove, busy }) {
  const typeStyle = getTypeStyle(item);
  const isActive = ACTIVE_STATUS.has(item.status);
  const isError = item.status === "error";
  const canOpen = Boolean(item?.file);
  const sizeText = item?.sizeBytes != null ? formatBytes(item.sizeBytes) : null;

  return (
    <article className="group flex items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-2 transition-colors hover:bg-[hsl(var(--muted))]/30">
      <FileVisual item={item} typeStyle={typeStyle} />

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-[hsl(var(--foreground))]"
          title={item.fileName}
        >
          {item.fileName ?? "Archivo"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <FileTypeBadge typeStyle={typeStyle} />
          {sizeText && (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {sizeText}
            </span>
          )}
          {isActive && (
            <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--muted-foreground))]" />
          )}
          {isError && (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 py-px text-[10px] font-semibold leading-4 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400">
              Error
            </span>
          )}
        </div>
        {item.error && (
          <p
            className="mt-0.5 truncate text-[11px] text-rose-500 dark:text-rose-400"
            title={item.error}
          >
            {item.error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
        {canOpen && (
          <IconAction
            label="Vista previa"
            onClick={() => onOpen(item)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </IconAction>
        )}
        {isError && hasRecord && (
          <IconAction label="Reintentar" onClick={() => onRetry(item.id)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </IconAction>
        )}
        <IconAction
          label="Quitar"
          onClick={() => onRemove(item.id)}
          disabled={busy}
          destructive
        >
          <X className="h-3.5 w-3.5" />
        </IconAction>
      </div>
    </article>
  );
}

function ImageGridTile({ item, previewUrl, loading, mimeType, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const isVideo = String(mimeType ?? "").startsWith("video/");
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative group aspect-square rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] hover:border-[hsl(var(--primary)/0.6)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      title={item.fileName}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" />
        </div>
      )}
      {isVideo ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Video className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
        </div>
      ) : previewUrl && !imgErr ? (
        <img
          src={previewUrl}
          alt={item.fileName}
          onError={() => setImgErr(true)}
          className="w-full h-full object-cover"
        />
      ) : !loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <FileImage className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 translate-y-full group-hover:translate-y-0 transition-transform">
        <p className="text-xs text-white truncate">{item.fileName}</p>
      </div>
    </button>
  );
}

function AssociatedCard({
  item,
  previewUrl = null,
  onOpen,
  onDownload,
  onRemove,
  opening,
  downloading,
  removing,
  canWrite,
}) {
  const typeStyle = getTypeStyle(item);
  const sizeText = item?.sizeBytes != null ? formatBytes(item.sizeBytes) : null;
  const dateText = item?.createdAt ? formatDate(item.createdAt) : null;

  return (
    <article className="group flex items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-2 transition-colors hover:bg-[hsl(var(--muted))]/30">
      {previewUrl ? (
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          title="Abrir vista previa"
          aria-label={`Abrir vista previa de ${item.fileName ?? "archivo"}`}
        >
          <FileVisual item={{ ...item, previewUrl }} typeStyle={typeStyle} />
        </button>
      ) : (
        <FileVisual item={item} typeStyle={typeStyle} />
      )}

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-[hsl(var(--foreground))]"
          title={item.fileName}
        >
          {item.fileName ?? "Archivo"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <FileTypeBadge typeStyle={typeStyle} />
          {sizeText && (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {sizeText}
            </span>
          )}
          {dateText && (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {dateText}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
        <IconAction
          label="Vista previa"
          onClick={() => onOpen(item)}
          disabled={opening}
        >
          {opening ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </IconAction>
        <IconAction
          label="Descargar"
          onClick={() => onDownload(item)}
          disabled={downloading}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </IconAction>
        <OfficeAttachmentAction file={item} />
        {canWrite && (
          <IconAction
            label="Quitar"
            onClick={() => onRemove(item)}
            disabled={removing}
            destructive
          >
            {removing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </IconAction>
        )}
      </div>
    </article>
  );
}

function AssociatedFilesList({
  items,
  localView,
  thumbUrlsByAssetId,
  onOpen,
  onDownload,
  onRemove,
  openingId,
  downloadingId,
  removingId,
  canWrite,
  canRemoveItem,
}) {
  if (localView === "grid") {
    const isMedia = (mimeType) => {
      const m = String(mimeType ?? "");
      return m.startsWith("image/") || m.startsWith("video/");
    };
    const images = items.filter((i) => isMedia(i.mimeType));
    const others = items.filter((i) => !isMedia(i.mimeType));
    return (
      <div className="space-y-3">
        {images.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-2">
              Multimedia ({images.length})
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((item) => {
                const isVideo = String(item.mimeType ?? "").startsWith("video/");
                return (
                  <ImageGridTile
                    key={item.id}
                    item={item}
                    mimeType={item.mimeType}
                    previewUrl={item.fileAssetId ? (thumbUrlsByAssetId[item.fileAssetId] ?? null) : null}
                    loading={!isVideo && !thumbUrlsByAssetId[item.fileAssetId] && Boolean(item.fileAssetId)}
                    onClick={() => onOpen(item)}
                  />
                );
              })}
            </div>
          </div>
        )}
        {others.length > 0 && (
          <div>
            {images.length > 0 && (
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-2">
                Documentos ({others.length})
              </p>
            )}
            <div className="space-y-1.5">
              {others.map((item) => (
                <AssociatedCard
                  key={item.id}
                  item={item}
                  previewUrl={null}
                  onOpen={onOpen}
                  onDownload={onDownload}
                  onRemove={onRemove}
                  opening={openingId === item.id}
                  downloading={downloadingId === item.id}
                  removing={removingId === item.id}
                  canWrite={canWrite && canRemoveItem(item)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        Archivos asociados
      </p>
      <div className="space-y-1.5">
        {items.map((item) => (
          <AssociatedCard
            key={item.id}
            item={item}
            previewUrl={item.fileAssetId ? (thumbUrlsByAssetId[item.fileAssetId] ?? null) : null}
            onOpen={onOpen}
            onDownload={onDownload}
            onRemove={onRemove}
            opening={openingId === item.id}
            downloading={downloadingId === item.id}
            removing={removingId === item.id}
            canWrite={canWrite && canRemoveItem(item)}
          />
        ))}
      </div>
    </div>
  );
}

export function AttachmentsPanel({
  apiBaseUrl,
  token,
  companyId = null,
  recordId,
  config,
  context = "detail",
  disabled = false,
  readOnly = false,
  showHeading = true,
  showViewToggle = false,
  defaultViewMode = "grid",
  className = "",
  onError,
  onChange,
  onControllerReady,
  canRemoveItem = () => true,
  prefetchedData,
}) {
  const controller = useAttachmentsController({
    apiBaseUrl,
    token,
    companyId,
    recordId,
    config,
    context,
    disabled,
    readOnly,
    onError,
    onChange,
    prefetchedData,
  });

  const [documentType, setDocumentType] = useState("");
  const [documentLabel, setDocumentLabel] = useState("");
  const [removingId, setRemovingId] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [openingPendingId, setOpeningPendingId] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [thumbUrlsByAssetId, setThumbUrlsByAssetId] = useState({});
  const [viewerIndex, setViewerIndex] = useState(0);
  const [localView, setLocalView] = useState(defaultViewMode);
  const fileInputRef = useRef(null);
  const dropzonePlacement = normalizePlacement(config?.placement);

  useEffect(() => {
    if (typeof onControllerReady !== "function") return undefined;
    onControllerReady(controller);
    return () => onControllerReady(null);
  }, [controller, onControllerReady]);

  const heading = useMemo(
    () => String(config?.label ?? "Documentos"),
    [config?.label],
  );
  const showTypeInput = Boolean(config?.metadataInputs?.showDocumentTypeInput);
  const showLabelInput = Boolean(config?.metadataInputs?.showLabelInput);
  const showMetadataInputs = showTypeInput || showLabelInput;

  const hasRecord = Boolean(recordId);
  const canChooseFiles =
    controller.canUpload &&
    !disabled &&
    !readOnly &&
    (context !== "detail" || hasRecord);
  const canManageAssociations =
    hasRecord && Boolean(config?.addPath && config?.removePath);

  const viewerFiles = useMemo(
    () =>
      controller.associatedItems.map((item) => ({
        ...item,
        id: item.fileAssetId ?? item.id,
        originalName: item.fileName ?? "Archivo",
        signedUrl:
          item.signedUrl ??
          (item.fileAssetId
            ? (thumbUrlsByAssetId[item.fileAssetId] ?? null)
            : null),
      })),
    [controller.associatedItems, thumbUrlsByAssetId],
  );

  useEffect(() => {
    let cancelled = false;
    const imageItems = controller.associatedItems.filter((item) =>
      String(item?.mimeType ?? "").startsWith("image/"),
    );
    if (imageItems.length === 0) return () => {};

    async function loadThumbs() {
      for (const item of imageItems) {
        const assetId = item.fileAssetId;
        if (!assetId) continue;
        if (thumbUrlsByAssetId[assetId]) continue;

        // Use inline signed URL if available and not expiring within 60 s
        if (item.signedUrl && item.signedUrlExpiresAt) {
          const expiresAt = new Date(item.signedUrlExpiresAt).getTime();
          if (expiresAt - Date.now() > 60_000) {
            if (!cancelled) {
              setThumbUrlsByAssetId((prev) =>
                prev[assetId] ? prev : { ...prev, [assetId]: item.signedUrl },
              );
            }
            continue;
          }
        }

        // Fallback: fetch signed URL individually (original behavior)
        try {
          const url = await controller.resolveSignedUrl(assetId);
          if (cancelled || !url) continue;
          setThumbUrlsByAssetId((prev) =>
            prev[assetId] ? prev : { ...prev, [assetId]: url },
          );
        } catch {
          // Ignore thumbnail resolution failures.
        }
      }
    }

    loadThumbs();
    return () => {
      cancelled = true;
    };
  }, [
    controller.associatedItems,
    controller.resolveSignedUrl,
    thumbUrlsByAssetId,
  ]);

  const handleFilesPicked = async (filesLike) => {
    await controller.queueFiles(filesLike, {
      documentType: documentType.trim(),
      label: documentLabel.trim(),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Keep a stable ref so the window effect never needs to re-register on render
  const handleFilesPickedRef = useRef(handleFilesPicked);
  handleFilesPickedRef.current = handleFilesPicked;

  // Window-level drag detection — shows overlay when dragging anywhere on screen
  useEffect(() => {
    if (!canChooseFiles) return;
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
      const files = e.dataTransfer?.files;
      if (files?.length) handleFilesPickedRef.current(files);
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
  }, [canChooseFiles]);

  const handleRemoveAssociated = async (item) => {
    setRemovingId(item.id);
    await controller.removeAssociated(item);
    setRemovingId(null);
  };

  const handleOpenAssociated = async (item) => {
    setOpeningId(item.id);
    const index = controller.associatedItems.findIndex(
      (entry) => entry.id === item.id,
    );
    if (index >= 0) setViewerIndex(index);
    const preloadedUrl = item.fileAssetId
      ? (thumbUrlsByAssetId[item.fileAssetId] ?? null)
      : null;
    await controller.openAssociated(
      preloadedUrl ? { ...item, signedUrl: preloadedUrl } : item,
    );
    setOpeningId(null);
  };

  const handleDownloadAssociated = async (item) => {
    setDownloadingId(item.id);
    await controller.downloadAssociated(item);
    setDownloadingId(null);
  };

  const handleOpenPending = async (item) => {
    setOpeningPendingId(item.id);
    await controller.openPending(item);
    setOpeningPendingId(null);
  };

  const wrapperClass =
    dropzonePlacement === "aside"
      ? "rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      : "";

  return (
    <div className={`${wrapperClass} ${className}`.trim()}>
      {isDragOver && canChooseFiles && (
        <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center">
          <div className="absolute inset-4 rounded-3xl border-2 border-dashed border-[hsl(var(--primary))]/50 bg-[hsl(var(--primary))]/8 backdrop-blur-sm" />
          <div className="relative flex flex-col items-center gap-3">
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl border border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/15">
              <Upload className="h-10 w-10 text-[hsl(var(--primary))]" />
            </span>
            <p className="text-base font-semibold text-[hsl(var(--primary))]">
              Suelta para adjuntar
            </p>
            <p className="text-sm text-[hsl(var(--primary))]/70">{heading}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            {showHeading && (
              <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {heading}
              </h4>
            )}
          </div>
          {showViewToggle && controller.associatedItems.length > 0 && (
            <div className="flex items-center gap-0.5 rounded-lg border border-[hsl(var(--border))] p-0.5">
              <button
                type="button"
                onClick={() => setLocalView("list")}
                className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${localView === "list" ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}
                title="Vista de lista"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setLocalView("grid")}
                className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${localView === "grid" ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}
                title="Vista de cuadricula"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
          {!hasRecord && context !== "detail" && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Los archivos se guardarán después de crear el registro.
            </p>
          )}

        {!canManageAssociations && context === "detail" && (
          <Alert variant="warning">
            <AlertTitle>Documentos</AlertTitle>
            <AlertDescription>
              Este registro no tiene un identificador válido para gestionar
              documentos.
            </AlertDescription>
          </Alert>
        )}

        {canChooseFiles && (
          <div className="space-y-2">
            {showMetadataInputs && (
              <div className="grid gap-2 md:grid-cols-2">
                {showTypeInput && (
                  <Input
                    type="text"
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value)}
                    placeholder="Tipo de documento"
                    disabled={disabled || readOnly}
                  />
                )}
                {showLabelInput && (
                  <Input
                    type="text"
                    value={documentLabel}
                    onChange={(e) => setDocumentLabel(e.target.value)}
                    placeholder="Etiqueta"
                    disabled={disabled || readOnly}
                  />
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple={controller.allowMultiple}
              className="sr-only"
              onChange={(e) => handleFilesPicked(e.target.files)}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || readOnly}
              aria-label="Seleccionar archivos adjuntos"
              className="group w-full cursor-pointer rounded-xl border border-dashed border-[hsl(var(--border))] bg-transparent p-5 transition-colors hover:border-[hsl(var(--primary))]/50 hover:bg-[hsl(var(--primary))]/5 disabled:pointer-events-none disabled:opacity-50"
            >
              <div className="pointer-events-none flex flex-col items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors group-hover:bg-[hsl(var(--primary))]/10 group-hover:text-[hsl(var(--primary))]">
                  <Upload className="h-4 w-4" />
                </span>
                <span className="space-y-0.5 text-center">
                  <span className="block text-sm font-medium text-[hsl(var(--foreground))]">
                    Agregar documentos
                  </span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                    Arrastra aquí o haz clic para seleccionar
                  </span>
                </span>
              </div>
            </button>
          </div>
        )}

        {controller.error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{controller.error}</AlertDescription>
          </Alert>
        )}

        {controller.notice && (
          <Alert variant="default">
            <AlertTitle>Información</AlertTitle>
            <AlertDescription>{controller.notice}</AlertDescription>
          </Alert>
        )}

        {controller.pendingItems.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Archivos pendientes
            </p>
            <div className="space-y-1.5">
              {controller.pendingItems.map((item) => (
                <PendingCard
                  key={item.id}
                  item={item}
                  hasRecord={hasRecord}
                  onOpen={handleOpenPending}
                  onRetry={controller.retryPending}
                  onRemove={controller.removePending}
                  busy={openingPendingId === item.id}
                />
              ))}
            </div>
          </div>
        )}

        {controller.loading && (
          <LoadingState
            variant="inline"
            size="sm"
            message="Cargando documentos..."
          />
        )}

        {controller.associatedItems.length > 0 && (
          <AssociatedFilesList
            items={controller.associatedItems}
            localView={localView}
            thumbUrlsByAssetId={thumbUrlsByAssetId}
            onOpen={handleOpenAssociated}
            onDownload={handleDownloadAssociated}
            onRemove={handleRemoveAssociated}
            openingId={openingId}
            downloadingId={downloadingId}
            removingId={removingId}
            canWrite={controller.canWrite}
            canRemoveItem={canRemoveItem}
          />
        )}
      </div>

      <AdvancedFileViewer
        open={Boolean(controller.viewerItem)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) controller.closeViewer();
        }}
        files={viewerFiles}
        activeIndex={viewerIndex}
        onIndexChange={(nextIndex) => {
          const target = controller.associatedItems[nextIndex];
          if (!target) return;
          handleOpenAssociated(target);
        }}
        onResolveSignedUrl={async (item) => {
          if (item?.signedUrl) return item.signedUrl;
          if (!item?.fileAssetId) return null;
          return controller.resolveSignedUrl(item.fileAssetId);
        }}
      />
    </div>
  );
}
