// Pure helpers for editing a draft ModuleDefinition in the Module Builder
// UI. These only ever touch the in-memory `definition` object the editor
// screen holds in React state — nothing here talks to the API. Every write
// goes through module-builder-service.js's updateDefinition (autosave) and
// is re-validated server-side by @runly/module-compiler before it can be
// published, so these helpers don't need to be authoritative — just
// convenient and non-destructive to sibling data.
export const FIELD_TYPE_LABELS = {
  text: "Texto", textarea: "Texto largo", number: "Número", decimal: "Decimal",
  boolean: "Sí/No", select: "Selección única", multiselect: "Selección múltiple",
  date: "Fecha", datetime: "Fecha y hora", email: "Correo", phone: "Teléfono",
  relation: "Relación", file: "Archivo", json: "JSON", markdown: "Markdown",
  color: "Color", richtext: "Texto enriquecido",
};

export function slugify(value, { camel = false } = {}) {
  const cleaned = (value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  if (camel) {
    return words.map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join("");
  }
  return words.join("_");
}

export function moduleSlug(moduleKey) {
  return (moduleKey ?? "").split(".").pop() ?? "";
}

function uniqueKey(base, existingKeys) {
  let key = base || "campo";
  let n = 2;
  while (existingKeys.has(key)) key = `${base}_${n++}`;
  return key;
}

const toKebab = (str) => str.replace(/_/g, "-");
const permKey = (slug, entityKey, action) => `${slug}.${entityKey}.${action}`;

// Mirrors normalizeModuleDefinition()'s default navigation-item shape
// (packages/module-compiler/src/definition.js) so a freshly-added entity
// gets a working nav entry immediately, without waiting for the next
// server-side validate/publish round trip to regenerate it.
function deriveNavigationItem(definition, entity) {
  const slug = moduleSlug(definition.key);
  return {
    label: entity.pluralLabel || `${entity.label}s`,
    icon: definition.icon,
    path: `/app/m/${definition.key}/${slug}-${toKebab(entity.key)}s`,
    page: `${slug}.${entity.key}.page`,
    permission: permKey(slug, entity.key, "read"),
    generated: true,
  };
}

export function addEntity(definition, { key, label, pluralLabel }) {
  const existingKeys = new Set((definition.entities ?? []).map((e) => e.key));
  const entityKey = uniqueKey(slugify(key || label), existingKeys);
  const entity = {
    key: entityKey,
    label: label || entityKey,
    pluralLabel: pluralLabel || `${label || entityKey}s`,
    companyScoped: true,
    softDelete: true,
    fields: [],
  };
  const next = { ...definition, entities: [...(definition.entities ?? []), entity] };
  if (Array.isArray(definition.navigation)) {
    next.navigation = [...definition.navigation, deriveNavigationItem(next, entity)];
  }
  return next;
}

export function updateEntity(definition, entityKey, patch) {
  return {
    ...definition,
    entities: definition.entities.map((e) => e.key === entityKey ? { ...e, ...patch } : e),
  };
}

export function removeEntity(definition, entityKey) {
  const slug = moduleSlug(definition.key);
  return {
    ...definition,
    entities: definition.entities.filter((e) => e.key !== entityKey),
    views: (definition.views ?? []).filter((v) => (v.entity ?? v.schema?.entity) !== entityKey),
    navigation: Array.isArray(definition.navigation)
      ? definition.navigation.filter((item) => item.page !== `${slug}.${entityKey}.page`)
      : definition.navigation,
  };
}

export function addField(definition, entityKey, { key, label, type }) {
  const entity = definition.entities.find((e) => e.key === entityKey);
  const existingKeys = new Set((entity?.fields ?? []).map((f) => f.key));
  const fieldKey = uniqueKey(slugify(key || label), existingKeys);
  const field = { key: fieldKey, label: label || fieldKey, type: type || "text" };
  if (type === "select" || type === "multiselect") field.options = [];
  return updateEntity(definition, entityKey, { fields: [...(entity?.fields ?? []), field] });
}

export function updateField(definition, entityKey, fieldKey, patch) {
  const entity = definition.entities.find((e) => e.key === entityKey);
  if (!entity) return definition;
  return updateEntity(definition, entityKey, {
    fields: entity.fields.map((f) => f.key === fieldKey ? { ...f, ...patch } : f),
  });
}

export function removeField(definition, entityKey, fieldKey) {
  const entity = definition.entities.find((e) => e.key === entityKey);
  if (!entity) return definition;
  return updateEntity(definition, entityKey, { fields: entity.fields.filter((f) => f.key !== fieldKey) });
}

export function moveField(definition, entityKey, fieldKey, direction) {
  const entity = definition.entities.find((e) => e.key === entityKey);
  if (!entity) return definition;
  const fields = [...entity.fields];
  const index = fields.findIndex((f) => f.key === fieldKey);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= fields.length) return definition;
  [fields[index], fields[target]] = [fields[target], fields[index]];
  return updateEntity(definition, entityKey, { fields });
}

