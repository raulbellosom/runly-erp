// Module Builder — "Diseño" preview rendered with the production RunlyForm /
// RunlyDetail, fed the exact schema the compiler will emit for the draft
// layout (buildLayoutFormSchema/buildLayoutDetailSchema). Side-effect free:
// submit is a no-op, relation fields are read-only (the module is not
// published yet, so their option endpoints do not exist).
import { useMemo, useState } from "react";
import { RunlyDetail, RunlyForm, SelectField } from "@runly/ui";
import { toLocalIso } from "@runly/core";
import {
  buildLayoutDetailSchema,
  buildLayoutFormSchema,
  toLayoutTemplateEntity,
} from "@runly/module-compiler/layout-views";

function sampleValue(field) {
  switch (field.type) {
    case "number": return 12;
    case "decimal": return 1250.5;
    case "boolean": return true;
    case "select": return field.options?.[0]?.value ?? field.options?.[0] ?? null;
    case "multiselect": return [];
    case "date": return toLocalIso();
    case "datetime": return new Date().toISOString();
    case "email": return "correo@ejemplo.com";
    case "phone": return "5512345678";
    case "color": return "#2563EB";
    case "file":
    case "relation":
    case "json": return null;
    default: return `${field.label} de ejemplo`;
  }
}

function previewOnly(schema) {
  return {
    ...schema,
    sections: schema.sections.map((section) => (section.fields
      ? { ...section, fields: section.fields.map((field) => (field.type === "relation" ? { ...field, relation: undefined, readonly: true } : field)) }
      : section)),
  };
}

function collectRuleFields(layout) {
  const trees = [layout?.tabs ?? [], layout?.detail?.tabs ?? []];
  return trees.flat().flatMap((tab) => [
    tab.visibleWhen?.field,
    ...(tab.sections ?? []).flatMap((section) => [section.visibleWhen?.field, ...Object.values(section.fieldRules ?? {}).map((rule) => rule.field)]),
  ]).filter(Boolean);
}

function testOptions(field) {
  if (field.type === "boolean") return [{ value: "true", label: "Sí" }, { value: "false", label: "No" }];
  return (field.options ?? []).map((option) => (typeof option === "object"
    ? { value: String(option.value), label: option.label ?? String(option.value) }
    : { value: String(option), label: String(option) }));
}

function fromTestOption(field, value) {
  return field.type === "boolean" ? value === "true" : value;
}

export function LayoutRealPreview({ moduleKey, entities = [], entity, kind }) {
  const { blueprint, record } = useMemo(() => {
    const templateEntity = toLayoutTemplateEntity(moduleKey, entity);
    // Other entities resolve relation labels and related sections.
    const config = { key: moduleKey, entities: entities.map((item) => toLayoutTemplateEntity(moduleKey, item.key === entity.key ? entity : item)) };
    const schema = kind === "form" ? buildLayoutFormSchema(config, templateEntity) : buildLayoutDetailSchema(config, templateEntity);
    const sample = Object.fromEntries((entity.fields ?? []).map((field) => [field.key, sampleValue(field)]));
    return { blueprint: schema ? { key: `preview.${entity.key}.${kind}`, schema: previewOnly(schema) } : null, record: sample };
  }, [moduleKey, entities, entity, kind]);

  // Test values for the fields that drive visibility rules: the form already
  // reacts to its own inputs, the detail needs these to show/hide elements.
  const [overrides, setOverrides] = useState({});
  const ruleFields = useMemo(() => {
    const keys = new Set(collectRuleFields(entity.layout));
    return (entity.fields ?? []).filter((field) => keys.has(field.key));
  }, [entity]);
  const detailRecord = useMemo(() => ({ ...record, ...overrides }), [record, overrides]);

  if (!blueprint) return null;
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
      {kind === "detail" && ruleFields.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-[hsl(var(--muted))]/50 p-3">
          <span className="w-full text-xs font-medium text-[hsl(var(--muted-foreground))]">Valores de prueba</span>
          {ruleFields.map((field) => (
            <SelectField
              key={field.key}
              className="w-48"
              label={field.label}
              options={testOptions(field)}
              value={String(detailRecord[field.key] ?? "")}
              onValueChange={(value) => setOverrides((current) => ({ ...current, [field.key]: fromTestOption(field, value) }))}
            />
          ))}
        </div>
      )}
      {kind === "form" ? (
        <RunlyForm
          blueprint={blueprint}
          fields={[]}
          initialData={record}
          mode="edit"
          apiBaseUrl=""
          showFooter={false}
          submitRequest={async () => ({ data: record })}
        />
      ) : (
        <RunlyDetail blueprint={blueprint} fields={[]} data={detailRecord} apiBaseUrl="" />
      )}
    </div>
  );
}
