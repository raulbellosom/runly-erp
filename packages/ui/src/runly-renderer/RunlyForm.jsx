import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import { renderFormFieldControl } from "./runly-form-field-control.jsx";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../components/Alert.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/Dialog.jsx";
import { AttachmentsPanel } from "../components/AttachmentsPanel.jsx";
import { FormCompletionRing } from "../components/FormCompletionRing.jsx";
import { FormPreviewPanel } from "../components/FormPreviewPanel.jsx";
import { ReportPartsEditor } from "./ReportPartsEditor.jsx";
import { CostsSummaryPanel } from "./CostsSummaryPanel.jsx";
import { DynamicFieldsSection, buildCustomFieldsPayload, seedCustomFieldValues } from "./DynamicFieldsSection.jsx";
import { normalizeSpanishLabel } from "./renderer-adapters.js";
import { cn } from "../lib/utils.js";
import { FormSaveBar } from "../components/FormSaveBar.jsx";
import { useInsideOverlay } from "../components/overlay-surface-context.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { normalizeField, normalizeSections } from "./runly-form-schema.js";
import { computeCompletion, computePreviewModel } from "./runly-form-preview.js";
import { fetchFirstImageAssetId, fetchSignedUrl } from "./runly-detail-hero.jsx";
import { firstTabWithError, resolveSchemaTabs, tabOfSection, tabsWithErrors } from "./schema-tabs.js";
import { isElementVisible, matchesVisibilityRule, visibleSections } from "./visibility-rules.js";
import { SchemaTabBar } from "./SchemaTabBar.jsx";
import { FieldPinButton, pinStateFor } from "./FieldPinButton.jsx";
import { useRunlyFormRelations } from "./useRunlyFormRelations.js";
import {
  joinUrl,
  buildInitialValues,
  castValueByType,
  resolveRecordId,
  extractCreatedRecord,
  toMoney,
  normalizeReportParts,
  computePartsCost,
  formValuesChanged,
} from "./runly-form-utils.js";

const MAIN_SECTION_TYPES = new Set(["fields", "parts", "attachments", "custom-fields", "component"]);

const matchesFieldRule = matchesVisibilityRule;

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

