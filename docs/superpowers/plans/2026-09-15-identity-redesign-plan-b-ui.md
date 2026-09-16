# Identity Redesign — Plan B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md`
**Companion plan:** `docs/superpowers/plans/2026-09-15-identity-redesign-plan-a-api.md` (backend; Section 2 onward of this plan consumes the SDK methods it adds)

**Goal:** Rebuild Usuarios (detail/edit) and Roles (list/detail) on the shared glassic blueprint pattern (`RunlyTable`/`RunlyDetail`/`RunlyForm`/`RunlyCrudView`/`DetailHero`/`StatStrip`) already used by `runly.hr`/`runly.fleet`/`runly.inventory`; restyle Overview (`StatStrip`) and Reportes de chat (visual polish only — its backing endpoint doesn't support blueprint-table pagination); and give `RunlyForm` the same `type: "component"` section capability `RunlyDetail` already has so a cascading country/state/city picker (and any future custom field group) can live inside a blueprint form.

**Architecture:** Section 1 extends the shared `@runly/ui` renderer (`RunlyForm` + a new `AddressFieldsSection` component) — this must land first since every other section depends on it. Sections 2–5 each follow the same shape already established by `runly.hr`: a `blueprints/*.blueprint.js` data file per screen, a small custom `components/*.jsx` file per `type: "component"` section, registration in `apps/desktop/src/lib/moduleComponentRegistry.js`, and a thin screen component that wires permissions/mutations around the shared renderer.

**Tech Stack:** React, `@runly/ui` blueprint renderer, TanStack Query, `react-router-dom`, `sonner` toasts, `node:test` for the pure renderer-logic unit tests (this repo has no component-level test harness — every existing `packages/ui/src/runly-renderer/__tests__/*` file tests pure helper functions only, not rendered React output; this plan follows that exact convention).

---

## File Structure

**Shared renderer (Section 1):**
- Create: `packages/ui/src/runly-renderer/useRunlyFormRelations.js` — extracted relation-loading + inline-create hook (moved out of `RunlyForm.jsx` to keep it under the project's file-size ceiling after adding component-section support).
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx` — use the new hook, add `componentRegistry` prop, add the `type: "component"` render branch.
- Modify: `packages/ui/src/runly-renderer/runly-form-schema.js` — add the `component` section type to `normalizeSections`.
- Modify: `packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js` — add coverage for the new section type.
- Create: `packages/ui/src/components/AddressFieldsSection.jsx` — reusable country/state/city cascade + street/colony/numbers/postal code field group.
- Modify: `packages/ui/src/index.js` — export `AddressFieldsSection`.
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js` — register `runly.identity:AddressFieldsSection`.

**Users (Section 2):**
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-user-table.blueprint.js` (extracted from `UsersScreen.jsx`, no schema change).
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js`.
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-user-form.blueprint.js`.
- Create: `apps/desktop/src/modules/runly.identity/components/MembershipsSection.jsx`.
- Create: `apps/desktop/src/modules/runly.identity/components/PermissionGrantsSection.jsx`.
- Create: `apps/desktop/src/modules/runly.identity/components/UserActivitySection.jsx`.
- Create: `apps/desktop/src/modules/runly.identity/screens/UserDetailScreen.jsx`.
- Create: `apps/desktop/src/modules/runly.identity/screens/UserEditScreen.jsx`.
- Modify: `apps/desktop/src/modules/runly.identity/screens/UsersScreen.jsx` (import the extracted blueprint, drop the inline object).
- Modify: `apps/desktop/src/modules/runly.identity/screens/UserCreateScreen.jsx` (visual polish only).
- Modify: `apps/desktop/src/app/ModuleOutlet.jsx` (repoint two route entries).
- Delete: `apps/desktop/src/modules/runly.identity/screens/UserEditorScreen.jsx`.
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js` (register the 3 new Users components).

**Roles (Section 3):**
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-role-table.blueprint.js`.
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-role-detail.blueprint.js`.
- Create: `apps/desktop/src/modules/runly.identity/components/PermissionTreeSection.jsx` (extracted from `RoleEditorScreen.jsx`'s permission-tree + save logic).
- Create: `apps/desktop/src/modules/runly.identity/components/RoleMembersSection.jsx`.
- Modify: `apps/desktop/src/modules/runly.identity/screens/RolesScreen.jsx` (rewritten around `RunlyCrudView`).
- Modify: `apps/desktop/src/modules/runly.identity/screens/RoleEditorScreen.jsx` (rewritten around `RunlyDetail`).
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js` (register the 2 new Roles components).

**Overview & Reportes de chat (Sections 4–5):**
- Modify: `apps/desktop/src/modules/runly.identity/screens/IdentityOverview.jsx` (StatCard → StatStrip).
- Modify: `apps/desktop/src/modules/runly.identity/screens/ChatReportsScreen.jsx` (visual polish only — confirmed during planning that its backing endpoint doesn't support `RunlyTable`'s pagination contract; see Task 19).

---

## Section 1: Shared renderer infrastructure

### Task 1: Extract relation/inline-create logic out of `RunlyForm.jsx` into a hook

**Why first:** `RunlyForm.jsx` is already 1540 lines (over the project's 1500-line hard ceiling per `CLAUDE.md`) before this feature touches it. Adding `type: "component"` support without first shrinking the file would make an existing violation worse. The relation-loading and inline-create-dialog logic (lines ~192–827 today) is self-contained enough to move into a dedicated hook with zero behavior change.

**Files:**
- Create: `packages/ui/src/runly-renderer/useRunlyFormRelations.js`
- Modify: `packages/ui/src/runly-renderer/RunlyForm.jsx`

- [ ] **Step 1: Create the hook file**

```js
// packages/ui/src/runly-renderer/useRunlyFormRelations.js
//
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
```

- [ ] **Step 2: Update `RunlyForm.jsx`'s imports**

Replace the existing import block (everything from `import { useCallback, ...` through the `_relationOptionsCache`/`_RELATION_CACHE_TTL` lines) with:

```js
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
import { normalizeSpanishLabel, normalizeRelationDescriptor } from "./renderer-adapters.js";
import { cn } from "../lib/utils.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { normalizeField, normalizeSections } from "./runly-form-schema.js";
import { formatDisplayValue, computeCompletion, computePreviewModel } from "./runly-form-preview.js";
import { useRunlyFormRelations } from "./useRunlyFormRelations.js";
import {
  PRESET_COLORS,
  CAR_COLORS,
  resolveColorName,
  joinUrl,
  normalizeOptions,
  buildInitialValues,
  castValueByType,
  resolveRecordId,
  toMoney,
  normalizeReportParts,
  computePartsCost,
} from "./runly-form-utils.js";

const MAIN_SECTION_TYPES = new Set(["fields", "parts", "attachments", "custom-fields", "component"]);
```

(Note: `resolveRelationLabel`, `extractBlueprintRows`, `extractFieldsFromBlueprint`, `extractCreatedRecord`, `buildInlineCreatePrefill` are dropped from this import — they moved into `useRunlyFormRelations.js` and are no longer referenced directly in `RunlyForm.jsx`. `normalizeRelationDescriptor` stays imported here too, since `renderFieldControl`'s `"relation"` case still calls it directly.)

- [ ] **Step 3: Add the `componentRegistry` prop and call the hook**

Replace the function signature:

```js
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
  componentRegistry = null,
}) {
```

Then replace the block that currently declares `relationState` through `handleQuickCreate` (everything from `const [relationState, setRelationState] = useState({});` down to the closing `},\n    [apiBaseUrl, applyCreatedRelationResult, companyId, token],\n  );` right before `const validate = () => {`) with:

```js
  const {
    relationState,
    relationInlineErrors,
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
```

Also remove the now-duplicate `nestedBlueprintFields` `useMemo` block that used to sit right after `inlineCreateState` (it lives in the hook now), and remove the `relationDebounceRef` declaration (also moved into the hook) — both were part of the block just replaced above, so no separate edit is needed if the whole block was replaced as shown.

Leave `attachmentsControllersRef`, `formValuesRef`, `fieldMapRef`, `initialDataRef`, `sectionsRef`, and `collapsedSections` exactly where they are today (they did not move).

- [ ] **Step 4: Update `handleChange` to clear relation errors via the hook**

Replace:

```js
  const handleChange = (name, value) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    setRelationInlineErrors((prev) => ({ ...prev, [name]: "" }));
  };
```

with:

```js
  const handleChange = (name, value) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    clearRelationInlineError(name);
  };
```

- [ ] **Step 5: Add the `component` section render branch**

In `renderSectionBody()`, insert a new branch immediately after the existing `if (section.type === "custom-fields") { ... }` block and before `const fieldsGrid = (`:

```js
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
          />
        );
      }

```

- [ ] **Step 6: Run the existing renderer test suite (regression check)**

Run: `node --test packages/ui/src/runly-renderer/__tests__/`
Expected: all existing tests still PASS (`detail-presentation.test.js`, `renderer-adapters.test.js`, `runly-form-preview.test.js`, `runly-form-schema.test.js`) — this task did not change any of the files those tests import, so this confirms the extraction didn't break `RunlyForm.jsx`'s public surface.

- [ ] **Step 7: Build check**

Run: `pnpm --filter @runly/ui build` (or `pnpm build` if there is no per-package build script)
Expected: no errors. If `pnpm --filter @runly/ui build` doesn't exist, run `node --check packages/ui/src/runly-renderer/RunlyForm.jsx packages/ui/src/runly-renderer/useRunlyFormRelations.js` instead.

- [ ] **Step 8: Manual regression smoke test**

Run `pnpm dev`, open an existing HR employee's edit form (`/app/m/runly.hr/hr/employees/:id/edit`), and confirm: the "Puesto"/"Departamento"/"Supervisor" relation dropdowns still load and search, and using "+ Crear puesto" (inline quick-create) still works end to end. This exercises every code path moved into the new hook.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/runly-renderer/useRunlyFormRelations.js packages/ui/src/runly-renderer/RunlyForm.jsx
git commit -m "refactor(ui): extract relation/inline-create logic out of RunlyForm into a hook"
```

