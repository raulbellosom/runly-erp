// Module Builder — General tab: identity (name, description, icon, color,
// PWA metadata). Module key is immutable once created (module-builder-service
// re-pins it on every save), shown read-only here.
import { TextField, TextareaField, SwatchField, IconPickerField, SectionCard } from "@runly/ui";

export function GeneralTab({ definition, onChange, readOnly }) {
  function set(patch) {
    onChange((current) => ({ ...current, ...patch }));
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 pt-4">
      <SectionCard title="Identidad">
        <div className="space-y-3">
          <TextField
            label="Nombre"
            value={definition.name ?? ""}
            disabled={readOnly}
            onChange={(e) => set({ name: e.target.value })}
          />
          <TextField label="Module key" value={definition.key ?? ""} disabled hint="No puede cambiar después de creado." />
          <TextareaField
            label="Descripción"
            value={definition.description ?? ""}
            disabled={readOnly}
            onChange={(e) => set({ description: e.target.value })}
          />
          <TextField
            label="Versión"
            value={definition.version ?? "0.1.0"}
            disabled={readOnly}
            onChange={(e) => set({ version: e.target.value })}
            hint="Formato semver x.y.z"
          />
        </div>
      </SectionCard>

      <SectionCard title="Apariencia">
        <div className="space-y-3">
          <IconPickerField
            label="Icono"
            value={definition.icon}
            disabled={readOnly}
            onChange={(value) => set({ icon: value })}
          />
          <SwatchField
            label="Color"
            value={definition.color}
            onChange={(value) => set({ color: value })}
          />
          <TextField
            label="Nombre corto (PWA)"
            value={definition.pwa?.shortName ?? ""}
            disabled={readOnly}
            maxLength={14}
            onChange={(e) => set({ pwa: { ...definition.pwa, shortName: e.target.value } })}
            hint="Máximo 14 caracteres."
          />
        </div>
      </SectionCard>
    </div>
  );
}
