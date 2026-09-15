import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildApiHeaders } from "../lib/apiHeaders.js";

const DEFAULT_FIELDS = {
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
  isCover: "isCover",
  sortOrder: "sortOrder",
};

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path) return base;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function getByPath(value, path) {
  if (!path || typeof path !== "string") return undefined;
  return path
    .split(".")
    .reduce((cursor, segment) =>
      cursor && typeof cursor === "object" ? cursor[segment] : undefined,
    value);
}

function replacePathTokens(pathTemplate, tokenMap) {
  let path = String(pathTemplate ?? "");
  for (const [key, rawValue] of Object.entries(tokenMap ?? {})) {
    const safeValue = encodeURIComponent(String(rawValue ?? "").trim());
    path = path.replace(new RegExp(`:${key}\\b`, "g"), safeValue);
  }
  return path;
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    return extractArrayPayload(payload.data);
  }
  return [];
}

function extractErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
  }
  return fallback;
}

function extractSignedUrlFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.url === "string" && payload.url.trim()) return payload.url;
  if (typeof payload.signedUrl === "string" && payload.signedUrl.trim()) {
    return payload.signedUrl;
  }
  if (payload.data && typeof payload.data === "object") {
    return extractSignedUrlFromPayload(payload.data);
  }
  return null;
}

function resolveUploadedFileAssetId(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [payload.file_asset_id, payload.fileAssetId, payload.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  if (payload.data && typeof payload.data === "object") {
    return resolveUploadedFileAssetId(payload.data);
  }
  return null;
}

function getFileExtension(fileName) {
  const safeName = String(fileName ?? "").trim().toLowerCase();
  const lastDot = safeName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === safeName.length - 1) return "";
  return safeName.slice(lastDot + 1);
}

const WORD_EXTENSIONS = new Set(["doc", "docx", "dot", "dotx", "rtf", "odt"]);
const SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv", "ods", "tsv"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "log", "json", "xml", "yaml", "yml"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz"]);

const FILE_TYPE_LABELS = {
  image: "Imagen",
  video: "Video",
  pdf: "PDF",
  word: "Word",
  spreadsheet: "Excel",
  text: "Texto",
  archive: "Comprimido",
  file: "Archivo",
};

function resolveFileTypeKind(mimeType, extension) {
  const normalizedMime = String(mimeType ?? "").trim().toLowerCase();
  const normalizedExt = String(extension ?? "").trim().toLowerCase();

  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("video/")) return "video";
  if (normalizedMime === "application/pdf" || normalizedExt === "pdf") return "pdf";
  if (
    normalizedMime.includes("msword") ||
    normalizedMime.includes("wordprocessingml") ||
    normalizedMime.includes("opendocument.text") ||
    WORD_EXTENSIONS.has(normalizedExt)
  ) {
    return "word";
  }
  if (
    normalizedMime.includes("spreadsheetml") ||
    normalizedMime.includes("excel") ||
    normalizedMime.includes("spreadsheet") ||
    normalizedMime.includes("comma-separated-values") ||
    normalizedMime.includes("opendocument.spreadsheet") ||
    SPREADSHEET_EXTENSIONS.has(normalizedExt)
  ) {
    return "spreadsheet";
  }
  if (normalizedMime.startsWith("text/") || TEXT_EXTENSIONS.has(normalizedExt)) {
    return "text";
  }
  if (
    normalizedMime.includes("zip") ||
    normalizedMime.includes("rar") ||
    normalizedMime.includes("7z") ||
    normalizedMime.includes("compressed") ||
    ARCHIVE_EXTENSIONS.has(normalizedExt)
  ) {
    return "archive";
  }
  return "file";
}

export function resolveAttachmentFileType({ mimeType, fileName } = {}) {
  const extension = getFileExtension(fileName);
  const kind = resolveFileTypeKind(mimeType, extension);
  return {
    kind,
    extension,
    label: FILE_TYPE_LABELS[kind] ?? FILE_TYPE_LABELS.file,
  };
}

function inferDocumentTypeFromFile(file) {
  return resolveAttachmentFileType({
    mimeType: file?.type,
    fileName: file?.name,
  }).kind;
}

