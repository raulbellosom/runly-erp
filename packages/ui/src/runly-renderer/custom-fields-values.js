// Pure helpers for custom-fields sections (spec
// 2026-10-03-inventory-custom-fields-modes): form values live flat under
// `${prefix}.${fieldKey}`; removals of per-record ("extra") fields ride in
// `${prefix}.__removed`.

export const REMOVED_SUFFIX = "__removed";

function isEmptyValue(value) {
  return value === undefined || value === null || value === "";
}

function toFormValue(raw, fieldType) {
  if (fieldType === "boolean") return raw === true || raw === "true";
  return raw ?? "";
}

// Record's stored values ([{ fieldId, value, field }]) -> flat form values.
export function seedCustomFieldValues(values, sections, initialData) {
  const next = { ...values };
  for (const section of sections ?? []) {
    if (section?.type !== "custom-fields") continue;
    const prefix = section.customFields?.valuePrefix ?? "customValues";
    const entries = Array.isArray(initialData?.[prefix]) ? initialData[prefix] : [];
    for (const entry of entries) {
      const key = entry?.field?.fieldKey;
      if (key) next[`${prefix}.${key}`] = toFormValue(entry.value, entry.field.fieldType);
    }
  }
  return next;
}

// Fields the record carries beyond its type's automatic set: on-demand
// fields (kept even when empty) and other types' fields holding a value.
export function extraDefinitionsFrom(entries, typeDefinitions) {
  const typeIds = new Set((typeDefinitions ?? []).map((def) => def.id));
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const field = entry?.field;
    if (!field?.id || typeIds.has(field.id) || out.some((def) => def.id === field.id)) continue;
    if (field.onDemand || !isEmptyValue(entry.value)) out.push(field);
  }
  return out;
}

// Flat form values -> API payload. Type fields with an empty value are
// skipped; extra fields (`_extra`) are always sent (value null when empty) so
// the record keeps them. Returns { customValues, removedCustomFieldIds }.
export function buildCustomFieldsPayload(formValues, definitions, valuePrefix) {
  const prefix = valuePrefix ?? "customValues";
  const customValues = [];
  for (const def of definitions ?? []) {
    const value = formValues?.[`${prefix}.${def.fieldKey}`];
    if (isEmptyValue(value) && !def._extra) continue;
    customValues.push({ fieldId: def.id, value: isEmptyValue(value) ? null : String(value) });
  }
  const removed = formValues?.[`${prefix}.${REMOVED_SUFFIX}`];
  return { customValues, removedCustomFieldIds: Array.isArray(removed) ? removed : [] };
}
