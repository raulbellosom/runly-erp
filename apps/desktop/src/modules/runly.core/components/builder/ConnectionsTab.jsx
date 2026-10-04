// Module Builder — Conexiones tab: "Conectar a un módulo del sistema" (spec
// docs/superpowers/specs/2026-10-03-rme3-module-platform-v2-design.md §15.1).
// Each entry becomes a manifest `connections` item compiled by
// @runly/module-compiler (connections.js): this module's fields shown and
// saved inside a core record (Inventario, Contactos, RR. HH., Proyectos).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge, Button, Card, CardContent, Checkbox, ConfirmDialog, EmptyState, SelectField, TextField,
} from "@runly/ui";
import { Link2, Plug, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../../auth/AuthProvider";
import { runly } from "../../../../lib/runly";
import { addField, updateField } from "../../lib/builderHelpers";

// Mirrors BUILDER_CONNECTION_TARGETS in packages/module-compiler/src/connections.js.
const TARGETS = [
  { value: "inventory_item", label: "Inventario · Artículo" },
  { value: "contact", label: "Contactos · Contacto" },
  { value: "hr_employee", label: "Recursos humanos · Colaborador" },
  { value: "project", label: "Proyectos · Proyecto" },
];
const KIND_OPTIONS = [
  { value: "fields", label: "Campos extra (uno por registro)" },
  { value: "related", label: "Registros relacionados (varios por registro)" },
];
const DELETE_OPTIONS = [
  { value: "setNull", label: "Conservar mis registros sin vínculo" },
  { value: "cascade", label: "Eliminar también mis registros" },
  { value: "restrict", label: "Impedir la eliminación" },
];
const SURFACES = [
  { key: "form", label: "Formulario", kinds: ["fields"] },
  { key: "detail", label: "Detalle", kinds: ["fields", "related"] },
  { key: "column", label: "Columna", kinds: ["fields"] },
  { key: "search", label: "Búsqueda", kinds: ["fields", "related"] },
];
const EXCLUDED_TYPES = new Set(["file", "json"]);
const MAX_CONNECTIONS = 10;

const keyOf = (item) => item.key ?? item.name;

function uniqueConnectionKey(entityKey, target, taken) {
  const base = `${entityKey}_${target}`.slice(0, 36);
  let key = base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
  return key;
}

function OfferedFields({ connection, entity, readOnly, onPatch }) {
  const surfaces = SURFACES.filter((surface) => surface.kinds.includes(connection.kind));
  const candidates = (entity?.fields ?? []).filter((field) => keyOf(field) !== connection.targetField && !EXCLUDED_TYPES.has(field.type));
  const offered = new Map((connection.fields ?? []).map((field) => [field.field, field]));

  function toggle(fieldKey, surface) {
    const current = offered.get(fieldKey) ?? { field: fieldKey };
    const next = { ...current, [surface]: !current[surface] };
    const active = surfaces.some((s) => next[s.key]);
    const order = candidates.map(keyOf);
    const rest = (connection.fields ?? []).filter((field) => field.field !== fieldKey);
    const fields = (active ? [...rest, next] : rest).sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
    onPatch({ fields });
  }

  if (!candidates.length) {
    return <p className="text-xs text-[hsl(var(--muted-foreground))]">Agrega campos a la entidad para ofrecerlos en el módulo del sistema.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Campos que ofreces y dónde se ven</p>
      <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
        <table className="w-full text-sm">
          <thead className="bg-[hsl(var(--muted))]/50 text-xs text-[hsl(var(--muted-foreground))]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Campo</th>
              {surfaces.map((surface) => <th key={surface.key} className="px-3 py-2 text-center font-medium">{surface.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {candidates.map((field) => (
              <tr key={keyOf(field)} className="border-t border-[hsl(var(--border))]">
                <td className="px-3 py-2">{field.label ?? keyOf(field)}</td>
                {surfaces.map((surface) => (
                  <td key={surface.key} className="px-3 py-2">
                    <div className="flex justify-center">
                      <Checkbox
                        aria-label={`${field.label ?? keyOf(field)}: ${surface.label}`}
                        checked={offered.get(keyOf(field))?.[surface.key] === true}
                        disabled={readOnly}
                        onCheckedChange={() => toggle(keyOf(field), surface.key)}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        El administrador de cada empresa activa la conexión en la pantalla Conexiones del módulo y solo puede reducir esta selección.
      </p>
    </div>
  );
}

function ConnectionCard({ connection, index, definition, catalog, readOnly, onPatch, onRemove, onCreateRelationField }) {
  const entities = definition.entities ?? [];
  const entity = entities.find((item) => keyOf(item) === connection.entity);
  const targetInfo = catalog.find((item) => item.type === connection.target);
  const relationFields = (entity?.fields ?? []).filter((field) => field.type === "relation" && field.targetExternal === connection.target);
  const targetLabel = TARGETS.find((target) => target.value === connection.target)?.label ?? connection.target;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Plug className="h-4 w-4 text-[--color-primary]" />
            <span className="font-medium">{connection.label || "Conexión"}</span>
            <Badge variant="outline">{connection.kind === "related" ? "Registros relacionados" : "Campos extra"}</Badge>
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{connection.key}</span>
          </div>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={() => onRemove(index)} aria-label="Quitar conexión">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Título de la sección" required value={connection.label ?? ""} disabled={readOnly}
            onChange={(e) => onPatch({ label: e.target.value })} />
          <SelectField label="Módulo del sistema" options={TARGETS} value={connection.target} disabled={readOnly}
            onValueChange={(target) => onPatch({ target, targetField: undefined })} />
          <SelectField label="Tipo" options={KIND_OPTIONS} value={connection.kind} disabled={readOnly}
            onValueChange={(kind) => onPatch(kind === "fields"
              ? { kind, onTargetDelete: undefined }
              : { kind, onTargetDelete: connection.onTargetDelete ?? "setNull", fields: (connection.fields ?? []).map(({ form, column, ...rest }) => rest).filter((f) => f.detail || f.search) })} />
          <SelectField label="Entidad de este módulo" options={entities.map((item) => ({ value: keyOf(item), label: item.label ?? keyOf(item) }))}
            value={connection.entity ?? ""} disabled={readOnly}
            onValueChange={(value) => onPatch({ entity: value, targetField: undefined, fields: [] })} />
        </div>
        {targetInfo && !targetInfo.installed && (
          <p className="text-xs text-[hsl(var(--destructive))]">El módulo {targetInfo.moduleName} no está instalado en esta instancia.</p>
        )}
        {entity && (
          <div className="grid gap-3 sm:grid-cols-2">
            {relationFields.length ? (
              <SelectField label="Campo que guarda el registro del sistema" options={relationFields.map((field) => ({ value: keyOf(field), label: field.label ?? keyOf(field) }))}
                value={connection.targetField ?? ""} disabled={readOnly}
                onValueChange={(value) => onPatch({ targetField: value, fields: (connection.fields ?? []).filter((f) => f.field !== value) })} />
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Campo que guarda el registro del sistema</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{entity.label} no tiene una relación con {targetLabel}.</p>
                {!readOnly && (
                  <Button size="sm" variant="outline" onClick={() => onCreateRelationField(connection)}>
                    <Link2 className="h-3.5 w-3.5" /> Crear campo de relación
                  </Button>
                )}
              </div>
            )}
            {connection.kind === "related" && (
              <SelectField label="Si se elimina el registro del sistema" options={DELETE_OPTIONS}
                value={connection.onTargetDelete ?? "setNull"} disabled={readOnly}
                onValueChange={(value) => onPatch({ onTargetDelete: value })} />
            )}
          </div>
        )}
        {entity && connection.targetField && (
          <OfferedFields connection={connection} entity={entity} readOnly={readOnly} onPatch={onPatch} />
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectionsTab({ definition, onChange, readOnly }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const connections = definition.connections ?? [];
  const [removeIndex, setRemoveIndex] = useState(null);
  const firstEntity = keyOf(definition.entities?.[0] ?? {});
  const catalogQuery = useQuery({
    queryKey: ["relation-targets", token],
    queryFn: () => runly.builder.listRelationTargets(token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });
  const catalog = catalogQuery.data?.data ?? [];

  const setConnections = (update) => onChange((current) => {
    const next = update(current.connections ?? []);
    const copy = { ...current };
    if (next.length) copy.connections = next; else delete copy.connections;
    return copy;
  });
  const patchConnection = (index, patch) => setConnections((list) => list.map((connection, i) => {
    if (i !== index) return connection;
    const merged = { ...connection, ...patch };
    for (const [prop, value] of Object.entries(merged)) if (value === undefined) delete merged[prop];
    return merged;
  }));
  const addConnection = () => setConnections((list) => {
    const target = "inventory_item";
    const entity = definition.entities?.[0];
    const relation = (entity?.fields ?? []).find((field) => field.type === "relation" && field.targetExternal === target);
    return [...list, {
      key: uniqueConnectionKey(firstEntity, target, new Set(list.map((c) => c.key))),
      target, kind: "fields", entity: firstEntity, label: entity?.label ?? "Conexión", fields: [],
      ...(relation ? { targetField: keyOf(relation) } : {}),
    }];
  });
  // Adds a relation field to the system entity and selects it; required for
  // "Campos extra" (one record per core record), optional for related records.
  const createRelationField = (index, connection) => onChange((current) => {
    const label = catalog.find((item) => item.type === connection.target)?.label
      ?? TARGETS.find((target) => target.value === connection.target)?.label.split(" · ").pop();
    let next = addField(current, connection.entity, { label, type: "relation" });
    const created = next.entities.find((e) => e.key === connection.entity)?.fields.at(-1);
    next = updateField(next, connection.entity, created.key, { targetExternal: connection.target, required: connection.kind === "fields" });
    return { ...next, connections: next.connections.map((c, i) => (i === index ? { ...c, targetField: created.key } : c)) };
  });

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          Muestra los datos de este módulo dentro de una ficha del sistema: campos extra que se guardan con el mismo botón Guardar del artículo, contacto, colaborador o proyecto, o una lista de registros relacionados en su detalle.
        </p>
        {!readOnly && (
          <Button onClick={addConnection} disabled={connections.length >= MAX_CONNECTIONS || !firstEntity}>
            <Plus className="mr-1 h-4 w-4" /> Conectar a un módulo del sistema
          </Button>
        )}
      </div>
      {connections.length === 0 ? (
        <EmptyState icon={Plug} title="Sin conexiones" description="Conecta una entidad para que sus datos aparezcan en Inventario, Contactos, Recursos humanos o Proyectos." />
      ) : connections.map((connection, index) => (
        <ConnectionCard
          key={connection.key}
          connection={connection}
          index={index}
          definition={definition}
          catalog={catalog}
          readOnly={readOnly}
          onPatch={(patch) => patchConnection(index, patch)}
          onRemove={setRemoveIndex}
          onCreateRelationField={(c) => createRelationField(index, c)}
        />
      ))}
      <ConfirmDialog
        open={removeIndex !== null}
        onOpenChange={(open) => !open && setRemoveIndex(null)}
        title="Quitar conexión"
        description="Al publicar, la sección dejará de mostrarse en el módulo del sistema. Los registros de este módulo se conservan."
        confirmLabel="Quitar"
        onConfirm={() => { setConnections((list) => list.filter((_, i) => i !== removeIndex)); setRemoveIndex(null); }}
      />
    </div>
  );
}
