import { normalizeSpanishLabel } from "./renderer-adapters.js";

export function normalizeField(fieldLike) {
  if (!fieldLike || typeof fieldLike !== "object") return null;
  const name = fieldLike.name ?? fieldLike.key ?? fieldLike.field ?? null;
  if (!name) return null;
  return {
    name: String(name),
    label: normalizeSpanishLabel(fieldLike.label ?? String(name)),
    type: fieldLike.type ?? "text",
    required: Boolean(fieldLike.required),
    readonly: Boolean(fieldLike.readonly),
    fullWidth: Boolean(fieldLike.fullWidth),
    default: fieldLike.default,
    hint:
      typeof fieldLike.hint === "string" && fieldLike.hint.trim()
        ? fieldLike.hint.trim()
        : null,
    options: fieldLike.options,
    relation: fieldLike.relation,
    visibleWhen: fieldLike.visibleWhen ?? null,
    hiddenWhen: fieldLike.hiddenWhen ?? null,
    currency: fieldLike.currency ?? null,
    locale: fieldLike.locale ?? null,
    allowNegative: fieldLike.allowNegative ?? null,
  };
}

function normalizeSectionField(item) {
  if (typeof item === "string") {
    const key = String(item).trim();
    if (!key) return null;
    return {
      name: key,
      field: {
        name: key,
        label: key,
        type: "text",
        required: false,
        readonly: false,
        options: [],
        visibleWhen: null,
        hiddenWhen: null,
      },
    };
  }
  const normalized = normalizeField(item);
  if (!normalized) return null;
  return {
    name: normalized.name,
    field: { ...normalized, options: normalized.options ?? [] },
  };
}

function normalizeAttachmentsPlacement(value) {
  const placement = String(value ?? "embedded")
    .trim()
    .toLowerCase();
  return placement === "aside" ? "aside" : "embedded";
}

function toSectionMeta(entry) {
  return {
    description:
      typeof entry?.description === "string" &&
      entry.description.trim().length > 0
        ? entry.description.trim()
        : null,
    collapsible: Boolean(entry?.collapsible),
    defaultCollapsed: Boolean(entry?.defaultCollapsed),
  };
}

function normalizeSectionType(entry) {
  if (typeof entry?.type === "string" && entry.type.trim()) {
    return entry.type.trim().toLowerCase();
  }
  return "fields";
}

export function normalizeSections(schema, fieldMap) {
  const rawSections = Array.isArray(schema?.sections) ? schema.sections : [];
  return rawSections
    .map((entry, sectionIndex) => {
      if (!entry || typeof entry !== "object") return null;
      const sectionType = normalizeSectionType(entry);

      if (sectionType === "attachments" || sectionType === "documents") {
        const attachmentsConfig =
          sectionType === "attachments"
            ? (entry.attachments ?? {})
            : {
                ...(entry.documents ?? {}),
                placement: entry.placement ?? "embedded",
              };
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: normalizeSpanishLabel(
            entry.title ?? entry.label ?? "Documentos",
          ),
          type: "attachments",
          placement: normalizeAttachmentsPlacement(
            entry.placement ?? attachmentsConfig?.placement,
          ),
          icon:
            typeof entry.icon === "string" && entry.icon.trim()
              ? entry.icon.trim()
              : null,
          ...toSectionMeta(entry),
          attachments: attachmentsConfig,
        };
      }

      if (sectionType === "parts" || sectionType === "parts-editor") {
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: normalizeSpanishLabel(
            entry.title ?? entry.label ?? "Refacciones / Partes",
          ),
          type: "parts",
          minItems: Number.isFinite(Number(entry.minItems))
            ? Math.max(0, Number(entry.minItems))
            : 0,
          icon:
            typeof entry.icon === "string" && entry.icon.trim()
              ? entry.icon.trim()
              : null,
          ...toSectionMeta(entry),
        };
      }

      if (sectionType === "custom-fields") {
        const cfg = entry.customFields ?? {};
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: normalizeSpanishLabel(
            entry.title ?? entry.label ?? "Campos personalizados",
          ),
          type: "custom-fields",
          icon:
            typeof entry.icon === "string" && entry.icon.trim()
              ? entry.icon.trim()
              : null,
          ...toSectionMeta(entry),
          customFields: {
            apiPath:
              typeof cfg.apiPath === "string" && cfg.apiPath.trim()
                ? cfg.apiPath.trim()
                : null,
            categoryField:
              typeof cfg.categoryField === "string" && cfg.categoryField.trim()
                ? cfg.categoryField.trim()
                : null,
            valuePrefix:
              typeof cfg.valuePrefix === "string" && cfg.valuePrefix.trim()
                ? cfg.valuePrefix.trim()
                : "customValues",
          },
        };
      }

      if (sectionType === "component") {
        const declaredFieldNames = (Array.isArray(entry.fields) ? entry.fields : [])
          .map((name) => String(name ?? "").trim())
          .filter(Boolean);
        for (const name of declaredFieldNames) {
          if (!fieldMap.has(name)) {
            fieldMap.set(name, {
              name,
              label: name,
              type: "text",
              required: false,
              readonly: false,
              options: [],
              visibleWhen: null,
              hiddenWhen: null,
            });
          }
        }
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: (entry.title ?? entry.label) ? normalizeSpanishLabel(entry.title ?? entry.label) : null,
          type: "component",
          component: typeof entry.component === "string" ? entry.component.trim() : "",
          fields: declaredFieldNames,
          icon: typeof entry.icon === "string" && entry.icon.trim() ? entry.icon.trim() : null,
          ...toSectionMeta(entry),
        };
      }

      const sectionFields = (Array.isArray(entry.fields) ? entry.fields : [])
        .map((item) => normalizeSectionField(item))
        .filter(Boolean);

      const uniqueFields = [];
      for (const fieldDef of sectionFields) {
        const name = fieldDef.name;
        if (!fieldMap.has(name)) {
          fieldMap.set(name, fieldDef.field);
        } else {
          const existing = fieldMap.get(name);
          fieldMap.set(name, {
            ...existing,
            label: fieldDef.field.label ?? existing?.label ?? name,
            type: fieldDef.field.type ?? existing?.type ?? "text",
            required: fieldDef.field.required ?? existing?.required ?? false,
            readonly: fieldDef.field.readonly ?? existing?.readonly ?? false,
            default:
              fieldDef.field.default !== undefined
                ? fieldDef.field.default
                : existing?.default,
            options:
              Array.isArray(fieldDef.field.options) &&
              fieldDef.field.options.length > 0
                ? fieldDef.field.options
                : (existing?.options ?? []),
            relation:
              fieldDef.field.relation ?? existing?.relation ?? undefined,
            visibleWhen:
              fieldDef.field.visibleWhen ?? existing?.visibleWhen ?? null,
            hiddenWhen:
              fieldDef.field.hiddenWhen ?? existing?.hiddenWhen ?? null,
          });
        }
        if (!uniqueFields.includes(name)) uniqueFields.push(name);
      }

      return {
        id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
        // Keep null when no title is provided — renderSectionHeader checks for this
        // and skips rendering the header bar for untitled sections.
        title:
          (entry.title ?? entry.label)
            ? normalizeSpanishLabel(entry.title ?? entry.label)
            : null,
        type: "fields",
        columns:
          entry.columns === 1 ? 1 : Number(entry.columns) === 2 ? 2 : "auto",
        icon:
          typeof entry.icon === "string" && entry.icon.trim()
            ? entry.icon.trim()
            : null,
        ...toSectionMeta(entry),
        fields: uniqueFields,
      };
    })
    .filter(Boolean);
}