function normalizeAssociatedItem(rawItem, fields) {
  const fileAsset =
    getByPath(rawItem, fields.fileAsset) ?? rawItem?.file_asset ?? rawItem?.fileAsset ?? null;

  const fileName =
    getByPath(rawItem, fields.fileName) ??
    fileAsset?.originalName ??
    fileAsset?.fileName ??
    fileAsset?.name ??
    "Archivo no disponible";

  const mimeType =
    getByPath(rawItem, fields.mimeType) ??
    fileAsset?.mimeType ??
    fileAsset?.mimetype ??
    "application/octet-stream";

  const sizeBytes =
    getByPath(rawItem, fields.sizeBytes) ?? fileAsset?.sizeBytes ?? fileAsset?.size ?? null;

  const associationId = getByPath(rawItem, fields.id) ?? rawItem?.id ?? null;
  const fileAssetId =
    getByPath(rawItem, fields.fileAssetId) ?? rawItem?.file_asset_id ?? fileAsset?.id ?? null;

  return {
    kind: "associated",
    id: String(associationId ?? fileAssetId ?? fileName),
    associationId,
    fileAssetId,
    fileName,
    mimeType,
    sizeBytes,
    documentType: getByPath(rawItem, fields.documentType) ?? rawItem?.document_type ?? null,
    label: getByPath(rawItem, fields.label) ?? rawItem?.label ?? null,
    createdAt: getByPath(rawItem, fields.createdAt) ?? rawItem?.created_at ?? null,
    enabled: getByPath(rawItem, fields.enabled) ?? rawItem?.enabled ?? true,
    signedUrl: fileAsset?.signedUrl ?? rawItem?.signedUrl ?? null,
    signedUrlExpiresAt: fileAsset?.signedUrlExpiresAt ?? rawItem?.signedUrlExpiresAt ?? null,
    isCover: Boolean(getByPath(rawItem, fields.isCover) ?? rawItem?.isCover ?? false),
    sortOrder: getByPath(rawItem, fields.sortOrder) ?? rawItem?.sortOrder ?? null,
    raw: rawItem,
  };
}

function createPendingItem(file, metadata = {}) {
  const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
  const defaultDocumentType = inferDocumentTypeFromFile(file);
  const defaultLabel = String(file?.name ?? "").trim();
  return {
    kind: "pending",
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size ?? null,
    status: "pending",
    error: "",
    progress: 0,
    fileAssetId: null,
    associationId: null,
    documentType:
      typeof metadata.documentType === "string" && metadata.documentType.trim()
        ? metadata.documentType.trim()
        : defaultDocumentType,
    label:
      typeof metadata.label === "string" && metadata.label.trim()
        ? metadata.label.trim()
        : defaultLabel,
    previewUrl,
  };
}

function normalizeCreateMode(config) {
  const mode = String(config?.createMode ?? "stage-until-parent-create").trim();
  return mode || "stage-until-parent-create";
}

function normalizeEditMode(config) {
  const mode = String(config?.editMode ?? "upload-immediately").trim();
  return mode || "upload-immediately";
}

