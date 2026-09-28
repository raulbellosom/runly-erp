// Module Builder — "Diseño" preview rendered with the production RunlyForm /
// RunlyDetail, fed the exact schema the compiler will emit for the draft
// layout (buildLayoutFormSchema/buildLayoutDetailSchema). Side-effect free:
// submit is a no-op, relation fields are read-only (the module is not
// published yet, so their option endpoints do not exist).
import { useMemo } from "react";
import { RunlyDetail, RunlyForm } from "@runly/ui";
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

export function LayoutRealPreview({ moduleKey, entity, kind }) {
  const { blueprint, record } = useMemo(() => {
    const templateEntity = toLayoutTemplateEntity(moduleKey, entity);
    const config = { key: moduleKey };
    const schema = kind === "form" ? buildLayoutFormSchema(config, templateEntity) : buildLayoutDetailSchema(config, templateEntity);
    const sample = Object.fromEntries((entity.fields ?? []).map((field) => [field.key, sampleValue(field)]));
    return { blueprint: schema ? { key: `preview.${entity.key}.${kind}`, schema: previewOnly(schema) } : null, record: sample };
  }, [moduleKey, entity, kind]);

  if (!blueprint) return null;
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
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
        <RunlyDetail blueprint={blueprint} fields={[]} data={record} apiBaseUrl="" />
      )}
    </div>
  );
}
