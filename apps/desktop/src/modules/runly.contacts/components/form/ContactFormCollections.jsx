import { useFieldArray, Controller } from "react-hook-form";
import { Button, SelectField, TextField, cn } from "@runly/ui";
import { Mail, Phone, Plus, Trash2 } from "lucide-react";
import { ADDRESS_KIND_LABELS, CHANNEL_LABELS } from "../../lib/contactLinks";

const CHANNEL_LABEL_OPTIONS = Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const ADDRESS_KIND_OPTIONS = Object.entries(ADDRESS_KIND_LABELS).map(([value, label]) => ({ value, label }));
const COUNTRY_CODE_OPTIONS = [
  { value: "+52", label: "MX +52" },
  { value: "+1", label: "US/CA +1" },
  { value: "+34", label: "ES +34" },
  { value: "+57", label: "CO +57" },
  { value: "+54", label: "AR +54" },
  { value: "+56", label: "CL +56" },
];
const COUNTRY_OPTIONS = [
  { value: "MX", label: "México" },
  { value: "US", label: "Estados Unidos" },
  { value: "CA", label: "Canadá" },
  { value: "ES", label: "España" },
  { value: "OT", label: "Otro" },
];

export const EMPTY_CHANNEL = (kind) => ({
  id: null, kind, label: kind === "phone" ? "mobile" : "other", value: "", countryCode: "+52", isPrimary: false,
});
export const EMPTY_ADDRESS = {
  id: null, kind: "fiscal", label: "", street: "", extNumber: "", intNumber: "", neighborhood: "",
  postalCode: "", city: "", state: "", country: "MX", isDefault: false,
};
export const EMPTY_PERSON = { id: null, name: "", role: "", phone: "", email: "", isPrimary: false };

function FlagPill({ active, onClick, label = "Principal" }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", active ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted-foreground))]/40")} />
      {label}
    </button>
  );
}

function RemoveButton({ onClick, label }) {
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick} aria-label={label} className="h-10 w-10 shrink-0">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

// Makes `index` the only flagged row within rows sharing the same group.
function setSingleFlag(form, name, index, flag, sameGroup = () => true) {
  const rows = form.getValues(name) ?? [];
  rows.forEach((row, i) => {
    if (!sameGroup(row, rows[index])) return;
    form.setValue(`${name}.${i}.${flag}`, i === index, { shouldDirty: true });
  });
}

