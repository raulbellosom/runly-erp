import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/Alert.jsx";
import { Button } from "../components/Button.jsx";
import { DetailActionBar } from "../components/DetailActionBar.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { FormSkeleton } from "../components/Skeleton.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/Sheet.jsx";
import { RunlyDetail } from "./RunlyDetail.jsx";
import { RunlyForm } from "./RunlyForm.jsx";
import { RunlyTable } from "./RunlyTable.jsx";
import {
  shouldUsePageMode,
  resolveAccentColor,
  resolveFormMode,
} from "./renderer-adapters.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";

const MODES = new Set(["list", "create", "detail", "edit"]);

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function getApiPath(blueprint) {
  const schema = blueprint?.schema ?? {};
  return typeof schema.apiPath === "string" ? schema.apiPath.trim() : "";
}

function resolveIdFromRow(row) {
  if (!row || typeof row !== "object") return null;
  return row.id ?? row.recordId ?? row.uuid ?? row.ID ?? null;
}

function resolveRowLabel(row) {
  if (!row || typeof row !== "object") return null;
  return (
    row.name ??
    row.nombre ??
    row.full_name ??
    row.fullName ??
    row.title ??
    row.titulo ??
    row.description ??
    row.plate ??
    row.placa ??
    row.code ??
    row.codigo ??
    String(row.id ?? "este registro")
  );
}

function replacePathTokens(pathTemplate, tokenMap) {
  let path = String(pathTemplate ?? "");
  for (const [key, value] of Object.entries(tokenMap ?? {})) {
    const safeValue = encodeURIComponent(String(value ?? ""));
    path = path.replace(new RegExp(`:${key}\\b`, "g"), safeValue);
  }
  return path;
}

function isActionVisible(action, record) {
  const rule = action?.visibleWhen;
  if (!rule || !record || typeof record !== "object") return true;
  const fieldName = String(rule.field ?? "").trim();
  if (!fieldName) return true;
  const value = record[fieldName];
  if (Object.prototype.hasOwnProperty.call(rule, "equals")) {
    return value === rule.equals;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "notEquals")) {
    return value !== rule.notEquals;
  }
  if (Array.isArray(rule.in)) {
    return rule.in.includes(value);
  }
  return true;
}

