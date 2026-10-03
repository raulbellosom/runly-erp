import { useQueryClient } from "@tanstack/react-query";
import { RunlyDetail, RunlyForm, RunlyTable } from "../../runly-renderer/index.js";
import { EmptyState } from "../EmptyState.jsx";
import { ErrorState } from "../ErrorState.jsx";
import { Skeleton } from "../Skeleton.jsx";
import { useModuleRuntime } from "../../lib/module-runtime/ModuleRuntimeContext.jsx";
import { useEntityRecord } from "../../lib/module-runtime/useEntity.js";
import { entityFields, entityQueryKey, findEntityBlueprint } from "../../lib/module-runtime/entity-helpers.js";

// Entity screens for CUSTOM views (spec 2026-10-03-rme3-module-platform-v2
// §5.4): thin wrappers over the standard blueprint renderers (the same ones
// the Builder's TABLE / FORM / DETAIL views use), fed with the module's own
// blueprint and session from the module runtime. Same look as the rest of
// Runly with one line, inside a screen of your own.

function useEntityBlueprint(kind, entity) {
  const runtime = useModuleRuntime();
  return {
    runtime,
    blueprint: findEntityBlueprint(runtime.blueprints, kind, entity),
    fields: entityFields(runtime.blueprints, entity),
  };
}

function MissingView({ kind, entity }) {
  return (
    <EmptyState
      title="Vista no disponible"
      description={`El módulo no tiene una vista ${kind} para la entidad "${entity}". Agrégala en el Constructor.`}
    />
  );
}

// Paged, searchable table of an entity. onView/onEdit receive the row.
export function EntityTable({ entity, onCreate, onView, onEdit, refreshSignal, initialFilters }) {
  const { runtime, blueprint } = useEntityBlueprint("TABLE", entity);
  if (!blueprint) return <MissingView kind="TABLE" entity={entity} />;
  return (
    <RunlyTable
      blueprint={blueprint}
      token={runtime.token}
      companyId={runtime.companyId}
      apiBaseUrl={runtime.apiBaseUrl}
      onCreate={onCreate}
      onView={onView}
      onEdit={onEdit}
      refreshSignal={refreshSignal}
      initialFilters={initialFilters}
    />
  );
}

// Create (no recordId) or edit form of an entity, with its sections, field
// types, validation and relations exactly as designed in the Builder.
export function EntityForm({ entity, recordId, initialData, onSaved, onCancel, showFooter = true }) {
  const { runtime, blueprint, fields } = useEntityBlueprint("FORM", entity);
  const queryClient = useQueryClient();
  const record = useEntityRecord(entity, recordId, { enabled: Boolean(blueprint && recordId && !initialData) });
  if (!blueprint) return <MissingView kind="FORM" entity={entity} />;
  if (recordId && !initialData) {
    if (record.isLoading) return <Skeleton className="h-64 w-full" />;
    if (record.error) return <ErrorState description={record.error.message} onRetry={record.refetch} />;
  }
  return (
    <RunlyForm
      blueprint={blueprint}
      fields={fields}
      mode={recordId ? "edit" : "create"}
      initialData={initialData ?? record.data ?? undefined}
      token={runtime.token}
      companyId={runtime.companyId}
      apiBaseUrl={runtime.apiBaseUrl}
      blueprints={runtime.blueprints}
      showFooter={showFooter}
      onCancel={onCancel}
      onSuccess={(saved) => {
        queryClient.invalidateQueries({ queryKey: entityQueryKey(runtime.moduleKey, entity) });
        onSaved?.(saved);
      }}
    />
  );
}

// Read-only detail of one record (sections, hero, attachments).
export function EntityDetail({ entity, recordId, onEdit, onBack, heroActions }) {
  const { runtime, blueprint, fields } = useEntityBlueprint("DETAIL", entity);
  const record = useEntityRecord(entity, recordId, { enabled: Boolean(blueprint) });
  if (!blueprint) return <MissingView kind="DETAIL" entity={entity} />;
  if (record.error) return <ErrorState description={record.error.message} onRetry={record.refetch} />;
  return (
    <RunlyDetail
      blueprint={blueprint}
      fields={fields}
      data={record.data ?? undefined}
      loading={record.isLoading}
      token={runtime.token}
      companyId={runtime.companyId}
      apiBaseUrl={runtime.apiBaseUrl}
      onEdit={onEdit}
      onBack={onBack}
      heroActions={heroActions}
    />
  );
}