export function useAttachmentsController({
  apiBaseUrl,
  token,
  companyId = null,
  recordId,
  config,
  context = "detail",
  disabled = false,
  readOnly = false,
  onChange,
  onError,
  // Pre-populated file list from a parallel query. Must be stable at mount time;
  // updates after mount are ignored (controller has already fetched or is fetching).
  prefetchedData,
}) {
  const mergedFields = { ...DEFAULT_FIELDS, ...(config?.fields ?? {}) };
  const prefetchedDataRef = useRef(prefetchedData);
  const [associatedItems, setAssociatedItems] = useState(() => {
    const initial = prefetchedDataRef.current;
    if (!Array.isArray(initial)) return [];
    return initial.map((r) => normalizeAssociatedItem(r, mergedFields));
  });
  const [pendingItems, setPendingItems] = useState([]);
  const pendingItemsRef = useRef(pendingItems);
  useEffect(() => { pendingItemsRef.current = pendingItems; }, [pendingItems]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewerItem, setViewerItem] = useState(null);

  const normalizedFields = useMemo(
    () => ({ ...DEFAULT_FIELDS, ...(config?.fields ?? {}) }),
    [config?.fields],
  );

  const createMode = useMemo(() => normalizeCreateMode(config), [config]);
  const editMode = useMemo(() => normalizeEditMode(config), [config]);

  const canWrite = !disabled && !readOnly;
  const canUpload =
    canWrite &&
    Boolean(config?.upload?.endpoint && config?.upload?.moduleKey && config?.upload?.entityType);
  const allowMultiple = config?.limits?.allowMultiple !== false;
  const maxFiles = Number(config?.limits?.maxFiles ?? 20);
  const maxSizeMB = Number(config?.limits?.maxSizeMB ?? 10);

  const setGlobalError = useCallback(
    (message) => {
      setError(message);
      onErrorRef.current?.(message);
    },
    [],
  );

  const loadAssociated = useCallback(
    async (idOverride = null) => {
      const effectiveRecordId = idOverride ?? recordId;
      if (!effectiveRecordId || !config?.listPath) {
        setAssociatedItems([]);
        setLoading(false);
        return [];
      }

      setLoading(true);
      setError("");
      setNotice("");

      try {
        const endpointPath = replacePathTokens(config.listPath, { id: effectiveRecordId });
        const response = await fetch(joinUrl(apiBaseUrl, endpointPath), {
          method: "GET",
          headers: buildApiHeaders(token, companyId),
        });
        const text = await response.text();
        const payload = parseJsonSafe(text);

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload, "No se pudieron cargar los documentos."));
        }

        const normalized = extractArrayPayload(payload).map((item) =>
          normalizeAssociatedItem(item, normalizedFields),
        );
        setAssociatedItems(normalized);
        onChangeRef.current?.({ associated: normalized, pending: pendingItemsRef.current });
        return normalized;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudieron cargar los documentos.";
        setGlobalError(message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [
      apiBaseUrl,
      companyId,
      config?.listPath,
      normalizedFields,
      recordId,
      setGlobalError,
      token,
    ],
  );

  useEffect(() => {
    if (Array.isArray(prefetchedDataRef.current)) return;
    loadAssociated();
  }, [loadAssociated]);

  const removePending = useCallback(
    (pendingId) => {
      if (viewerItem?.kind === "pending" && viewerItem?.id === pendingId) {
        if (viewerItem?.__revokeOnClose && viewerItem?.url) {
          URL.revokeObjectURL(viewerItem.url);
        }
        setViewerItem(null);
      }
      setPendingItems((prev) => {
        const target = prev.find((item) => item.id === pendingId);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        const next = prev.filter((item) => item.id !== pendingId);
        return next;
      });
    },
    [viewerItem],
  );

  const uploadAndAssociateOne = useCallback(
    async (pending, effectiveRecordId) => {
      if (!pending?.file) {
        return { ok: false, error: "Archivo pendiente inválido." };
      }

      if (!canUpload || !config?.addPath) {
        return { ok: false, error: "Carga de documentos no disponible." };
      }

      setPendingItems((prev) =>
        prev.map((item) =>
          item.id === pending.id
            ? { ...item, status: "uploading", progress: 30, error: "" }
            : item,
        ),
      );

      try {
        const formData = new FormData();
        formData.append("file", pending.file);
        formData.append("moduleKey", config.upload.moduleKey);
        formData.append("entityType", config.upload.entityType);
        formData.append("entityId", String(effectiveRecordId));

        const uploadResponse = await fetch(joinUrl(apiBaseUrl, config.upload.endpoint), {
          method: "POST",
          headers: buildApiHeaders(token, companyId),
          body: formData,
        });
        const uploadText = await uploadResponse.text();
        const uploadPayload = parseJsonSafe(uploadText);

        if (!uploadResponse.ok) {
          throw new Error(extractErrorMessage(uploadPayload, "No se pudo subir el documento."));
        }

        const fileAssetId = resolveUploadedFileAssetId(uploadPayload);
        if (!fileAssetId) {
          throw new Error("No se pudo asociar el documento.");
        }

        setPendingItems((prev) =>
          prev.map((item) =>
            item.id === pending.id
              ? {
                  ...item,
                  status: "attaching",
                  progress: 70,
                  fileAssetId,
                  error: "",
                }
              : item,
          ),
        );

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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudo subir el documento.";
        setPendingItems((prev) =>
          prev.map((item) =>
            item.id === pending.id
              ? { ...item, status: "error", progress: 0, error: message }
              : item,
          ),
        );
        return { ok: false, error: message };
      }
    },
    [apiBaseUrl, canUpload, companyId, config, token],
  );

  const flushPending = useCallback(
    async (targetRecordId = null) => {
      const effectiveRecordId = targetRecordId ?? recordId;
      if (!effectiveRecordId) {
        return { ok: false, failed: [{ message: "El registro aún no existe." }], success: [] };
      }

      const candidates = pendingItems.filter(
        (item) => item.status === "pending" || item.status === "error",
      );

      if (candidates.length === 0) {
        return { ok: true, failed: [], success: [] };
      }

      const success = [];
      const failed = [];

      const uploadResults = await Promise.all(
        candidates.map(async (pending) => ({
          pending,
          result: await uploadAndAssociateOne(pending, effectiveRecordId),
        })),
      );
      for (const { pending, result } of uploadResults) {
        if (result.ok) success.push(pending.id);
        else failed.push({ id: pending.id, message: result.error ?? "Error" });
      }

      if (success.length > 0) {
        setPendingItems((prev) => {
          const toRemove = new Set(success);
          const next = [];
          for (const item of prev) {
            if (toRemove.has(item.id)) {
              if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
              continue;
            }
            next.push(item);
          }
          return next;
        });
      }

      await loadAssociated(effectiveRecordId);

      if (failed.length > 0) {
        setGlobalError("Algunos documentos no se pudieron subir. Puedes reintentar.");
      }

      return { ok: failed.length === 0, failed, success };
    },
    [loadAssociated, pendingItems, recordId, setGlobalError, uploadAndAssociateOne],
  );

  const queueFiles = useCallback(
    async (filesLike, metadata = {}) => {
      setError("");
      setNotice("");

      const files = Array.from(filesLike ?? []).filter(Boolean);
      if (files.length === 0) return;

      const accepted = [];
      for (const file of files) {
        if (!allowMultiple && accepted.length >= 1) break;
        if (accepted.length >= maxFiles) break;
        if (file.size > maxSizeMB * 1024 * 1024) {
          setNotice(`Se omitió ${file.name}: supera ${maxSizeMB} MB.`);
          continue;
        }
        accepted.push(file);
      }

      if (accepted.length === 0) return;

      const newPending = accepted.map((file) => createPendingItem(file, metadata));
      setPendingItems((prev) => {
        const base = allowMultiple ? prev : [];
        const remaining = Math.max(0, maxFiles - base.length);
        return [...base, ...newPending.slice(0, remaining)];
      });

      const effectiveRecordId = recordId;
      const shouldImmediateUpload =
        Boolean(effectiveRecordId) &&
        (context === "detail" || editMode === "upload-immediately" || createMode === "upload-immediately-if-possible");

      if (shouldImmediateUpload) {
        await Promise.all(
          newPending.map((item) => uploadAndAssociateOne(item, effectiveRecordId)),
        );
        setPendingItems((prev) => {
          const completed = prev.filter((item) => item.status === "success").map((item) => item.id);
          if (completed.length === 0) return prev;
          const next = [];
          const completedSet = new Set(completed);
          for (const item of prev) {
            if (completedSet.has(item.id)) {
              if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
              continue;
            }
            next.push(item);
          }
          return next;
        });
        await loadAssociated(effectiveRecordId);
      }
    },
    [
      allowMultiple,
      context,
      createMode,
      editMode,
      loadAssociated,
      maxFiles,
      maxSizeMB,
      recordId,
      uploadAndAssociateOne,
    ],
  );

  const retryPending = useCallback(
    async (pendingId, targetRecordId = null) => {
      const pending = pendingItems.find((item) => item.id === pendingId);
      if (!pending) return { ok: false };
      const effectiveRecordId = targetRecordId ?? recordId;
      if (!effectiveRecordId) {
        setGlobalError("Guarda el registro antes de subir documentos.");
        return { ok: false };
      }

      const result = await uploadAndAssociateOne(pending, effectiveRecordId);
      if (result.ok) {
        setPendingItems((prev) => {
          const next = [];
          for (const item of prev) {
            if (item.id === pendingId) {
              if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
              continue;
            }
            next.push(item);
          }
          return next;
        });
        await loadAssociated(effectiveRecordId);
      }
      return result;
    },
    [loadAssociated, pendingItems, recordId, setGlobalError, uploadAndAssociateOne],
  );

  const resolveSignedUrl = useCallback(
    async (fileAssetId, { inlineSignedUrl, inlineSignedUrlExpiresAt } = {}) => {
      if (!fileAssetId) throw new Error("Archivo no disponible");

      if (inlineSignedUrl && inlineSignedUrlExpiresAt) {
        const expiresAt = new Date(inlineSignedUrlExpiresAt).getTime();
        if (expiresAt - Date.now() > 60_000) return inlineSignedUrl;
      }

      const endpointTemplate =
        config?.signedUrl?.endpointTemplate ?? "/files/:fileId/signed-url";
      const endpointPath = replacePathTokens(endpointTemplate, { fileId: fileAssetId });
      const response = await fetch(joinUrl(apiBaseUrl, endpointPath), {
        method: "GET",
        headers: buildApiHeaders(token, companyId),
      });
      const text = await response.text();
      const payload = parseJsonSafe(text);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, "No se pudo abrir el archivo."));
      }
      const url = extractSignedUrlFromPayload(payload);
      if (!url) throw new Error("Archivo no disponible");
      return url;
    },
    [apiBaseUrl, companyId, config?.signedUrl?.endpointTemplate, token],
  );

  const openAssociated = useCallback(
    async (item) => {
      try {
        const signedUrl = await resolveSignedUrl(item.fileAssetId, {
          inlineSignedUrl: item.signedUrl,
          inlineSignedUrlExpiresAt: item.signedUrlExpiresAt,
        });
        setViewerItem({
          ...item,
          originalName: item.fileName,
          signedUrl,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudo abrir el archivo.";
        setGlobalError(message);
      }
    },
    [resolveSignedUrl, setGlobalError],
  );

  const openPending = useCallback(
    async (item) => {
      if (!item?.file) {
        setGlobalError("Archivo pendiente no disponible.");
        return { ok: false };
      }

      const resolvedType = resolveAttachmentFileType({
        mimeType: item.mimeType,
        fileName: item.fileName,
      });

      if (resolvedType.kind === "image" || resolvedType.kind === "pdf") {
        let localUrl = item.previewUrl ?? null;
        let shouldRevokeOnClose = false;

        if (!localUrl) {
          localUrl = URL.createObjectURL(item.file);
          shouldRevokeOnClose = true;
        }

        setViewerItem({
          ...item,
          originalName: item.fileName,
          url: localUrl,
          signedUrl: localUrl,
          __revokeOnClose: shouldRevokeOnClose,
        });
        return { ok: true };
      }

      const fallbackUrl = URL.createObjectURL(item.file);
      try {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(fallbackUrl), 120000);
        return { ok: true };
      } catch {
        URL.revokeObjectURL(fallbackUrl);
        throw new Error("No se pudo abrir el archivo.");
      }
    },
    [setGlobalError],
  );

  const downloadAssociated = useCallback(
    async (item) => {
      try {
        const signedUrl = await resolveSignedUrl(item.fileAssetId);
        const link = document.createElement("a");
        link.href = signedUrl;
        link.download = item.fileName ?? "documento";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudo abrir el archivo.";
        setGlobalError(message);
      }
    },
    [resolveSignedUrl, setGlobalError],
  );

  const removeAssociated = useCallback(
    async (item, idOverride = null) => {
      const effectiveRecordId = idOverride ?? recordId;
      if (!canWrite || !effectiveRecordId || !config?.removePath) return { ok: false };
      const docId = item.associationId;
      if (!docId) {
        setGlobalError("No se pudo quitar el documento.");
        return { ok: false };
      }

      try {
        const endpointPath = replacePathTokens(config.removePath, {
          id: effectiveRecordId,
          docId,
        });
        const response = await fetch(joinUrl(apiBaseUrl, endpointPath), {
          method: "DELETE",
          headers: buildApiHeaders(token, companyId),
        });
        const text = await response.text();
        const payload = parseJsonSafe(text);

        if (!response.ok && response.status !== 404) {
          throw new Error(extractErrorMessage(payload, "No se pudo quitar el documento."));
        }

        if (response.status === 404) {
          setNotice("El documento ya no estaba disponible. Se actualizó la lista.");
        }

        await loadAssociated(effectiveRecordId);
        return { ok: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudo quitar el documento.";
        setGlobalError(message);
        return { ok: false, error: message };
      }
    },
    [apiBaseUrl, canWrite, companyId, config?.removePath, loadAssociated, recordId, setGlobalError, token],
  );

  // Gated on canWrite too: setCover/reorder no-op on a read-only view (see
  // below), so the star/reorder affordances must not render there either.
  const canManageCover = canWrite && Boolean(config?.coverPath);

  const setCover = useCallback(
    async (item, idOverride = null) => {
      const effectiveRecordId = idOverride ?? recordId;
      if (!canWrite || !effectiveRecordId || !config?.coverPath) return { ok: false };
      const docId = item.associationId;
      if (!docId) {
        setGlobalError("No se pudo actualizar la portada.");
        return { ok: false };
      }

      try {
        const endpointPath = replacePathTokens(config.coverPath, {
          id: effectiveRecordId,
          docId,
        });
        const response = await fetch(joinUrl(apiBaseUrl, endpointPath), {
          method: "PATCH",
          headers: buildApiHeaders(token, companyId),
        });
        const text = await response.text();
        const payload = parseJsonSafe(text);

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload, "No se pudo actualizar la portada."));
        }

        await loadAssociated(effectiveRecordId);
        return { ok: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudo actualizar la portada.";
        setGlobalError(message);
        return { ok: false, error: message };
      }
    },
    [apiBaseUrl, canWrite, companyId, config?.coverPath, loadAssociated, recordId, setGlobalError, token],
  );

  const reorderItems = useCallback(
    async (orderedItems, idOverride = null) => {
      const effectiveRecordId = idOverride ?? recordId;
      if (!canWrite || !effectiveRecordId || !config?.reorderPath) return { ok: false };
      if (!Array.isArray(orderedItems) || orderedItems.length === 0) return { ok: false };

      try {
        const endpointPath = replacePathTokens(config.reorderPath, { id: effectiveRecordId });
        const response = await fetch(joinUrl(apiBaseUrl, endpointPath), {
          method: "PATCH",
          headers: buildApiHeaders(token, companyId, { "Content-Type": "application/json" }),
          body: JSON.stringify({ items: orderedItems }),
        });
        const text = await response.text();
        const payload = parseJsonSafe(text);

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload, "No se pudieron reordenar los documentos."));
        }

        await loadAssociated(effectiveRecordId);
        return { ok: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudieron reordenar los documentos.";
        setGlobalError(message);
        return { ok: false, error: message };
      }
    },
    [apiBaseUrl, canWrite, companyId, config?.reorderPath, loadAssociated, recordId, setGlobalError, token],
  );

  const closeViewer = useCallback(() => {
    setViewerItem((current) => {
      if (current?.__revokeOnClose && current?.url) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const item of pendingItems) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, [pendingItems]);

  useEffect(() => {
    return () => {
      if (viewerItem?.__revokeOnClose && viewerItem?.url) {
        URL.revokeObjectURL(viewerItem.url);
      }
    };
  }, [viewerItem]);

  return {
    associatedItems,
    pendingItems,
    loading,
    error,
    notice,
    viewerItem,
    canWrite,
    canUpload,
    allowMultiple,
    maxFiles,
    maxSizeMB,
    createMode,
    editMode,
    queueFiles,
    loadAssociated,
    flushPending,
    retryPending,
    removePending,
    removeAssociated,
    canManageCover,
    setCover,
    reorderItems,
    openPending,
    openAssociated,
    downloadAssociated,
    resolveSignedUrl,
    closeViewer,
    setError: setGlobalError,
    setNotice,
  };
}
