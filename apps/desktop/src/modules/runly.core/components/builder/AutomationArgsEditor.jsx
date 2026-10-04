// Module Builder — argument mapping of one automation (spec
// docs/superpowers/specs/2026-10-04-builder-automations-design.md §4.1): for
// each argument the service contract declares, where its value comes from.
import { Badge, SelectField, TextField } from "@runly/ui";
import { AUTOMATIC_ARGS } from "@runly/module-compiler/browser";

const ARG_LABELS = {
  title: "Título", description: "Descripción", startAt: "Inicio", endAt: "Fin", allDay: "Todo el día", location: "Lugar",
  calendarId: "Calendario (id)", attendeeIds: "Invitados (ids de usuario)", reminderMinutes: "Recordatorios (minutos antes)",
  userIds: "Destinatarios", body: "Mensaje", link: "Enlace", priority: "Prioridad", name: "Nombre", type: "Tipo",
  email: "Correo", phone: "Teléfono", id: "Registro a cambiar (id)", status: "Estado", notes: "Notas", locationId: "Ubicación (id)",
  projectId: "Proyecto (id)", assigneeId: "Responsable (id)", dueDate: "Fecha límite", statusId: "Estado (id)",
  mimeType: "Tipo de archivo", contentBase64: "Contenido (base64)", shareWithCompany: "Compartir con la empresa",
  plate: "Matrícula", vehicleId: "Vehículo (id)", driver: "Chofer", color: "Color", brand: "Marca", model: "Modelo", year: "Año",
  insurer: "Aseguradora", policyNumber: "Número de póliza", coverageType: "Cobertura", startDate: "Inicio de vigencia",
  expiryDate: "Vencimiento", premium: "Prima", currency: "Moneda", policyId: "Póliza (id)",
  accountId: "Cuenta (id)", accountName: "Cuenta (nombre)", fecha: "Fecha", nombre: "Nombre", referencia: "Referencia",
  concepto: "Concepto", numero: "Número", deposito: "Depósito", retiro: "Retiro", categoryId: "Categoría (id)", transactionId: "Movimiento (id)",
  wallet: "Cartera (nombre o id)", direction: "Tipo de movimiento", amount: "Monto", occurredOn: "Fecha", category: "Categoría",
  merchant: "Comercio", note: "Nota", movementId: "Movimiento (id)",
};

export const argLabel = (name) => ARG_LABELS[name] ?? name;

function sourceOptions({ required, triggerType }) {
  return [
    ...(required ? [] : [{ value: "none", label: "No usar" }]),
    { value: "value", label: "Valor fijo" },
    { value: "field", label: triggerType === "event" ? "Dato del evento" : "Campo del registro" },
    { value: "template", label: "Texto con campos" },
    { value: "recordId", label: triggerType === "event" ? "Id del registro del sistema" : "Id del registro" },
    ...(triggerType === "record" ? [{ value: "actor", label: "Usuario que guarda" }] : []),
  ];
}

// Literal values are edited as text and converted to the contract type.
function toLiteral(spec, text) {
  if (text === "") return undefined;
  if (spec.type === "number" || spec.type === "integer") return Number(text);
  if (spec.type.endsWith("[]")) {
    const items = text.split(",").map((item) => item.trim()).filter(Boolean);
    return spec.type === "integer[]" ? items.map(Number) : items;
  }
  return text;
}
const fromLiteral = (value) => (Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value));

function ValueInput({ name, spec, source, fieldOptions, readOnly, onSource }) {
  const label = `Valor de ${argLabel(name).toLowerCase()}`;
  if (source.from === "field") {
    return <SelectField aria-label={label} options={fieldOptions} value={source.field ?? ""} disabled={readOnly} placeholder="Elige un campo"
      onValueChange={(field) => onSource({ from: "field", field })} />;
  }
  if (source.from === "template") {
    return <TextField aria-label={label} value={source.template ?? ""} disabled={readOnly} placeholder="Ej. Visita {{folio}}"
      onChange={(e) => onSource({ from: "template", template: e.target.value })} />;
  }
  if (source.from !== "value") return <p className="py-2 text-xs text-[hsl(var(--muted-foreground))]">Se llena automáticamente.</p>;
  if (spec.type === "enum" || spec.type === "boolean") {
    const options = spec.type === "boolean"
      ? [{ value: "true", label: "Sí" }, { value: "false", label: "No" }]
      : spec.values.map((value) => ({ value, label: value }));
    return <SelectField aria-label={label} options={options} value={source.value === undefined ? "" : String(source.value)} disabled={readOnly}
      onValueChange={(value) => onSource({ from: "value", value: spec.type === "boolean" ? value === "true" : value })} />;
  }
  const numeric = spec.type === "number" || spec.type === "integer";
  return (
    <TextField aria-label={label} type={numeric ? "number" : "text"} value={fromLiteral(source.value)} disabled={readOnly}
      placeholder={spec.type.endsWith("[]") ? "Separa con comas" : spec.type === "datetime" ? "2026-10-06T10:00:00" : spec.type === "date" ? "AAAA-MM-DD" : ""}
      onChange={(e) => onSource({ from: "value", value: toLiteral(spec, e.target.value) })} />
  );
}

export function AutomationArgsEditor({ contract, args, triggerType, fieldOptions, readOnly, onChange }) {
  if (!contract) return null;
  const names = Object.keys(contract.args).filter((name) => !AUTOMATIC_ARGS.includes(name));
  const setSource = (name, source) => {
    const next = { ...args };
    if (!source) delete next[name]; else next[name] = source;
    onChange(next);
  };
  if (!names.length) return <p className="text-xs text-[hsl(var(--muted-foreground))]">Este servicio no necesita datos.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Datos que se envían</p>
      <div className="divide-y divide-[hsl(var(--border))] rounded-lg border border-[hsl(var(--border))]">
        {names.map((name) => {
          const spec = contract.args[name];
          const source = args[name];
          return (
            <div key={name} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_1fr] sm:items-center">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span>{argLabel(name)}</span>
                {spec.required && <Badge variant="outline">Obligatorio</Badge>}
              </div>
              <SelectField aria-label={`Origen de ${argLabel(name).toLowerCase()}`} options={sourceOptions({ required: spec.required, triggerType })}
                value={source?.from ?? (spec.required ? "" : "none")} disabled={readOnly} placeholder="Elige el origen"
                onValueChange={(from) => setSource(name, from === "none" ? null : { from })} />
              {source ? (
                <ValueInput name={name} spec={spec} source={source} fieldOptions={fieldOptions} readOnly={readOnly} onSource={(next) => setSource(name, next)} />
              ) : <span className="hidden sm:block" />}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        En «Texto con campos» escribe el nombre del campo entre llaves dobles, por ejemplo {"{{folio}}"}. El origen del registro y la protección contra duplicados se agregan solos.
      </p>
    </div>
  );
}