const DERIVED_FIELDS = new Set(["parts_cost", "total_cost"]);

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
  onCompletionChange,
  asideActions = null,
  onAttachmentsChange,
  componentRegistry = null,
  renderTools = null,
  submitRequest = null,
  // Optional per-field pins, see FieldPinButton.jsx for the contract.
  fieldPins = null,
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

  const insideOverlay = useInsideOverlay();
  const [formValues, setFormValues] = useState(() =>
    buildInitialValues(fieldMap, initialData),
  );
  // Tabs and sections can depend on live values (visibleWhen). Fields of a
  // hidden tab/section are neither validated nor sent, so stored values stay.
  const allFormTabs = useMemo(() => resolveSchemaTabs(schema), [schema]);
  const formTabs = useMemo(
    () => allFormTabs.filter((tab) => isElementVisible(tab, formValues)),
    [allFormTabs, formValues],
  );
  const shownSections = useMemo(
    () => visibleSections(sections, allFormTabs, formValues, tabOfSection),
    [sections, allFormTabs, formValues],
  );
  const hiddenFieldNames = useMemo(() => {
    const shown = new Set(shownSections.flatMap((section) => section.fields ?? []));
    return new Set(
      sections
        .flatMap((section) => section.fields ?? [])
        .filter((name) => !shown.has(name)),
    );
  }, [sections, shownSections]);
  const [activeTab, setActiveTab] = useState(null);
  const currentTab = formTabs.some((tab) => tab.key === activeTab) ? activeTab : (formTabs[0]?.key ?? null);
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
  const [collapsedSections, setCollapsedSections] = useState(() => {
    const next = {};
    for (const section of sections) {
      if (!section?.collapsible) continue;
      next[section.id] = Boolean(section.defaultCollapsed);
    }
    return next;
  });
  const attachmentsControllersRef = useRef(new Map());
  const formValuesRef = useRef(formValues);
  // Dirty tracking for the save bar: values as of the last reset, plus a flag
  // set by user edits (derived cost totals never mark the form dirty).
  const baselineRef = useRef(formValues);
  const baselinePartsRef = useRef(null);
  const [touched, setTouched] = useState(false);
  // Files queued for upload per attachments section (create forms): they
  // only save with the record, so they count as unsaved changes.
  const [pendingAttachments, setPendingAttachments] = useState({});
  const fieldMapRef = useRef(fieldMap);
  const initialDataRef = useRef(initialData);
  const sectionsRef = useRef(sections);

  // Commit the latest values before the reset effect and event handlers run.
  useLayoutEffect(() => {
    fieldMapRef.current = fieldMap;
    initialDataRef.current = initialData;
    sectionsRef.current = sections;
  }, [fieldMap, initialData, sections]);

  useEffect(() => {
    formValuesRef.current = formValues;
  }, [formValues]);

  const {
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
  } = useRunlyFormRelations({
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
  });

  // Reset form state when the form structure or initial data actually changes.
  // Uses string tokens (not object refs) so reference-equal but structurally identical
  // re-renders (e.g. outer form re-rendering and producing a new fields array) do not
  // spuriously clear user input in a nested inline-create form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fm = fieldMapRef.current;
    const id = initialDataRef.current;
    const sc = sectionsRef.current;
    // Custom field values of the record join the flat form values.
    const nextValues = seedCustomFieldValues(buildInitialValues(fm, id), sc, id);
    baselineRef.current = nextValues;
    setTouched(false);
    setFormValues(nextValues);
    const nextParts = normalizeReportParts(id?.parts);
    baselinePartsRef.current = JSON.stringify(nextParts);
    setReportParts(nextParts);
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

  const recordId = resolvedRecordId;
  const isEditMode = mode === "edit";

  // Edited and actually different from the last reset/save (reverting every
  // change hides the save bar again). Derived cost totals are ignored.
  const hasPendingAttachments = Object.values(pendingAttachments).some((count) => count > 0);
  const isDirty = useMemo(() => {
    if (hasPendingAttachments) return true;
    if (!touched) return false;
    if (baselinePartsRef.current !== null && JSON.stringify(reportParts) !== baselinePartsRef.current) return true;
    return formValuesChanged(baselineRef.current, formValues, DERIVED_FIELDS);
  }, [touched, formValues, reportParts, hasPendingAttachments]);

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
    setTouched(true);
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    clearRelationInlineError(name);
  };

  const handlePartsChange = useCallback((nextParts) => {
    setTouched(true);
    setReportParts(Array.isArray(nextParts) ? nextParts : []);
    setFieldErrors((prev) => ({ ...prev, parts: "" }));
  }, []);

  const toggleSection = useCallback((sectionId) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !Boolean(prev[sectionId]),
    }));
  }, []);

  const validate = () => {
    const nextErrors = {};
    for (const section of shownSections) {
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
    const errorTab = firstTabWithError(shownSections, allFormTabs, nextErrors);
    if (errorTab) setActiveTab(errorTab);
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
      if (hiddenFieldNames.has(name)) continue;
      const casted = castValueByType(formValues[name], field.type);
      if (field.type === "boolean") {
        payload[name] = Boolean(casted);
        continue;
      }
      if (field.type === "relation" || (field.type === "file" && field.file)) {
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
      const { customValues, removedCustomFieldIds } = buildCustomFieldsPayload(
        formValues,
        defs,
        customFieldsSection.customFields?.valuePrefix,
      );
      if (customValues.length > 0) payload.customValues = customValues;
      if (removedCustomFieldIds.length > 0) payload.removedCustomFieldIds = removedCustomFieldIds;
    }
    setSubmitting(true);
    try {
      let result;
      if (submitRequest) {
        result = await submitRequest({ payload, recordId, mode });
      } else {
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
      result = await response.json();
      }
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

      baselineRef.current = formValuesRef.current;
      setTouched(false);
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

  const renderFieldControl = (field) =>
    renderFormFieldControl(field, { formValues, fieldErrors, handleChange, apiBaseUrl, token, companyId, relationState, relationInlineErrors, initialData, allowInlineCreate, inlineCreateDepth, quickCreatingField, inlineCreateState, loadRelationOptions, handleRelationSearch, handleQuickCreate, openInlineCreate });

  const mainSections = shownSections.filter(
    (section) =>
      MAIN_SECTION_TYPES.has(section.type) && section.placement !== "aside",
  );
  const asideSections = shownSections.filter(
    (section) =>
      section.type === "attachments" && section.placement === "aside",
  );

  const renderSection = (section) => {
    const isCollapsed = Boolean(collapsedSections[section.id]);
    const isCollapsible = Boolean(section.collapsible);

    const renderSectionHeader = () => {
      if (!section.title && !isCollapsible) return null;
      const SectionIcon = section.icon ? LucideIcons[section.icon] : null;
      const headerInner = (
        <>
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]">
              {isCollapsed ? (
                <LucideIcons.ChevronDown className="h-4 w-4" />
              ) : (
                <LucideIcons.ChevronUp className="h-4 w-4" />
              )}
            </span>
          ) : null}
        </>
      );

      // The whole header row is the click target when a section can collapse —
      // hunting for the small chevron button was the actual complaint. The
      // chevron above is now a plain, non-interactive span so a click anywhere
      // in the row only fires this one handler (no nested-button double toggle).
      if (isCollapsible) {
        return (
          <button
            type="button"
            onClick={() => toggleSection(section.id)}
            className="flex w-full items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-3 text-left transition-opacity hover:opacity-80"
          >
            {headerInner}
          </button>
        );
      }
      return (
        <div className="pb-3 border-b border-[hsl(var(--border))] flex items-start justify-between gap-3">
          {headerInner}
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
            onChange={onAttachmentsChange}
            onPendingChange={(count) =>
              setPendingAttachments((prev) => (prev[section.id] === count ? prev : { ...prev, [section.id]: count }))
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
            initialEntries={initialData?.[section.customFields?.valuePrefix ?? "customValues"] ?? null}
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

      if (section.type === "component") {
        const Comp = componentRegistry?.resolve?.(section.component) ?? null;
        if (!Comp) {
          return (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
              Componente "{section.component}" no está registrado.
            </div>
          );
        }
        const sectionValue = {};
        for (const fieldName of section.fields ?? []) {
          sectionValue[fieldName] = formValues[fieldName];
        }
        const sectionErrors = {};
        for (const fieldName of section.fields ?? []) {
          if (fieldErrors[fieldName]) sectionErrors[fieldName] = fieldErrors[fieldName];
        }
        return (
          <Comp
            value={sectionValue}
            errors={sectionErrors}
            onChange={(patch) => {
              setTouched(true);
              setFormValues((prev) => ({ ...prev, ...patch }));
              setFieldErrors((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(patch)) next[key] = "";
                return next;
              });
            }}
            apiBaseUrl={apiBaseUrl}
            token={token}
            companyId={companyId}
            disabled={submitting}
            renderPin={(names, label) => {
              const pin = pinStateFor(fieldPins, names);
              return pin ? <FieldPinButton {...pin} label={label} /> : null;
            }}
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
            const pin = pinStateFor(fieldPins, [field.name]);
            return (
              <div
                key={field.name}
                className={cn(isFullWidth && "col-span-full", pin && "relative")}
              >
                {pin ? <FieldPinButton {...pin} label={field.label} /> : null}
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
          "glass-shell-flat rounded-xl px-5 py-4 space-y-4",
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
  const hasAsideColumn =
    showCompletion || Boolean(asideActions) || Boolean(previewModel) || asideSections.length > 0;

  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function loadPreviewImage() {
      if (!previewConfig?.imageDocsPath || !recordId) {
        if (!cancelled) setPreviewImageUrl(null);
        return;
      }
      const assetId = await fetchFirstImageAssetId(
        apiBaseUrl,
        token,
        previewConfig.imageDocsPath,
        recordId,
        companyId,
      );
      if (!assetId) {
        if (!cancelled) setPreviewImageUrl(null);
        return;
      }
      const url = await fetchSignedUrl(apiBaseUrl, token, assetId, companyId, undefined, "preview");
      if (!cancelled) setPreviewImageUrl(url);
    }
    loadPreviewImage();
    return () => {
      cancelled = true;
    };
  }, [previewConfig?.imageDocsPath, recordId, apiBaseUrl, token, companyId]);

  // Reported unconditionally (regardless of schema.showCompletion) so a screen
  // that wants to react to completion changes elsewhere (e.g. a page title
  // badge) can do so in addition to the ring RunlyForm renders itself below.
  useEffect(() => {
    onCompletionChange?.({
      percent: completionPercent,
      filledCount,
      totalCount: allFieldNames.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionPercent, filledCount, allFieldNames.length]);

  if (!apiPath) {
    return <Alert variant="warning"><AlertTitle>Vista sin configuración</AlertTitle>
      <AlertDescription>Esta vista no tiene <code>schema.apiPath</code>. No se puede guardar la información.</AlertDescription></Alert>;
  }

  return (
    <form id={id} className="space-y-6" onSubmit={handleSubmit}>
      {renderTools?.({ values: formValues, disabled: submitting, patchValues: (patch) => {
        setTouched(true);
        setFormValues((prev) => ({ ...prev, ...patch }));
        setFieldErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !(key in patch))));
      } })}
      <SchemaTabBar
        tabs={formTabs}
        activeKey={currentTab}
        onChange={setActiveTab}
        errorKeys={tabsWithErrors(
          shownSections,
          allFormTabs,
          Object.fromEntries(Object.entries(fieldErrors).filter(([, message]) => Boolean(message))),
        )}
      />
      {sections.length === 0 && (
        <Alert variant="warning">
          <AlertTitle>Formulario sin secciones</AlertTitle>
          <AlertDescription>
            Esta vista no tiene <code>schema.sections</code> configurado.
          </AlertDescription>
        </Alert>
      )}

      <div className={hasAsideColumn ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]" : "space-y-3"}>
        {/* Below xl there's no side-by-side column, so the aside content
            (completion ring, quick actions) would otherwise fall after every
            field, at the very bottom of a long form. order-first puts it
            right below the header instead; xl:order-none restores normal
            (right-column) source order once the two columns sit side by side. */}
        <div className="space-y-3 order-last xl:order-none">
          {/* Every tab stays mounted (only hidden) so no typed value is lost. */}
          {mainSections.map((section) =>
            allFormTabs.length ? (
              <div key={section.id} hidden={tabOfSection(section, allFormTabs) !== currentTab}>
                {renderSection(section)}
              </div>
            ) : (
              renderSection(section)
            ),
          )}
        </div>
        {hasAsideColumn ? (
          <div className="space-y-3 order-first xl:order-none xl:sticky xl:top-4 xl:self-start">
            {showCompletion || asideActions ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:flex-col xl:items-stretch">
                {showCompletion ? (
                  <FormCompletionRing
                    percent={completionPercent}
                    filledCount={filledCount}
                    totalCount={allFieldNames.length}
                  />
                ) : null}
                {asideActions}
              </div>
            ) : null}
            {previewModel ? (
              <FormPreviewPanel
                title={previewModel.title}
                subtitle={previewModel.subtitle}
                rows={previewModel.rows}
                imageUrl={previewImageUrl}
                fallbackIcon={previewConfig?.fallbackIcon}
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
        <FormSaveBar
          floating={!insideOverlay}
          dirty={isDirty}
          submitting={submitting}
          forceVisible={Boolean(submitError)}
          submitLabel={submitLabel}
          onCancel={() => onCancel?.()}
        />
      )}
    </form>
  );
}
