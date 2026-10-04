// Module Builder — rename a field key everywhere the definition refers to it.
// The field keeps its fieldId, so publishing renames the column and keeps its
// data (spec 2026-10-03-rme3-module-platform-v2 §10.6). References live in
// the entity layout (placements, visibility rules, hero, KPIs), views of the
// entity (records, Kanban), dashboard widgets reading the entity, connections,
// public links and relation fields of other entities (labelField).

// Properties whose string value is a field key, and arrays of field keys.
const REF_PROPS = new Set(["field", "titleField", "subtitleField", "statusField", "imageField", "groupBy", "aggregateField", "labelField", "linkField", "targetField", "sortField", "dateField"]);
const REF_ARRAYS = new Set(["fields", "subtitleFields", "formFields", "columns", "searchFields", "filterFields"]);

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set(["id", "company_id", "enabled", "created_at", "updated_at"]);

export function validateFieldKey(key, entity, currentKey) {
  if (!IDENTIFIER.test(key ?? "")) return "Usa minúsculas, números y guion bajo; empieza con una letra.";
  if (RESERVED.has(key)) return "Esa clave está reservada.";
  if (key !== currentKey && (entity?.fields ?? []).some((field) => field.key === key)) return "Ya existe un campo con esa clave.";
  return "";
}

function renameRefs(node, from, to) {
  if (Array.isArray(node)) return node.map((item) => renameRefs(item, from, to));
  if (!node || typeof node !== "object") return node;
  const next = {};
  for (const [prop, value] of Object.entries(node)) {
    if (prop === "fieldRules" && value && typeof value === "object") {
      next[prop] = Object.fromEntries(Object.entries(value).map(([key, rule]) => [key === from ? to : key, renameRefs(rule, from, to)]));
    } else if (REF_PROPS.has(prop) && value === from) {
      next[prop] = to;
    } else if (REF_ARRAYS.has(prop) && Array.isArray(value)) {
      next[prop] = value.map((item) => (item === from ? to : renameRefs(item, from, to)));
    } else {
      next[prop] = renameRefs(value, from, to);
    }
  }
  return next;
}

const viewEntity = (view) => view.entity ?? view.schema?.entity;

export function renameField(definition, entityKey, from, to) {
  if (from === to) return definition;
  const entities = definition.entities.map((entity) => {
    if (entity.key === entityKey) {
      return {
        ...entity,
        fields: entity.fields.map((field) => (field.key === from ? { ...field, key: to } : field)),
        ...(entity.layout ? { layout: renameRefs(entity.layout, from, to) } : {}),
      };
    }
    // Relation fields of other entities that display this field.
    return {
      ...entity,
      fields: entity.fields.map((field) => (field.targetEntity === entityKey && field.labelField === from ? { ...field, labelField: to } : field)),
    };
  });
  const views = (definition.views ?? []).map((view) => {
    if (viewEntity(view) === entityKey) return renameRefs(view, from, to);
    if (view.kind === "DASHBOARD") {
      const rename = (widgets) => (widgets ?? []).map((widget) => (widget.source?.entity === entityKey ? renameRefs(widget, from, to) : widget));
      return view.schema ? { ...view, schema: { ...view.schema, widgets: rename(view.schema.widgets) } } : { ...view, widgets: rename(view.widgets) };
    }
    return view;
  });
  const next = { ...definition, entities, views };
  if (definition.connections) {
    next.connections = definition.connections.map((connection) => (connection.entity === entityKey ? renameRefs(connection, from, to) : connection));
  }
  if (definition.publicLinks) {
    next.publicLinks = definition.publicLinks.map((link) => {
      const own = link.entity === entityKey ? { ...link, fields: (link.fields ?? []).map((key) => (key === from ? to : key)) } : link;
      if (link.targetEntity !== entityKey) return own;
      return {
        ...own,
        formFields: (own.formFields ?? []).map((key) => (key === from ? to : key)),
        ...(own.linkField === from ? { linkField: to } : {}),
      };
    });
  }
  return next;
}

// A published field can be renamed with its data only once its fieldId is
// part of the published definition (every publish assigns missing ids).
export function canRenameKeepingData(field, publishedDefinition, entityKey) {
  if (!field?.fieldId) return false;
  const published = publishedDefinition?.entities?.find((entity) => entity.key === entityKey)?.fields ?? [];
  return published.some((item) => item.fieldId === field.fieldId);
}
