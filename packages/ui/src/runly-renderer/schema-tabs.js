// Tabs for RunlyForm / RunlyDetail. Blueprints keep a flat `schema.sections`
// list (so every consumer of sections keeps working); a section joins a tab
// through `section.tab`, and `schema.tabs` lists the tabs in order. Tabs only
// render with 2+ entries; sections without a known tab fall into the first.

export function resolveSchemaTabs(schema) {
  const tabs = (Array.isArray(schema?.tabs) ? schema.tabs : [])
    .filter((tab) => tab && typeof tab.key === "string" && tab.key.trim())
    .map((tab) => ({
      key: tab.key.trim(),
      label: String(tab.label ?? tab.key).trim() || tab.key,
      ...(tab.visibleWhen ? { visibleWhen: tab.visibleWhen } : {}),
    }));
  return tabs.length > 1 ? tabs : [];
}

export function tabOfSection(section, tabs) {
  if (!tabs?.length) return null;
  return tabs.some((tab) => tab.key === section?.tab) ? section.tab : tabs[0].key;
}

export function tabsWithErrors(sections, tabs, errors) {
  const failing = new Set();
  if (!tabs?.length || !errors) return failing;
  const errorNames = new Set(Object.keys(errors));
  for (const section of sections ?? []) {
    if ((section.fields ?? []).some((name) => errorNames.has(name))) failing.add(tabOfSection(section, tabs));
  }
  return failing;
}

export function firstTabWithError(sections, tabs, errors) {
  const failing = tabsWithErrors(sections, tabs, errors);
  return tabs?.find((tab) => failing.has(tab.key))?.key ?? null;
}
