// Module Builder — Permisos tab (Etapa 11). CRUD permissions are generated
// automatically per entity by normalizeModuleDefinition(); this tab explains
// what each one grants and where the menu uses it. Assigning permissions to
// roles remains the existing Runly administration flow (Identidad > Roles),
// linked from here rather than duplicated.
import { useNavigate } from "react-router-dom";
import { Button, Badge, EmptyState } from "@runly/ui";
import { Copy, Database, Eye, KeyRound, Menu, Pencil, Plus, Power, Rocket, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { moduleSlug, navigationItems } from "../../lib/builderHelpers";

// Names match the manifest template (templates/manifest.js buildPermLabel).
const ACTIONS = [
  { action: "read", label: "Ver", icon: Eye, description: (e) => `Ver la lista y el detalle de ${e}. Muestra la entrada del menú.` },
  { action: "create", label: "Crear", icon: Plus, description: (e) => `Registrar nuevos ${e}.` },
  { action: "update", label: "Editar", icon: Pencil, description: (e) => `Modificar ${e} existentes.` },
  { action: "delete", label: "Desactivar", icon: Power, description: (e) => `Desactivar ${e}; con eliminación suave se pueden recuperar.` },
];

const ROLES_PATH = "/app/m/runly.identity/identity/roles";

const STEPS = [
  { icon: Rocket, title: "Publica el módulo", text: "Los permisos se registran en la instancia al publicar." },
  { icon: ShieldCheck, title: "Asígnalos a roles", text: "En Identidad › Roles marca qué puede hacer cada rol." },
  { icon: Users, title: "Los usuarios heredan", text: "Cada usuario ve el menú y las acciones de sus roles." },
];

function copyKey(key) {
  navigator.clipboard?.writeText(key)
    .then(() => toast.success("Clave copiada."))
    .catch(() => toast.error("No se pudo copiar."));
}

export function PermissionsTab({ definition, published }) {
  const navigate = useNavigate();
  const slug = moduleSlug(definition.key);
  const entities = definition.entities ?? [];
  const menuUse = new Map();
  for (const item of navigationItems(definition)) {
    if (!menuUse.has(item.permission)) menuUse.set(item.permission, []);
    menuUse.get(item.permission).push(item.label);
  }

  return (
    <div className="space-y-5 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Permisos</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Cada entidad genera automáticamente 4 permisos. Aquí ves qué permite cada uno; se asignan a roles fuera del constructor.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={!published} onClick={() => navigate(ROLES_PATH)}>
          <ShieldCheck className="h-4 w-4" />
          Gestionar roles
        </Button>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))]">
              <step.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{index + 1}. {step.title}</span>
              <span className="block text-xs text-[hsl(var(--muted-foreground))]">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {!published && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">"Gestionar roles" se habilita cuando el módulo esté publicado.</p>
      )}

      {!entities.length ? (
        <EmptyState icon={KeyRound} title="Sin permisos todavía" description="Añade entidades en la pestaña Datos para generar sus permisos." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {entities.map((entity) => {
            const plural = (entity.pluralLabel || entity.label || entity.key).toLowerCase();
            return (
              <section key={entity.key} className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))]">
                    <Database className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{entity.label}</span>
                    <span className="block truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">{entity.key}</span>
                  </span>
                  <Badge variant="outline" className="shrink-0">4 permisos</Badge>
                </div>
                <ul className="divide-y divide-[hsl(var(--border))]">
                  {ACTIONS.map(({ action, label, icon: Icon, description }) => {
                    const key = `${slug}.${entity.key}.${action}`;
                    const usedBy = menuUse.get(key) ?? [];
                    return (
                      <li key={action} className="flex items-start gap-3 px-4 py-3">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{label} {(entity.label ?? "").toLowerCase()}</span>
                            {usedBy.length > 0 && (
                              <Badge variant="secondary" className="gap-1 text-[10px]" title={usedBy.join(", ")}>
                                <Menu className="h-3 w-3" />
                                Menú: {usedBy.length === 1 ? usedBy[0] : `${usedBy.length} entradas`}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-[hsl(var(--muted-foreground))]">{description(plural)}</p>
                          <p className="truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">{key}</p>
                        </div>
                        <Button size="icon" variant="ghost" className="shrink-0" aria-label={`Copiar ${key}`} onClick={() => copyKey(key)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