---

### Task 2: Add `type: "component"` support to `normalizeSections`

**Files:**
- Modify: `packages/ui/src/runly-renderer/runly-form-schema.js`
- Modify: `packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`:

```js
test("normalizeSections builds a component section and registers its declared fields", () => {
  const fieldMap = new Map();
  const sections = normalizeSections(
    {
      sections: [
        {
          id: "address",
          title: "Dirección",
          type: "component",
          component: "runly.identity:AddressFieldsSection",
          fields: ["country", "state", "city"],
        },
      ],
    },
    fieldMap,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "component");
  assert.equal(sections[0].component, "runly.identity:AddressFieldsSection");
  assert.deepEqual(sections[0].fields, ["country", "state", "city"]);
  assert.equal(fieldMap.has("country"), true);
  assert.equal(fieldMap.get("country").type, "text");
  assert.equal(fieldMap.get("country").required, false);
});

test("normalizeSections component section merges into an existing fieldMap entry without clobbering it", () => {
  const fieldMap = new Map([["country", { name: "country", label: "País", type: "text", required: true }]]);
  normalizeSections(
    { sections: [{ type: "component", component: "x:Y", fields: ["country"] }] },
    fieldMap,
  );
  assert.equal(fieldMap.get("country").required, true);
  assert.equal(fieldMap.get("country").label, "País");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`
Expected: FAIL — the `component`-typed section falls through to the default `"fields"` branch today, so `sections[0].type` is `"fields"` and `sections[0].component` is `undefined`.

- [ ] **Step 3: Implement the branch**

In `normalizeSections`, insert a new `if` block immediately after the existing `custom-fields` block and before the fallback `"fields"` handling (the `const sectionFields = ...` line):

```js
      if (sectionType === "component") {
        const declaredFieldNames = (Array.isArray(entry.fields) ? entry.fields : [])
          .map((name) => String(name ?? "").trim())
          .filter(Boolean);
        for (const name of declaredFieldNames) {
          if (!fieldMap.has(name)) {
            fieldMap.set(name, {
              name,
              label: name,
              type: "text",
              required: false,
              readonly: false,
              options: [],
              visibleWhen: null,
              hiddenWhen: null,
            });
          }
        }
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: (entry.title ?? entry.label) ? normalizeSpanishLabel(entry.title ?? entry.label) : null,
          type: "component",
          component: typeof entry.component === "string" ? entry.component.trim() : "",
          fields: declaredFieldNames,
          icon: typeof entry.icon === "string" && entry.icon.trim() ? entry.icon.trim() : null,
          ...toSectionMeta(entry),
        };
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js`
Expected: PASS (all tests, including the two new ones and the pre-existing ones from Task 1's regression check).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/runly-renderer/runly-form-schema.js packages/ui/src/runly-renderer/__tests__/runly-form-schema.test.js
git commit -m "feat(ui): support type:component sections in RunlyForm blueprints"
```

---

### Task 3: `AddressFieldsSection` component

**Files:**
- Create: `packages/ui/src/components/AddressFieldsSection.jsx`
- Modify: `packages/ui/src/index.js`

- [ ] **Step 1: Create the component**

This reproduces the exact country → state → city cascading behavior currently hand-rolled in `UserEditorScreen.jsx` (and duplicated in `CompanyAddress.jsx`), as a `type: "component"` section consumed by `RunlyForm` per Task 2's contract: it receives `value` (an object keyed by the section's declared field names), `errors`, `onChange(patch)`, and `disabled`.

```jsx
// packages/ui/src/components/AddressFieldsSection.jsx
import { useMemo } from "react";
import { Country, State, City } from "country-state-city";
import { MapPin } from "lucide-react";
import { ComboboxField, TextField } from "./FormFields.jsx";

// Reusable address field group: country -> state -> city cascade (via the
// country-state-city package) plus colonia/calle/numeros/codigo postal as
// plain text fields. Designed to be registered as a `type: "component"`
// section in any RunlyForm blueprint — see
// docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md.
//
// Contract: `value` holds only the fields this component owns (country,
// state, city, colony, street, extNumber, intNumber, postalCode); `onChange`
// is called with a partial patch of those same keys to merge into the
// parent form's state.
export function AddressFieldsSection({ value = {}, errors = {}, onChange, disabled = false }) {
  const country = value.country ?? "";
  const state = value.state ?? "";
  const city = value.city ?? "";

  const countryOptions = useMemo(
    () => Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name })),
    [],
  );
  const stateOptions = useMemo(
    () => (country ? State.getStatesOfCountry(country).map((s) => ({ value: s.isoCode, label: s.name })) : []),
    [country],
  );
  const cityOptions = useMemo(
    () => (country && state ? City.getCitiesOfState(country, state).map((c) => ({ value: c.name, label: c.name })) : []),
    [country, state],
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ComboboxField
        label="País"
        options={countryOptions}
        value={country}
        disabled={disabled}
        onChange={(val) => onChange({ country: val, state: "", city: "", colony: value.colony ?? "" })}
        placeholder="Seleccionar país..."
        searchPlaceholder="Buscar país..."
        error={errors.country}
      />
      {stateOptions.length > 0 ? (
        <ComboboxField
          label="Estado / Provincia"
          options={stateOptions}
          value={state}
          disabled={disabled}
          onChange={(val) => onChange({ state: val, city: "", colony: value.colony ?? "" })}
          placeholder="Seleccionar estado..."
          searchPlaceholder="Buscar estado..."
          error={errors.state}
        />
      ) : (
        <TextField
          label="Estado / Provincia"
          icon={MapPin}
          value={state}
          disabled={disabled}
          onChange={(e) => onChange({ state: e.target.value })}
          error={errors.state}
        />
      )}
      {country && cityOptions.length > 0 ? (
        <ComboboxField
          label="Ciudad / Municipio"
          options={cityOptions}
          value={city}
          disabled={disabled}
          onChange={(val) => onChange({ city: val })}
          placeholder="Seleccionar ciudad..."
          searchPlaceholder="Buscar ciudad..."
          minSearchLength={2}
          error={errors.city}
        />
      ) : (
        <TextField
          label="Ciudad / Municipio"
          icon={MapPin}
          value={city}
          disabled={disabled}
          onChange={(e) => onChange({ city: e.target.value })}
          error={errors.city}
        />
      )}
      <TextField
        label="Colonia / Fraccionamiento"
        icon={MapPin}
        value={value.colony ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ colony: e.target.value })}
        error={errors.colony}
      />
      <TextField
        label="Calle"
        icon={MapPin}
        value={value.street ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ street: e.target.value })}
        error={errors.street}
      />
      <TextField
        label="Número exterior"
        value={value.extNumber ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ extNumber: e.target.value })}
        error={errors.extNumber}
      />
      <TextField
        label="Número interior"
        value={value.intNumber ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ intNumber: e.target.value })}
        error={errors.intNumber}
      />
      <TextField
        label="Código postal"
        value={value.postalCode ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ postalCode: e.target.value })}
        error={errors.postalCode}
      />
    </div>
  );
}
```

- [ ] **Step 2: Export it**

Modify `packages/ui/src/index.js`: add `export { AddressFieldsSection } from "./components/AddressFieldsSection.jsx";` next to the other component exports (e.g. near `DetailHero`/`StatStrip`'s export lines).

- [ ] **Step 3: Verify syntax**

Run: `node --check packages/ui/src/components/AddressFieldsSection.jsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/AddressFieldsSection.jsx packages/ui/src/index.js
git commit -m "feat(ui): add reusable AddressFieldsSection component"
```

---

### Task 4: Register `AddressFieldsSection` in the module component registry

**Files:**
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js`

- [ ] **Step 1: Add the import and registration**

Add near the top, next to the other component imports:

```js
import { AddressFieldsSection } from "@runly/ui";
```

Add near the bottom, next to the other `runly.hr:*` registrations:

```js
componentRegistry.register("runly.identity:AddressFieldsSection", AddressFieldsSection);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/lib/moduleComponentRegistry.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/moduleComponentRegistry.js
git commit -m "feat(identity): register AddressFieldsSection in the module component registry"
```

---

## Section 2: Usuarios

