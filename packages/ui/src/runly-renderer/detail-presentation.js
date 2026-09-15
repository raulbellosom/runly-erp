// Pure view-model helpers for the opt-in RunlyDetail presentation layer
// (hero + KPI strip + two-column body). No React, no fetching, no side effects.
import { resolveColorHex } from "./runly-form-utils.js";

export function getByPath(value, path) {
  if (!path || typeof path !== "string") return undefined;
  return path
    .split(".")
    .reduce(
      (cursor, segment) =>
        cursor && typeof cursor === "object" ? cursor[segment] : undefined,
      value,
    );
}

export function replacePathTokens(pathTemplate, tokenMap) {
  let path = String(pathTemplate ?? "");
  for (const [key, rawValue] of Object.entries(tokenMap ?? {})) {
    if (rawValue === null || rawValue === undefined) continue;
    if (typeof rawValue === "object") continue;
    const safeValue = encodeURIComponent(String(rawValue).trim());
    path = path.replace(new RegExp(`:${key}\\b`, "g"), safeValue);
  }
  return path;
}

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

export function buildChipList(chipDefs, record) {
  return (Array.isArray(chipDefs) ? chipDefs : [])
    .map((def) => {
      if (!def || typeof def !== "object" || !def.field) return null;
      const raw = getByPath(record, def.field);
      if (isEmpty(raw)) return null;
      const chip = {
        key: def.field,
        label: def.label ? String(def.label) : null,
        value: raw,
        type: def.type ?? "text",
        icon:
          typeof def.icon === "string" && def.icon.trim() ? def.icon.trim() : null,
      };
      if (chip.type === "color") chip.colorHex = resolveColorHex(String(raw));
      return chip;
    })
    .filter(Boolean);
}

export function resolveHeroModel(schema, record) {
  const hero = schema?.hero;
  if (!hero || typeof hero !== "object") return null;

  const titleRaw = hero.titleField ? getByPath(record, hero.titleField) : null;
  const subtitle = (Array.isArray(hero.subtitleFields) ? hero.subtitleFields : [])
    .map((field) => getByPath(record, field))
    .filter((value) => !isEmpty(value))
    .map((value) => String(value))
    .join(" · ");

  const statusValue = hero.statusField
    ? (getByPath(record, hero.statusField) ?? null)
    : null;
  const imageRaw = hero.imageField ? getByPath(record, hero.imageField) : null;
  const accentRaw = hero.accentColorField
    ? getByPath(record, hero.accentColorField)
    : null;

  return {
    title: isEmpty(titleRaw) ? "" : String(titleRaw),
    subtitle,
    statusValue,
    statusMap:
      hero.statusMap && typeof hero.statusMap === "object"
        ? hero.statusMap
        : null,
    imageAssetId: isEmpty(imageRaw) ? null : String(imageRaw),
    imageDocsPath:
      typeof hero.imageDocsPath === "string" && hero.imageDocsPath.trim()
        ? hero.imageDocsPath.trim()
        : null,
    fallbackIcon:
      typeof hero.fallbackIcon === "string" && hero.fallbackIcon.trim()
        ? hero.fallbackIcon.trim()
        : "FileText",
    accentHex: isEmpty(accentRaw) ? null : resolveColorHex(String(accentRaw)),
    chips: buildChipList(hero.metaChips, record),
  };
}

function primitiveTokenMap(record) {
  const out = {};
  for (const [key, value] of Object.entries(
    record && typeof record === "object" ? record : {},
  )) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    out[key] = value;
  }
  if (record && record.id !== undefined) out.id = record.id;
  return out;
}

export function resolveKpis(schema, record) {
  const defs = Array.isArray(schema?.kpis) ? schema.kpis : [];
  const tokenMap = primitiveTokenMap(record);
  return defs
    .map((def, index) => {
      if (!def || typeof def !== "object") return null;
      const raw = def.field ? getByPath(record, def.field) : undefined;
      let href = null;
      if (def.hrefTemplate) {
        const candidate = replacePathTokens(def.hrefTemplate, tokenMap);
        href = candidate.includes(":") ? null : candidate;
      }
      return {
        key: def.field ? String(def.field) : `kpi-${index}`,
        label: def.label ? String(def.label) : String(def.field ?? ""),
        rawValue: raw === undefined ? null : raw,
        type: def.type ? String(def.type) : "text",
        icon:
          typeof def.icon === "string" && def.icon.trim() ? def.icon.trim() : null,
        href,
      };
    })
    .filter(Boolean);
}

export function splitSectionsByColumn(sections, layout) {
  const list = Array.isArray(sections) ? sections : [];
  if (String(layout ?? "") !== "two-column") {
    return { twoColumn: false, main: list, aside: [] };
  }
  const main = [];
  const aside = [];
  for (const section of list) {
    if (section?.column === "aside") aside.push(section);
    else main.push(section);
  }
  return { twoColumn: true, main, aside };
}

export function normalizeComponentSection(entry, sectionIndex, title, icon) {
  const componentKey =
    typeof entry?.component === "string" && entry.component.trim()
      ? entry.component.trim()
      : "";
  if (!componentKey) return null;
  return {
    id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
    title: title ?? null,
    type: "component",
    icon: icon ?? null,
    component: componentKey,
  };
}
