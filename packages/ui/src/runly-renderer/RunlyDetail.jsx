import { useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState.jsx";
import { Alert, AlertDescription, AlertTitle } from "../components/Alert.jsx";
import { Button } from "../components/Button.jsx";
import { AttachmentsPanel } from "../components/AttachmentsPanel.jsx";
import { AuditTrail } from "../components/AuditTrail.jsx";
import { FileAssetValue } from "../components/FileAssetField.jsx";
import { MarkdownViewer } from "../components/MarkdownViewer.jsx";
import { normalizeSpanishLabel } from "./renderer-adapters.js";
import { resolveColorHex } from "./runly-form-utils.js";
import { accentFor } from "./records-view-format.js";
import { normalizeSelectOptions } from "./table-select-columns.js";
import { CostsSummaryPanel } from "./CostsSummaryPanel.jsx";
import { DetailSectionShell } from "./detail-section-shell.jsx";
import { RelationCardSection, RelationListSection, resolveIcon, formatDetailDate, formatDetailCurrency } from "./detail-relation-sections.jsx";
import {
  resolveHeroModel,
  resolveKpis,
  splitSectionsByColumn,
  normalizeComponentSection,
  normalizeSectionColumn,
} from "./detail-presentation.js";
import { HeroContainer } from "./runly-detail-hero.jsx";
import { resolveSchemaTabs, tabOfSection } from "./schema-tabs.js";
import { isElementVisible, matchesVisibilityRule, visibleSections as filterVisibleSections } from "./visibility-rules.js";
import { SchemaTabBar } from "./SchemaTabBar.jsx";
import { resolveFieldIcon } from "./field-icons.js";
import { cn } from "../lib/utils.js";

const STATUS_LABELS = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
  draft: "Borrador",
  finalized: "Finalizado",
  available: "Disponible",
  assigned: "Asignado",
  lost: "Perdido",
  stolen: "Robado",
  disposed: "Desechado",
};

const STATUS_COLORS = {
  active: "bg-green-500/15 text-green-700 dark:text-green-400",
  inactive: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  maintenance: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  retired: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  pending: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  disabled: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  draft: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  finalized: "bg-green-500/15 text-green-700 dark:text-green-400",
  available: "bg-green-500/15 text-green-700 dark:text-green-400",
  assigned: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  lost: "bg-red-500/15 text-red-700 dark:text-red-400",
  stolen: "bg-red-500/15 text-red-700 dark:text-red-400",
  disposed: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
};


const matchesFieldRule = matchesVisibilityRule;

function normalizeField(fieldLike) {
  if (!fieldLike || typeof fieldLike !== "object") return null;
  const name = fieldLike.name ?? fieldLike.key ?? fieldLike.field ?? null;
  if (!name) return null;
  return {
    name: String(name),
    label: normalizeSpanishLabel(fieldLike.label ?? String(name)),
    type: fieldLike.type ?? "text",
    icon:
      typeof fieldLike.icon === "string" && fieldLike.icon.trim()
        ? fieldLike.icon.trim()
        : null,
    options: Array.isArray(fieldLike.options) ? fieldLike.options : null,
    visibleWhen: fieldLike.visibleWhen ?? null,
    hiddenWhen: fieldLike.hiddenWhen ?? null,
    accept: fieldLike.accept ?? null,
    signedUrlPath: fieldLike.signedUrlPath ?? null,
    urlField: fieldLike.urlField ?? null,
  };
}

function normalizeSectionField(item) {
  if (typeof item === "string") {
    const key = String(item).trim();
    if (!key) return null;
    // No default type: let normalizeSections preserve the existing type from fieldMap
    // (e.g. "markdown" from the form blueprint) instead of overwriting with "text".
    return {
      name: key,
      field: { name: key, label: key, icon: null },
    };
  }
  const normalized = normalizeField(item);
  if (!normalized) return null;
  return { name: normalized.name, field: normalized };
}

function normalizeFieldMap(fields) {
  const map = new Map();
  for (const entry of Array.isArray(fields) ? fields : []) {
    const normalized = normalizeField(entry);
    if (!normalized) continue;
    map.set(normalized.name, normalized);
  }
  return map;
}

