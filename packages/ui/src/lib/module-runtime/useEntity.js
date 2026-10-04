import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { buildApiHeaders } from "../apiHeaders.js";
import { useModuleRuntime } from "./ModuleRuntimeContext.jsx";
import { buildListUrl, entityApiPath, entityQueryKey } from "./entity-helpers.js";

// Data hooks for one entity of the current module (spec
// 2026-10-03-rme3-module-platform-v2 §5.4). They call the REST API the
// Builder generates for the entity (docs/developers/api-modulos.md), with the
// session and company headers, and show Spanish error toasts.

async function request(url, { token, companyId, transport, method = "GET", body } = {}) {
  const res = await (transport?.fetch ?? globalThis.fetch)(url, {
    method,
    headers: buildApiHeaders(token, companyId, body ? { "Content-Type": "application/json" } : undefined),
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(payload?.error ?? `No se pudo completar la operación (${res.status}).`);
    error.status = res.status;
    error.details = payload;
    throw error;
  }
  return payload;
}

// apiPath is null when the module has no view for the entity: queries stay
// disabled and mutations reject with a clear message instead of crashing.
function useEntityContext(entity) {
  const runtime = useModuleRuntime();
  return { ...runtime, apiPath: entityApiPath(runtime.blueprints, entity) };
}

function requireApiPath(apiPath, entity) {
  if (!apiPath) throw new Error(`La entidad "${entity}" no tiene vistas en este módulo.`);
  return apiPath;
}

// { data: [...], pagination: { page, pageSize, total, totalPages } }
export function useEntityList(entity, { page = 1, pageSize = 20, search = "", filters = {}, enabled = true } = {}) {
  const { moduleKey, token, companyId, apiBaseUrl, apiPath, transport, sessionId } = useEntityContext(entity);
  return useQuery({
    queryKey: entityQueryKey(sessionId ?? moduleKey, entity, "list", { page, pageSize, search, filters, companyId }),
    queryFn: () => request(buildListUrl(apiBaseUrl, apiPath, { page, pageSize, search, filters }), { token, companyId, transport }),
    enabled: Boolean((token || transport) && apiPath) && enabled,
    placeholderData: (previous) => previous,
  });
}

// The record object itself (the API's `data`), or undefined while loading.
export function useEntityRecord(entity, id, { enabled = true } = {}) {
  const { moduleKey, token, companyId, apiBaseUrl, apiPath, transport, sessionId } = useEntityContext(entity);
  return useQuery({
    queryKey: entityQueryKey(sessionId ?? moduleKey, entity, "record", id, companyId),
    queryFn: async () => (await request(`${apiBaseUrl}${apiPath}/${id}`, { token, companyId, transport }))?.data ?? null,
    enabled: Boolean((token || transport) && id && apiPath) && enabled,
  });
}

// create(values) / update(id, values) / disable(id), each a mutation with
// toasts and cache invalidation of the entity's lists and records.
export function useEntityMutations(entity, { successMessages = {} } = {}) {
  const { moduleKey, token, companyId, apiBaseUrl, apiPath, transport, sessionId } = useEntityContext(entity);
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: entityQueryKey(sessionId ?? moduleKey, entity) });
  const onError = (error) => toast.error(error.message);

  const create = useMutation({
    mutationFn: (values) => request(`${apiBaseUrl}${requireApiPath(apiPath, entity)}`, { token, companyId, transport, method: "POST", body: values }),
    onSuccess: () => { invalidate(); toast.success(successMessages.create ?? "Registro creado."); },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, values }) => request(`${apiBaseUrl}${requireApiPath(apiPath, entity)}/${id}`, { token, companyId, transport, method: "PATCH", body: values }),
    onSuccess: () => { invalidate(); toast.success(successMessages.update ?? "Cambios guardados."); },
    onError,
  });
  const disable = useMutation({
    mutationFn: (id) => request(`${apiBaseUrl}${requireApiPath(apiPath, entity)}/${id}/enabled`, { token, companyId, transport, method: "PATCH", body: { enabled: false } }),
    onSuccess: () => { invalidate(); toast.success(successMessages.disable ?? "Registro desactivado."); },
    onError,
  });

  return { create, update, disable };
}
