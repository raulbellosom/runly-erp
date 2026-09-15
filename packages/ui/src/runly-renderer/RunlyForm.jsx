import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../components/Alert.jsx";
import { Button } from "../components/Button.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/Dialog.jsx";
import {
  TextField,
  TextareaField,
  SelectField,
  PhoneField,
  SwitchField,
  RelationSelectField,
  CurrencyField,
  CarColorPickerField,
  FieldWrapper,
} from "../components/FormFields.jsx";
import { MarkdownField } from "../components/MarkdownField.jsx";
import { AttachmentsPanel } from "../components/AttachmentsPanel.jsx";
import { DatePickerField } from "../components/DatePickerField.jsx";
import { FormCompletionRing } from "../components/FormCompletionRing.jsx";
import { FormPreviewPanel } from "../components/FormPreviewPanel.jsx";
import { ReportPartsEditor } from "./ReportPartsEditor.jsx";
import { CostsSummaryPanel } from "./CostsSummaryPanel.jsx";
import { DynamicFieldsSection, buildCustomFieldsPayload } from "./DynamicFieldsSection.jsx";
import {
  normalizeSpanishLabel,
  normalizeRelationDescriptor,
} from "./renderer-adapters.js";
import { cn } from "../lib/utils.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { normalizeField, normalizeSections } from "./runly-form-schema.js";
import { formatDisplayValue, computeCompletion, computePreviewModel } from "./runly-form-preview.js";
import {
  PRESET_COLORS,
  CAR_COLORS,
  resolveColorName,
  joinUrl,
  resolveRelationLabel,
  normalizeOptions,
  buildInitialValues,
  castValueByType,
  resolveRecordId,
  extractBlueprintRows,
  extractFieldsFromBlueprint,
  extractCreatedRecord,
  buildInlineCreatePrefill,
  toMoney,
  normalizeReportParts,
  computePartsCost,
} from "./runly-form-utils.js";

// Module-level cache for relation field options. Persists across modal open/close cycles.
const _relationOptionsCache = new Map();

const MAIN_SECTION_TYPES = new Set(["fields", "parts", "attachments", "custom-fields"]);
const _RELATION_CACHE_TTL = 5 * 60 * 1000;

function matchesFieldRule(rule, formValues) {
  if (!rule || typeof rule !== "object") return true;
  const fieldName = String(rule.field ?? "").trim();
  if (!fieldName) return true;
  const value = formValues?.[fieldName];
  if (Object.prototype.hasOwnProperty.call(rule, "equals")) {
    return value === rule.equals;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "notEquals")) {
    return value !== rule.notEquals;
  }
  if (Array.isArray(rule.in)) {
    return rule.in.includes(value);
  }
  if (Array.isArray(rule.notIn)) {
    return !rule.notIn.includes(value);
  }
  if (Object.prototype.hasOwnProperty.call(rule, "truthy")) {
    return Boolean(value) === Boolean(rule.truthy);
  }
  return true;
}

function isFieldVisible(field, formValues) {
  if (!field) return false;
  if (field.visibleWhen && !matchesFieldRule(field.visibleWhen, formValues)) {
    return false;
  }
  if (field.hiddenWhen && matchesFieldRule(field.hiddenWhen, formValues)) {
    return false;
  }
  return true;
}

function buildResetInitialDataToken(initialData, mode) {
  const safeData =
    initialData && typeof initialData === "object" ? initialData : {};
  const recordId = resolveRecordId(safeData);
  if (mode === "edit" || mode === "detail") {
    const revision =
      safeData.updated_at ??
      safeData.updatedAt ??
      safeData.version ??
      safeData.revision ??
      "";
    return `record:${recordId ?? "none"}:${String(revision)}`;
  }

  const keys = Object.keys(safeData);
  if (keys.length === 0) return "create:empty";

  const sorted = {};
  for (const key of keys.sort()) {
    sorted[key] = safeData[key];
  }
  try {
    return `create:${JSON.stringify(sorted)}`;
  } catch {
    return "create:non-serializable";
  }
}

