// Module Builder — Automatizaciones tab (spec
// docs/superpowers/specs/2026-10-04-builder-automations-design.md §4.5).
// Each card becomes a definition.automations item compiled by
// @runly/module-compiler: when a record of this module is saved (or a system
// event happens), call one service of a system module.
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, SelectField, SwitchField, TextField } from "@runly/ui";
import { Equal, Plus, Trash2, Zap } from "lucide-react";
import { MAX_AUTOMATIONS, SERVICE_CONTRACTS, automationEvents, automationServices } from "@runly/module-compiler/browser";
import { AutomationArgsEditor } from "./AutomationArgsEditor";

const OWNER_LABELS = {
  "runly.calendar": "Calendario", "runly.files": "Archivos", "runly.notifications": "Notificaciones", "runly.contacts": "Contactos",
  "runly.inventory": "Inventario", "runly.projects": "Proyectos", "runly.ledger": "Libro de cuentas", "runly.fleet": "Flota", "runly.pfm": "Finanzas personales",
};
const TRIGGER_TYPES = [
  { value: "record", label: "Cuando se guarda un registro de este módulo" },
  { value: "event", label: "Cuando pasa algo en otro módulo" },
];
const ON_OPTIONS = [
  { value: "create", label: "Al crear" },
  { value: "update", label: "Al actualizar" },
  { value: "save", label: "Al crear o actualizar" },
];
const OP_OPTIONS = [
  { value: "equals", label: "Es igual a" },
  { value: "changed", label: "Cambió" },
  { value: "filled", label: "Tiene valor" },
];

const keyOf = (item) => item.key ?? item.name;
const serviceLabel = (key, label) => `${OWNER_LABELS[key.split(":")[0]] ?? key.split(":")[0]} · ${label}`;

function uniqueKey(taken) {
  let index = taken.size + 1;
  while (taken.has(`automatizacion_${index}`)) index += 1;
  return `automatizacion_${index}`;
}

function TriggerEditor({ automation, entities, events, readOnly, onPatch }) {
  const trigger = automation.trigger;
  const entity = entities.find((item) => keyOf(item) === trigger.entity);
  const fieldOptions = trigger.type === "event"
    ? (events.find((event) => event.key === trigger.event)?.payload ?? []).map((key) => ({ value: key, label: key }))
    : (entity?.fields ?? []).map((field) => ({ value: keyOf(field), label: field.label ?? keyOf(field) }));
  const when = trigger.when;
  const ops = OP_OPTIONS.filter((op) => op.value !== "changed" || (trigger.type === "record" && trigger.on !== "create"));
  const setTrigger = (patch) => onPatch({ trigger: { ...trigger, ...patch } });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Cuándo" options={TRIGGER_TYPES} value={trigger.type} disabled={readOnly}
          onValueChange={(type) => onPatch({
            trigger: type === "record" ? { type, entity: keyOf(entities[0] ?? {}), on: "create" } : { type, event: events[0]?.key },
            // Event triggers only allow services that run without a person.
            action: { service: "", args: {} },
          })} />
        {trigger.type === "record" ? (
          <>
            <SelectField label="Entidad" options={entities.map((item) => ({ value: keyOf(item), label: item.label ?? keyOf(item) }))}
              value={trigger.entity ?? ""} disabled={readOnly}
              onValueChange={(value) => onPatch({ trigger: { type: "record", entity: value, on: trigger.on }, action: { ...automation.action, args: {} } })} />
            <SelectField label="Momento" options={ON_OPTIONS} value={trigger.on} disabled={readOnly}
              onValueChange={(on) => setTrigger({ on, ...(on === "create" && when?.op === "changed" ? { when: undefined } : {}) })} />
          </>
        ) : (
          <SelectField label="Evento" options={events.map((event) => ({ value: event.key, label: event.label }))}
            value={trigger.event ?? ""} disabled={readOnly}
            onValueChange={(event) => onPatch({ trigger: { type: "event", event }, action: { ...automation.action, args: {} } })} />
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Solo si" options={[{ value: "none", label: "Siempre" }, ...fieldOptions]} value={when?.field ?? "none"} disabled={readOnly}
          onValueChange={(field) => setTrigger({ when: field === "none" ? undefined : { field, op: when?.op ?? "filled", ...(when?.value !== undefined ? { value: when.value } : {}) } })} />
        {when && (
          <SelectField label="Condición" options={ops} value={when.op} disabled={readOnly}
            onValueChange={(op) => setTrigger({ when: op === "equals" ? { ...when, op, value: when.value ?? "" } : { field: when.field, op } })} />
        )}
        {when?.op === "equals" && (
          <TextField label="Valor" icon={Equal} value={String(when.value ?? "")} disabled={readOnly}
            onChange={(e) => setTrigger({ when: { ...when, value: e.target.value } })} />
        )}
      </div>
    </div>
  );
}

function AutomationCard({ automation, entities, events, readOnly, onPatch, onRemove }) {
  const trigger = automation.trigger;
  const services = useMemo(() => automationServices({ trigger: trigger.type }), [trigger.type]);
  const contract = SERVICE_CONTRACTS[automation.action.service];
  const entity = entities.find((item) => keyOf(item) === trigger.entity);
  const fieldOptions = trigger.type === "event"
    ? (events.find((event) => event.key === trigger.event)?.payload ?? []).map((key) => ({ value: key, label: key }))
    : (entity?.fields ?? []).map((field) => ({ value: keyOf(field), label: field.label ?? keyOf(field) }));

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Zap className="h-4 w-4 text-[--color-primary]" />
            <span className="font-medium">{automation.label || "Automatización"}</span>
            {automation.enabled === false && <Badge variant="outline">Pausada</Badge>}
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{automation.key}</span>
          </div>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Quitar automatización">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField label="Nombre" required value={automation.label ?? ""} disabled={readOnly} maxLength={120}
            onChange={(e) => onPatch({ label: e.target.value })} />
          <SwitchField label="Activa" checked={automation.enabled !== false} disabled={readOnly} onChange={(enabled) => onPatch({ enabled })} />
        </div>
        <TriggerEditor automation={automation} entities={entities} events={events} readOnly={readOnly} onPatch={onPatch} />
        <SelectField label="Qué hacer" options={services.map((service) => ({ value: service.key, label: serviceLabel(service.key, service.label) }))}
          value={automation.action.service ?? ""} disabled={readOnly} placeholder="Elige una acción"
          onValueChange={(service) => onPatch({ action: { service, args: {} } })} />
        {trigger.type === "event" && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Desde un evento no hay una persona que guarde, por eso solo aparecen las acciones que pueden correr en segundo plano.
          </p>
        )}
        <AutomationArgsEditor contract={contract} args={automation.action.args ?? {}} triggerType={trigger.type} fieldOptions={fieldOptions}
          readOnly={readOnly} onChange={(args) => onPatch({ action: { ...automation.action, args } })} />
      </CardContent>
    </Card>
  );
}