### Task 5: Extract the Users table blueprint

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-user-table.blueprint.js`
- Modify: `apps/desktop/src/modules/runly.identity/screens/UsersScreen.jsx`

- [ ] **Step 1: Create the blueprint file**

Move the existing `USERS_BLUEPRINT` object out of `UsersScreen.jsx` verbatim, only adding a top-level `kind: "TABLE"` field for consistency with every other blueprint file in this plan (inert here — `UsersScreen.jsx` imports `RunlyTable` directly rather than dispatching on `kind`, so this is metadata only, not a behavior change):

```js
// apps/desktop/src/modules/runly.identity/blueprints/identity-user-table.blueprint.js
export const IDENTITY_USER_TABLE = {
  key: "identity.users.table",
  kind: "TABLE",
  schema: {
    apiPath: "/identity/users",
    primaryField: "displayName",
    searchable: true,
    searchPlaceholder: "Buscar usuario...",
    columns: [
      { field: "avatarUrl", label: "Foto", type: "image", sortable: false },
      { field: "displayName", label: "Usuario", sortable: true, link: true },
      { field: "email", label: "Correo", sortable: true },
      { field: "memberships.0.roleName", label: "Rol", sortable: false },
      {
        field: "enabled",
        label: "Estado",
        type: "select",
        sortable: true,
        options: [
          { value: true, label: "Activo" },
          { value: false, label: "Inactivo" },
        ],
      },
      { field: "createdAt", label: "Creado", type: "date", sortable: true },
      { field: "firstName", label: "Nombre", defaultVisible: false },
      { field: "lastName", label: "Apellidos", defaultVisible: false },
      { field: "phone", label: "Telefono", defaultVisible: false },
      {
        field: "gender",
        label: "Sexo",
        defaultVisible: false,
        type: "select",
        options: [
          { value: "male", label: "Masculino" },
          { value: "female", label: "Femenino" },
          { value: "other", label: "Otro" },
        ],
      },
      { field: "birthDate", label: "Fecha nacimiento", type: "date", defaultVisible: false },
      { field: "country", label: "Pais", defaultVisible: false },
      { field: "state", label: "Estado/Provincia", defaultVisible: false },
      { field: "city", label: "Ciudad", defaultVisible: false },
      { field: "colony", label: "Colonia", defaultVisible: false },
      { field: "street", label: "Calle", defaultVisible: false },
      { field: "postalCode", label: "Codigo postal", defaultVisible: false },
      { field: "bio", label: "Bio", defaultVisible: false },
    ],
    filters: [
      {
        key: "enabled",
        label: "Estado",
        type: "select",
        options: [
          { value: "true", label: "Activo" },
          { value: "false", label: "Inactivo" },
        ],
      },
    ],
    emptyState: { message: "No hay usuarios registrados." },
    rowActions: [{ label: "Ver detalle" }, { label: "Editar" }, { label: "Eliminar" }],
  },
};