function ChannelRows({ form, fields, remove, kind }) {
  const { register, control, formState: { errors }, watch } = form;
  const rows = watch("channels") ?? [];
  const indexes = fields.map((_, i) => i).filter((i) => rows[i]?.kind === kind);
  if (!indexes.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin {kind === "phone" ? "teléfonos" : "correos"}.</p>;
  }
  return (
    <div className="space-y-3">
      {indexes.map((i) => (
        <div key={fields[i].id} className="grid gap-2 sm:grid-cols-[auto_1fr_150px_auto_auto] sm:items-start">
          {kind === "phone" ? (
            <Controller
              control={control}
              name={`channels.${i}.countryCode`}
              render={({ field }) => (
                <div className="sm:w-32"><SelectField value={field.value || "+52"} onValueChange={field.onChange} options={COUNTRY_CODE_OPTIONS} /></div>
              )}
            />
          ) : (
            <span className="hidden h-10 w-10 items-center justify-center sm:flex">
              <Mail className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            </span>
          )}
          <TextField
            {...register(`channels.${i}.value`)}
            type={kind === "phone" ? "tel" : "email"}
            inputMode={kind === "phone" ? "tel" : "email"}
            placeholder={kind === "phone" ? "81 8345 6700" : "correo@empresa.mx"}
            error={errors.channels?.[i]?.value?.message}
          />
          <Controller
            control={control}
            name={`channels.${i}.label`}
            render={({ field }) => (
              <SelectField value={field.value} onValueChange={field.onChange} options={CHANNEL_LABEL_OPTIONS} />
            )}
          />
          <div className="flex items-center gap-1">
            <FlagPill
              active={Boolean(rows[i]?.isPrimary)}
              onClick={() => setSingleFlag(form, "channels", i, "isPrimary", (a, b) => a.kind === b.kind)}
            />
            <RemoveButton onClick={() => remove(i)} label="Quitar" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChannelsSection({ form }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "channels" });
  return (
    <div className="space-y-6">
      {[["phone", "Teléfonos", Phone, "+ Agregar teléfono"], ["email", "Correos electrónicos", Mail, "+ Agregar correo"]].map(
        ([kind, title, Icon, addLabel]) => (
          <div key={kind} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" /> {title}
              </h4>
              <Button type="button" variant="ghost" size="sm" onClick={() => append(EMPTY_CHANNEL(kind))}>
                <Plus className="mr-1 h-4 w-4" /> {addLabel.replace("+ ", "")}
              </Button>
            </div>
            <ChannelRows form={form} fields={fields} remove={remove} kind={kind} />
          </div>
        ),
      )}
    </div>
  );
}

export function AddressesSection({ form }) {
  const { register, control, formState: { errors }, watch } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "addresses" });
  const rows = watch("addresses") ?? [];
  return (
    <div className="space-y-4">
      {fields.map((field, i) => (
        <div key={field.id} className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Controller
              control={control}
              name={`addresses.${i}.kind`}
              render={({ field: f }) => (
                <div className="w-36"><SelectField value={f.value} onValueChange={f.onChange} options={ADDRESS_KIND_OPTIONS} /></div>
              )}
            />
            <div className="min-w-[160px] flex-1"><TextField {...register(`addresses.${i}.label`)} placeholder="Etiqueta (ej. Matriz)" /></div>
            <FlagPill
              label="Predeterminada"
              active={Boolean(rows[i]?.isDefault)}
              onClick={() => setSingleFlag(form, "addresses", i, "isDefault", (a, b) => a.kind === b.kind)}
            />
            <RemoveButton onClick={() => remove(i)} label="Quitar dirección" />
          </div>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-4"><TextField {...register(`addresses.${i}.street`)} label="Calle" required error={errors.addresses?.[i]?.street?.message} /></div>
            <div className="sm:col-span-1"><TextField {...register(`addresses.${i}.extNumber`)} label="Núm. ext." /></div>
            <div className="sm:col-span-1"><TextField {...register(`addresses.${i}.intNumber`)} label="Núm. int." /></div>
            <div className="sm:col-span-3"><TextField {...register(`addresses.${i}.neighborhood`)} label="Colonia" /></div>
            <div className="sm:col-span-1"><TextField {...register(`addresses.${i}.postalCode`)} label="C.P." inputMode="numeric" /></div>
            <div className="sm:col-span-2"><TextField {...register(`addresses.${i}.city`)} label="Ciudad / Municipio" /></div>
            <div className="sm:col-span-3"><TextField {...register(`addresses.${i}.state`)} label="Estado" /></div>
            <Controller
              control={control}
              name={`addresses.${i}.country`}
              render={({ field: f }) => (
                <div className="sm:col-span-3"><SelectField label="País" value={f.value || "MX"} onValueChange={f.onChange} options={COUNTRY_OPTIONS} /></div>
              )}
            />
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => append({ ...EMPTY_ADDRESS, kind: fields.length ? "shipping" : "fiscal" })}>
        <Plus className="mr-1 h-4 w-4" /> Agregar dirección
      </Button>
    </div>
  );
}

export function PeopleSection({ form }) {
  const { register, control, formState: { errors }, watch } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "persons" });
  const rows = watch("persons") ?? [];
  return (
    <div className="space-y-3">
      {fields.map((field, i) => (
        <div key={field.id} className="grid gap-2 rounded-xl border border-[hsl(var(--border))] p-3 sm:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto] sm:items-start">
          <TextField {...register(`persons.${i}.name`)} placeholder="Nombre" error={errors.persons?.[i]?.name?.message} />
          <TextField {...register(`persons.${i}.role`)} placeholder="Puesto (ej. Compras)" />
          <TextField {...register(`persons.${i}.phone`)} placeholder="Teléfono" inputMode="tel" />
          <TextField {...register(`persons.${i}.email`)} placeholder="Correo" inputMode="email" error={errors.persons?.[i]?.email?.message} />
          <div className="flex items-center gap-1">
            <FlagPill active={Boolean(rows[i]?.isPrimary)} onClick={() => setSingleFlag(form, "persons", i, "isPrimary")} />
            <RemoveButton onClick={() => remove(i)} label="Quitar persona" />
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => append({ ...EMPTY_PERSON })}>
        <Plus className="mr-1 h-4 w-4" /> Agregar persona de contacto
      </Button>
    </div>
  );
}