export const RunlyCrudView = forwardRef(function RunlyCrudView({
  tableBlueprint,
  formBlueprint,
  detailBlueprint,
  fields,
  token,
  companyId = null,
  apiBaseUrl,
  componentRegistry = null,
  suppressToolbarCreate = false,
  initialMode = "list",
  recordId = null,
  module = null,
  blueprints = null,
  resolveBlueprintByKey = null,
  onNavigate,
  onCreateSuccess,
  onEditSuccess,
  onDeleteSuccess,
}, ref) {
  const tableApiPath = getApiPath(tableBlueprint);
  const resolvedInitialMode = MODES.has(initialMode) ? initialMode : "list";
  const accentColor = resolveAccentColor(module, tableBlueprint);

  const currentFormBlueprint = formBlueprint ?? tableBlueprint;
  const currentDetailBlueprint = detailBlueprint ?? tableBlueprint;
  const formMode = useMemo(
    () => resolveFormMode(currentFormBlueprint?.schema),
    [currentFormBlueprint],
  );

  const pageMode = useMemo(
    () =>
      formMode === "page"
        ? true
        : formMode === "sheet"
          ? false
          : shouldUsePageMode(currentFormBlueprint?.schema, fields),
    [currentFormBlueprint, fields, formMode],
  );

  const [mode, setMode] = useState(resolvedInitialMode);
  const [activeRecordId, setActiveRecordId] = useState(recordId ?? null);
  const [recordData, setRecordData] = useState(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [headerActionLoadingKey, setHeaderActionLoadingKey] = useState("");
  const [refreshSignal, setRefreshSignal] = useState(0);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const shouldOpenSheet =
    !pageMode && (mode === "create" || mode === "detail" || mode === "edit");
  const showPageContent =
    mode === "create" || mode === "detail" || mode === "edit";

  useEffect(() => {
    setMode(resolvedInitialMode);
  }, [resolvedInitialMode]);

  useEffect(() => {
    setActiveRecordId(recordId ?? null);
  }, [recordId]);

  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  });

  useEffect(() => {
    onNavigateRef.current?.({ mode, recordId: activeRecordId ?? null });
  }, [activeRecordId, mode]);

  const fetchRecord = useCallback(
    async (nextRecordId) => {
      if (!tableApiPath || !nextRecordId) return;
      setLoadingRecord(true);
      setRecordError("");
      try {
        const endpoint = `${joinUrl(apiBaseUrl, tableApiPath)}/${encodeURIComponent(String(nextRecordId))}`;
        const response = await fetch(endpoint, {
          method: "GET",
          headers: buildApiHeaders(token, companyId),
        });
        if (!response.ok) {
          const text = await response.text();
          let message = "No se pudo cargar el registro.";
          try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed?.error) message = parsed.error;
          } catch {
            if (text) message = text;
          }
          throw new Error(message);
        }
        const payload = await response.json();
        setRecordData(payload?.data ?? null);
      } catch (err) {
        setRecordData(null);
        setRecordError(
          err instanceof Error ? err.message : "No se pudo cargar el registro.",
        );
      } finally {
        setLoadingRecord(false);
      }
    },
    [apiBaseUrl, tableApiPath, token, companyId],
  );

  useEffect(() => {
    if ((mode === "detail" || mode === "edit") && activeRecordId) {
      fetchRecord(activeRecordId);
      return;
    }
    setRecordData(null);
    setRecordError("");
    setLoadingRecord(false);
  }, [activeRecordId, fetchRecord, mode]);

  const goToList = () => {
    setMode("list");
    setRecordError("");
    setLoadingRecord(false);
  };

  const openCreate = () => {
    if (!currentFormBlueprint) return;
    setMode("create");
  };

  const openDetail = (row) => {
    const nextId = resolveIdFromRow(row);
    if (!nextId) return;
    // In sheet (non-page) mode, delegate to the parent navigator immediately so
    // the route transition begins before this component re-renders. This prevents
    // the sheet from flashing open for one frame before the navigation lands.
    if (!pageMode && onNavigateRef.current) {
      onNavigateRef.current({ mode: "detail", recordId: nextId });
      return;
    }
    setActiveRecordId(nextId);
    setMode("detail");
  };

  const openEdit = (row) => {
    const nextId = resolveIdFromRow(row);
    if (!nextId) return;
    // Same early-navigate pattern as openDetail.
    if (!pageMode && onNavigateRef.current) {
      onNavigateRef.current({ mode: "edit", recordId: nextId });
      return;
    }
    setActiveRecordId(nextId);
    setMode("edit");
  };

  // Expose imperative API so parent shells can trigger navigation without URL changes.
  useImperativeHandle(ref, () => ({
    openCreate() {
      if (!currentFormBlueprint) return;
      setMode("create");
      setActiveRecordId(null);
      setRecordData(null);
    },
    openDetail(id) {
      if (!id) return;
      setActiveRecordId(id);
      setMode("detail");
    },
    openEdit(id) {
      if (!id) return;
      setActiveRecordId(id);
      setMode("edit");
    },
    goToList() {
      goToList();
    },
  }), [currentFormBlueprint]);

  const requestDelete = (row) => {
    setPendingDeleteRow(row);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    const id = resolveIdFromRow(pendingDeleteRow);
    if (!id || !tableApiPath) return;
    setDeleting(true);
    try {
      const endpoint = `${joinUrl(apiBaseUrl, tableApiPath)}/${encodeURIComponent(String(id))}`;
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: buildApiHeaders(token, companyId),
      });
      if (!response.ok) {
        const text = await response.text();
        let message = "No se pudo eliminar el registro.";
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed?.error) message = parsed.error;
        } catch {
          if (text) message = text;
        }
        throw new Error(message);
      }
      setDeleteConfirmOpen(false);
      setPendingDeleteRow(null);
      setRefreshSignal((c) => c + 1);
      onDeleteSuccess?.();
    } catch (err) {
      setRecordError(
        err instanceof Error ? err.message : "No se pudo eliminar el registro.",
      );
      setDeleteConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleFormSuccess = (result) => {
    const wasCreate = mode === "create";
    goToList();
    setActiveRecordId(null);
    setRefreshSignal((c) => c + 1);
    if (wasCreate) onCreateSuccess?.(result);
    else onEditSuccess?.(result);
  };

  const detailHeaderActions = useMemo(() => {
    const actions = currentDetailBlueprint?.schema?.headerActions;
    return Array.isArray(actions) ? actions : [];
  }, [currentDetailBlueprint]);

  const executeHeaderAction = useCallback(
    async (action) => {
      if (!action || !recordData) return;
      const recordId = resolveIdFromRow(recordData);
      if (!recordId) return;
      const actionKey = String(action.key ?? action.label ?? "action");
      const method = String(action.method ?? "POST").toUpperCase();
      const endpointPath = replacePathTokens(action.pathTemplate ?? "", { id: recordId });
      if (!endpointPath) return;

      setHeaderActionLoadingKey(actionKey);
      setRecordError("");
      try {
        const response = await fetch(joinUrl(apiBaseUrl, endpointPath), {
          method,
          headers: buildApiHeaders(token, companyId),
        });
        if (!response.ok) {
          const text = await response.text();
          let message = "No se pudo ejecutar la accion.";
          try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed?.error) message = parsed.error;
          } catch {
            if (text) message = text;
          }
          throw new Error(message);
        }

        if (action.download === true) {
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = String(action.downloadFileName ?? `${recordId}.pdf`);
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(objectUrl);
        }

        if (action.refreshAfter !== false) {
          await fetchRecord(recordId);
          setRefreshSignal((count) => count + 1);
        }
      } catch (error) {
        setRecordError(
          error instanceof Error ? error.message : "No se pudo ejecutar la accion.",
        );
      } finally {
        setHeaderActionLoadingKey("");
      }
    },
    [apiBaseUrl, fetchRecord, recordData, token, companyId],
  );

  const renderRecordLoadingOrError = () => {
    if (loadingRecord) {
      return <FormSkeleton />;
    }
    if (recordError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{recordError}</AlertDescription>
        </Alert>
      );
    }
    return null;
  };

  if (!tableApiPath) {
    return (
      <Alert variant="warning">
        <AlertTitle>Vista sin configuración</AlertTitle>
        <AlertDescription>
          La vista de tabla no tiene <code>schema.apiPath</code>. No se puede
          renderizar el CRUD.
        </AlertDescription>
      </Alert>
    );
  }

  const deleteLabel = pendingDeleteRow ? resolveRowLabel(pendingDeleteRow) : "";

  return (
    <div className="space-y-4">
      {/* Page mode: show form/detail directly in page, hide table */}
      {pageMode && showPageContent ? (
        <div className="space-y-4">
          {mode === "create" && currentFormBlueprint && (
            <>
              <PageHeader
                compact
                title={
                  currentFormBlueprint?.schema?.title ??
                  currentFormBlueprint?.title ??
                  tableBlueprint?.schema?.actions?.[0]?.label ??
                  "Nuevo registro"
                }
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={goToList}>
                      Cancelar
                    </Button>
                    <Button type="submit" form="runly-crud-form" size="sm">
                      Guardar
                    </Button>
                  </div>
                }
              />
              <RunlyForm
                id="runly-crud-form"
                blueprint={currentFormBlueprint}
                fields={fields}
                initialData={{}}
                mode="create"
                token={token}
                companyId={companyId}
                apiBaseUrl={apiBaseUrl}
                blueprints={blueprints}
                resolveBlueprintByKey={resolveBlueprintByKey}
                onSuccess={handleFormSuccess}
                onCancel={goToList}
              />
            </>
          )}

          {mode === "detail" && currentDetailBlueprint && (() => {
            const heroEnabled = Boolean(currentDetailBlueprint?.schema?.hero);
            const detailActions = (
              <DetailActionBar
                primary={
                  currentFormBlueprint
                    ? { label: "Editar", onClick: () => setMode("edit") }
                    : null
                }
                secondary={[
                  {
                    label: "Volver",
                    icon: <ArrowLeft className="h-4 w-4" />,
                    onClick: goToList,
                  },
                  ...detailHeaderActions
                    .filter((action) => isActionVisible(action, recordData))
                    .map((action) => {
                      const actionKey = String(action.key ?? action.label ?? "action");
                      return {
                        label: action.label ?? "Accion",
                        onClick: () => executeHeaderAction(action),
                        loading: headerActionLoadingKey === actionKey,
                        destructive: action.variant === "destructive",
                      };
                    }),
                ]}
              />
            );
            return (
              <>
                {!heroEnabled && (
                  <PageHeader
                    compact
                    eyebrow={
                      currentDetailBlueprint?.schema?.title ??
                      currentDetailBlueprint?.title ??
                      null
                    }
                    title={
                      recordData
                        ? resolveRowLabel(recordData)
                        : (currentDetailBlueprint?.schema?.title ??
                          currentDetailBlueprint?.title ??
                          "Detalle")
                    }
                    actions={detailActions}
                  />
                )}
                {renderRecordLoadingOrError() ??
                  (recordData && (
                    <RunlyDetail
                      blueprint={currentDetailBlueprint}
                      fields={fields}
                      data={recordData}
                      accentColor={accentColor}
                      token={token}
                companyId={companyId}
                      apiBaseUrl={apiBaseUrl}
                      componentRegistry={componentRegistry}
                      onBack={heroEnabled ? goToList : undefined}
                      heroActions={heroEnabled ? detailActions : undefined}
                    />
                  ))}
              </>
            );
          })()}

          {mode === "edit" && currentFormBlueprint && (
            <>
              <PageHeader
                compact
                eyebrow={
                  currentFormBlueprint?.schema?.title ??
                  currentFormBlueprint?.title ??
                  null
                }
                title={recordData ? resolveRowLabel(recordData) : "Editar registro"}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={goToList}>
                      Cancelar
                    </Button>
                    <Button type="submit" form="runly-crud-form" size="sm">
                      Guardar cambios
                    </Button>
                  </div>
                }
              />
              {renderRecordLoadingOrError() ??
                (recordData && (
                  <RunlyForm
                    id="runly-crud-form"
                    blueprint={currentFormBlueprint}
                    fields={fields}
                    initialData={recordData}
                    mode="edit"
                    token={token}
                companyId={companyId}
                    apiBaseUrl={apiBaseUrl}
                    blueprints={blueprints}
                    resolveBlueprintByKey={resolveBlueprintByKey}
                    onSuccess={handleFormSuccess}
                    onCancel={goToList}
                  />
                ))}
            </>
          )}
        </div>
      ) : (
        /* Normal mode: table always visible, sheet for create/detail/edit */
        <>
          <RunlyTable
            key={tableBlueprint?.key ?? tableApiPath}
            blueprint={tableBlueprint}
            token={token}
                companyId={companyId}
            apiBaseUrl={apiBaseUrl}
            componentRegistry={componentRegistry}
            accentColor={accentColor}
            onCreate={
              !suppressToolbarCreate && currentFormBlueprint
                ? openCreate
                : undefined
            }
            onView={currentDetailBlueprint ? openDetail : undefined}
            onEdit={currentFormBlueprint ? openEdit : undefined}
            onDelete={requestDelete}
            refreshSignal={refreshSignal}
          />

          <Sheet
            open={shouldOpenSheet}
            onOpenChange={(open) => {
              if (!open && !pageMode) goToList();
            }}
          >
            <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
              {mode === "create" && currentFormBlueprint && (
                <>
                  <SheetHeader className="shrink-0">
                    <SheetTitle>
                      {currentFormBlueprint?.title
                        ?? tableBlueprint?.schema?.actions?.[0]?.label
                        ?? "Nuevo registro"}
                    </SheetTitle>
                    <SheetDescription>
                      Completa la información y guarda los cambios.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="md:flex-1 md:min-h-0 md:overflow-y-auto pr-1">
                    <RunlyForm
                      blueprint={currentFormBlueprint}
                      fields={fields}
                      initialData={{}}
                      mode="create"
                      token={token}
                companyId={companyId}
                      apiBaseUrl={apiBaseUrl}
                      blueprints={blueprints}
                      resolveBlueprintByKey={resolveBlueprintByKey}
                      onSuccess={handleFormSuccess}
                      onCancel={goToList}
                    />
                  </div>
                </>
              )}

              {mode === "detail" && currentDetailBlueprint && (
                <>
                  <SheetHeader className="shrink-0">
                    <SheetTitle>
                      {resolveRowLabel(recordData)
                        ?? currentDetailBlueprint?.title
                        ?? "Detalle"}
                    </SheetTitle>
                    <SheetDescription>
                      Información del registro seleccionado.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="md:flex-1 md:min-h-0 md:overflow-y-auto pr-1">
                    {renderRecordLoadingOrError() ??
                      (recordData && (
                        <RunlyDetail
                          blueprint={currentDetailBlueprint}
                          fields={fields}
                          data={recordData}
                          accentColor={accentColor}
                          token={token}
                companyId={companyId}
                          apiBaseUrl={apiBaseUrl}
                          onEdit={
                            currentFormBlueprint
                              ? () => setMode("edit")
                              : undefined
                          }
                        />
                      ))}
                  </div>
                </>
              )}

              {mode === "edit" && currentFormBlueprint && (
                <>
                  <SheetHeader className="shrink-0">
                    <SheetTitle>
                      {resolveRowLabel(recordData)
                        ? `Editar: ${resolveRowLabel(recordData)}`
                        : (currentFormBlueprint?.title ?? "Editar registro")}
                    </SheetTitle>
                    <SheetDescription>
                      Actualiza la información del registro.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="md:flex-1 md:min-h-0 md:overflow-y-auto pr-1">
                    {renderRecordLoadingOrError() ??
                      (recordData && (
                        <RunlyForm
                          blueprint={currentFormBlueprint}
                          fields={fields}
                          initialData={recordData}
                          mode="edit"
                          token={token}
                companyId={companyId}
                          apiBaseUrl={apiBaseUrl}
                          blueprints={blueprints}
                          resolveBlueprintByKey={resolveBlueprintByKey}
                          onSuccess={handleFormSuccess}
                          onCancel={goToList}
                        />
                      ))}
                  </div>
                </>
              )}
            </SheetContent>
          </Sheet>
        </>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Eliminar registro"
        description="Esta acción no se puede deshacer. ¿Deseas continuar?"
        detail={deleteLabel || undefined}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
});