export default IDENTITY_USER_TABLE;
```

- [ ] **Step 2: Update `UsersScreen.jsx`**

Remove the inline `USERS_BLUEPRINT` object definition (the `const USERS_BLUEPRINT = { ... };` block) and its now-unused surrounding comment, and instead import it:

```js
import { IDENTITY_USER_TABLE } from "../blueprints/identity-user-table.blueprint.js";
```

Replace every use of `USERS_BLUEPRINT` in the file (there is exactly one, in the `<RunlyTable blueprint={USERS_BLUEPRINT} ...>` JSX) with `IDENTITY_USER_TABLE`.

- [ ] **Step 3: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/screens/UsersScreen.jsx apps/desktop/src/modules/runly.identity/blueprints/identity-user-table.blueprint.js`
Expected: no output. (Note: `node --check` validates plain JS syntax; JSX in `UsersScreen.jsx` requires the project's normal build/lint step to fully verify — run `pnpm lint` on this file as well.)

- [ ] **Step 4: Manual verification**

Run `pnpm dev`, open `/app/m/runly.identity/identity/users`, and confirm the table renders exactly as before (same columns, search, filters, bulk actions).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/blueprints/identity-user-table.blueprint.js apps/desktop/src/modules/runly.identity/screens/UsersScreen.jsx
git commit -m "refactor(identity): extract Users table blueprint into its own file"
```

---

### Task 6: `identity-user-detail.blueprint.js`

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js`

- [ ] **Step 1: Create the blueprint**

```js
// apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js
const ENABLED_STATUS_MAP = { true: "Activo", false: "Inactivo" };

export const IDENTITY_USER_DETAIL = {
  key: "identity.user.detail",
  kind: "DETAIL",
  schema: {
    entity: "identityUser",
    component: "RunlyDetail",
    apiPath: "/identity/users",
    layout: "two-column",
    hero: {
      titleField: "displayName",
      subtitleFields: ["email"],
      statusField: "enabled",
      statusMap: ENABLED_STATUS_MAP,
      avatarUserField: "id",
      fallbackIcon: "UserRound",
      metaChips: [{ field: "phone", label: "Teléfono", icon: "Phone" }],
    },
    kpis: [
      { label: "Estado", field: "enabled", type: "select", options: [{ value: true, label: "Activo" }, { value: false, label: "Inactivo" }], icon: "CircleCheck" },
      { label: "Rol principal", field: "memberships.0.roleName", icon: "Shield" },
      { label: "Empresas asignadas", field: "membershipsTotal", icon: "Building2" },
      { label: "Fecha de alta", field: "createdAt", type: "date", icon: "Calendar" },
    ],
    sections: [
      {
        label: "Información personal",
        icon: "UserRound",
        column: "main",
        columns: 2,
        fields: [
          { field: "firstName", label: "Nombre", icon: "UserRound" },
          { field: "lastName", label: "Apellidos", icon: "UserRound" },
          { field: "phone", label: "Teléfono", icon: "Phone" },
          { field: "birthDate", label: "Fecha de nacimiento", type: "date", icon: "Calendar" },
          { field: "gender", label: "Sexo", icon: "VenusAndMars" },
        ],
      },
      {
        label: "Biografía",
        icon: "FileText",
        column: "main",
        fields: [{ field: "bio", label: "Biografía", type: "markdown", icon: "FileText" }],
      },
      {
        label: "Dirección",
        icon: "MapPin",
        column: "main",
        columns: 2,
        fields: [
          { field: "country", label: "País", icon: "MapPin" },
          { field: "state", label: "Estado / Provincia", icon: "MapPin" },
          { field: "city", label: "Ciudad / Municipio", icon: "MapPin" },
          { field: "colony", label: "Colonia", icon: "MapPin" },
          { field: "street", label: "Calle", icon: "MapPin" },
          { field: "extNumber", label: "Número exterior" },
          { field: "intNumber", label: "Número interior" },
          { field: "postalCode", label: "Código postal" },
        ],
      },
      {
        id: "memberships",
        type: "component",
        label: "Empresas y roles",
        icon: "Building2",
        column: "aside",
        component: "runly.identity:MembershipsSection",
      },
      {
        id: "permission-grants",
        type: "component",
        label: "Permisos",
        icon: "KeyRound",
        column: "aside",
        component: "runly.identity:PermissionGrantsSection",
      },
      {
        id: "activity",
        type: "component",
        label: "Actividad",
        icon: "History",
        column: "aside",
        component: "runly.identity:UserActivitySection",
      },
    ],
  },
};

export default IDENTITY_USER_DETAIL;
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js
git commit -m "feat(identity): add Users detail blueprint"
```

---

### Task 7: `identity-user-form.blueprint.js`

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-user-form.blueprint.js`

- [ ] **Step 1: Create the blueprint**

```js
// apps/desktop/src/modules/runly.identity/blueprints/identity-user-form.blueprint.js
export const IDENTITY_USER_FORM = {
  key: "identity.user.form",
  kind: "FORM",
  schema: {
    entity: "identityUser",
    component: "RunlyForm",
    apiPath: "/identity/users",
    formMode: "page",
    showCompletion: true,
    sections: [
      {
        label: "Identidad",
        icon: "UserRound",
        fields: [
          { field: "firstName", label: "Nombre", type: "text", required: true },
          { field: "lastName", label: "Apellidos", type: "text", required: true },
          { field: "email", label: "Correo", type: "email", required: true },
          { field: "enabled", label: "Usuario activo", type: "boolean" },
        ],
      },
      {
        label: "Perfil",
        icon: "Contact",
        fields: [
          { field: "phone", label: "Teléfono", type: "phone" },
          { field: "birthDate", label: "Fecha de nacimiento", type: "date" },
          {
            field: "gender",
            label: "Sexo",
            type: "select",
            options: [
              { value: "masculino", label: "Masculino" },
              { value: "femenino", label: "Femenino" },
              { value: "no_binario", label: "No binario" },
              { value: "prefiero_no_decir", label: "Prefiero no decir" },
            ],
          },
          { field: "bio", label: "Biografía", type: "markdown", fullWidth: true },
        ],
      },
      {
        id: "address",
        type: "component",
        label: "Dirección",
        icon: "MapPin",
        component: "runly.identity:AddressFieldsSection",
        fields: ["country", "state", "city", "colony", "street", "extNumber", "intNumber", "postalCode"],
      },
    ],
    submitLabel: "Guardar usuario",
    cancelLabel: "Cancelar",
  },
};

export default IDENTITY_USER_FORM;
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/blueprints/identity-user-form.blueprint.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/blueprints/identity-user-form.blueprint.js
git commit -m "feat(identity): add Users edit form blueprint"
```

---

### Task 8: `MembershipsSection` component

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/components/MembershipsSection.jsx`

This is the most involved new component: a per-row autosaving editor for a user's company memberships, plus a dialog to add a new one. It is registered as a `RunlyDetail` `type: "component"` section, so per that contract (see `RunlyDetail.jsx`) it receives `{ data, apiBaseUrl, token, companyId }` where `data` is the full user record from `GET /identity/users/:id` (including `memberships` and `membershipsTotal`).

- [ ] **Step 1: Create the component**

```jsx
// apps/desktop/src/modules/runly.identity/components/MembershipsSection.jsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, SelectField, SwitchField, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, EmptyState } from "@runly/ui";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

const NO_ROLE_VALUE = "__none__";

function roleOptionsForCompany(roles, companyId) {
  return [
    { value: NO_ROLE_VALUE, label: "Sin rol" },
    ...roles
      .filter((role) => role.companyId === null || role.companyId === companyId)
      .map((role) => ({ value: role.id, label: role.name })),
  ];
}

export default function MembershipsSection({ data }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const userId = data?.id;
  const memberships = data?.memberships ?? [];
  const [addOpen, setAddOpen] = useState(false);
  const [addCompanyId, setAddCompanyId] = useState("");
  const [addRoleId, setAddRoleId] = useState(NO_ROLE_VALUE);
  const [savingMembershipId, setSavingMembershipId] = useState(null);

  const rolesQuery = useQuery({
    queryKey: ["identity-roles"],
    queryFn: () => runly.identity.listRoles(token),
    enabled: Boolean(token),
  });
  const companiesQuery = useQuery({
    queryKey: ["identity-company-options"],
    queryFn: () => runly.identity.listCompanyOptions(token),
    enabled: Boolean(token) && addOpen,
  });
  const roles = rolesQuery.data?.data ?? [];
  const companies = companiesQuery.data?.data ?? [];

  const assignedCompanyIds = useMemo(() => new Set(memberships.filter((m) => m.enabled).map((m) => m.companyId)), [memberships]);
  const companyOptions = companies
    .filter((c) => !assignedCompanyIds.has(c.id))
    .map((c) => ({ value: c.id, label: c.name }));

  const updateMutation = useMutation({
    mutationFn: ({ membershipId, patch }) => runly.identity.updateMembership(userId, membershipId, patch, token),
    onMutate: ({ membershipId }) => setSavingMembershipId(membershipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
      toast.success("Membresía actualizada");
    },
    onError: (err) => toast.error(err?.message || "No se pudo actualizar la membresía"),
    onSettled: () => setSavingMembershipId(null),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => runly.identity.createMembership(userId, payload, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
      toast.success("Empresa asignada");
      setAddOpen(false);
      setAddCompanyId("");
      setAddRoleId(NO_ROLE_VALUE);
    },
    onError: (err) => toast.error(err?.message || "No se pudo asignar la empresa"),
  });

  if (!userId) return null;

  return (
    <div className="space-y-3">
      {memberships.length === 0 ? (
        <EmptyState icon={Building2} title="Sin empresas asignadas" description="Este usuario no tiene acceso a ninguna empresa todavía." />
      ) : (
        <div className="space-y-2">
          {memberships.map((membership) => (
            <div key={membership.id} className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{membership.companyName ?? "Empresa"}</p>
              </div>
              <div className="flex items-center gap-2">
                <SelectField
                  value={membership.roleId ?? NO_ROLE_VALUE}
                  options={roleOptionsForCompany(roles, membership.companyId)}
                  disabled={savingMembershipId === membership.id}
                  onValueChange={(value) =>
                    updateMutation.mutate({
                      membershipId: membership.id,
                      patch: { roleId: value === NO_ROLE_VALUE ? null : value },
                    })
                  }
                />
                <SwitchField
                  checked={membership.enabled}
                  disabled={savingMembershipId === membership.id}
                  onChange={(checked) =>
                    updateMutation.mutate({ membershipId: membership.id, patch: { enabled: checked } })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
        <Plus className="h-4 w-4" />
        Agregar empresa
      </Button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <SelectField
              label="Empresa"
              placeholder="Seleccionar empresa"
              value={addCompanyId}
              options={companyOptions}
              onValueChange={setAddCompanyId}
            />
            <SelectField
              label="Rol"
              value={addRoleId}
              options={roleOptionsForCompany(roles, addCompanyId)}
              onValueChange={setAddRoleId}
              disabled={!addCompanyId}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!addCompanyId || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  companyId: addCompanyId,
                  roleId: addRoleId === NO_ROLE_VALUE ? null : addRoleId,
                })
              }
            >
              {createMutation.isPending ? "Guardando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/components/MembershipsSection.jsx`
Expected: no output (this only checks JS syntax broadly; full JSX validation happens at build time in Step 3 below).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/components/MembershipsSection.jsx
git commit -m "feat(identity): add MembershipsSection detail component"
```

(This component is registered in the component registry as part of Task 12, alongside the other two new Users detail components, once all three exist.)

---

### Task 9: `PermissionGrantsSection` and `UserActivitySection` wrapper components

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/components/PermissionGrantsSection.jsx`
- Create: `apps/desktop/src/modules/runly.identity/components/UserActivitySection.jsx`

- [ ] **Step 1: Create `PermissionGrantsSection.jsx`**

Thin wrapper matching the `runly.hr:HistorySection` pattern — adapts the `{ data, token }` contract a `RunlyDetail` `type: "component"` section receives into the props the existing `UserPermissionGrantsCard` already expects. Reproduces the exact `canManageGrants` gate from today's `UserEditorScreen.jsx` (`identity.permissions.update` AND `identity.users.update`).

```jsx
// apps/desktop/src/modules/runly.identity/components/PermissionGrantsSection.jsx
import { useAuth } from "../../../auth/AuthProvider";
import UserPermissionGrantsCard from "./UserPermissionGrantsCard.jsx";

export default function PermissionGrantsSection({ data, token }) {
  const { userProfile } = useAuth();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canManageUsers = hasPermission("identity.users.update");
  const canManageGrants = hasPermission("identity.permissions.update") && canManageUsers;

  if (!canManageGrants || !data?.id) return null;

  return <UserPermissionGrantsCard userId={data.id} token={token} canManage={canManageUsers} />;
}
```

- [ ] **Step 2: Create `UserActivitySection.jsx`**

```jsx
// apps/desktop/src/modules/runly.identity/components/UserActivitySection.jsx
import { ActivityTimeline } from "@runly/ui";
import { runly } from "../../../lib/runly";

export default function UserActivitySection({ data, token }) {
  if (!data?.id) return null;
  return (
    <ActivityTimeline
      sdk={runly}
      token={token}
      entityType="UserProfile"
      entityId={data.id}
      limit={20}
      heightClass="max-h-[320px]"
      emptyMessage="Sin actividad registrada para este usuario."
    />
  );
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/components/PermissionGrantsSection.jsx apps/desktop/src/modules/runly.identity/components/UserActivitySection.jsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/components/PermissionGrantsSection.jsx apps/desktop/src/modules/runly.identity/components/UserActivitySection.jsx
git commit -m "feat(identity): add PermissionGrantsSection and UserActivitySection wrapper components"
```

---

### Task 10: `UserDetailScreen.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/screens/UserDetailScreen.jsx`

Mirrors `apps/desktop/src/modules/runly.hr/screens/HrEmployeeDetail.jsx`'s shape exactly, adapted for identity's permission keys and the self/protected-admin-role delete guards that exist today in `UserEditorScreen.jsx`.

- [ ] **Step 1: Create the screen**

```jsx
// apps/desktop/src/modules/runly.identity/screens/UserDetailScreen.jsx
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RunlyDetail, LoadingState, ErrorState, ConfirmDialog, DetailActionBar, DistDropZone } from "@runly/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@runly/ui";
import { ArrowLeft, Camera, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { runly } from "../../../lib/runly";
import { IDENTITY_USER_DETAIL } from "../blueprints/identity-user-detail.blueprint.js";
import { componentRegistry } from "../../../lib/moduleComponentRegistry.js";

const API_BASE = getApiUrl();
const PROTECTED_ROLE_KEYS = new Set(["runly.admin", "system.admin"]);

function isProtectedAdminUser(user) {
  const roleKey = String(user?.memberships?.[0]?.roleKey ?? "").trim().toLowerCase();
  return PROTECTED_ROLE_KEYS.has(roleKey);
}

export default function UserDetailScreen() {
  const { id: userId } = useParams();
  const { session, userProfile, refreshProfile } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const { activeCompanyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canUpdate = hasPermission("identity.users.update");
  const canDelete = hasPermission("identity.users.delete");
  const isSelf = userId === userProfile?.id;

  const userQuery = useQuery({
    queryKey: ["identity-user", userId],
    queryFn: () => runly.identity.getUser(userId, token),
    enabled: Boolean(token && userId),
  });
  const user = userQuery.data?.data ?? null;

  const avatarMutation = useMutation({
    mutationFn: (file) => runly.identity.uploadUserAvatar(userId, file, token),
    onMutate: () => toast.loading("Subiendo foto de perfil..."),
    onSuccess: async (_data, _vars, toastId) => {
      await queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
      if (isSelf) {
        await queryClient.invalidateQueries({ queryKey: ["profile-me"] });
        refreshProfile(session);
      }
      toast.success("Foto de perfil actualizada", { id: toastId });
      setAvatarDialogOpen(false);
    },
    onError: (_err, _vars, toastId) => toast.error("No se pudo actualizar la foto de perfil", { id: toastId }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => runly.identity.deleteUser(userId, token),
    onSuccess: () => {
      toast.success("Usuario eliminado");
      navigate("/app/m/runly.identity/identity/users");
    },
    onError: (err) => {
      try {
        toast.error(JSON.parse(err?.message || "{}").error || "No se pudo eliminar el usuario");
      } catch {
        toast.error("No se pudo eliminar el usuario");
      }
    },
  });

  if (userQuery.isLoading) {
    return (
      <div className="p-4 md:p-6">
        <LoadingState title="Cargando usuario" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Usuario no encontrado" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <RunlyDetail
        blueprint={IDENTITY_USER_DETAIL}
        data={user}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        heroActions={
          <DetailActionBar
            primary={
              canUpdate ? { label: "Editar", icon: <Pencil className="h-4 w-4" />, onClick: () => navigate(`/app/m/runly.identity/identity/users/${userId}/edit`) } : null
            }
            secondary={[
              { label: "Volver a usuarios", icon: <ArrowLeft className="h-4 w-4" />, onClick: () => navigate("/app/m/runly.identity/identity/users") },
              canUpdate ? { label: "Cambiar foto", icon: <Camera className="h-4 w-4" />, onClick: () => setAvatarDialogOpen(true) } : null,
              canDelete && !isSelf
                ? { label: "Eliminar usuario", icon: <Trash2 className="h-4 w-4" />, onClick: () => setDeleteOpen(true), destructive: true }
                : null,
            ].filter(Boolean)}
          />
        }
      />

      <Dialog open={avatarDialogOpen} onOpenChange={setAvatarDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar foto de perfil</DialogTitle>
          </DialogHeader>
          <DistDropZone
            variant="compact"
            accept="image/*"
            maxSizeMB={10}
            onFile={(file) => avatarMutation.mutate(file)}
            isUploading={avatarMutation.isPending}
            emptyLabel="Arrastra o haz clic para subir una foto"
            emptyHint="JPG, PNG o WebP · máximo 10 MB"
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="¿Eliminar usuario?"
        description="Esta acción es irreversible. Se eliminará la cuenta del usuario y no podrá recuperarse."
        detail={user.displayName || user.email}
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (isProtectedAdminUser(user)) {
            toast.error("No puedes eliminar usuarios Runly Admin/System Admin");
            setDeleteOpen(false);
            return;
          }
          deleteMutation.mutate();
        }}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/screens/UserDetailScreen.jsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/screens/UserDetailScreen.jsx
git commit -m "feat(identity): add UserDetailScreen"
```

---

### Task 11: `UserEditScreen.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/screens/UserEditScreen.jsx`

Mirrors `apps/desktop/src/modules/runly.hr/screens/HrEmployeeForm.jsx`'s shape, in edit-only mode (Users creation stays on the separate `UserCreateScreen.jsx` per the spec's Non-goal 5).