function normalizeRelationCardConfig(config, sectionTitle) {
  if (!config || typeof config !== "object") return null;
  const subtitleFields = (
    Array.isArray(config.subtitleFields) ? config.subtitleFields : []
  )
    .map((field) => (typeof field === "string" ? field.trim() : ""))
    .filter(Boolean);

  const subtitleTypes = Array.isArray(config.subtitleTypes)
    ? config.subtitleTypes.map((t) => (typeof t === "string" ? t.trim() : ""))
    : [];

  const contactActions = (
    Array.isArray(config.contactActions) ? config.contactActions : []
  )
    .map((action) =>
      action && typeof action === "object" && typeof action.field === "string" && action.field.trim()
        ? {
            type: typeof action.type === "string" ? action.type.trim() : null,
            field: action.field.trim(),
            label: typeof action.label === "string" ? action.label.trim() : null,
          }
        : null,
    )
    .filter(Boolean);

  return {
    idField:
      typeof config.idField === "string" && config.idField.trim()
        ? config.idField.trim()
        : null,
    titleField:
      typeof config.titleField === "string" && config.titleField.trim()
        ? config.titleField.trim()
        : null,
    subtitleFields,
    subtitleTypes,
    fallbackTitle: normalizeSpanishLabel(
      config.fallbackTitle ??
        `No hay ${sectionTitle?.toLowerCase() ?? "relación"}.`,
    ),
    hrefTemplate:
      typeof config.hrefTemplate === "string" && config.hrefTemplate.trim()
        ? config.hrefTemplate.trim()
        : null,
    icon:
      typeof config.icon === "string" && config.icon.trim()
        ? config.icon.trim()
        : null,
    avatarField:
      typeof config.avatarField === "string" && config.avatarField.trim()
        ? config.avatarField.trim()
        : null,
    // 'user': resolve via /identity/users/:id/avatar/signed-url (idField's
    // value) instead of the generic files route avatarField would use.
    avatarKind:
      typeof config.avatarKind === "string" && config.avatarKind.trim()
        ? config.avatarKind.trim()
        : null,
    contactActions,
  };
}

function normalizeRelationListConfig(config) {
  if (!config || typeof config !== "object") return null;
  const subtitleFields = (
    Array.isArray(config.subtitleFields) ? config.subtitleFields : []
  )
    .map((field) => (typeof field === "string" ? field.trim() : ""))
    .filter(Boolean);

  const subtitleLabels = Array.isArray(config.subtitleLabels)
    ? config.subtitleLabels.map((l) => (typeof l === "string" ? l.trim() : ""))
    : [];

  const subtitleTypes = Array.isArray(config.subtitleTypes)
    ? config.subtitleTypes.map((t) => (typeof t === "string" ? t.trim() : ""))
    : [];

  return {
    apiPath:
      typeof config.apiPath === "string" && config.apiPath.trim()
        ? config.apiPath.trim()
        : null,
    idField:
      typeof config.idField === "string" && config.idField.trim()
        ? config.idField.trim()
        : "id",
    titleField:
      typeof config.titleField === "string" && config.titleField.trim()
        ? config.titleField.trim()
        : null,
    subtitleFields,
    subtitleLabels,
    subtitleTypes,
    hrefTemplate:
      typeof config.hrefTemplate === "string" && config.hrefTemplate.trim()
        ? config.hrefTemplate.trim()
        : null,
    icon:
      typeof config.icon === "string" && config.icon.trim()
        ? config.icon.trim()
        : null,
    emptyMessage: normalizeSpanishLabel(
      config.emptyMessage ?? "No hay registros relacionados.",
    ),
  };
}