// A field can only be dropped from a PUBLISHED module without a destructive
// DROP_COLUMN if it never existed in the last published definition — see
// docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md
// "DELETE FIELD SAFETY". The real block happens server-side at publish time
// (schema diff); this is a client-side hint shown before that.
export function fieldExistedInPublished(publishedDefinition, entityKey, fieldKey) {
  const entity = publishedDefinition?.entities?.find((e) => e.key === entityKey);
  return Boolean(entity?.fields?.some((f) => f.key === fieldKey));
}

export function addSelectOption(field) {
  const options = field.options ?? [];
  return { ...field, options: [...options, { value: `OPCION_${options.length + 1}`, label: `Opción ${options.length + 1}` }] };
}

export function updateSelectOption(field, index, patch) {
  const options = [...(field.options ?? [])];
  options[index] = { ...options[index], ...patch };
  return { ...field, options };
}

export function removeSelectOption(field, index) {
  return { ...field, options: (field.options ?? []).filter((_, i) => i !== index) };
}

export function moveSelectOption(field, index, direction) {
  const options = [...(field.options ?? [])];
  const target = index + direction;
  if (target < 0 || target >= options.length) return field;
  [options[index], options[target]] = [options[target], options[index]];
  return { ...field, options };
}

export function hasDuplicateOptionValues(field) {
  const values = (field.options ?? []).map((o) => o.value);
  return new Set(values).size !== values.length;
}

function defaultViewKey(definition, entityKey, kind) {
  return `${moduleSlug(definition.key)}.${entityKey ?? "dashboard"}.${kind.toLowerCase()}`;
}

export function addView(definition, { kind, entityKey }) {
  const key = defaultViewKey(definition, entityKey, kind);
  const base = { key, kind };
  if (kind === "DASHBOARD") {
    return { ...definition, views: [...(definition.views ?? []), { ...base, title: definition.name, widgets: [] }] };
  }
  if (kind === "KANBAN") {
    return { ...definition, views: [...(definition.views ?? []), { ...base, entity: entityKey, title: `Tablero`, groupBy: null, card: {} }] };
  }
  return { ...definition, views: [...(definition.views ?? []), { ...base, entity: entityKey }] };
}

export function updateView(definition, viewKey, patch) {
  return { ...definition, views: definition.views.map((v) => v.key === viewKey ? { ...v, ...patch } : v) };
}

export function removeView(definition, viewKey) {
  return { ...definition, views: definition.views.filter((v) => v.key !== viewKey) };
}

export function selectableFieldsFor(entity, predicate = () => true) {
  return (entity?.fields ?? []).filter(predicate);
}

export function navigationItems(definition) {
  if (Array.isArray(definition.navigation)) return definition.navigation;
  return (definition.entities ?? []).map((entity) => deriveNavigationItem(definition, entity));
}

export function updateNavigationItem(definition, index, patch) {
  const items = [...navigationItems(definition)];
  items[index] = { ...items[index], ...patch };
  return { ...definition, navigation: items };
}

export function moveNavigationItem(definition, index, direction) {
  const items = [...navigationItems(definition)];
  const target = index + direction;
  if (target < 0 || target >= items.length) return definition;
  [items[index], items[target]] = [items[target], items[index]];
  return { ...definition, navigation: items };
}
