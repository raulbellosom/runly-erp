// Pure helpers for editing a draft ModuleDefinition in the Module Builder
// UI. These only ever touch the in-memory `definition` object the editor
// screen holds in React state — nothing here talks to the API. Every write
// goes through module-builder-service.js's updateDefinition (autosave) and
// is re-validated server-side by @runly/module-compiler before it can be
// published, so these helpers don't need to be authoritative — just
// convenient and non-destructive to sibling data.
import * as LucideIcons from "lucide-react";

// Turns the server's `capabilities.iconNames` (@runly/module-engine's
// MODULE_ICON_NAMES — the exact list @runly/module-compiler's validator
// accepts) into {name, component} pairs resolved against the real
// lucide-react package, for IconPickerField's `icons` override. Deliberately
// does NOT go through packages/ui's separate icon-catalog.js — that catalog
// is its own, differently-curated list (built for runly.pfm's wallet icons)
// that was never meant to be a superset of MODULE_ICON_NAMES, and filtering
// through it silently dropped valid module icons the picker should offer.
// Resolving directly against lucide-react means whatever the server allows,
// the picker can always show — no separate list to keep in sync.
export function buildModuleIconOptions(iconNames) {
  return (iconNames ?? [])
    .map((name) => ({ name, component: LucideIcons[name] }))
    .filter((option) => Boolean(option.component));
}

// Resolves a stored lucide icon name (module/navigation icons) to its
// component, or null when the name is unknown.
export function resolveLucideIcon(name) {
  return (name && LucideIcons[name]) || null;
}

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

// Custom view kinds that render records of one entity (see
// @runly/module-engine records-view-schema.js). Path suffixes mirror the
// compiler's defaults in packages/module-compiler/src/records-views.js.
export const RECORDS_VIEW_KINDS = ["CARDS", "CALENDAR", "TIMELINE", "REPORT"];
export const CUSTOM_VIEW_KINDS = ["DASHBOARD", "KANBAN", ...RECORDS_VIEW_KINDS];
const VIEW_PATH_SUFFIX = { KANBAN: "kanban", CARDS: "cards", CALENDAR: "calendar", TIMELINE: "timeline", REPORT: "report" };

function defaultViewKey(definition, entityKey, kind) {
  return `${moduleSlug(definition.key)}.${entityKey ?? "dashboard"}.${kind.toLowerCase()}`;
}

// A second dashboard (or a second kanban on the same entity) used to reuse
// the first one's key and route, which failed DUPLICATE_VIEW_KEY and would
// have shadowed the first view's page. Suffix both until they're unique.
function uniqueViewKeyAndPath(definition, entityKey, kind) {
  const views = definition.views ?? [];
  const slug = moduleSlug(definition.key);
  const base = entityKey ?? "dashboard";
  const pathBase = kind === "DASHBOARD" ? "dashboard" : `${entityKey}-${VIEW_PATH_SUFFIX[kind] ?? kind.toLowerCase()}`;
  for (let n = 1; ; n++) {
    const middle = n === 1 ? base : `${base}_${n}`;
    const key = n === 1 ? defaultViewKey(definition, entityKey, kind) : `${slug}.${middle}.${kind.toLowerCase()}`;
    const path = `/app/m/${definition.key}/${n === 1 ? pathBase : `${pathBase}-${n}`}`;
    if (!views.some((v) => v.key === key || v.path === path)) return { key, path };
  }
}

// Sensible starting configuration per records view kind, picked from the
// entity's own fields so a new view validates (or nearly) out of the box.
function recordsViewDefaults(kind, entity) {
  const fields = entity?.fields ?? [];
  const firstOf = (types) => fields.find((f) => types.includes(f.type))?.key;
  const titleField = firstOf(["text", "email", "phone"]) ?? fields[0]?.key;
  const dateField = firstOf(["date", "datetime"]) ?? "created_at";
  const label = entity?.pluralLabel || entity?.label || "Registros";
  if (kind === "CARDS") {
    return { title: label, card: { titleField, badgeField: firstOf(["select", "boolean"]), imageField: firstOf(["file"]) } };
  }
  if (kind === "CALENDAR") return { title: `Calendario de ${label.toLowerCase()}`, dateField, titleField, colorField: firstOf(["select", "boolean"]) };
  if (kind === "TIMELINE") return { title: `Historial de ${label.toLowerCase()}`, dateField, titleField, badgeField: firstOf(["select", "boolean"]) };
  return {
    title: `Reporte de ${label.toLowerCase()}`,
    groupBy: firstOf(["select", "boolean"]) ?? titleField,
    measures: [{ key: "total", label: "Registros", aggregate: "count" }],
  };
}

