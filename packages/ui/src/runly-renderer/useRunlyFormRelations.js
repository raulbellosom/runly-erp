// Extracted from RunlyForm.jsx (2026-09-15) to keep that file under the
// project's file-size ceiling. Owns everything about `type: "relation"`
// fields: remote option loading/caching, search debouncing, and the
// inline-create dialog / quick-create flows. See RunlyForm.jsx for how the
// returned values are consumed inside renderFieldControl's "relation" case
// and the inline-create <Dialog>.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeRelationDescriptor } from "./renderer-adapters.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import {
  joinUrl,
  resolveRelationLabel,
  extractBlueprintRows,
  extractFieldsFromBlueprint,
  extractCreatedRecord,
  buildInlineCreatePrefill,
} from "./runly-form-utils.js";

// Module-level cache for relation field options. Persists across modal open/close cycles.
const _relationOptionsCache = new Map();
const _RELATION_CACHE_TTL = 5 * 60 * 1000;

export function useRunlyFormRelations({
  apiBaseUrl,
  token,
  companyId,
  fieldMap,
  initialData,
  resetInitialDataToken,
  formValuesRef,
  setFormValues,
  setFieldErrors,
  blueprint,
  blueprints,
  resolveBlueprintByKey,
  allowInlineCreate,
  inlineCreateDepth,
}) {
  const [relationState, setRelationState] = useState({});
  const [relationInlineErrors, setRelationInlineErrors] = useState({});
  const [inlineCreateState, setInlineCreateState] = useState({
    open: false,
    fieldName: null,
    descriptor: null,
    blueprint: null,
    prefillData: {},
    searchText: "",
  });
  const [quickCreatingField, setQuickCreatingField] = useState(null);
  const [nestedBlueprintRows, setNestedBlueprintRows] = useState(null);
  const nestedBlueprintFields = useMemo(
    () => extractFieldsFromBlueprint(inlineCreateState.blueprint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inlineCreateState.blueprint],
  );
  const relationDebounceRef = useRef({});

  const clearRelationInlineError = useCallback((name) => {
    setRelationInlineErrors((prev) => ({ ...prev, [name]: "" }));
  }, []);

  const loadRelationOptions = useCallback(
    async (fieldName, descriptor, search) => {
      const url = new URL(joinUrl(apiBaseUrl, descriptor.apiPath));
      url.searchParams.set(descriptor.pageParam, "1");
      url.searchParams.set(descriptor.pageSizeParam, String(descriptor.pageSize));
      if (search) url.searchParams.set(descriptor.searchParam, search);
      const cacheKey = url.toString();

      if (!search) {
        const cached = _relationOptionsCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < _RELATION_CACHE_TTL) {
          setRelationState((prev) => ({
            ...prev,
            [fieldName]: { options: cached.options, loading: false, error: null },
          }));
          return true;
        }
      }

      setRelationState((prev) => ({
        ...prev,
        [fieldName]: { options: prev[fieldName]?.options ?? [], loading: true, error: null },
      }));
      try {
        const res = await fetch(cacheKey, { headers: buildApiHeaders(token, companyId) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
        const options = rows
          .map((row) => {
            const df = descriptor.displayFields;
            let meta = null;
            if (df) {
              const rawMeta = {
                badge: df.badge ? String(row[df.badge] ?? "").trim() : null,
                title: df.title ? String(row[df.title] ?? "").trim() : null,
                subtitle: df.subtitle
                  ? Array.isArray(df.subtitle)
                    ? df.subtitle.map((f) => row[f]).filter(Boolean).join(" • ")
                    : String(row[df.subtitle] ?? "").trim()
                  : null,
              };
              meta = rawMeta.badge || rawMeta.title || rawMeta.subtitle ? rawMeta : null;
            }
            return {
              value: String(row[descriptor.valueField] ?? ""),
              label: resolveRelationLabel(row, descriptor),
              disabled: descriptor.disabledField ? row[descriptor.disabledField] === false : false,
              meta,
            };
          })
          .filter((o) => o.value);
        if (!search) {
          _relationOptionsCache.set(cacheKey, { options, ts: Date.now() });
        }
        setRelationState((prev) => {
          const currentOptions = prev[fieldName]?.options ?? [];
          const selectedValue = formValuesRef.current?.[fieldName];
          const normalizedSelectedValue =
            selectedValue === undefined || selectedValue === null || selectedValue === ""
              ? null
              : String(selectedValue);
          const hasSelectedInFetched =
            normalizedSelectedValue != null &&
            options.some((item) => String(item?.value ?? "") === normalizedSelectedValue);
          const selectedFallback =
            normalizedSelectedValue != null && !hasSelectedInFetched
              ? currentOptions.find((item) => String(item?.value ?? "") === normalizedSelectedValue)
              : null;
          const mergedOptions = selectedFallback ? [selectedFallback, ...options] : options;
          return {
            ...prev,
            [fieldName]: { options: mergedOptions, loading: false, error: null },
          };
        });
        return true;
      } catch {
        setRelationState((prev) => ({
          ...prev,
          [fieldName]: { options: prev[fieldName]?.options ?? [], loading: false, error: true },
        }));
        return false;
      }
    },
    [apiBaseUrl, token, companyId, formValuesRef],
  );

  useEffect(() => {
    for (const [, field] of fieldMap.entries()) {
      if (field.type !== "relation") continue;
      const descriptor = normalizeRelationDescriptor(field);
      if (descriptor?.source === "remote" && descriptor.preload) {
        loadRelationOptions(field.name, descriptor, "");
      }
    }
  }, [fieldMap, loadRelationOptions]);

  useEffect(() => {
    if (!initialData || typeof initialData !== "object") return;
    for (const [fieldName, field] of fieldMap.entries()) {
      if (field.type !== "relation") continue;
      const descriptor = normalizeRelationDescriptor(field);
      if (!descriptor) continue;
      const value = initialData[fieldName];
      if (value == null || value === "") continue;

      const labelFields = Array.isArray(descriptor.labelField)
        ? descriptor.labelField
        : typeof descriptor.labelField === "string"
          ? [descriptor.labelField]
          : [];
      const labelParts = labelFields
        .map((f) => (initialData[f] != null ? String(initialData[f]).trim() : ""))
        .filter(Boolean);
      if (labelParts.length === 0) continue;

      const seedOption = {
        value: String(value),
        label: labelParts.join(descriptor.labelSeparator ?? " "),
        disabled: false,
        meta: null,
      };

      setRelationState((prev) => {
        const current = prev[fieldName] ?? { options: [], loading: false, error: null };
        if (current.options.some((o) => o.value === seedOption.value)) return prev;
        return {
          ...prev,
          [fieldName]: {
            ...current,
            options: [seedOption, ...current.options.filter((o) => o.value !== seedOption.value)],
          },
        };
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetInitialDataToken, fieldMap]);

  const handleRelationSearch = useCallback(
    (fieldName, descriptor, search) => {
      if (descriptor.source !== "remote") return;
      clearTimeout(relationDebounceRef.current[fieldName]);
      if (!search) {
        loadRelationOptions(fieldName, descriptor, "");
        return;
      }
      relationDebounceRef.current[fieldName] = setTimeout(() => {
        loadRelationOptions(fieldName, descriptor, search);
      }, 300);
    },
    [loadRelationOptions],
  );

  const closeInlineCreate = useCallback(() => {
    setInlineCreateState({
      open: false,
      fieldName: null,
      descriptor: null,
      blueprint: null,
      prefillData: {},
      searchText: "",
    });
  }, []);

  const resolveInlineCreateBlueprint = useCallback(
    async (viewKey) => {
      if (typeof resolveBlueprintByKey === "function") {
        const resolved = await resolveBlueprintByKey(viewKey);
        if (resolved) return resolved;
      }
      const localRows = Array.isArray(blueprints) ? blueprints : nestedBlueprintRows;
      if (Array.isArray(localRows) && localRows.length > 0) {
        const found = localRows.find((row) => String(row?.key ?? "").trim() === viewKey);
        if (found) return found;
      }
      const response = await fetch(joinUrl(apiBaseUrl, "/blueprints"), {
        method: "GET",
        headers: buildApiHeaders(token, companyId),
      });
      if (!response.ok) throw new Error("No se pudieron cargar las vistas relacionadas.");
      const payload = await response.json();
      const rows = extractBlueprintRows(payload);
      setNestedBlueprintRows(rows);
      const moduleKey = String(blueprint?.moduleKey ?? "").trim();
      const found = rows.find((row) => {
        if (String(row?.key ?? "").trim() !== viewKey) return false;
        if (!moduleKey) return true;
        return String(row?.moduleKey ?? "").trim() === moduleKey;
      });
      return found ?? null;
    },
    [apiBaseUrl, blueprint?.moduleKey, blueprints, nestedBlueprintRows, resolveBlueprintByKey, token, companyId],
  );

  const openInlineCreate = useCallback(
    async (fieldName, descriptor, searchText) => {
      if (!allowInlineCreate || inlineCreateDepth > 1) return;
      if (!descriptor?.create?.enabled) return;
      const viewKey = String(descriptor.create.viewKey ?? "").trim();
      if (!viewKey) return;
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      clearRelationInlineError(fieldName);
      try {
        const nestedBlueprint = await resolveInlineCreateBlueprint(viewKey);
        if (!nestedBlueprint) {
          throw new Error("No se encontró la vista de creación relacionada.");
        }
        const nestedApiPath = descriptor.create.apiPath;
        const blueprintForCreate =
          nestedApiPath && nestedBlueprint?.schema && nestedBlueprint.schema.apiPath !== nestedApiPath
            ? { ...nestedBlueprint, schema: { ...nestedBlueprint.schema, apiPath: nestedApiPath } }
            : nestedBlueprint;
        const prefillData = buildInlineCreatePrefill({
          nestedBlueprint: blueprintForCreate,
          searchText,
          descriptor,
        });
        setInlineCreateState({
          open: true,
          fieldName,
          descriptor,
          blueprint: blueprintForCreate,
          prefillData,
          searchText: String(searchText ?? ""),
        });
      } catch (err) {
        setRelationInlineErrors((prev) => ({
          ...prev,
          [fieldName]:
            err instanceof Error && err.message ? err.message : "No se pudo abrir el formulario relacionado.",
        }));
      }
    },
    [allowInlineCreate, inlineCreateDepth, resolveInlineCreateBlueprint, clearRelationInlineError],
  );

  const applyCreatedRelationResult = useCallback(
    async (fieldName, descriptor, result) => {
      if (!fieldName || !descriptor) return;
      const createdRecord = extractCreatedRecord(result);
      const createdIdRaw =
        createdRecord && descriptor.valueField in createdRecord ? createdRecord[descriptor.valueField] : null;
      const createdId =
        createdIdRaw === undefined || createdIdRaw === null || createdIdRaw === "" ? null : String(createdIdRaw);

      if (createdRecord && createdId) {
        const option = { value: createdId, label: resolveRelationLabel(createdRecord, descriptor), disabled: false };
        setRelationState((prev) => {
          const current = prev[fieldName]?.options ?? [];
          const next = current.filter((item) => String(item.value) !== createdId);
          return { ...prev, [fieldName]: { ...prev[fieldName], options: [option, ...next], loading: false, error: null } };
        });
      }

      if (descriptor.create?.selectCreated !== false && createdId) {
        setFormValues((prev) => ({ ...prev, [fieldName]: createdId }));
        setFieldErrors((prev) => ({ ...prev, [fieldName]: "" }));
      }

      let refreshOk = true;
      if (descriptor.create?.refreshOptions !== false) {
        refreshOk = await loadRelationOptions(fieldName, descriptor, "");
        if (createdRecord && createdId) {
          const createdOption = { value: createdId, label: resolveRelationLabel(createdRecord, descriptor), disabled: false };
          setRelationState((prev) => {
            const current = prev[fieldName]?.options ?? [];
            const exists = current.some((item) => String(item?.value ?? "") === createdId);
            if (exists) return prev;
            return { ...prev, [fieldName]: { ...prev[fieldName], options: [createdOption, ...current], loading: false, error: null } };
          });
        }
      }

      if (!createdId) {
        setRelationInlineErrors((prev) => ({
          ...prev,
          [fieldName]: "Se creó el registro, pero no se pudo obtener su identificador.",
        }));
      } else if (!refreshOk) {
        setRelationInlineErrors((prev) => ({
          ...prev,
          [fieldName]: "Se creó el registro, pero no se pudieron actualizar las opciones.",
        }));
      } else {
        clearRelationInlineError(fieldName);
      }
    },
    [loadRelationOptions, setFormValues, setFieldErrors, clearRelationInlineError],
  );

  const handleInlineCreateSuccess = useCallback(
    async (result) => {
      await applyCreatedRelationResult(inlineCreateState.fieldName, inlineCreateState.descriptor, result);
      closeInlineCreate();
    },
    [applyCreatedRelationResult, closeInlineCreate, inlineCreateState.descriptor, inlineCreateState.fieldName],
  );

  const handleQuickCreate = useCallback(
    async (fieldName, descriptor, searchText) => {
      if (descriptor?.create?.mode !== "quick") return;
      const trimmed = String(searchText ?? "").trim();
      if (!trimmed) return;
      setQuickCreatingField(fieldName);
      clearRelationInlineError(fieldName);
      try {
        const response = await fetch(joinUrl(apiBaseUrl, descriptor.create.apiPath), {
          method: "POST",
          headers: buildApiHeaders(token, companyId, { "Content-Type": "application/json" }),
          body: JSON.stringify({ [descriptor.create.nameField]: trimmed }),
        });
        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (!response.ok) {
          throw new Error(payload?.error || "No se pudo crear el registro.");
        }
        await applyCreatedRelationResult(fieldName, descriptor, payload);
      } catch (err) {
        setRelationInlineErrors((prev) => ({
          ...prev,
          [fieldName]: err instanceof Error && err.message ? err.message : "No se pudo crear el registro.",
        }));
      } finally {
        setQuickCreatingField(null);
      }
    },
    [apiBaseUrl, applyCreatedRelationResult, companyId, token, clearRelationInlineError],
  );

  return {
    relationState,
    relationInlineErrors,
    setRelationInlineErrors,
    quickCreatingField,
    inlineCreateState,
    nestedBlueprintFields,
    nestedBlueprintRows,
    loadRelationOptions,
    handleRelationSearch,
    openInlineCreate,
    closeInlineCreate,
    handleInlineCreateSuccess,
    handleQuickCreate,
    clearRelationInlineError,
  };
}
