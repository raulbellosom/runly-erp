const DASHBOARD_SHELL_KEY = "runly.dashboardShell";
const CRUD_LAYOUT_KEY = "runly.crudLayout";

const SHELL_ALIASES = new Map([
  ["runly.dashboardshell", DASHBOARD_SHELL_KEY],
  ["atlas.dashboardshell", DASHBOARD_SHELL_KEY],
  ["main", DASHBOARD_SHELL_KEY],
  ["default", DASHBOARD_SHELL_KEY],
]);

const LAYOUT_ALIASES = new Map([
  ["runly.crudlayout", CRUD_LAYOUT_KEY],
  ["atlas.crudlayout", CRUD_LAYOUT_KEY],
  ["main", CRUD_LAYOUT_KEY],
  ["default", CRUD_LAYOUT_KEY],
]);

function asNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function resolveKey(candidates, aliases, fallbackKey) {
  for (const candidate of candidates) {
    const rawValue = asNonEmptyString(candidate?.value);
    if (!rawValue) continue;
    const normalized = aliases.get(rawValue.toLowerCase());
    if (normalized) {
      return {
        key: normalized,
        source: candidate.source,
        raw: rawValue,
        unsupported: null,
      };
    }
    return {
      key: fallbackKey,
      source: candidate.source,
      raw: rawValue,
      unsupported: rawValue,
    };
  }

  return {
    key: fallbackKey,
    source: "default",
    raw: null,
    unsupported: null,
  };
}

export function resolveBlueprintPresentation({
  pageBlueprint,
  tableBlueprint,
  formBlueprint,
  detailBlueprint,
} = {}) {
  const shellResolution = resolveKey(
    [
      { source: "page.schema.shell", value: pageBlueprint?.schema?.shell },
      {
        source: "page.schema.page.shell",
        value: pageBlueprint?.schema?.page?.shell,
      },
      { source: "table.schema.shell", value: tableBlueprint?.schema?.shell },
      { source: "form.schema.shell", value: formBlueprint?.schema?.shell },
      { source: "detail.schema.shell", value: detailBlueprint?.schema?.shell },
    ],
    SHELL_ALIASES,
    DASHBOARD_SHELL_KEY,
  );

  const layoutResolution = resolveKey(
    [
      { source: "page.schema.layout", value: pageBlueprint?.schema?.layout },
      {
        source: "page.schema.page.layout",
        value: pageBlueprint?.schema?.page?.layout,
      },
      { source: "table.schema.layout", value: tableBlueprint?.schema?.layout },
      { source: "form.schema.layout", value: formBlueprint?.schema?.layout },
      {
        source: "detail.schema.layout",
        value: detailBlueprint?.schema?.layout,
      },
    ],
    LAYOUT_ALIASES,
    CRUD_LAYOUT_KEY,
  );

  return {
    shellKey: shellResolution.key,
    layoutKey: layoutResolution.key,
    shellSource: shellResolution.source,
    layoutSource: layoutResolution.source,
    rawShellKey: shellResolution.raw,
    rawLayoutKey: layoutResolution.raw,
    unsupportedShellKey: shellResolution.unsupported,
    unsupportedLayoutKey: layoutResolution.unsupported,
  };
}