export function RunlyForm({
  blueprint,
  fields,
  initialData,
  mode = "create",
  token,
  companyId = null,
  apiBaseUrl,
  onSuccess,
  onCancel,
  blueprints = null,
  resolveBlueprintByKey = null,
  allowInlineCreate = true,
  inlineCreateDepth = 0,
  id,
  showFooter = true,
}) {
  const schema = blueprint?.schema ?? {};
  const apiPath =
    typeof schema.apiPath === "string" ? schema.apiPath.trim() : "";
  const submitLabel = normalizeSpanishLabel(
    String(schema?.submitLabel ?? "").trim() || "Guardar",
  );

  const fieldMap = useMemo(() => {
    const map = new Map();
    for (const entry of Array.isArray(fields) ? fields : []) {
      const normalized = normalizeField(entry);
      if (!normalized) continue;
      map.set(normalized.name, normalized);
    }
    return map;
  }, [fields]);

  const sections = useMemo(
    () => normalizeSections(schema, fieldMap),
    [fieldMap, schema],
  );
  const formStructureToken = useMemo(() => {
    const fieldNames = [...fieldMap.keys()].sort().join("|");
    const sectionKeys = sections
      .map((section) => `${section.id}:${section.type}`)
      .join("|");
    return `${String(blueprint?.key ?? "")}::${fieldNames}::${sectionKeys}`;
  }, [blueprint?.key, fieldMap, sections]);
  const resetInitialDataToken = useMemo(
    () => buildResetInitialDataToken(initialData, mode),
    [initialData, mode],
  );

  const [formValues, setFormValues] = useState(() =>
    buildInitialValues(fieldMap, initialData),
  );
  const [reportParts, setReportParts] = useState(() =>
    normalizeReportParts(initialData?.parts),
  );
  const [customFieldDefs, setCustomFieldDefs] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolvedRecordId, setResolvedRecordId] = useState(() =>
    resolveRecordId(initialData),
  );
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
  const [nestedBlueprintRows, setNestedBlueprintRows] = useState(null);
  // Stable fields array for the nested inline-create form. Recomputed only when the
  // blueprint changes, not on every outer render.
  const nestedBlueprintFields = useMemo(
    () => extractFieldsFromBlueprint(inlineCreateState.blueprint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inlineCreateState.blueprint],
  );
  const [collapsedSections, setCollapsedSections] = useState(() => {
    const next = {};
    for (const section of sections) {
      if (!section?.collapsible) continue;
      next[section.id] = Boolean(section.defaultCollapsed);
    }
    return next;
  });
  const attachmentsControllersRef = useRef(new Map());
  const relationDebounceRef = useRef({});
  const formValuesRef = useRef(formValues);
  const fieldMapRef = useRef(fieldMap);
  const initialDataRef = useRef(initialData);
  const sectionsRef = useRef(sections);

  // Keep refs current on every render so the reset effect always reads latest values
  fieldMapRef.current = fieldMap;
  initialDataRef.current = initialData;
  sectionsRef.current = sections;

  useEffect(() => {
    formValuesRef.current = formValues;
  }, [formValues]);

  const loadRelationOptions = useCallback(
    async (fieldName, descriptor, search) => {
      const url = new URL(joinUrl(apiBaseUrl, descriptor.apiPath));
      url.searchParams.set(descriptor.pageParam, "1");
      url.searchParams.set(
        descriptor.pageSizeParam,
        String(descriptor.pageSize),
      );
      if (search) url.searchParams.set(descriptor.searchParam, search);
      const cacheKey = url.toString();

      // Serve from module-level cache if fresh and it's not a search query
      if (!search) {
        const cached = _relationOptionsCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < _RELATION_CACHE_TTL) {
          setRelationState((prev) => ({
            ...prev,
            [fieldName]: {
              options: cached.options,
              loading: false,
              error: null,
            },
          }));
          return true;
        }
      }

      setRelationState((prev) => ({
        ...prev,
        [fieldName]: {
          options: prev[fieldName]?.options ?? [],
          loading: true,
          error: null,
        },
      }));
      try {
        const res = await fetch(cacheKey, {
          headers: buildApiHeaders(token, companyId),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows = Array.isArray(json.data)
          ? json.data
          : Array.isArray(json)
            ? json
            : [];
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
                    ? df.subtitle
                        .map((f) => row[f])
                        .filter(Boolean)
                        .join(" • ")
                    : String(row[df.subtitle] ?? "").trim()
                  : null,
              };
              meta =
                rawMeta.badge || rawMeta.title || rawMeta.subtitle
                  ? rawMeta
                  : null;
            }
            return {
              value: String(row[descriptor.valueField] ?? ""),
              label: resolveRelationLabel(row, descriptor),
              disabled: descriptor.disabledField
                ? row[descriptor.disabledField] === false
                : false,
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
            selectedValue === undefined ||
            selectedValue === null ||
            selectedValue === ""
              ? null
              : String(selectedValue);
          const hasSelectedInFetched =
            normalizedSelectedValue != null &&
            options.some(
              (item) => String(item?.value ?? "") === normalizedSelectedValue,
            );
          const selectedFallback =
            normalizedSelectedValue != null && !hasSelectedInFetched
              ? currentOptions.find(
                  (item) =>
                    String(item?.value ?? "") === normalizedSelectedValue,
                )
              : null;
          const mergedOptions = selectedFallback
            ? [selectedFallback, ...options]
            : options;
          return {
            ...prev,
            [fieldName]: {
              options: mergedOptions,
              loading: false,
              error: null,
            },
          };
        });
        return true;
      } catch {
        setRelationState((prev) => ({
          ...prev,
          [fieldName]: {
            options: prev[fieldName]?.options ?? [],
            loading: false,
            error: true,
          },
        }));
        return false;
      }
    },
    [apiBaseUrl, token, companyId],
  );

  // Reset form state when the form structure or initial data actually changes.
  // Uses string tokens (not object refs) so reference-equal but structurally identical
  // re-renders (e.g. outer form re-rendering and producing a new fields array) do not
  // spuriously clear user input in a nested inline-create form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fm = fieldMapRef.current;
    const id = initialDataRef.current;
    const sc = sectionsRef.current;
    setFormValues(buildInitialValues(fm, id));
    setReportParts(normalizeReportParts(id?.parts));
    setFieldErrors({});
    setRelationInlineErrors({});
    setSubmitError("");
    setResolvedRecordId(resolveRecordId(id));
    setCollapsedSections(() => {
      const next = {};
      for (const section of sc) {
        if (!section?.collapsible) continue;
        next[section.id] = Boolean(section.defaultCollapsed);
      }
      return next;
    });
    // Only re-run when the form structure or initial data meaningfully changes.
    // formStructureToken encodes blueprint key + field names + section layout.
    // resetInitialDataToken encodes the initial data payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formStructureToken, resetInitialDataToken]);

  useEffect(() => {
    const partsCost = computePartsCost(reportParts);
    const laborCost = Math.max(0, toMoney(formValues.labor_cost, 0));
    const totalCost = Number((partsCost + laborCost).toFixed(2));
    setFormValues((prev) => ({
      ...prev,
      parts_cost: partsCost,
      total_cost: totalCost,
    }));
  }, [formValues.labor_cost, reportParts]);

  useEffect(() => {
    for (const [, field] of fieldMap.entries()) {
      if (field.type !== "relation") continue;
      const descriptor = normalizeRelationDescriptor(field);
      if (descriptor?.source === "remote" && descriptor.preload) {
        loadRelationOptions(field.name, descriptor, "");
      }
    }
  }, [fieldMap, loadRelationOptions]);

  // When editing an existing record, seed each relation field with an initial
  // option built from the initialData fields that match the descriptor's
  // labelField(s). This prevents "Registro no disponible" when the current
  // value isn't in the first page of remote results.
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
        .map((f) =>
          initialData[f] != null ? String(initialData[f]).trim() : "",
        )
        .filter(Boolean);

      if (labelParts.length === 0) continue;

      const seedOption = {
        value: String(value),
        label: labelParts.join(descriptor.labelSeparator ?? " "),
        disabled: false,
        meta: null,
      };

      setRelationState((prev) => {
        const current = prev[fieldName] ?? {
          options: [],
          loading: false,
          error: null,
        };
        if (current.options.some((o) => o.value === seedOption.value))
          return prev;
        return {
          ...prev,
          [fieldName]: {
            ...current,
            options: [
              seedOption,
              ...current.options.filter((o) => o.value !== seedOption.value),
            ],
          },
        };
      });
    }
    // Re-seed whenever the initial data token changes (i.e. a different record is opened).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetInitialDataToken, fieldMap]);

  if (!apiPath) {
    return (
      <Alert variant="warning">
        <AlertTitle>Vista sin configuración</AlertTitle>
        <AlertDescription>
          Esta vista no tiene <code>schema.apiPath</code>. No se puede guardar
          la información.
        </AlertDescription>
      </Alert>
    );
  }

  const recordId = resolvedRecordId;
  const isEditMode = mode === "edit";

  const registerAttachmentsController = useCallback((sectionId, controller) => {
    if (!sectionId) return;
    if (!controller) {
      attachmentsControllersRef.current.delete(sectionId);
      return;
    }
    attachmentsControllersRef.current.set(sectionId, controller);
  }, []);

  const flushPendingAttachments = useCallback(async (effectiveRecordId) => {
    const controllers = Array.from(
      attachmentsControllersRef.current.values(),
    ).filter(Boolean);
    if (!effectiveRecordId || controllers.length === 0) {
      return { attempted: 0, success: 0, failed: 0, details: [] };
    }

    const results = [];
    for (const controller of controllers) {
      if (typeof controller.flushPending !== "function") continue;
      const result = await controller.flushPending(effectiveRecordId);
      results.push(result);
    }

    const attempted = results.reduce(
      (sum, item) =>
        sum + ((item?.failed?.length ?? 0) + (item?.success?.length ?? 0)),
      0,
    );
    const success = results.reduce(
      (sum, item) => sum + (item?.success?.length ?? 0),
      0,
    );
    const failed = results.reduce(
      (sum, item) => sum + (item?.failed?.length ?? 0),
      0,
    );
    const details = results.flatMap((item) => item?.failed ?? []);
    return { attempted, success, failed, details };
  }, []);

  const handleChange = (name, value) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    setRelationInlineErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handlePartsChange = useCallback((nextParts) => {
    setReportParts(Array.isArray(nextParts) ? nextParts : []);
    setFieldErrors((prev) => ({ ...prev, parts: "" }));
  }, []);

  const toggleSection = useCallback((sectionId) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !Boolean(prev[sectionId]),
    }));
  }, []);

  const handleRelationSearch = (fieldName, descriptor, search) => {
    if (descriptor.source !== "remote") return;
    clearTimeout(relationDebounceRef.current[fieldName]);
    if (!search) {
      loadRelationOptions(fieldName, descriptor, "");
      return;
    }
    relationDebounceRef.current[fieldName] = setTimeout(() => {
      loadRelationOptions(fieldName, descriptor, search);
    }, 300);
  };

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

      const localRows = Array.isArray(blueprints)
        ? blueprints
        : nestedBlueprintRows;
      if (Array.isArray(localRows) && localRows.length > 0) {
        const found = localRows.find(
          (row) => String(row?.key ?? "").trim() === viewKey,
        );
        if (found) return found;
      }

      const response = await fetch(joinUrl(apiBaseUrl, "/blueprints"), {
        method: "GET",
        headers: buildApiHeaders(token, companyId),
      });
      if (!response.ok)
        throw new Error("No se pudieron cargar las vistas relacionadas.");
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
    [
      apiBaseUrl,
      blueprint?.moduleKey,
      blueprints,
      nestedBlueprintRows,
      resolveBlueprintByKey,
      token,
      companyId,
    ],
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

      setRelationInlineErrors((prev) => ({ ...prev, [fieldName]: "" }));

      try {
        const nestedBlueprint = await resolveInlineCreateBlueprint(viewKey);
        if (!nestedBlueprint) {
          throw new Error("No se encontró la vista de creación relacionada.");
        }
        const nestedApiPath = descriptor.create.apiPath;
        const blueprintForCreate =
          nestedApiPath &&
          nestedBlueprint?.schema &&
          nestedBlueprint.schema.apiPath !== nestedApiPath
            ? {
                ...nestedBlueprint,
                schema: {
                  ...nestedBlueprint.schema,
                  apiPath: nestedApiPath,
                },
              }
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
            err instanceof Error && err.message
              ? err.message
              : "No se pudo abrir el formulario relacionado.",
        }));
      }
    },
    [allowInlineCreate, inlineCreateDepth, resolveInlineCreateBlueprint],
  );

  const handleInlineCreateSuccess = useCallback(
    async (result) => {
      const fieldName = inlineCreateState.fieldName;
      const descriptor = inlineCreateState.descriptor;
      if (!fieldName || !descriptor) {
        closeInlineCreate();
        return;
      }

      const createdRecord = extractCreatedRecord(result);
      const createdIdRaw =
        createdRecord && descriptor.valueField in createdRecord
          ? createdRecord[descriptor.valueField]
          : null;
      const createdId =
        createdIdRaw === undefined ||
        createdIdRaw === null ||
        createdIdRaw === ""
          ? null
          : String(createdIdRaw);

      if (createdRecord && createdId) {
        const option = {
          value: createdId,
          label: resolveRelationLabel(createdRecord, descriptor),
          disabled: false,
        };
        setRelationState((prev) => {
          const current = prev[fieldName]?.options ?? [];
          const next = current.filter(
            (item) => String(item.value) !== createdId,
          );
          return {
            ...prev,
            [fieldName]: {
              ...prev[fieldName],
              options: [option, ...next],
              loading: false,
              error: null,
            },
          };
        });
      }

      if (descriptor.create?.selectCreated !== false && createdId) {
        handleChange(fieldName, createdId);
      }

      let refreshOk = true;
      if (descriptor.create?.refreshOptions !== false) {
        refreshOk = await loadRelationOptions(fieldName, descriptor, "");
        if (createdRecord && createdId) {
          const createdOption = {
            value: createdId,
            label: resolveRelationLabel(createdRecord, descriptor),
            disabled: false,
          };
          setRelationState((prev) => {
            const current = prev[fieldName]?.options ?? [];
            const exists = current.some(
              (item) => String(item?.value ?? "") === createdId,
            );
            if (exists) return prev;
            return {
              ...prev,
              [fieldName]: {
                ...prev[fieldName],
                options: [createdOption, ...current],
                loading: false,
                error: null,
              },
            };
          });
        }
      }

      if (!createdId) {
        setRelationInlineErrors((prev) => ({
          ...prev,
          [fieldName]:
            "Se creó el registro, pero no se pudo obtener su identificador.",
        }));
      } else if (!refreshOk) {
        setRelationInlineErrors((prev) => ({
          ...prev,
          [fieldName]:
            "Se creó el registro, pero no se pudieron actualizar las opciones.",
        }));
      } else {
        setRelationInlineErrors((prev) => ({ ...prev, [fieldName]: "" }));
      }

      closeInlineCreate();
    },
    [
      closeInlineCreate,
      inlineCreateState.descriptor,
      inlineCreateState.fieldName,
      loadRelationOptions,
    ],
  );

  const validate = () => {
    const nextErrors = {};
    for (const section of sections) {
      if (section.type === "parts") {
        const minItems = Number(section.minItems ?? 0);
        if (minItems > 0 && reportParts.length < minItems) {
          nextErrors.parts = `Agrega al menos ${minItems} refacción(es).`;
        }
        continue;
      }
      if (section.type !== "fields") continue;
      for (const fieldName of section.fields) {
        const field = fieldMap.get(fieldName);
        if (!isFieldVisible(field, formValues)) continue;
        if (!field || !field.required || field.readonly) continue;
        if (field.type === "boolean") continue;
        const value = formValues[fieldName];
        if (field.type === "currency") {
          if (value === undefined || value === null || value === "") {
            nextErrors[fieldName] = "Campo requerido";
          }
          continue;
        }
        if (
          value === undefined ||
          value === null ||
          String(value).trim() === ""
        ) {
          nextErrors[fieldName] = "Campo requerido";
        }
      }
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSubmitError("");
    if (!validate()) return;
    if (isEditMode && !recordId) {
      setSubmitError("No se pudo guardar la información.");
      return;
    }
    const payload = {};
    for (const [name, field] of fieldMap.entries()) {
      if (field.readonly) continue;
      if (!isFieldVisible(field, formValues)) continue;
      const casted = castValueByType(formValues[name], field.type);
      if (field.type === "boolean") {
        payload[name] = Boolean(casted);
        continue;
      }
      if (field.type === "relation") {
        payload[name] = casted === "" ? null : casted;
        continue;
      }
      if (casted === null || casted === "") continue;
      payload[name] = casted;
    }
    if (sections.some((section) => section.type === "parts")) {
      payload.parts = normalizeReportParts(reportParts);
    }
    const customFieldsSection = sections.find((section) => section.type === "custom-fields");
    if (customFieldsSection) {
      const defs = customFieldDefs[customFieldsSection.id] ?? [];
      const customValues = buildCustomFieldsPayload(
        formValues,
        defs,
        customFieldsSection.customFields?.valuePrefix,
      );
      if (customValues.length > 0) payload.customValues = customValues;
    }
    setSubmitting(true);
    try {
      const endpoint = isEditMode
        ? `${joinUrl(apiBaseUrl, apiPath)}/${encodeURIComponent(String(recordId))}`
        : joinUrl(apiBaseUrl, apiPath);
      const response = await fetch(endpoint, {
        method: isEditMode ? "PATCH" : "POST",
        headers: buildApiHeaders(token, companyId, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        let message = "No se pudo guardar la información.";
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed?.error) message = parsed.error;
        } catch {
          if (text) message = text;
        }
        throw new Error(message);
      }
      const result = await response.json();
      const createdRecord = extractCreatedRecord(result);
      const createdRecordId = resolveRecordId(createdRecord);
      const effectiveRecordId = isEditMode
        ? recordId
        : (createdRecordId ?? null);

      if (!isEditMode && effectiveRecordId) {
        setResolvedRecordId(effectiveRecordId);
      }

      const attachmentSync = await flushPendingAttachments(effectiveRecordId);

      const nextResult =
        result && typeof result === "object"
          ? { ...result, attachments: attachmentSync }
          : { data: result, attachments: attachmentSync };

      onSuccess?.(nextResult);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo guardar la información.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderFieldControl = (field) => {
    const value = formValues[field.name];
    const sharedProps = {
      label: field.label,
      required: field.required,
      hint: field.hint ?? undefined,
      error: fieldErrors[field.name],
    };

    if (field.readonly) {
      const displayValue = formatDisplayValue(field, value) ?? "—";
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">
            {field.label}
          </p>
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-sm">
            {displayValue}
          </div>
        </div>
      );
    }

    switch (field.type) {
      case "textarea":
        return (
          <TextareaField
            {...sharedProps}
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );

      case "markdown":
        return (
          <MarkdownField
            {...sharedProps}
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e?.target?.value ?? "")}
          />
        );

      case "select": {
        const options = normalizeOptions(field.options);
        return (
          <SelectField
            {...sharedProps}
            value={value ?? ""}
            options={options}
            onValueChange={(val) => handleChange(field.name, val)}
          />
        );
      }

      case "boolean":
        return (
          <SwitchField
            {...sharedProps}
            checked={Boolean(value)}
            onChange={(checked) => handleChange(field.name, Boolean(checked))}
          />
        );

      case "phone":
        return (
          <PhoneField
            {...sharedProps}
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );

      case "number":
        return (
          <TextField
            {...sharedProps}
            type="number"
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );

      case "decimal":
        return (
          <TextField
            {...sharedProps}
            type="number"
            step="0.0001"
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );

      case "currency":
        return (
          <CurrencyField
            {...sharedProps}
            value={value ?? 0}
            onChange={(val) => handleChange(field.name, val)}
            currency={field.currency ?? "MXN"}
            locale={field.locale ?? "es-MX"}
            allowNegative={field.allowNegative ?? false}
          />
        );

      case "date":
        return (
          <DatePickerField
            {...sharedProps}
            value={value ?? ""}
            onChange={(val) => handleChange(field.name, val ?? "")}
          />
        );

      case "datetime":
        return (
          <TextField
            {...sharedProps}
            type="datetime-local"
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );

      case "email":
        return (
          <TextField
            {...sharedProps}
            type="email"
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );

      case "color": {
        // Normalize legacy hex values to color names on first render
        const colorValue =
          value && String(value).startsWith("#")
            ? (resolveColorName(String(value)) ?? value)
            : value;
        return (
          <CarColorPickerField
            key={field.name}
            id={field.name}
            label={field.label}
            required={field.required}
            hint={field.hint ?? undefined}
            value={colorValue || ""}
            onChange={(name) => handleChange(field.name, name || "")}
            colors={CAR_COLORS}
            clearable
            error={fieldErrors[field.name]}
          />
        );
      }

      // hex-color: native browser color picker — stores a #rrggbb hex string.
      // Use this instead of "color" when a vehicle palette is not appropriate.
      case "hex-color": {
        const hexValue =
          value && String(value).startsWith("#") ? String(value) : "#000000";
        return (
          <FieldWrapper
            label={field.label}
            labelFor={field.name}
            required={field.required}
            hint={field.hint ?? undefined}
            error={fieldErrors[field.name]}
          >
            <div className="flex items-center gap-3">
              <input
                type="color"
                id={field.name}
                value={hexValue}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className="h-10 w-16 rounded-lg border border-[hsl(var(--border))] bg-transparent cursor-pointer p-0.5"
              />
              <span className="text-sm font-mono text-[hsl(var(--muted-foreground))]">
                {hexValue}
              </span>
            </div>
          </FieldWrapper>
        );
      }

      case "relation": {
        const descriptor = normalizeRelationDescriptor(field);
        const relationError =
          fieldErrors[field.name] || relationInlineErrors[field.name] || "";
        if (!descriptor) {
          return (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                {field.label}
                {field.required ? " *" : ""}
              </p>
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                Relación no configurada
              </div>
              {relationError && (
                <p className="text-xs text-[hsl(var(--destructive))]">
                  {relationError}
                </p>
              )}
            </div>
          );
        }
        const rs = relationState[field.name] ?? {
          options: [],
          loading: false,
          error: null,
        };
        const staticOpts =
          descriptor.source === "static" ? descriptor.options : rs.options;
        const createActionLabel =
          descriptor.create?.label ?? normalizeSpanishLabel("Crear nuevo");
        const canInlineCreate =
          Boolean(descriptor.create?.enabled) &&
          allowInlineCreate &&
          inlineCreateDepth < 2;
        return (
          <RelationSelectField
            {...sharedProps}
            error={relationError}
            value={value ?? null}
            options={staticOpts}
            loading={descriptor.source === "remote" ? rs.loading : false}
            loadError={descriptor.source === "remote" ? rs.error : null}
            clearable={descriptor.clearable}
            onRetry={() => loadRelationOptions(field.name, descriptor, "")}
            onSearchChange={(search) =>
              handleRelationSearch(field.name, descriptor, search)
            }
            onChange={(val) => handleChange(field.name, val)}
            createActionLabel={createActionLabel}
            createActionMode={descriptor.create?.allowedWhen ?? "always"}
            createFromSearch={descriptor.create?.prefillFromSearch === true}
            createDisabled={
              !canInlineCreate ||
              (inlineCreateState.open &&
                inlineCreateState.fieldName === field.name)
            }
            onCreate={
              canInlineCreate
                ? (searchText) =>
                    openInlineCreate(field.name, descriptor, searchText)
                : undefined
            }
          />
        );
      }

      default:
        return (
          <TextField
            {...sharedProps}
            type="text"
            value={value ?? ""}
            onChange={(e) => handleChange(field.name, e.target.value)}
          />
        );
    }
  };

  const mainSections = sections.filter(
    (section) =>
      MAIN_SECTION_TYPES.has(section.type) && section.placement !== "aside",
  );
  const asideSections = sections.filter(
    (section) =>
      section.type === "attachments" && section.placement === "aside",
  );

  const renderSection = (section) => {
    const isCollapsed = Boolean(collapsedSections[section.id]);
    const isCollapsible = Boolean(section.collapsible);

    const renderSectionHeader = () => {
      if (!section.title && !isCollapsible) return null;
      const SectionIcon = section.icon ? LucideIcons[section.icon] : null;
      return (
        <div className="pb-3 border-b border-[hsl(var(--border))] flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {SectionIcon ? (
              <SectionIcon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : null}
            <div className="space-y-0.5">
              {section.title ? (
                <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  {section.title}
                </h4>
              ) : null}
              {section.description ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {section.description}
                </p>
              ) : null}
            </div>
          </div>
          {isCollapsible ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleSection(section.id)}
            >
              {isCollapsed ? (
                <LucideIcons.ChevronDown className="h-4 w-4" />
              ) : (
                <LucideIcons.ChevronUp className="h-4 w-4" />
              )}
            </Button>
          ) : null}
        </div>
      );
    };

    const renderSectionBody = () => {
      if (section.type === "attachments") {
        return (
          <AttachmentsPanel
            apiBaseUrl={apiBaseUrl}
            token={token}
            companyId={companyId}
            recordId={recordId}
            config={{
              ...(section.attachments ?? {}),
              placement: "embedded",
            }}
            context="form"
            showHeading={false}
            onControllerReady={(controller) =>
              registerAttachmentsController(section.id, controller)
            }
          />
        );
      }

      if (section.type === "parts") {
        return (
          <div className="space-y-2">
            <ReportPartsEditor
              parts={reportParts}
              onChange={handlePartsChange}
              readonly={Boolean(submitting)}
            />
            {fieldErrors.parts ? (
              <p className="text-xs text-[hsl(var(--destructive))]">
                {fieldErrors.parts}
              </p>
            ) : null}
          </div>
        );
      }

      if (section.type === "custom-fields") {
        return (
          <DynamicFieldsSection
            config={section.customFields}
            formValues={formValues}
            onFieldChange={handleChange}
            apiBaseUrl={apiBaseUrl}
            token={token}
            companyId={companyId}
            onDefinitionsChange={(defs) =>
              setCustomFieldDefs((prev) => ({ ...prev, [section.id]: defs }))
            }
          />
        );
      }

      const fieldsGrid = (
        <div
          className={
            section.columns === 1
              ? "grid gap-4"
              : section.columns === 2
                ? "grid gap-4 md:grid-cols-2"
                : "grid gap-4 lg:grid-cols-2"
          }
        >
          {section.fields.map((fieldName) => {
            const field = fieldMap.get(fieldName);
            if (!field || !isFieldVisible(field, formValues)) return null;
            const isFullWidth =
              ["textarea", "markdown"].includes(field.type) ||
              field.fullWidth === true;
            return (
              <div
                key={field.name}
                className={isFullWidth ? "col-span-full" : ""}
              >
                {renderFieldControl(field)}
              </div>
            );
          })}
        </div>
      );

      if (section.id === "costs") {
        return (
          <div className="space-y-4">
            {fieldsGrid}
            <CostsSummaryPanel
              laborCost={formValues.labor_cost ?? 0}
              partsCost={formValues.parts_cost ?? 0}
              totalCost={formValues.total_cost ?? 0}
            />
          </div>
        );
      }

      return fieldsGrid;
    };

    const header = renderSectionHeader();
    return (
      <div
        key={section.id}
        className={cn(
          "glass rounded-xl px-5 py-4 space-y-4",
          header && isCollapsible && !isCollapsed && "pb-5",
        )}
      >
        {header}
        {!isCollapsed ? renderSectionBody() : null}
      </div>
    );
  };

  const previewConfig = schema.preview ?? null;
  const showCompletion = schema.showCompletion === true;
  const { allFieldNames, filledCount, completionPercent } = computeCompletion(fieldMap, formValues, isFieldVisible);
  const previewModel = computePreviewModel(previewConfig, fieldMap, formValues);

  return (
    <form id={id} className="space-y-6" onSubmit={handleSubmit}>
      {sections.length === 0 && (
        <Alert variant="warning">
          <AlertTitle>Formulario sin secciones</AlertTitle>
          <AlertDescription>
            Esta vista no tiene <code>schema.sections</code> configurado.
          </AlertDescription>
        </Alert>
      )}

      {showCompletion ? (
        <FormCompletionRing
          percent={completionPercent}
          filledCount={filledCount}
          totalCount={allFieldNames.length}
        />
      ) : null}

      <div
        className={
          asideSections.length > 0 || previewModel
            ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"
            : "space-y-3"
        }
      >
        <div className="space-y-3">
          {mainSections.map((section) => renderSection(section))}
        </div>
        {asideSections.length > 0 || previewModel ? (
          <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
            {previewModel ? (
              <FormPreviewPanel
                title={previewModel.title}
                subtitle={previewModel.subtitle}
                rows={previewModel.rows}
              />
            ) : null}
            {asideSections.map((section) => renderSection(section))}
          </div>
        ) : null}
      </div>

      <Dialog
        modal={inlineCreateDepth === 0}
        open={inlineCreateState.open}
        onOpenChange={(open) => {
          if (!open) closeInlineCreate();
        }}
      >
        <DialogContent className="md:max-w-3xl">
          {inlineCreateState.blueprint ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {normalizeSpanishLabel(
                    inlineCreateState.descriptor?.create?.title ??
                      inlineCreateState.descriptor?.create?.label ??
                      "Crear nuevo",
                  )}
                </DialogTitle>
                <DialogDescription>
                  Completa la información y guarda para continuar.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[70dvh] overflow-y-auto pr-1">
                <RunlyForm
                  blueprint={inlineCreateState.blueprint}
                  fields={nestedBlueprintFields}
                  initialData={inlineCreateState.prefillData}
                  mode="create"
                  token={token}
                  apiBaseUrl={apiBaseUrl}
                  onSuccess={handleInlineCreateSuccess}
                  onCancel={closeInlineCreate}
                  blueprints={
                    Array.isArray(blueprints) ? blueprints : nestedBlueprintRows
                  }
                  resolveBlueprintByKey={resolveBlueprintByKey}
                  allowInlineCreate={inlineCreateDepth < 1}
                  inlineCreateDepth={inlineCreateDepth + 1}
                />
              </div>
            </>
          ) : (
            <Alert variant="warning">
              <AlertTitle>No se pudo cargar el formulario</AlertTitle>
              <AlertDescription>
                No se encontró la vista de creación relacionada.
              </AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>

      {showFooter && (
        <div
          className={cn(
            "sticky bottom-0 z-10 border-t border-[hsl(var(--border))] px-4 py-3 flex items-center justify-between gap-2",
            "bg-[hsl(var(--surface-1))]",
          )}
        >
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {submitting ? "Guardando..." : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCancel?.()}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? "Guardando..." : submitLabel}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
