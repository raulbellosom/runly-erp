// Visibility rules shared by RunlyForm / RunlyDetail for fields, sections and
// tabs: `{ field, equals | notEquals | in | notIn | truthy }`. The generated
// RME3 API (module-compiler templates/visibility.js) evaluates the same
// semantics to enforce "required only while visible".

export function matchesVisibilityRule(rule, values) {
  if (!rule || typeof rule !== "object") return true;
  const fieldName = String(rule.field ?? "").trim();
  if (!fieldName) return true;
  const value = values?.[fieldName];
  if (Object.prototype.hasOwnProperty.call(rule, "equals")) return value === rule.equals;
  if (Object.prototype.hasOwnProperty.call(rule, "notEquals")) return value !== rule.notEquals;
  if (Array.isArray(rule.in)) return rule.in.includes(value);
  if (Array.isArray(rule.notIn)) return !rule.notIn.includes(value);
  if (Object.prototype.hasOwnProperty.call(rule, "truthy")) return Boolean(value) === Boolean(rule.truthy);
  return true;
}

export function isElementVisible(element, values) {
  return !element?.visibleWhen || matchesVisibilityRule(element.visibleWhen, values);
}

// Sections that are visible given the tab list (from resolveSchemaTabs) and
// the current values: the section's own rule and its tab's rule must hold.
export function visibleSections(sections, tabs, values, tabOf) {
  const hiddenTabs = new Set((tabs ?? []).filter((tab) => !isElementVisible(tab, values)).map((tab) => tab.key));
  return (sections ?? []).filter((section) => isElementVisible(section, values) && !(tabs?.length && hiddenTabs.has(tabOf(section, tabs))));
}
