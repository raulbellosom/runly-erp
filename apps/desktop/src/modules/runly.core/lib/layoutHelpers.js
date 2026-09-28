// Module Builder — pure editing operations for an entity's `layout`
// (tabs -> sections -> fields, detail hero/KPIs, open mode). Contract and
// validation live in packages/module-compiler/src/layout.js.

const MAX_TABS = 8;
export const MAX_KPIS = 4;

function keyFrom(label, fallback) {
  const slug = String(label ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `${fallback}_${slug || "1"}`;
}

function allKeys(layout) {
  return new Set((layout?.tabs ?? []).flatMap((tab) => [tab.key, ...tab.sections.map((section) => section.key)]));
}

export function uniqueLayoutKey(layout, label, fallback) {
  const taken = allKeys(layout);
  const base = keyFrom(label, fallback);
  let key = base;
  for (let index = 2; taken.has(key); index += 1) key = `${base}_${index}`;
  return key;
}

function mapSections(layout, fn) {
  return { ...layout, tabs: layout.tabs.map((tab) => ({ ...tab, sections: fn(tab.sections, tab) })) };
}

function move(list, index, direction) {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function createDefaultLayout(entity) {
  return {
    mode: "auto",
    tabs: [{
      key: "general",
      label: "General",
      sections: [{ key: "datos", label: entity?.label || "Datos", columns: 2, fields: (entity?.fields ?? []).map((field) => field.key) }],
    }],
    detail: {},
  };
}

export function canAddTab(layout) {
  return (layout?.tabs?.length ?? 0) < MAX_TABS;
}

export function addTab(layout, label) {
  if (!canAddTab(layout)) return layout;
  const key = uniqueLayoutKey(layout, label, "tab");
  const sectionKey = uniqueLayoutKey({ tabs: [...layout.tabs, { key, sections: [] }] }, `${label} datos`, "section");
  return { ...layout, tabs: [...layout.tabs, { key, label, sections: [{ key: sectionKey, label, columns: 2, fields: [] }] }] };
}

export function updateTab(layout, tabKey, patch) {
  return { ...layout, tabs: layout.tabs.map((tab) => (tab.key === tabKey ? { ...tab, ...patch } : tab)) };
}

export function removeTab(layout, tabKey) {
  if (layout.tabs.length <= 1) return layout;
  return { ...layout, tabs: layout.tabs.filter((tab) => tab.key !== tabKey) };
}

export function moveTab(layout, tabKey, direction) {
  return { ...layout, tabs: move(layout.tabs, layout.tabs.findIndex((tab) => tab.key === tabKey), direction) };
}

export function hasAttachmentsSection(layout) {
  return (layout?.tabs ?? []).some((tab) => tab.sections.some((section) => section.type === "attachments"));
}

export function addSection(layout, tabKey, { label, type = "fields", source }) {
  if (type === "attachments" && hasAttachmentsSection(layout)) return layout;
  const key = uniqueLayoutKey(layout, label, "section");
  const section = type === "attachments"
    ? { key, label, type: "attachments", placement: "embedded" }
    : type === "related"
      ? { key, label, type: "related", source }
      : { key, label, columns: 2, fields: [] };
  return mapSections(layout, (sections, tab) => (tab.key === tabKey ? [...sections, section] : sections));
}

export function updateSection(layout, sectionKey, patch) {
  return mapSections(layout, (sections) => sections.map((section) => (section.key === sectionKey ? { ...section, ...patch } : section)));
}

export function removeSection(layout, sectionKey) {
  return mapSections(layout, (sections) => sections.filter((section) => section.key !== sectionKey));
}

export function moveSection(layout, sectionKey, direction) {
  return mapSections(layout, (sections) => move(sections, sections.findIndex((section) => section.key === sectionKey), direction));
}

// Places a field at the end of a section, removing it from wherever it was.
// A null sectionKey just unplaces it.
export function placeField(layout, fieldKey, sectionKey) {
  return mapSections(layout, (sections) => sections.map((section) => {
    if (section.type === "attachments") return section;
    const fields = (section.fields ?? []).filter((key) => key !== fieldKey);
    const next = { ...section, fields: section.key === sectionKey ? [...fields, fieldKey] : fields };
    // A field rule belongs to the section the field sits in.
    if (section.key !== sectionKey && section.fieldRules?.[fieldKey]) {
      const rest = Object.fromEntries(Object.entries(section.fieldRules).filter(([key]) => key !== fieldKey));
      next.fieldRules = Object.keys(rest).length ? rest : undefined;
    }
    return next;
  }));
}

export function reorderSectionFields(layout, sectionKey, fields) {
  return updateSection(layout, sectionKey, { fields });
}

export function unplacedFields(layout, entity) {
  const placed = new Set((layout?.tabs ?? []).flatMap((tab) => tab.sections.flatMap((section) => section.fields ?? [])));
  return (entity?.fields ?? []).filter((field) => !placed.has(field.key));
}

export function updateDetail(layout, patch) {
  return { ...layout, detail: { ...(layout.detail ?? {}), ...patch } };
}

function pruneRule(rule, exists) {
  return rule && exists.has(rule.field) ? rule : undefined;
}

function pruneTree(tree, exists) {
  return mapSections({ tabs: tree }, (sections) => sections.map((section) => {
    const next = { ...section, visibleWhen: pruneRule(section.visibleWhen, exists) };
    if (section.fields) next.fields = section.fields.filter((key) => exists.has(key));
    if (section.fieldRules) {
      const rules = Object.fromEntries(Object.entries(section.fieldRules)
        .filter(([key, rule]) => exists.has(key) && pruneRule(rule, exists)));
      next.fieldRules = Object.keys(rules).length ? rules : undefined;
    }
    return next;
  })).tabs.map((tab) => ({ ...tab, visibleWhen: pruneRule(tab.visibleWhen, exists) }));
}

// Drops references to fields that no longer exist (deleted in the builder):
// placements, rules, the detail tree, hero and KPIs.
export function pruneLayout(layout, fieldKeys) {
  if (!layout?.tabs) return layout;
  const exists = new Set(fieldKeys);
  const next = { ...layout, tabs: pruneTree(layout.tabs, exists) };
  if (layout.detail?.tabs) next.detail = { ...layout.detail, tabs: pruneTree(layout.detail.tabs, exists) };
  const hero = layout.detail?.hero;
  if (hero) {
    const cleanHero = {
      ...hero,
      subtitleFields: (hero.subtitleFields ?? []).filter((key) => exists.has(key)),
      statusField: exists.has(hero.statusField) ? hero.statusField : undefined,
      imageField: exists.has(hero.imageField) ? hero.imageField : undefined,
    };
    next.detail = { ...next.detail, hero: exists.has(hero.titleField) ? cleanHero : undefined };
  }
  if (layout.detail?.kpis) next.detail = { ...next.detail, kpis: layout.detail.kpis.filter((kpi) => exists.has(kpi.field)) };
  return next;
}

// ── Independent detail tree ─────────────────────────────────────────────────
// The tree ops above work on any `{ tabs }` object; the designer edits the
// detail tree through treeOf/withTree.

export function hasDetailTree(layout) {
  return Boolean(layout?.detail?.tabs?.length);
}

export function treeOf(layout, target) {
  return target === "detail" && hasDetailTree(layout) ? { tabs: layout.detail.tabs } : layout;
}

export function withTree(layout, target, tree) {
  if (target === "detail" && hasDetailTree(layout)) return updateDetail(layout, { tabs: tree.tabs });
  return { ...layout, tabs: tree.tabs };
}

// Starts the detail tree as a copy of the form tree (rules included).
export function enableDetailTree(layout) {
  return updateDetail(layout, { tabs: structuredClone(layout.tabs) });
}

export function disableDetailTree(layout) {
  return updateDetail(layout, { tabs: undefined });
}

// ── Visibility rules ────────────────────────────────────────────────────────
// Rule shape: { field, equals | notEquals | in | truthy } (see compiler layout.js).

export const RULE_FIELD_TYPES = new Set(["select", "boolean"]);

export function setTabRule(tree, tabKey, rule) {
  return updateTab(tree, tabKey, { visibleWhen: rule ?? undefined });
}

export function setSectionRule(tree, sectionKey, rule) {
  return updateSection(tree, sectionKey, { visibleWhen: rule ?? undefined });
}

export function setFieldRule(tree, sectionKey, fieldKey, rule) {
  return mapSections(tree, (sections) => sections.map((section) => {
    if (section.key !== sectionKey) return section;
    const rules = { ...(section.fieldRules ?? {}) };
    if (rule) rules[fieldKey] = rule;
    else delete rules[fieldKey];
    return { ...section, fieldRules: Object.keys(rules).length ? rules : undefined };
  }));
}

function optionLabel(field, value) {
  if (field?.type === "boolean") return value ? "Sí" : "No";
  const option = (field?.options ?? []).find((item) => (typeof item === "object" ? item.value : item) === value);
  return typeof option === "object" ? (option.label ?? String(value)) : String(value);
}

export function ruleSummary(rule, fieldsByKey) {
  if (!rule) return "";
  const field = fieldsByKey.get(rule.field);
  const name = field?.label ?? rule.field;
  if ("equals" in rule) return `${name} = ${optionLabel(field, rule.equals)}`;
  if ("notEquals" in rule) return `${name} ≠ ${optionLabel(field, rule.notEquals)}`;
  if (Array.isArray(rule.in)) return `${name} es ${rule.in.map((value) => optionLabel(field, value)).join(" o ")}`;
  if ("truthy" in rule) return rule.truthy ? `${name} tiene valor` : `${name} está vacío`;
  return name;
}

// Mirrors the compiler's resolveEntityLayout: unplaced fields are appended to
// an "Otros datos" section in the last tab. Used by the builder preview.
export function resolveLayoutForPreview(entity, target = "form") {
  if (!entity?.layout?.tabs?.length) return null;
  const layout = { ...entity.layout, tabs: treeOf(entity.layout, target).tabs };
  const rest = unplacedFields(layout, entity).map((field) => field.key);
  if (!rest.length) return layout;
  const tabs = layout.tabs.map((tab, index) => (index === layout.tabs.length - 1
    ? { ...tab, sections: [...tab.sections, { key: "otros_datos", label: "Otros datos", columns: 2, fields: rest }] }
    : tab));
  return { ...layout, tabs };
}

// Relations of other entities pointing at `entityKey` — candidates for a
// detail "Registros relacionados" section.
export function relatedSources(definition, entityKey) {
  return (definition?.entities ?? []).flatMap((entity) => (entity.fields ?? [])
    .filter((field) => field.type === "relation" && field.targetEntity === entityKey)
    .map((field) => ({
      source: { entity: entity.key, field: field.key },
      label: entity.pluralLabel || entity.label,
      description: `${entity.pluralLabel || entity.label} por "${field.label}"`,
    })));
}
