// Module Builder — Navegación tab (Etapa 10). Routes/permissions/pages are
// always derived safely (one entry per entity, generated server-side); this
// tab only lets the user rename labels, pick icons and reorder — never type
// a path by hand, per the spec's explicit "no advanced mode by default".
import { Button, IconPickerField, TextField } from "@runly/ui";
import { ChevronUp, ChevronDown } from "lucide-react";
import { navigationItems, updateNavigationItem, moveNavigationItem, buildModuleIconOptions } from "../../lib/builderHelpers";

export function NavigationTab({ definition, onChange, capabilities, readOnly }) {
  const items = navigationItems(definition);
  const moduleIcons = buildModuleIconOptions(capabilities?.iconNames);

  return (
    <div className="space-y-2 pt-4 max-w-2xl">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Cada entidad aparece en la navegación del módulo. La ruta y el permiso se generan automáticamente.
      </p>
      {items.map((item, index) => (
        <div key={item.page ?? index} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] p-2.5">
          <IconPickerField
            value={item.icon}
            disabled={readOnly}
            onChange={(value) => onChange((d) => updateNavigationItem(d, index, { icon: value }))}
            icons={moduleIcons.length ? moduleIcons : undefined}
          />
          <TextField
            className="flex-1"
            value={item.label ?? ""}
            disabled={readOnly}
            onChange={(e) => onChange((d) => updateNavigationItem(d, index, { label: e.target.value }))}
          />
          <span className="hidden md:inline text-xs font-mono text-[hsl(var(--muted-foreground))] truncate max-w-40">{item.path}</span>
          {!readOnly && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onChange((d) => moveNavigationItem(d, index, -1))}>
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" disabled={index === items.length - 1} onClick={() => onChange((d) => moveNavigationItem(d, index, 1))}>
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