- [ ] **Step 1: Create the screen**

```jsx
// apps/desktop/src/modules/runly.identity/screens/UserEditScreen.jsx
import { useNavigate, useParams } from "react-router-dom";
import { RunlyForm, PageHeader, LoadingState, ErrorState, Button } from "@runly/ui";
import { Eye } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { runly } from "../../../lib/runly";
import { IDENTITY_USER_FORM } from "../blueprints/identity-user-form.blueprint.js";
import { componentRegistry } from "../../../lib/moduleComponentRegistry.js";

const API_BASE = getApiUrl();

export default function UserEditScreen() {
  const { id: userId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canSubmit = hasPermission("identity.users.update");

  const userQuery = useQuery({
    queryKey: ["identity-user", userId],
    queryFn: () => runly.identity.getUser(userId, token),
    enabled: Boolean(token && userId),
  });
  const user = userQuery.data?.data ?? null;

  if (userQuery.isLoading) return <LoadingState message="Cargando usuario..." />;
  if (userQuery.isError) return <ErrorState message="No se pudo cargar el usuario" />;
  if (!canSubmit) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="No tienes permiso para esta acción" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        eyebrow="Editar usuario"
        title={user?.displayName || "Editar usuario"}
        actions={
          <Button variant="outline" onClick={() => navigate(`/app/m/runly.identity/identity/users/${userId}`)}>
            <Eye className="h-4 w-4" />
            Ver detalle
          </Button>
        }
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={IDENTITY_USER_FORM}
          initialData={user ?? {}}
          mode="edit"
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          componentRegistry={componentRegistry}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
            queryClient.invalidateQueries({ queryKey: ["identity-users"] });
            navigate(`/app/m/runly.identity/identity/users/${userId}`);
          }}
          onCancel={() => navigate(`/app/m/runly.identity/identity/users/${userId}`)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/screens/UserEditScreen.jsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/screens/UserEditScreen.jsx
git commit -m "feat(identity): add UserEditScreen"
```

---

### Task 12: Register the three new Users detail components, repoint routes, delete `UserEditorScreen.jsx`

**Files:**
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js`
- Modify: `apps/desktop/src/app/ModuleOutlet.jsx`
- Delete: `apps/desktop/src/modules/runly.identity/screens/UserEditorScreen.jsx`

- [ ] **Step 1: Register the components**

Add to `apps/desktop/src/lib/moduleComponentRegistry.js`, next to the `AddressFieldsSection` import/registration added in Task 4:

```js
import MembershipsSection from "../modules/runly.identity/components/MembershipsSection.jsx";
import PermissionGrantsSection from "../modules/runly.identity/components/PermissionGrantsSection.jsx";
import UserActivitySection from "../modules/runly.identity/components/UserActivitySection.jsx";
```

```js
componentRegistry.register("runly.identity:MembershipsSection", MembershipsSection);
componentRegistry.register("runly.identity:PermissionGrantsSection", PermissionGrantsSection);
componentRegistry.register("runly.identity:UserActivitySection", UserActivitySection);
```

- [ ] **Step 2: Repoint the two routes**

Modify `apps/desktop/src/app/ModuleOutlet.jsx`: replace

```js
  "runly.identity:/identity/users/:id": lazy(
    () => import("../modules/runly.identity/screens/UserEditorScreen.jsx"),
  ),
  "runly.identity:/identity/users/:id/edit": lazy(
    () => import("../modules/runly.identity/screens/UserEditorScreen.jsx"),
  ),
```

with

```js
  "runly.identity:/identity/users/:id": lazy(
    () => import("../modules/runly.identity/screens/UserDetailScreen.jsx"),
  ),
  "runly.identity:/identity/users/:id/edit": lazy(
    () => import("../modules/runly.identity/screens/UserEditScreen.jsx"),
  ),
```

- [ ] **Step 3: Delete the old screen**

```bash
git rm apps/desktop/src/modules/runly.identity/screens/UserEditorScreen.jsx
```

- [ ] **Step 4: Verify syntax**

Run: `node --check apps/desktop/src/lib/moduleComponentRegistry.js apps/desktop/src/app/ModuleOutlet.jsx`
Expected: no output.

- [ ] **Step 5: Manual verification (covers spec Acceptance Criteria 1–3, 10)**

Run `pnpm dev` and, as a user with `identity.users.update`:
1. Open a user's detail page (`/identity/users/:id`) — confirm hero, KPI strip, Información personal/Dirección sections, and the three aside sections (Empresas y roles, Permisos, Actividad) all render, with no editable fields.
2. Click "Editar" — confirm it navigates to `/identity/users/:id/edit` and renders `RunlyForm` with Identidad/Perfil/Dirección, and the country→state→city cascade still works exactly as before.
3. On the detail page, use "Agregar empresa" — confirm a new membership row appears without reload.
4. Toggle a membership's enabled switch and change its role — confirm both autosave with a toast and no page reload.
5. Click "Cambiar foto" — confirm the upload dialog works and the new avatar appears in the hero.
6. As the currently logged-in user's own account, confirm the "Eliminar usuario" action is absent.
7. As a different user's detail page, confirm delete works and self/protected-admin-role guards still block appropriately.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/lib/moduleComponentRegistry.js apps/desktop/src/app/ModuleOutlet.jsx
git commit -m "feat(identity): wire Users detail/edit screens, remove UserEditorScreen"
```

---

### Task 13: Restyle `UserCreateScreen.jsx`

**Files:**
- Modify: `apps/desktop/src/modules/runly.identity/screens/UserCreateScreen.jsx`

Per the spec's Non-goal 5, this screen's fields and behavior are unchanged — only visual polish (spacing/typography consistent with the rest of the redesigned module). No blueprint conversion.

- [ ] **Step 1: Apply the visual polish**

Modify the outer `<Card>` in `UserCreateScreen.jsx` to use `variant="shell"` (the same glass-card variant `DetailHero`/`StatStrip` use elsewhere in this plan) instead of the current plain `<Card>`:

Replace:
```jsx
      {canManageUsers && (
        <Card>
          <CardHeader>
            <CardTitle>Datos del nuevo usuario</CardTitle>
          </CardHeader>
```

with:
```jsx
      {canManageUsers && (
        <Card variant="shell">
          <CardHeader>
            <CardTitle>Datos del nuevo usuario</CardTitle>
          </CardHeader>
```

No other changes to this file — its fields, validation, and `createUserMutation` logic stay exactly as they are today.

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/screens/UserCreateScreen.jsx`
Expected: no output.

- [ ] **Step 3: Manual verification**

Run `pnpm dev`, open `/identity/users/new`, confirm the form still creates a user exactly as before and now uses the glass card styling consistent with the rest of the module.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/screens/UserCreateScreen.jsx
git commit -m "style(identity): apply glass card styling to UserCreateScreen"
```

---

## Section 3: Roles

### Task 14: `identity-role-table.blueprint.js` and rewritten `RolesScreen.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-role-table.blueprint.js`
- Modify: `apps/desktop/src/modules/runly.identity/screens/RolesScreen.jsx`

