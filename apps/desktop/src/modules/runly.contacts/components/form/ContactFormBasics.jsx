import { useEffect, useMemo, useRef, useState } from "react";
import { Controller } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  ComboboxField,
  MarkdownField,
  SegmentedControl,
  TagsComboboxField,
  TextField,
  cn,
} from "@runly/ui";
import {
  REGIMEN_FISCAL,
  USO_CFDI,
  catalogForPersonType,
  normalizeRfc,
  rfcPersonType,
} from "@runly/validators";
import { AlertTriangle, CheckCircle2, ImagePlus, X } from "lucide-react";
import { runly } from "../../../../lib/runly";
import { TYPE_AVATAR_COLORS } from "../../constants";
import { initials } from "../../lib/contactLinks";

const TYPE_SEGMENTS = [
  { value: "person", label: "Persona" },
  { value: "company", label: "Empresa" },
  { value: "customer", label: "Cliente" },
  { value: "supplier", label: "Proveedor" },
];

const toOptions = (catalog) => catalog.map((e) => ({ value: e.code, label: `${e.code} - ${e.label}` }));

function AvatarPicker({ name, type, currentUrl, pending, onPick, onClear }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!(pending instanceof File)) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(pending);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  const shown = pending === "remove" ? null : preview ?? currentUrl;
  const colors = TYPE_AVATAR_COLORS[type] ?? TYPE_AVATAR_COLORS.person;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        aria-label="Cambiar foto"
      >
        <Avatar className="h-24 w-24 rounded-2xl">
          {shown && <AvatarImage src={shown} alt="" className="object-cover" />}
          <AvatarFallback className={cn("rounded-2xl text-2xl font-semibold", colors.bg, colors.text)}>
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus className="h-6 w-6 text-white" />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
      <div className="flex gap-2 text-xs">
        <button type="button" className="font-medium text-[hsl(var(--primary))] hover:underline" onClick={() => input.current?.click()}>
          Cambiar foto
        </button>
        {shown && (
          <button type="button" className="text-[hsl(var(--destructive))] hover:underline" onClick={onClear}>
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}

export function GeneralSection({ form, token, avatarUrl, avatarPending, setAvatarPending }) {
  const { register, control, formState: { errors }, watch } = form;
  const [tagQuery, setTagQuery] = useState("");
  const tagsQuery = useQuery({
    queryKey: ["contact-tags", tagQuery],
    queryFn: () => runly.contacts.listTags(tagQuery, token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const name = watch("name");
  const type = watch("type");

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <AvatarPicker
        name={name}
        type={type}
        currentUrl={avatarUrl}
        pending={avatarPending}
        onPick={setAvatarPending}
        onClear={() => setAvatarPending(avatarUrl ? "remove" : null)}
      />
      <div className="min-w-0 flex-1 space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Tipo de contacto</p>
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <SegmentedControl ariaLabel="Tipo de contacto" options={TYPE_SEGMENTS} value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField {...register("name")} label="Nombre comercial" required error={errors.name?.message} />
          <TextField {...register("legalName")} label="Razón social" hint="Como aparece en la constancia de situación fiscal" />
          <TextField {...register("industry")} label="Giro" placeholder="Ej. Construcción" />
          <TextField {...register("website")} label="Sitio web" placeholder="https://" inputMode="url" error={errors.website?.message} />
        </div>
        <Controller
          control={control}
          name="tags"
          render={({ field }) => (
            <TagsComboboxField
              label="Etiquetas"
              value={field.value ?? []}
              onChange={field.onChange}
              suggestions={tagsQuery.data?.data ?? []}
              onSearchChange={setTagQuery}
              error={errors.tags?.message}
            />
          )}
        />
      </div>
    </div>
  );
}

export function FiscalSection({ form }) {
  const { register, control, formState: { errors }, watch, setValue } = form;
  const taxId = watch("taxId");
  const taxRegime = watch("taxRegime");
  const cfdiUse = watch("cfdiUse");
  const rfc = normalizeRfc(taxId);
  const personType = rfcPersonType(rfc);
  const regimenOptions = useMemo(() => toOptions(catalogForPersonType(REGIMEN_FISCAL, personType)), [personType]);
  const usoOptions = useMemo(() => toOptions(catalogForPersonType(USO_CFDI, personType)), [personType]);
  const regimenMismatch = taxRegime && personType && !regimenOptions.some((o) => o.value === taxRegime);
  const usoMismatch = cfdiUse && personType && !usoOptions.some((o) => o.value === cfdiUse);
  const rfcRegister = register("taxId");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextField
          {...rfcRegister}
          onChange={(event) => {
            event.target.value = event.target.value.toUpperCase();
            rfcRegister.onChange(event);
          }}
          label="RFC"
          placeholder="XAXX010101000"
          className="font-mono tracking-wide"
          error={errors.taxId?.message}
          hint={
            personType
              ? `RFC con formato válido · ${personType === "moral" ? "Persona moral" : "Persona física"}`
              : "12 caracteres para persona moral, 13 para persona física"
          }
          icon={personType ? CheckCircle2 : undefined}
        />
      </div>
      <Controller
        control={control}
        name="taxRegime"
        render={({ field }) => (
          <ComboboxField
            label="Régimen fiscal"
            options={regimenMismatch ? toOptions(REGIMEN_FISCAL) : regimenOptions}
            value={field.value || ""}
            onChange={(value) => field.onChange(value ?? "")}
            placeholder="Selecciona el régimen"
            searchPlaceholder="Buscar por clave o nombre..."
            error={errors.taxRegime?.message}
          />
        )}
      />
      <TextField
        {...register("fiscalPostalCode")}
        label="Código postal fiscal"
        inputMode="numeric"
        maxLength={5}
        error={errors.fiscalPostalCode?.message}
      />
      <Controller
        control={control}
        name="cfdiUse"
        render={({ field }) => (
          <ComboboxField
            label="Uso de CFDI por defecto"
            options={usoMismatch ? toOptions(USO_CFDI) : usoOptions}
            value={field.value || ""}
            onChange={(value) => field.onChange(value ?? "")}
            placeholder="Selecciona el uso"
            searchPlaceholder="Buscar por clave o nombre..."
            error={errors.cfdiUse?.message}
          />
        )}
      />
      {(regimenMismatch || usoMismatch) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">
            {regimenMismatch ? "El régimen fiscal" : "El uso de CFDI"} seleccionado no corresponde a una{" "}
            {personType === "moral" ? "persona moral" : "persona física"}.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              if (regimenMismatch) setValue("taxRegime", "", { shouldDirty: true });
              if (usoMismatch) setValue("cfdiUse", "", { shouldDirty: true });
            }}
          >
            <X className="mr-1 h-3 w-3" /> Limpiar
          </Button>
        </div>
      )}
    </div>
  );
}

export function NotesSection({ form }) {
  return (
    <Controller
      control={form.control}
      name="notesMarkdown"
      render={({ field }) => (
        <MarkdownField
          value={field.value ?? ""}
          onChange={field.onChange}
          placeholder="Condiciones comerciales, acuerdos, observaciones..."
          maxLength={5000}
        />
      )}
    />
  );
}
