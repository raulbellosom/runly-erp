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

export function addSection(layout, tabKey, { label, type = "fields" }) {
  if (type === "attachments" && hasAttachmentsSection(layout)) return layout;
  const key = uniqueLayoutKey(layout, label, "section");
  const section = type === "attachments"
    ? { key, label, type: "attachments", placement: "embedded" }
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
    return { ...section, fields: section.key === sectionKey ? [...fields, fieldKey] : fields };
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

// Drops references to fields that no longer exist (deleted in the builder).
export function pruneLayout(layout, fieldKeys) {
  if (!layout?.tabs) return layout;
  const exists = new Set(fieldKeys);
  const next = mapSections(layout, (sections) => sections.map((section) => (
    section.fields ? { ...section, fields: section.fields.filter((key) => exists.has(key)) } : section
  )));
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

// Mirrors the compiler's resolveEntityLayout: unplaced fields are appended to
// an "Otros datos" section in the last tab. Used by the builder preview.
export function resolveLayoutForPreview(entity) {
  const layout = entity?.layout;
  if (!layout?.tabs?.length) return null;
  const rest = unplacedFields(layout, entity).map((field) => field.key);
  if (!rest.length) return layout;
  const tabs = layout.tabs.map((tab, index) => (index === layout.tabs.length - 1
    ? { ...tab, sections: [...tab.sections, { key: "otros_datos", label: "Otros datos", columns: 2, fields: rest }] }
    : tab));
  return { ...layout, tabs };
}