Per the corrected decision in the spec (Non-goal 7), this becomes a single `RunlyCrudView` table view — no view-mode switch, no card/grid views. "Nuevo rol" keeps its existing 3-field Sheet exactly as today (not converted to a blueprint form).

- [ ] **Step 1: Create the table blueprint**

```js
// apps/desktop/src/modules/runly.identity/blueprints/identity-role-table.blueprint.js
export const IDENTITY_ROLE_TABLE = {
  key: "identity.roles.table",
  kind: "TABLE",
  schema: {
    apiPath: "/identity/roles",
    primaryField: "name",
    searchable: true,
    searchPlaceholder: "Buscar rol...",
    columns: [
      { field: "name", label: "Rol", sortable: true, link: true },
      { field: "key", label: "Clave", sortable: false },
      { field: "permissionKeys.length", label: "Permisos", sortable: false },
      {
        field: "enabled",
        label: "Estado",
        type: "select",
        sortable: true,
        options: [
          { value: true, label: "Activo" },
          { value: false, label: "Inactivo" },
        ],
      },
      {
        field: "system",
        label: "Sistema",
        type: "select",
        defaultVisible: false,
        options: [
          { value: true, label: "Sí" },
          { value: false, label: "No" },
        ],
      },
    ],
    filters: [
      {
        key: "enabled",
        label: "Estado",
        type: "select",
        options: [
          { value: "true", label: "Activo" },
          { value: "false", label: "Inactivo" },
        ],
      },
    ],
    emptyState: { message: "No hay roles registrados en esta instancia." },
    rowActions: [{ label: "Ver permisos" }],
  },
};

export default IDENTITY_ROLE_TABLE;
```

- [ ] **Step 2: Rewrite `RolesScreen.jsx`**

Replace the entire file. This keeps the existing create-role Sheet and its `react-hook-form` wiring exactly as today, and drops the hand-rolled table/card/grid view components and `ViewModeSwitch` in favor of `RunlyCrudView` (table-only, no `formBlueprint`/`detailBlueprint` passed, since Roles' create/edit/detail flows stay on their own dedicated Sheet and `RoleEditorScreen.jsx` route rather than `RunlyCrudView`'s built-in ones):

```jsx
// apps/desktop/src/modules/runly.identity/screens/RolesScreen.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Button,
  ErrorState,
  PageHeader,
  RunlyCrudView,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  TextField,
} from "@runly/ui";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { runly } from "../../../lib/runly";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { IDENTITY_ROLE_TABLE } from "../blueprints/identity-role-table.blueprint.js";

const API_BASE_URL = getApiUrl();

export default function RolesScreen() {
  const navigate = useNavigate();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canReadRoles = hasPermission("identity.roles.read");
  const canCreateRoles = hasPermission("identity.roles.create");
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);

  const createRoleMutation = useMutation({
    mutationFn: (data) => runly.identity.createRole(data, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      setSheetOpen(false);
      toast.success("Rol creado");
    },
    onError: () => toast.error("No se pudo crear el rol"),
  });

  const {
    register: registerCreate,
    handleSubmit: handleCreateSubmit,
    reset: resetCreate,
    formState: { errors: createErrors },
  } = useForm({ defaultValues: { key: "", name: "", description: "" } });

  function onCreateSubmit(data) {
    createRoleMutation.mutate(data);
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Identity"
        title="Roles y permisos"
        description="Define roles y asigna permisos para controlar el acceso en tu instancia."
        actions={
          canCreateRoles && (
            <Button
              onClick={() => {
                resetCreate();
                setSheetOpen(true);
              }}
            >
              <Shield className="h-4 w-4" />
              Nuevo rol
            </Button>
          )
        }
      />

      {!canReadRoles ? (
        <ErrorState message="No tienes permisos para consultar roles." />
      ) : (
        <RunlyCrudView
          tableBlueprint={IDENTITY_ROLE_TABLE}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE_URL}
          suppressToolbarCreate
          onNavigate={({ recordId }) => {
            if (recordId) navigate(`/app/m/runly.identity/identity/roles/${recordId}`);
          }}
        />
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={(v) => {
          if (!createRoleMutation.isPending) setSheetOpen(v);
        }}
      >
        <SheetContent className="sm:max-w-md lg:max-w-xl xl:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Nuevo rol</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-4">
            <form id="create-role-form" onSubmit={handleCreateSubmit(onCreateSubmit)} className="space-y-4">
              <TextField
                label="Clave interna"
                required
                placeholder="ej. ventas.supervisor"
                error={createErrors.key?.message}
                {...registerCreate("key", { required: "La clave es obligatoria" })}
              />
              <TextField
                label="Nombre visible"
                required
                placeholder="Supervisor de ventas"
                error={createErrors.name?.message}
                {...registerCreate("name", { required: "El nombre es obligatorio" })}
              />
              <TextField
                label="Descripcion"
                placeholder="Gestiona equipo y operaciones comerciales (opcional)"
                {...registerCreate("description")}
              />
            </form>
          </div>
          <SheetFooter className="gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={createRoleMutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="create-role-form" disabled={createRoleMutation.isPending}>
              {createRoleMutation.isPending ? "Creando..." : "Crear rol"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

Note: `RunlyCrudView`'s row click navigates via `onView` internally calling `onNavigate({ mode: "detail", recordId })` in non-page mode when no `detailBlueprint` is given and page-mode is false — since `IDENTITY_ROLE_TABLE` has no `formMode`/hero config making it page-mode, `RunlyCrudView` opens a Sheet by default for `onView`. To make row clicks navigate to the full `/identity/roles/:id` route instead of opening a Sheet, this relies on `RunlyCrudView`'s `onNavigate` callback firing before the Sheet mounts (see `RunlyCrudView.jsx`'s `openDetail`: it calls `onNavigateRef.current({ mode: "detail", recordId })` and returns immediately without opening the Sheet when `onNavigate` is provided and not in page mode) — no `detailBlueprint` needs to be passed for this to work, since the early-navigate branch is checked before `currentDetailBlueprint` is used.

- [ ] **Step 3: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/blueprints/identity-role-table.blueprint.js apps/desktop/src/modules/runly.identity/screens/RolesScreen.jsx`
Expected: no output.

- [ ] **Step 4: Manual verification**

Run `pnpm dev`, open `/identity/roles`, confirm: the table renders with search/filter, "Nuevo rol" still opens the same Sheet and creates a role, and clicking a role name navigates to `/identity/roles/:id` (not a Sheet).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/blueprints/identity-role-table.blueprint.js apps/desktop/src/modules/runly.identity/screens/RolesScreen.jsx
git commit -m "refactor(identity): rebuild Roles list on RunlyCrudView"
```

---

### Task 15: `PermissionTreeSection` and `RoleMembersSection` components

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/components/PermissionTreeSection.jsx`
- Create: `apps/desktop/src/modules/runly.identity/components/RoleMembersSection.jsx`

`PermissionTreeSection` extracts the permission-tree state/mutation logic currently living directly in `RoleEditorScreen.jsx` (lines handling `pendingKeys`, `savedKeys`, `isDirty`, `savePermsMutation`, `togglePermission`, `togglePermissionGroup`) into a `type: "component"` `RunlyDetail` section, unchanged in behavior.

- [ ] **Step 1: Create `PermissionTreeSection.jsx`**

```jsx
// apps/desktop/src/modules/runly.identity/components/PermissionTreeSection.jsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState, UnsavedChangesBar } from "@runly/ui";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import PermissionFeatureTree from "./PermissionFeatureTree.jsx";

export default function PermissionTreeSection({ data, token }) {
  const { userProfile } = useAuth();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canReadPermissions = hasPermission("identity.permissions.read");
  const canManagePermissions = hasPermission("identity.permissions.update");
  const queryClient = useQueryClient();
  const roleId = data?.id;

  const [pendingKeys, setPendingKeys] = useState(null);

  const permissionsQuery = useQuery({
    queryKey: ["identity-permissions"],
    queryFn: () => runly.identity.listPermissions(token),
    enabled: Boolean(token) && canReadPermissions,
  });
  const allPermissions = permissionsQuery.data?.data?.permissions ?? [];

  useEffect(() => {
    setPendingKeys(new Set(data?.permissionKeys ?? []));
  }, [roleId, data?.permissionKeys?.join(",")]);

  const savedKeys = useMemo(() => new Set(data?.permissionKeys ?? []), [data]);

  const isDirty = useMemo(() => {
    if (!pendingKeys) return false;
    if (pendingKeys.size !== savedKeys.size) return true;
    for (const k of pendingKeys) if (!savedKeys.has(k)) return true;
    return false;
  }, [pendingKeys, savedKeys]);

  const savePermsMutation = useMutation({
    mutationFn: ({ id, keys }) => runly.identity.setRolePermissions(id, [...keys], token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      toast.success("Permisos guardados");
    },
    onError: () => toast.error("No se pudieron guardar los permisos"),
  });

  function togglePermission(key) {
    if (!canManagePermissions) return;
    setPendingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePermissionGroup(keys, checked) {
    if (!canManagePermissions) return;
    setPendingKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  if (!canReadPermissions) {
    return (
      <EmptyState
        icon={KeyRound}
        title="Sin acceso al catalogo de permisos"
        description="Necesitas el permiso identity.permissions.read para ver el catalogo."
      />
    );
  }
  if (allPermissions.length === 0) {
    return <EmptyState icon={KeyRound} title="Sin permisos disponibles" description="No hay permisos definidos en el sistema." />;
  }

  return (
    <>
      <PermissionFeatureTree
        key={roleId}
        allPermissions={allPermissions}
        pendingKeys={pendingKeys ?? savedKeys}
        baselineKeys={savedKeys}
        onTogglePermission={togglePermission}
        onBulkToggle={togglePermissionGroup}
        disabled={!canManagePermissions || savePermsMutation.isPending}
      />
      {isDirty && canManagePermissions && (
        <UnsavedChangesBar
          className="mt-4"
          message="Cambios sin guardar en permisos"
          saving={savePermsMutation.isPending}
          saveLabel="Guardar permisos"
          onDiscard={() => setPendingKeys(new Set(savedKeys))}
          onSave={() => savePermsMutation.mutate({ id: roleId, keys: pendingKeys })}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create `RoleMembersSection.jsx`**

```jsx
// apps/desktop/src/modules/runly.identity/components/RoleMembersSection.jsx
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage, EmptyState, Skeleton } from "@runly/ui";
import { Users } from "lucide-react";
import { runly } from "../../../lib/runly";