function normalizeSections(schema, fieldMap) {
  let rawSections = Array.isArray(schema?.sections) ? schema.sections : [];

  // When no sections are defined (e.g. a TABLE blueprint used as detail fallback),
  // auto-generate a flat section from the `columns` definition so the detail renders
  // something meaningful instead of showing the "Detalle sin secciones" warning.
  if (
    rawSections.length === 0 &&
    Array.isArray(schema?.columns) &&
    schema.columns.length > 0
  ) {
    rawSections = [
      {
        fields: schema.columns
          .filter((col) => col.field && !col.hidden)
          .map((col) => ({
            name: col.field,
            label: col.label ?? col.field,
            type: col.type ?? "text",
          })),
      },
    ];
  }

  return rawSections
    .map((entry, sectionIndex) => {
      if (!entry || typeof entry !== "object") return null;
      const sectionType =
        typeof entry.type === "string" && entry.type.trim()
          ? entry.type.trim().toLowerCase()
          : "fields";

      const sectionTitle =
        (entry.title ?? entry.label)
          ? normalizeSpanishLabel(entry.title ?? entry.label)
          : null;

      const sectionIcon =
        typeof entry.icon === "string" && entry.icon.trim()
          ? entry.icon.trim()
          : null;

      if (sectionType === "documents" || sectionType === "attachments") {
        const attachmentsConfig =
          sectionType === "attachments"
            ? (entry.attachments ?? null)
            : (entry.documents ?? null);
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: sectionTitle,
          type: "attachments",
          icon: sectionIcon,
          column: normalizeSectionColumn(entry.column),
          attachments: attachmentsConfig,
        };
      }

      if (sectionType === "relation-card") {
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: sectionTitle,
          type: "relation-card",
          icon: sectionIcon,
          column: normalizeSectionColumn(entry.column),
          relationCard: normalizeRelationCardConfig(
            entry.relationCard,
            sectionTitle,
          ),
        };
      }

      if (sectionType === "relation-list") {
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: sectionTitle,
          type: "relation-list",
          icon: sectionIcon,
          column: normalizeSectionColumn(entry.column),
          relationList: normalizeRelationListConfig(entry.relationList),
        };
      }

      if (sectionType === "component") {
        return normalizeComponentSection(entry, sectionIndex, sectionTitle, sectionIcon);
      }

      // Built-in audit trail of the record (spec 2026-10-03-audit-trail-design).
      if (sectionType === "audit") {
        return {
          id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
          title: sectionTitle ?? "Historial de cambios",
          type: "audit",
          icon: sectionIcon ?? "History",
          column: normalizeSectionColumn(entry.column),
          tab: entry.tab ?? null,
          audit: { entityType: entry.audit?.entityType ?? null },
        };
      }

      const fieldDefs = (Array.isArray(entry.fields) ? entry.fields : [])
        .map((item) => normalizeSectionField(item))
        .filter(Boolean);

      const fieldNames = [];
      for (const fieldDef of fieldDefs) {
        const name = fieldDef.name;
        if (!fieldMap.has(name)) {
          fieldMap.set(name, fieldDef.field);
        } else {
          const existing = fieldMap.get(name);
          fieldMap.set(name, {
            ...existing,
            label: fieldDef.field.label ?? existing?.label ?? name,
            type: fieldDef.field.type ?? existing?.type ?? "text",
            icon: fieldDef.field.icon ?? existing?.icon ?? null,
            options: fieldDef.field.options ?? existing?.options ?? null,
            accept: fieldDef.field.accept ?? existing?.accept ?? null,
            signedUrlPath: fieldDef.field.signedUrlPath ?? existing?.signedUrlPath ?? null,
            urlField: fieldDef.field.urlField ?? existing?.urlField ?? null,
          });
        }
        if (!fieldNames.includes(name)) fieldNames.push(name);
      }

      const cols = Number(entry.columns);
      const columns = cols === 1 ? 1 : cols === 2 ? 2 : "auto";

      return {
        id: entry.id ?? entry.key ?? `section-${sectionIndex}`,
        title: sectionTitle,
        type: "fields",
        columns,
        icon: sectionIcon,
        column: normalizeSectionColumn(entry.column),
        fields: fieldNames,
      };
    })
    .map((section, i) => {
      if (!section) return null;
      const withTab = {
        ...section,
        ...(typeof rawSections[i]?.tab === "string" ? { tab: rawSections[i].tab } : {}),
        ...(rawSections[i]?.visibleWhen ? { visibleWhen: rawSections[i].visibleWhen } : {}),
      };
      return withCollapseConfig(withTab, rawSections[i]);
    })
    .filter(Boolean);
}

