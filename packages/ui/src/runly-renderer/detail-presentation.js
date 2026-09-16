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

// Fields declared with `type: "select"` + `options` in a section carry the
// value->label mapping used to render them there (see RunlyDetail's
// renderValue). The hero's subtitle/chips read the same raw record values but
// bypass that mapping, so a select field would otherwise leak its raw stored
// value (e.g. "equipment") instead of its label ("Equipo / Maquinaria").
// `fieldMap` is the same Map RunlyDetail builds from `fields` + sections.
function resolveDisplayLabel(fieldMap, fieldName, rawValue) {
  if (isEmpty(rawValue)) return rawValue;
  const field = fieldMap?.get ? fieldMap.get(fieldName) : null;
  if (field?.type === "select" && Array.isArray(field.options)) {
    const str = String(rawValue);
    const opt = field.options.find((o) => String(o.value) === str);
    if (opt?.label) return opt.label;
  }
  return rawValue;
}

export function buildChipList(chipDefs, record, fieldMap = null) {
  return (Array.isArray(chipDefs) ? chipDefs : [])
    .map((def) => {
      if (!def || typeof def !== "object" || !def.field) return null;
      const raw = getByPath(record, def.field);
      if (isEmpty(raw)) return null;
      const chip = {
        key: def.field,
        label: def.label ? String(def.label) : null,
        value: resolveDisplayLabel(fieldMap, def.field, raw),
        type: def.type ?? "text",
        icon:
          typeof def.icon === "string" && def.icon.trim() ? def.icon.trim() : null,
      };
      if (chip.type === "color") chip.colorHex = resolveColorHex(String(raw));
      return chip;
    })
    .filter(Boolean);
}

export function resolveHeroModel(schema, record, fieldMap = null) {
  const hero = schema?.hero;
  if (!hero || typeof hero !== "object") return null;

  const titleRaw = hero.titleField ? getByPath(record, hero.titleField) : null;
  const subtitle = (Array.isArray(hero.subtitleFields) ? hero.subtitleFields : [])
    .map((field) => resolveDisplayLabel(fieldMap, field, getByPath(record, field)))
    .filter((value) => !isEmpty(value))
    .map((value) => String(value))
    .join(" · ");

  const statusValue = hero.statusField
    ? (getByPath(record, hero.statusField) ?? null)
    : null;
  const imageRaw = hero.imageField ? getByPath(record, hero.imageField) : null;
  const avatarUserRaw = hero.avatarUserField
    ? getByPath(record, hero.avatarUserField)
    : null;
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
    // Last-resort fallback when neither imageField nor imageDocsPath yields
    // a photo: a linked user account's avatar, resolved via the dedicated
    // /identity/users/:id/avatar/signed-url route (see HeroContainer) since
    // it isn't a company-scoped file entity fetchSignedUrl can resolve.
    avatarUserId: isEmpty(avatarUserRaw) ? null : String(avatarUserRaw),
    fallbackIcon:
      typeof hero.fallbackIcon === "string" && hero.fallbackIcon.trim()
        ? hero.fallbackIcon.trim()
        : "FileText",
    accentHex: isEmpty(accentRaw) ? null : resolveColorHex(String(accentRaw)),
    chips: buildChipList(hero.metaChips, record, fieldMap),
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

// Normalizes a blueprint section's raw `column` value to what
// splitSectionsByColumn below (and every normalizeSections branch in
// RunlyDetail.jsx) expects: "aside" or "main".
export function normalizeSectionColumn(value) {
  return String(value ?? "").trim().toLowerCase() === "aside" ? "aside" : "main";
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
    column: normalizeSectionColumn(entry?.column),
    component: componentKey,
  };
}
