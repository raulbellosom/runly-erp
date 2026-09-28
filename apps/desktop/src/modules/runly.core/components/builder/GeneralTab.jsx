// Module Builder — General tab: identity (name, description, icon, color,
// PWA metadata). Module key is immutable once created (module-builder-service
// re-pins it on every save), shown read-only here.
import { Button, TextField, TextareaField, SwatchField, IconPickerField, SectionCard } from "@runly/ui";
import { Code2, Download, GitBranch, KeyRound, MousePointerClick, Package, Smartphone } from "lucide-react";
import { buildModuleIconOptions } from "../../lib/builderHelpers";

// Visual (Builder) vs "modo desarrollador" (code via ZIP). Both the card and
// the button open DeveloperModeDialog, which explains the flow and hosts the
// download and the optional manual conversion.
function EditingModeCard({ mode }) {
  if (!mode) return null;
  const options = [
    { key: "visual", icon: MousePointerClick, title: "Visual", text: "Lo editas aquí, sin código: datos, diseño, vistas, menú y permisos.", active: !mode.advanced },
    { key: "developer", icon: Code2, title: "Desarrollador (código)", text: "Descargas el ZIP, agregas pantallas propias en React siguiendo la guía incluida y lo subes en Módulos.", active: mode.advanced },
  ];
  return (
    <SectionCard title="Modo de edición" className="md:col-span-2">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((option) => {
            const clickable = option.key === "developer";
            const Tag = clickable ? "button" : "div";
            return (
              <Tag
                key={option.key}
                {...(clickable ? { type: "button", onClick: mode.onOpen } : {})}
                className={`rounded-xl border p-3 text-left ${option.active ? "border-(--brand-primary) bg-(--brand-primary)/5" : "border-[hsl(var(--border))]"} ${clickable ? "cursor-pointer transition-colors hover:border-(--brand-primary) hover:bg-(--brand-primary)/5" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <option.icon className="h-4 w-4" />
                  <span className="text-sm font-semibold">{option.title}</span>
                  {option.active && <span className="ml-auto text-xs font-medium text-(--brand-primary)">Actual</span>}
                </div>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{option.text}</p>
                {clickable && <p className="mt-2 text-xs font-medium text-(--brand-primary)">Ver cómo funciona</p>}
              </Tag>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={mode.downloading} onClick={mode.onDownload}>
            <Download className="h-4 w-4" />
            {mode.downloading ? "Preparando..." : "Descargar ZIP con guía"}
          </Button>
        </div>
        {!mode.advanced && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            No necesitas publicar antes. Cuando subas tu ZIP con cambios, el proyecto pasa solo a modo desarrollador.
          </p>
        )}
      </div>
    </SectionCard>
  );
}

export function GeneralTab({ definition, onChange, capabilities, readOnly, editingMode }) {
  function set(patch) {
    onChange((current) => ({ ...current, ...patch }));
  }

  // Constrains the picker to exactly what @runly/module-compiler's validator
  // accepts (capabilities.iconNames === MODULE_ICON_NAMES) — otherwise a
  // perfectly normal-looking pick from IconPickerField's much larger default
  // catalog fails "Icon is not supported by the module catalog" at Validar.
  const moduleIcons = buildModuleIconOptions(capabilities?.iconNames);

  return (
    <div className="grid gap-4 md:grid-cols-2 pt-4">
      <SectionCard title="Identidad">
        <div className="space-y-3">
          <TextField
            label="Nombre"
            icon={Package}
            value={definition.name ?? ""}
            disabled={readOnly}
            onChange={(e) => set({ name: e.target.value })}
          />
          <TextField label="Module key" icon={KeyRound} value={definition.key ?? ""} disabled hint="No puede cambiar después de creado." />
          <TextareaField
            label="Descripción"
            value={definition.description ?? ""}
            disabled={readOnly}
            onChange={(e) => set({ description: e.target.value })}
          />
          <TextField
            label="Versión"
            icon={GitBranch}
            value={definition.version ?? "0.1.0"}
            disabled={readOnly}
            onChange={(e) => set({ version: e.target.value })}
            hint={editingMode?.publishedVersion
              ? `Publicada: v${editingMode.publishedVersion}. Al publicar, Runly te sugiere la siguiente versión según lo que cambiaste.`
              : "Formato x.y.z. Al publicar cambios, Runly te sugiere la siguiente versión."}
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
            icons={moduleIcons.length ? moduleIcons : undefined}
          />
          <SwatchField
            label="Color"
            value={definition.color}
            disabled={readOnly}
            onChange={(value) => set({ color: value })}
          />
          <TextField
            label="Nombre corto (PWA)"
            icon={Smartphone}
            value={definition.pwa?.shortName ?? ""}
            disabled={readOnly}
            maxLength={14}
            onChange={(e) => set({ pwa: { ...definition.pwa, shortName: e.target.value } })}
            hint="Máximo 14 caracteres."
          />
        </div>
      </SectionCard>
      <EditingModeCard mode={editingMode} />
    </div>
  );
}
