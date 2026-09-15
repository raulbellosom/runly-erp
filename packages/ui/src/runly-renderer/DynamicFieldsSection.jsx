import { useEffect, useState } from "react";
import {
  TextField,
  NumberField,
  DateField,
  SelectField,
  CheckboxField,
} from "../components/FormFields.jsx";
import { MarkdownField } from "../components/MarkdownField.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function DynamicFieldControl({ definition, value, onChange }) {
  const { label, fieldType, options = [], required } = definition;
  const commonProps = { label, required: Boolean(required) };

  switch (fieldType) {
    case "number":
      return (
        <NumberField {...commonProps} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "date":
      // DateField emits a synthetic { target: { name, value } } event (not the
      // raw value directly) so its onChange can be wired straight into RHF's
      // Controller.onChange in other screens — extract .target.value here.
      return (
        <DateField {...commonProps} value={value ?? ""} onChange={(e) => onChange(e?.target?.value ?? "")} />
      );
    case "textarea":
      return (
        <MarkdownField {...commonProps} value={value ?? ""} onChange={(e) => onChange(e?.target?.value ?? "")} />
      );
    case "select": {
      const selectOptions = options.map((opt) =>
        typeof opt === "string" ? { label: opt, value: opt } : opt,
      );
      return (
        <SelectField {...commonProps} options={selectOptions} value={value ?? ""} onValueChange={onChange} />
      );
    }
    case "boolean":
      return (
        <CheckboxField
          {...commonProps}
          checked={value === true || value === "true"}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "url":
      return (
        <TextField {...commonProps} type="url" placeholder="https://" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "email":
      return (
        <TextField {...commonProps} type="email" placeholder="correo@ejemplo.com" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "text":
    default:
      return (
        <TextField {...commonProps} type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
  }
}

// Fetches the InvCustomField-style definitions for the current category value and
// renders one control per definition, writing into formValues under
// `${valuePrefix}.${fieldKey}` — RunlyForm's handleSubmit collects these into a
// `customValues: [{ fieldId, value }]` array on submit via buildCustomFieldsPayload
// below (a following task wires that into RunlyForm.jsx's handleSubmit).
export function DynamicFieldsSection({
  config,
  formValues,
  onFieldChange,
  onDefinitionsChange,
  apiBaseUrl,
  token,
  companyId,
}) {
  const [definitions, setDefinitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const categoryValue = config?.categoryField ? formValues[config.categoryField] : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!config?.apiPath || !categoryValue) {
        setDefinitions([]);
        return;
      }
      setLoading(true);
      try {
        const url = new URL(joinUrl(apiBaseUrl, config.apiPath));
        url.searchParams.set("categoryId", String(categoryValue));
        const res = await fetch(url.toString(), { headers: buildApiHeaders(token, companyId) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
        if (!cancelled) {
          setDefinitions(rows);
          onDefinitionsChange?.(rows);
        }
      } catch {
        if (!cancelled) setDefinitions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, token, companyId, config?.apiPath, categoryValue]);

  if (!categoryValue) return null;
  if (loading) return <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando campos...</p>;
  if (definitions.length === 0) return null;

  const prefix = config.valuePrefix ?? "customValues";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {definitions.map((def) => {
        const key = `${prefix}.${def.fieldKey}`;
        return (
          <div key={def.id} className={def.fieldType === "textarea" ? "col-span-full" : ""}>
            <DynamicFieldControl
              definition={def}
              value={formValues[key]}
              onChange={(val) => onFieldChange(key, val)}
            />
          </div>
        );
      })}
    </div>
  );
}

// Reads the `${prefix}.`-namespaced keys back out of formValues and returns the
// [{ fieldId, value }] array shape the inventory API's create/update endpoints
// expect for `customValues`.
export function buildCustomFieldsPayload(formValues, definitions, valuePrefix) {
  const prefix = valuePrefix ?? "customValues";
  const byKey = new Map(definitions.map((d) => [d.fieldKey, d]));
  const out = [];
  for (const [formKey, value] of Object.entries(formValues)) {
    if (!formKey.startsWith(`${prefix}.`)) continue;
    const fieldKey = formKey.slice(prefix.length + 1);
    const def = byKey.get(fieldKey);
    if (!def) continue;
    if (value === undefined || value === null || value === "") continue;
    out.push({ fieldId: def.id, value: String(value) });
  }
  return out;
}
