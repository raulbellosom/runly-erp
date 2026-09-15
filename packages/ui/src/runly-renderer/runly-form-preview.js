// Pure helpers backing RunlyForm's opt-in schema.preview / schema.showCompletion
// features. No React, no fetching, no side effects — see detail-presentation.js
// for the sibling pattern this follows.
import { normalizeOptions } from "./runly-form-utils.js";

export function formatDisplayValue(field, value) {
  if (value === undefined || value === null || value === "") return null;
  if (field.type === "currency" || field.type === "decimal") {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount)
      ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount)
      : null;
  }
  if (field.type === "date") {
    const str = String(value);
    const datePart = str.includes("T") ? str.slice(0, 10) : str;
    const [year, month, day] = datePart.split("-");
    return year && month && day ? `${day}/${month}/${year}` : str;
  }
  if (field.type === "boolean") return value ? "Sí" : "No";
  if (field.type === "select" || field.type === "relation") {
    const options = normalizeOptions(field.options);
    const found = options.find((o) => String(o.value) === String(value));
    return found?.label ?? String(value);
  }
  return String(value);
}

export function computeCompletion(fieldMap, formValues, isFieldVisible) {
  const allFieldNames = [...fieldMap.keys()];
  const filledCount = allFieldNames.filter((name) => {
    const field = fieldMap.get(name);
    if (!isFieldVisible(field, formValues)) return false;
    const value = formValues[name];
    return value !== undefined && value !== null && String(value).trim() !== "";
  }).length;
  const completionPercent = allFieldNames.length > 0 ? (filledCount / allFieldNames.length) * 100 : 0;
  return { allFieldNames, filledCount, completionPercent };
}

export function computePreviewModel(previewConfig, fieldMap, formValues) {
  if (!previewConfig) return null;
  return {
    title: previewConfig.titleField ? String(formValues[previewConfig.titleField] ?? "") : "",
    subtitle: (Array.isArray(previewConfig.subtitleFields) ? previewConfig.subtitleFields : [])
      .map((name) => formValues[name])
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
      .join(" · "),
    rows: (Array.isArray(previewConfig.rows) ? previewConfig.rows : [])
      .map((row) => {
        const field = fieldMap.get(row.field);
        if (!field) return null;
        return {
          key: row.field,
          label: row.label ?? field.label,
          value: formatDisplayValue(field, formValues[row.field]),
        };
      })
      .filter(Boolean),
  };
}