export function AutomationsTab({ definition, onChange, readOnly }) {
  const automations = definition.automations ?? [];
  const entities = definition.entities ?? [];
  const events = useMemo(() => automationEvents(), []);
  const [removeIndex, setRemoveIndex] = useState(null);
  const used = [...new Set(automations.map((automation) => automation.action.service).filter(Boolean))];

  const setAutomations = (update) => onChange((current) => {
    const next = update(current.automations ?? []);
    const copy = { ...current };
    if (next.length) copy.automations = next; else delete copy.automations;
    return copy;
  });
  const patchAutomation = (index, patch) => setAutomations((list) => list.map((automation, i) => {
    if (i !== index) return automation;
    const merged = { ...automation, ...patch };
    if (merged.trigger?.when === undefined) delete merged.trigger?.when;
    return merged;
  }));
  const addAutomation = () => setAutomations((list) => [...list, {
    key: uniqueKey(new Set(list.map((automation) => automation.key))),
    label: "Nueva automatización",
    enabled: true,
    trigger: { type: "record", entity: keyOf(entities[0] ?? {}), on: "create" },
    action: { service: "", args: {} },
  }]);

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          Haz que este módulo trabaje con los demás sin programar: al guardar un registro (o cuando algo pasa en otro módulo) crea un evento de calendario, envía una notificación, guarda un contacto, registra un movimiento y más.
        </p>
        {!readOnly && (
          <Button onClick={addAutomation} disabled={automations.length >= MAX_AUTOMATIONS || !entities.length}>
            <Plus className="mr-1 h-4 w-4" /> Nueva automatización
          </Button>
        )}
      </div>
      {used.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-sm">
          <p className="font-medium">Este módulo usará</p>
          <ul className="mt-1 list-disc pl-5 text-[hsl(var(--muted-foreground))]">
            {used.map((key) => <li key={key}>{serviceLabel(key, SERVICE_CONTRACTS[key]?.label ?? key)}</li>)}
          </ul>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Al publicar quedan autorizados si puedes administrar módulos; si no, un administrador debe autorizarlos en Módulos.
          </p>
        </div>
      )}
      {automations.length === 0 ? (
        <EmptyState icon={Zap} title="Sin automatizaciones" description="Crea una para que este módulo agende, notifique o registre información en otros módulos al guardar." />
      ) : automations.map((automation, index) => (
        <AutomationCard
          key={automation.key}
          automation={automation}
          entities={entities}
          events={events}
          readOnly={readOnly}
          onPatch={(patch) => patchAutomation(index, patch)}
          onRemove={() => setRemoveIndex(index)}
        />
      ))}
      <ConfirmDialog
        open={removeIndex !== null}
        onOpenChange={(open) => !open && setRemoveIndex(null)}
        title="Quitar automatización"
        description="Al publicar dejará de ejecutarse. Lo que ya creó en otros módulos se conserva."
        confirmLabel="Quitar"
        onConfirm={() => { setAutomations((list) => list.filter((_, i) => i !== removeIndex)); setRemoveIndex(null); }}
      />
    </div>
  );
}