export default function RoleMembersSection({ data, token }) {
  const roleId = data?.id;
  const membersQuery = useQuery({
    queryKey: ["identity-role-members", roleId],
    queryFn: () => runly.identity.listRoleMembers(roleId, token),
    enabled: Boolean(token && roleId),
  });
  const members = membersQuery.data?.data ?? [];

  if (membersQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (members.length === 0) {
    return <EmptyState icon={Users} title="Sin usuarios" description="Ningún usuario tiene asignado este rol." />;
  }

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <a
          key={member.id}
          href={`/app/m/runly.identity/identity/users/${member.id}`}
          className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[hsl(var(--muted))]/30"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={member.avatarUrl ?? ""} alt={member.displayName || "Usuario"} />
            <AvatarFallback>{(member.displayName || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{member.displayName}</p>
            <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{member.companyName}</p>
          </div>
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/components/PermissionTreeSection.jsx apps/desktop/src/modules/runly.identity/components/RoleMembersSection.jsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/components/PermissionTreeSection.jsx apps/desktop/src/modules/runly.identity/components/RoleMembersSection.jsx
git commit -m "feat(identity): add PermissionTreeSection and RoleMembersSection detail components"
```

---

### Task 16: `identity-role-detail.blueprint.js` and rewritten `RoleEditorScreen.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/blueprints/identity-role-detail.blueprint.js`
- Modify: `apps/desktop/src/modules/runly.identity/screens/RoleEditorScreen.jsx`

- [ ] **Step 1: Create the blueprint**

```js
// apps/desktop/src/modules/runly.identity/blueprints/identity-role-detail.blueprint.js
export const IDENTITY_ROLE_DETAIL = {
  key: "identity.role.detail",
  kind: "DETAIL",
  schema: {
    entity: "identityRole",
    component: "RunlyDetail",
    apiPath: "/identity/roles",
    layout: "two-column",
    hero: {
      titleField: "name",
      subtitleFields: ["key"],
      statusField: "enabled",
      statusMap: { true: "Activo", false: "Inactivo" },
      fallbackIcon: "Shield",
      metaChips: [
        { field: "system", label: "Sistema", type: "select", options: [{ value: true, label: "Sí" }, { value: false, label: "No" }] },
      ],
    },
    kpis: [
      { label: "Permisos asignados", field: "permissionKeys.length", icon: "KeyRound" },
      { label: "Usuarios con este rol", field: "memberCount", icon: "Users" },
    ],
    sections: [
      {
        id: "permission-tree",
        type: "component",
        label: "Permisos",
        icon: "KeyRound",
        column: "main",
        component: "runly.identity:PermissionTreeSection",
      },
      {
        id: "role-members",
        type: "component",
        label: "Usuarios con este rol",
        icon: "Users",
        column: "aside",
        component: "runly.identity:RoleMembersSection",
      },
    ],
  },
};

export default IDENTITY_ROLE_DETAIL;
```

- [ ] **Step 2: Rewrite `RoleEditorScreen.jsx`**

Replace the entire file. This keeps the exact same edit-name/description Sheet and enable/disable toggle logic as today, replacing only the hand-rolled "role info card" + inline `PermissionFeatureTree` usage with `RunlyDetail` (which now delegates the permission tree and the members list to the two new registered components from Task 15):

```jsx
// apps/desktop/src/modules/runly.identity/screens/RoleEditorScreen.jsx
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Button,
  RunlyDetail,
  DetailActionBar,
  ErrorState,
  LoadingState,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  TextField,
} from "@runly/ui";
import { ArrowLeft, Pencil, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { runly } from "../../../lib/runly";
import { IDENTITY_ROLE_DETAIL } from "../blueprints/identity-role-detail.blueprint.js";
import { componentRegistry } from "../../../lib/moduleComponentRegistry.js";

const API_BASE = getApiUrl();

export default function RoleEditorScreen() {
  const { id: roleId } = useParams();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const { activeCompanyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canReadRoles = hasPermission("identity.roles.read");
  const canManageRoles = hasPermission("identity.roles.update");

  const rolesQuery = useQuery({
    queryKey: ["identity-roles"],
    queryFn: () => runly.identity.listRoles(token),
    enabled: Boolean(token) && canReadRoles,
  });
  const role = (rolesQuery.data?.data ?? []).find((r) => r.id === roleId) ?? null;

  const toggleRoleMutation = useMutation({
    mutationFn: ({ id, enabled }) => runly.identity.setRoleEnabled(id, enabled, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      toast.success("Estado actualizado");
    },
    onError: () => toast.error("No se pudo cambiar el estado"),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, data }) => runly.identity.updateRole(id, data, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      setEditSheetOpen(false);
      toast.success("Rol actualizado");
    },
    onError: () => toast.error("No se pudo actualizar el rol"),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: { name: "", description: "" } });

  function openEditSheet() {
    if (!role) return;
    reset({ name: role.name, description: role.description ?? "" });
    setEditSheetOpen(true);
  }

  function onEditSubmit(data) {
    if (!role) return;
    updateRoleMutation.mutate({ id: role.id, data });
  }

  if (!canReadRoles) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState message="No tienes permisos para consultar roles." />
      </div>
    );
  }
  if (rolesQuery.isLoading) {
    return (
      <div className="p-4 md:p-6">
        <LoadingState title="Cargando rol" />
      </div>
    );
  }
  if (!role) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Rol no encontrado" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <RunlyDetail
        blueprint={IDENTITY_ROLE_DETAIL}
        data={role}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        heroActions={
          <DetailActionBar
            primary={
              canManageRoles && !role.system ? { label: "Editar", icon: <Pencil className="h-4 w-4" />, onClick: openEditSheet } : null
            }
            secondary={[
              { label: "Volver a roles", icon: <ArrowLeft className="h-4 w-4" />, onClick: () => navigate("/app/m/runly.identity/identity/roles") },
              canManageRoles && !role.system
                ? {
                    label: role.enabled ? "Desactivar" : "Activar",
                    icon: role.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />,
                    onClick: () => toggleRoleMutation.mutate({ id: role.id, enabled: !role.enabled }),
                    loading: toggleRoleMutation.isPending,
                  }
                : null,
            ].filter(Boolean)}
          />
        }
      />

      <Sheet
        open={editSheetOpen}
        onOpenChange={(v) => {
          if (!updateRoleMutation.isPending) setEditSheetOpen(v);
        }}
      >
        <SheetContent className="sm:max-w-md lg:max-w-xl xl:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Editar rol</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-4">
            <form id="edit-role-form" onSubmit={handleSubmit(onEditSubmit)} className="space-y-4">
              <TextField
                label="Nombre visible"
                required
                placeholder="Supervisor de ventas"
                error={errors.name?.message}
                {...register("name", { required: "El nombre es obligatorio" })}
              />
              <TextField
                label="Descripcion"
                placeholder="Describe las responsabilidades de este rol (opcional)"
                {...register("description")}
              />
            </form>
          </div>
          <SheetFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditSheetOpen(false)} disabled={updateRoleMutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="edit-role-form" disabled={updateRoleMutation.isPending}>
              {updateRoleMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

Note: this rewrite drops several imports the old file needed that this one doesn't (`KeyRound`/`Shield` icons, `Badge`, `PermissionFeatureTree`, `UnsavedChangesBar`, `Skeleton`, `EmptyState`) — all of that logic now lives inside `PermissionTreeSection.jsx`/`RoleMembersSection.jsx` from Task 15 instead.

- [ ] **Step 3: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/blueprints/identity-role-detail.blueprint.js apps/desktop/src/modules/runly.identity/screens/RoleEditorScreen.jsx`
Expected: no output.

- [ ] **Step 4: Manual verification (covers spec Acceptance Criteria 6)**

Run `pnpm dev`, open a role's detail page (`/identity/roles/:id`):
1. Confirm hero (name/key/Sistema badge/Activo-Inactivo) and KPI strip (permisos asignados, usuarios con este rol) render.
2. Confirm the permission tree still works exactly as before (toggle a permission, see the unsaved-changes bar, save, confirm persisted).
3. Confirm "Usuarios con este rol" lists the right users and the KPI count matches.
4. Confirm "Editar" opens the same Sheet as before and updates name/description.
5. Confirm Activar/Desactivar still works.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/blueprints/identity-role-detail.blueprint.js apps/desktop/src/modules/runly.identity/screens/RoleEditorScreen.jsx
git commit -m "refactor(identity): rebuild Role detail on RunlyDetail"
```

---

### Task 17: Register the two new Roles detail components

**Files:**
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js`

- [ ] **Step 1: Add the import and registration**

```js
import PermissionTreeSection from "../modules/runly.identity/components/PermissionTreeSection.jsx";
import RoleMembersSection from "../modules/runly.identity/components/RoleMembersSection.jsx";
```

```js
componentRegistry.register("runly.identity:PermissionTreeSection", PermissionTreeSection);
componentRegistry.register("runly.identity:RoleMembersSection", RoleMembersSection);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/lib/moduleComponentRegistry.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/moduleComponentRegistry.js
git commit -m "feat(identity): register PermissionTreeSection and RoleMembersSection"
```

---

## Section 4: Overview

### Task 18: Restyle `IdentityOverview.jsx` with `StatStrip`

**Files:**
- Modify: `apps/desktop/src/modules/runly.identity/screens/IdentityOverview.jsx`

- [ ] **Step 1: Replace the local `StatCard` function and stat grid with `StatStrip`**

Remove the local `StatCard` function (the block starting `function StatCard({ icon: Icon, label, value, sub, color, loading }) { ... }`) and add `StatStrip` to the `@runly/ui` import list:

```jsx
import { Badge, Button, PageHeader, Skeleton, StatStrip } from "@runly/ui";
```

Replace the `{/* Stat grid */}` block:

```jsx
      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Usuarios"
          value={canReadUsers ? users.length : "—"}
          sub={canReadUsers && !isLoadingUsers ? `${activeUsers.length} activos` : undefined}
          color={brandColor}
          loading={isLoadingUsers}
        />
        <StatCard
          icon={UserCheck}
          label="Activos"
          value={canReadUsers ? activeUsers.length : "—"}
          sub={canReadUsers && !isLoadingUsers && users.length > 0
            ? `${Math.round((activeUsers.length / users.length) * 100)}% del total`
            : undefined}
          color={emerald}
          loading={isLoadingUsers}
        />
        <StatCard
          icon={Shield}
          label="Roles"
          value={canReadRoles ? roles.length : "—"}
          sub={canReadRoles && !isLoadingRoles ? `${activeRoles.length} activos` : undefined}
          color={violet}
          loading={isLoadingRoles}
        />
        <StatCard
          icon={KeyRound}
          label="Roles personalizados"
          value={canReadRoles ? customRoles.length : "—"}
          sub={canReadRoles && !isLoadingRoles ? `${systemRoles.length} de sistema` : undefined}
          color={amber}
          loading={isLoadingRoles}
        />
      </div>
```

with:

```jsx
      {/* Stat grid */}
      <StatStrip
        items={[
          {
            key: "users",
            label: "Usuarios",
            icon: "Users",
            value: isLoadingUsers ? "…" : canReadUsers ? String(users.length) : "—",
          },
          {
            key: "active",
            label: "Activos",
            icon: "UserCheck",
            value: isLoadingUsers ? "…" : canReadUsers ? String(activeUsers.length) : "—",
          },
          {
            key: "roles",
            label: "Roles",
            icon: "Shield",
            value: isLoadingRoles ? "…" : canReadRoles ? String(roles.length) : "—",
          },
          {
            key: "custom-roles",
            label: "Roles personalizados",
            icon: "KeyRound",
            value: isLoadingRoles ? "…" : canReadRoles ? String(customRoles.length) : "—",
          },
        ]}
      />
```

The `brandColor`, `emerald`, `violet`, `amber` local constants and the `color`/`sub` props they fed are no longer used by `StatStrip` (it doesn't accept a `color` or `sub` prop — see `packages/ui/src/components/StatStrip.jsx`); remove those four `const` declarations from the component body.

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/screens/IdentityOverview.jsx`
Expected: no output.

- [ ] **Step 3: Manual verification (covers spec Acceptance Criteria 8)**

Run `pnpm dev`, open `/app/m/runly.identity/` (the module's landing page), confirm the 4 KPIs render via `StatStrip`'s layout (compare visually against another module's `StatStrip`, e.g. a HR employee detail's KPI row) and the quick-link cards / roles-recientes list below are unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/screens/IdentityOverview.jsx
git commit -m "refactor(identity): use shared StatStrip on Overview"
```

---

## Section 5: Reportes de chat

### Task 19: Restyle `ChatReportsScreen.jsx` (no blueprint conversion)

**Files:**
- Modify: `apps/desktop/src/modules/runly.identity/screens/ChatReportsScreen.jsx`

**Resolved during planning:** confirmed by reading `apps/api/src/routes/chat/moderation-routes.js` — `GET /chat/reports` only accepts `?status=` and returns `{ data: result }` where `result` is a plain array with no `pagination` envelope. It does not support `page`/`pageSize`/`search`, which `RunlyTable`'s `schema.apiPath` contract requires (the same contract `IDENTITY_USER_TABLE` relies on). Converting this screen to `RunlyTable` would require adding pagination to the chat moderation API, which is scope creep into `runly.chat` forbidden by the spec's Non-goals and `docs/spec-driven-development.md` Stage 5's "no scope expansion" rule. **This screen therefore stays on its current hand-wired `DataTable`, restyled only** — same approach as Task 13's `UserCreateScreen.jsx`. No new blueprint file is created for this screen.

- [ ] **Step 1: Apply the visual polish**

Modify `ChatReportsScreen.jsx`: wrap the filter + table block in the same glass-shell spacing used elsewhere in the redesigned module. Replace:

```jsx
        <>
          <div className="max-w-xs">
            <SelectField
              label="Estado"
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "open", label: "Abierto" },
                { value: "dismissed", label: "Desestimado" },
                { value: "user_disabled", label: "Usuario deshabilitado" },
                { value: "all", label: "Todos" },
              ]}
            />
          </div>

          <DataTable
            columns={columns}
            data={reports}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            emptyTitle="Sin reportes"
            emptyDescription="No hay reportes de chat con este filtro."
            emptyIcon={Flag}
          />
        </>
```

with:

```jsx
        <div className="space-y-4">
          <div className="glass-shell max-w-xs rounded-xl p-3">
            <SelectField
              label="Estado"
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "open", label: "Abierto" },
                { value: "dismissed", label: "Desestimado" },
                { value: "user_disabled", label: "Usuario deshabilitado" },
                { value: "all", label: "Todos" },
              ]}
            />
          </div>

          <DataTable
            columns={columns}
            data={reports}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            emptyTitle="Sin reportes"
            emptyDescription="No hay reportes de chat con este filtro."
            emptyIcon={Flag}
          />
        </div>