export function addView(definition, { kind, entityKey }) {
  if (kind === "DASHBOARD" || kind === "KANBAN" || RECORDS_VIEW_KINDS.includes(kind)) {
    const { key, path } = uniqueViewKeyAndPath(definition, entityKey, kind);
    let view;
    if (kind === "DASHBOARD") view = { key, kind, path, title: definition.name, widgets: [] };
    else if (kind === "KANBAN") view = { key, kind, path, entity: entityKey, title: "Tablero", groupBy: null, card: {} };
    else {
      const entity = (definition.entities ?? []).find((e) => e.key === entityKey);
      view = { key, kind, path, entity: entityKey, ...recordsViewDefaults(kind, entity) };
    }
    return { ...definition, views: [...(definition.views ?? []), view] };
  }
  const key = defaultViewKey(definition, entityKey, kind);
  return { ...definition, views: [...(definition.views ?? []), { key, kind, entity: entityKey }] };
}

export function updateView(definition, viewKey, patch) {
  return { ...definition, views: definition.views.map((v) => v.key === viewKey ? { ...v, ...patch } : v) };
}

export function removeView(definition, viewKey) {
  return {
    ...definition,
    views: definition.views.filter((v) => v.key !== viewKey),
    navigation: Array.isArray(definition.navigation)
      ? definition.navigation.filter((item) => item.page !== viewKey)
      : definition.navigation,
  };
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

// Every view the module menu can point at: each entity's generated page plus
// custom DASHBOARD/KANBAN views (the runtime routes those by their own
// schema.path). Paths/permissions mirror normalizeModuleDefinition() and the
// kanban/dashboard schema defaults in @runly/module-compiler.
export function navigationTargets(definition) {
  const slug = moduleSlug(definition.key);
  const entities = definition.entities ?? [];
  const firstRead = entities[0] ? permKey(slug, entities[0].key, "read") : null;
  const pages = entities.map((entity) => ({
    ...deriveNavigationItem(definition, entity),
    kind: "PAGE",
  }));
  const custom = (definition.views ?? [])
    .filter((view) => view.kind === "DASHBOARD" || view.kind === "KANBAN" || RECORDS_VIEW_KINDS.includes(view.kind))
    .map((view) => {
      if (RECORDS_VIEW_KINDS.includes(view.kind)) {
        return {
          kind: view.kind,
          label: view.title || view.kind,
          icon: definition.icon,
          path: view.path ?? `/app/m/${definition.key}/${view.entity}-${VIEW_PATH_SUFFIX[view.kind]}`,
          page: view.key,
          permission: permKey(slug, view.entity, "read"),
        };
      }
      if (view.kind === "KANBAN") {
        return {
          kind: "KANBAN",
          label: view.title || "Tablero",
          icon: definition.icon,
          path: view.path ?? `/app/m/${definition.key}/${view.entity}-kanban`,
          page: view.key,
          permission: permKey(slug, view.entity, "read"),
        };
      }
      const widgetEntity = (view.widgets ?? []).find((w) => w.source?.entity)?.source.entity;
      return {
        kind: "DASHBOARD",
        label: view.title || "Dashboard",
        icon: definition.icon,
        path: view.path ?? `/app/m/${definition.key}/dashboard`,
        page: view.key,
        permission: view.permissionKey ?? (widgetEntity ? permKey(slug, widgetEntity, "read") : firstRead),
      };
    });
  return [...pages, ...custom];
}

export function navigationKind(definition, item) {
  return navigationTargets(definition).find((target) => target.page === item.page)?.kind ?? "PAGE";
}

export function addNavigationItem(definition, target) {
  const { kind, ...item } = target;
  return { ...definition, navigation: [...navigationItems(definition), { ...item, generated: false }] };
}

export function removeNavigationItem(definition, index) {
  return { ...definition, navigation: navigationItems(definition).filter((_, i) => i !== index) };
}

export function setNavigationOrder(definition, items) {
  return { ...definition, navigation: items };
}
