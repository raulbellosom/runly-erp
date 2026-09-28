// Module Builder — "Pantallas propias (código)": React screens captured from
// an uploaded ZIP (definition.extensions). They are edited as code (download
// ZIP, edit, upload); here they can only be reviewed or removed. Removing
// sends explicit empty lists so the server does not keep the stored ones.
import { Badge, Button, SectionCard } from "@runly/ui";
import { FileCode2, Trash2 } from "lucide-react";
import { extensionViewMeta as viewMeta, removeExtensionView } from "../../lib/codeExtensions";

export function CodeExtensionsCard({ definition, onChange, readOnly }) {
  const extensions = definition.extensions;
  const views = extensions?.views ?? [];
  const files = extensions?.files ?? [];
  if (!views.length && !files.length) return null;
  const normalized = { files, views, navigation: extensions?.navigation ?? [] };
  const componentCount = files.filter((file) => file.path.startsWith("components/")).length;

  return (
    <SectionCard
      title="Pantallas propias (código)"
      description={`Pantallas React que subiste en un ZIP (${componentCount} archivo(s) en components/). El Constructor las incluye en cada publicación; para cambiarlas descarga el ZIP, edítalas y súbelo.`}
    >
      <div className="space-y-2">
        {views.map((view) => {
          const meta = viewMeta(files.find((file) => file.path === view.file));
          const inMenu = normalized.navigation.some((item) => item.path === meta.path);
          return (
            <div key={view.file} className="flex flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2">
              <FileCode2 className="h-4 w-4 shrink-0 text-violet-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{meta.title ?? view.file}</p>
                <p className="truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">{meta.path ?? view.file}</p>
              </div>
              {inMenu && <Badge variant="outline" className="shrink-0">En el menú</Badge>}
              {!readOnly && (
                <Button size="icon-sm" variant="ghost" className="text-red-600" aria-label={`Quitar ${meta.title ?? view.file}`} onClick={() => onChange({ ...definition, extensions: removeExtensionView(normalized, view.file) })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
        {!readOnly && (
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onChange({ ...definition, extensions: { files: [], views: [], navigation: [] } })}>
            <Trash2 className="h-3.5 w-3.5" />
            Quitar todo el código propio
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