```

No other changes — `columns`, `useChatReports`, `useResolveReport`, and the resolve/dismiss/disable-user `ConfirmDialog` all stay exactly as they are today.

- [ ] **Step 2: Verify syntax**

Run: `node --check apps/desktop/src/modules/runly.identity/screens/ChatReportsScreen.jsx`
Expected: no output.

- [ ] **Step 3: Manual verification**

Run `pnpm dev`, open `/identity/chat-reports`, confirm the status filter, table rendering, and both resolve actions (Desestimar / Deshabilitar usuario) still work exactly as before, now with the glass-shell filter panel.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.identity/screens/ChatReportsScreen.jsx
git commit -m "style(identity): apply glass styling to ChatReportsScreen"
```

---

## Section 6: Final verification

### Task 20: Full Plan B verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: no errors across `packages/ui` and `apps/desktop`.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new violations. Pay particular attention to the guardrail rule banning `local-date-from-toISOString()` (not touched by this plan, but confirm no accidental regression) and to no source file exceeding 1000/1500 lines (`git diff --stat` against `main` for every file this plan touched or created).

- [ ] **Step 3: Full renderer test suite**

Run: `node --test packages/ui/src/runly-renderer/__tests__/`
Expected: all tests PASS, including the new `type: "component"` coverage added in Task 2.

- [ ] **Step 4: Regression walkthrough of an untouched blueprint**

Open an existing HR/Fleet/Inventory FORM and DETAIL screen in the running app and confirm they still render and submit correctly (this is the acceptance criterion from the spec, Section 25 #9, guarding against the `RunlyForm`/`normalizeSections` changes in Section 1 breaking an unrelated module).

- [ ] **Step 5: Full manual walkthrough of the redesigned module**

Re-run every "Manual verification" step from Tasks 5, 10 (Step 5), 13, 14, 16, 18, and 19 in one pass against a freshly seeded dev database, confirming nothing regressed between tasks.

- [ ] **Step 6: Line-count check**

Run: `git diff main --stat -- apps/desktop apps/api packages/ui packages/sdk packages/validators` (or `wc -l` on each new/modified file) and confirm every file is under 1000 lines, per the spec's Goal 8. `RunlyForm.jsx` in particular should now be smaller than it was before this plan started (it lost the extracted relation/inline-create logic in Task 1 and only gained the ~25-line component-section branch in Task 1 Step 5).

- [ ] **Step 7: Commit** (only if fixes were needed; otherwise skip)

```bash
git add -A
git commit -m "fix(identity): address Plan B verification findings"
```

---

## Plan B complete

Once all 20 tasks are checked off and Task 20's verification passes, the identity module redesign described in `docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md` is fully implemented. Update `docs/TASKS.md` with a `Verified: YYYY-MM-DD (...)` entry per `docs/spec-driven-development.md` Stage 6 before considering this feature complete.