// Optional per-section collapse: `collapsible: true` renders a toggle header;
// `defaultCollapsed` is true | false | "mobile" (collapsed only below lg).
function withCollapseConfig(section, entry) {
  const dc = entry?.defaultCollapsed;
  const collapsible = entry?.collapsible === true || dc === true || dc === "mobile";
  if (!collapsible) return section;
  return {
    ...section,
    collapsible: true,
    defaultCollapsed: dc === "mobile" ? "mobile" : dc === true,
  };
}

function renderValue(field, value, record = {}) {
  if (value === undefined || value === null || value === "") return "—";
  if (field?.type === "boolean") return value ? "Sí" : "No";

  if (field?.type === "date") return formatDetailDate(value, false);
  if (field?.type === "datetime") return formatDetailDate(value, true);

  if (field?.type === "currency" || field?.type === "decimal") {
    return formatDetailCurrency(value, record.currency);
  }

  if (field?.type === "number" || field?.type === "integer") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat("es-MX").format(n);
  }

  if (field?.type === "select" && Array.isArray(field?.options)) {
    const str = String(value);
    const options = normalizeSelectOptions(field.options);
    const found = options.find((o) => String(o.value) === str);
    // Every option renders as a pill (stable accent unless it declares a
    // color); `emphasis` (hero KPIs that are the record's key state) makes it
    // solid and larger.
    const opt = found && { ...found, color: resolveColorHex(found.color) ?? accentFor({ options }, value) };
    if (opt?.label) {
      return field.emphasis ? (
        <span
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold text-white shadow-sm ring-2 ring-offset-1 ring-offset-[hsl(var(--card))]"
          style={{ backgroundColor: opt.color, "--tw-ring-color": `${opt.color}55` }}
        >
          <span className="h-2 w-2 rounded-full bg-white/90" />
          {opt.label}
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{ color: opt.color, backgroundColor: `${opt.color}1f` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: opt.color }} />
          {opt.label}
        </span>
      );
    }
  }

  if (field?.type === "color") {
    const colorStr = String(value);
    const hex = resolveColorHex(colorStr);
    const displayName = colorStr.startsWith("#") ? colorStr : colorStr;
    return (
      <span className="inline-flex items-center gap-2">
        {hex && (
          <span
            className="inline-block h-4 w-4 rounded-full border border-[hsl(var(--border))] shadow-sm shrink-0"
            style={{ backgroundColor: hex }}
          />
        )}
        <span>{displayName}</span>
      </span>
    );
  }

  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  const lower = str.toLowerCase();
  const label = STATUS_LABELS[lower];
  if (label) {
    const chipClass =
      STATUS_COLORS[lower] ??
      "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
    return (
      <span
        className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${chipClass}`}
      >
        {label}
      </span>
    );
  }
  return str;
}

function gridClass(columns) {
  if (columns === 1) return "grid gap-4";
  if (columns === 2) return "grid gap-4 md:grid-cols-2";
  if (columns === 3) return "grid gap-4 md:grid-cols-3";
  return "grid gap-4 lg:grid-cols-2";
}


function FieldLabel({ field }) {
  // Explicit blueprint icon first, else one inferred from the field.
  const Icon = resolveIcon(field?.icon) ?? resolveFieldIcon({ ...field, icon: null });

  if (!Icon) {
    return <>{field.label}</>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={13} />
      {field.label}
    </span>
  );
}

export function RunlyDetail({
  blueprint,
  fields,
  data: dataProp,
  loading = false,
  onEdit,
  onBack,
  heroActions,
  token,
  apiBaseUrl,
  companyId = null,
  componentRegistry = null,
  onAttachmentsChange,
  // Screen-owned content (connection sections, canvas references, ...)
  // appended inside the main / aside column instead of a full-width row
  // under the whole detail. Single-column layouts append both in order.
  mainExtra = null,
  asideExtra = null,
}) {
  const schema = blueprint?.schema ?? {};
  const fieldMap = useMemo(() => normalizeFieldMap(fields), [fields]);
  const sections = useMemo(
    () => normalizeSections(schema, fieldMap),
    [schema, fieldMap],
  );
  // loading=true + no data yet: fall back to {} so the section/hero shell
  // (the .glass-shell-flat divs below) renders immediately with blank ("—")
  // field values, instead of this whole tree being swapped in for the first
  // time only once real data arrives. That swap — a totally different
  // component (e.g. a caller's <LoadingState/>) being replaced by this one —
  // is what caused a backdrop-filter "first paint" flash: Chromium briefly
  // renders a freshly-created blurred layer blank/white before it has
  // sampled real content behind it. Callers that pass `loading` and always
  // render <RunlyDetail/> (rather than conditionally swapping it in) keep
  // the same glass layers mounted across the loading→loaded transition, so
  // there's nothing left to freshly paint once data lands — see the
  // "glassic flicker" bug report. Callers that never pass `loading` (the
  // default) get byte-for-byte the original behavior below.
  const data =
    loading && (!dataProp || typeof dataProp !== "object") ? {} : dataProp;
  const heroModel = useMemo(
    () =>
      data && typeof data === "object"
        ? resolveHeroModel(schema, data, fieldMap)
        : null,
    [schema, data, fieldMap],
  );
  const kpiItems = useMemo(
    () => (data && typeof data === "object" ? resolveKpis(schema, data) : []),
    [schema, data],
  );
  const allTabs = useMemo(() => resolveSchemaTabs(schema), [schema]);
  const tabs = useMemo(
    () => allTabs.filter((tab) => isElementVisible(tab, data ?? {})),
    [allTabs, data],
  );
  const [activeTab, setActiveTab] = useState(null);
  const currentTab = tabs.some((tab) => tab.key === activeTab) ? activeTab : (tabs[0]?.key ?? null);
  const visibleSections = useMemo(() => {
    const shown = filterVisibleSections(sections, allTabs, data ?? {}, tabOfSection);
    return allTabs.length ? shown.filter((section) => tabOfSection(section, allTabs) === currentTab) : shown;
  }, [sections, allTabs, data, currentTab]);
  const { twoColumn, main: mainSections, aside: asideSections, full: fullSections } = useMemo(
    () => splitSectionsByColumn(visibleSections, schema?.layout),
    [visibleSections, schema?.layout],
  );

  if (!loading && (!data || typeof data !== "object")) {
    return (
      <Alert variant="warning">
        <AlertTitle>Sin información</AlertTitle>
        <AlertDescription>
          No hay datos para mostrar en el detalle.
        </AlertDescription>
      </Alert>
    );
  }

  const fallbackActions =
    onBack || onEdit ? (
      <>
        {onBack && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onBack?.()}
          >
            Volver
          </Button>
        )}
        {onEdit && (
          <Button type="button" size="sm" onClick={() => onEdit?.(data)}>
            Editar
          </Button>
        )}
      </>
    ) : null;

  // Diff labels for the audit section come from the blueprint's own fields.
  const auditLabels = Object.fromEntries(
    [...fieldMap.entries()].map(([name, field]) => [name, { label: field?.label ?? name, type: field?.type ?? null, options: field?.options ?? null }]),
  );

  const renderSection = (section) => (
    <DetailSectionShell
      key={section.id}
      section={section}
      className={cn(
        section.type === "fields" &&
          "border-l-2 border-l-(--brand-primary) shadow-[inset_10px_0_16px_-14px_var(--brand-primary)]",
      )}
    >

      {section.type === "attachments" ? (
        <AttachmentsPanel
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
          recordId={data?.id ?? null}
          config={section.attachments ?? {}}
          context="detail"
          readOnly
          showHeading={false}
          onChange={onAttachmentsChange}
        />
      ) : null}

      {section.type === "relation-card" ? (
        <RelationCardSection
          section={section}
          data={data}
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
        />
      ) : null}

      {section.type === "relation-list" ? (
        <RelationListSection
          section={section}
          data={data}
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
        />
      ) : null}

      {section.type === "audit" ? (
        <AuditTrail
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
          entityType={section.audit?.entityType ?? schema?.entity}
          entityId={data?.id ?? null}
          changeLabels={auditLabels}
        />
      ) : null}

      {section.type === "component" ? (() => {
        const Comp = componentRegistry?.resolve?.(section.component) ?? null;
        if (!Comp) {
          return (
            <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
              Componente "{section.component}" no está registrado.
            </div>
          );
        }
        return (
          <Comp data={data} apiBaseUrl={apiBaseUrl} token={token} companyId={companyId} />
        );
      })() : null}

      {section.type === "fields" ? (
        <div className="space-y-4">
          <dl className={gridClass(section.columns)}>
            {section.fields.map((fieldName) => {
              const field = fieldMap.get(fieldName);
              if (!field) return null;
              if (
                field.visibleWhen &&
                !matchesFieldRule(field.visibleWhen, data)
              )
                return null;
              if (field.hiddenWhen && matchesFieldRule(field.hiddenWhen, data))
                return null;
              const value = data[field.name];
              const isMarkdown = field.type === "markdown";
              const strValue =
                value != null && value !== "" ? String(value) : null;
              return (
                <div
                  key={field.name}
                  className={`space-y-1.5${isMarkdown ? " col-span-full" : ""}`}
                >
                  <dt className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    <FieldLabel field={field} />
                  </dt>
                  <dd className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {isMarkdown ? (
                      strValue ? (
                        <MarkdownViewer value={strValue} />
                      ) : (
                        <span className="text-[hsl(var(--muted-foreground))]">
                          —
                        </span>
                      )
                    ) : field.type === "external-link" && value ? (
                      // Record of another module (relation-targets): label + link to its own detail.
                      data[field.urlField] ? (
                        <a href={data[field.urlField]} className="text-(--brand-primary) hover:underline">{String(value)}</a>
                      ) : (
                        <span>{String(value)}</span>
                      )
                    ) : field.type === "file-asset" ? (
                      <FileAssetValue
                        value={value}
                        accept={field.accept ?? "any"}
                        signedUrlPath={field.signedUrlPath}
                        apiBaseUrl={apiBaseUrl}
                        token={token}
                        companyId={companyId}
                      />
                    ) : (
                      renderValue(field, value, data)
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {section.fields.includes("labor_cost") &&
          section.fields.includes("parts_cost") &&
          section.fields.includes("total_cost") ? (
            <CostsSummaryPanel
              laborCost={data.labor_cost ?? 0}
              partsCost={data.parts_cost ?? 0}
              totalCost={data.total_cost ?? 0}
            />
          ) : null}
        </div>
      ) : null}
    </DetailSectionShell>
  );

  return (
    <div className="space-y-6">
      {heroModel ? (
        <HeroContainer
          heroModel={heroModel}
          kpiItems={kpiItems}
          data={data}
          apiBaseUrl={apiBaseUrl}
          token={token}
          companyId={companyId}
          actions={heroActions ?? fallbackActions}
          renderValue={renderValue}
        />
      ) : (
        (onBack || onEdit) && (
          <div className="flex items-center justify-end gap-2">
            {onBack && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onBack?.()}
              >
                Volver
              </Button>
            )}
            {onEdit && (
              <Button type="button" onClick={() => onEdit?.(data)}>
                Editar
              </Button>
            )}
          </div>
        )
      )}

      <SchemaTabBar tabs={tabs} activeKey={currentTab} onChange={setActiveTab} />

      {sections.length === 0 && (
        <Alert variant="warning">
          <AlertTitle>Detalle sin secciones</AlertTitle>
          <AlertDescription>
            Esta vista no tiene <code>schema.sections</code> configurado.
          </AlertDescription>
        </Alert>
      )}

      {twoColumn ? (
        // The aside column keeps a 300px floor so file lists, thumbnails and
        // activity feeds never collapse to an unreadable width on narrow
        // lg viewports (sidebar open); the main column absorbs the squeeze.
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="min-w-0 space-y-6">
            {mainSections.map(renderSection)}
            {mainExtra}
          </div>
          <div className="min-w-0 space-y-6">
            {asideSections.map(renderSection)}
            {asideExtra}
          </div>
          {fullSections.length > 0 && (
            <div className="min-w-0 space-y-6 lg:col-span-2">
              {fullSections.map(renderSection)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {visibleSections.map(renderSection)}
          {mainExtra}
          {asideExtra}
        </div>
      )}
    </div>
  );
}
