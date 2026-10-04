// Module Builder — "Campos archivados" of one entity (spec
// 2026-10-03-rme3-module-platform-v2 §8.3). A field removed from a published
// module keeps its column and data. "Restaurar" adds it back to the draft
// (the next publish restores it with its data); "Eliminar definitivamente"
// drops the column after a backup, with a two-step confirmation.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ConfirmDialog } from "@runly/ui";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../../auth/AuthProvider";
import { runly } from "../../../../lib/runly";
import { updateEntity } from "../../lib/builderHelpers";

export function ArchivedFieldsPanel({ entity, definition, published, readOnly, onChange }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState({ field: null, step: 0 });
  const moduleKey = definition?.key;
  const query = useQuery({
    queryKey: ["archived-fields", moduleKey],
    queryFn: async () => (await runly.modules.archivedFields(moduleKey, token))?.data ?? [],
    enabled: Boolean(token && moduleKey && published),
    staleTime: 60 * 1000,
  });
  const draftKeys = new Set((entity.fields ?? []).map((field) => field.key));
  const archived = (query.data ?? []).filter((item) => item.entity === entity.key && !draftKeys.has(item.field));

  const purge = useMutation({
    mutationFn: async (item) => {
      const result = await runly.modules.purgeArchivedField(moduleKey, { table: item.table, field: item.field }, token);
      if (result?.error) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, item) => {
      toast.success(`Se eliminó "${item.label}" definitivamente.`, { description: "Quedó un respaldo de la tabla por 14 días." });
      queryClient.invalidateQueries({ queryKey: ["archived-fields", moduleKey] });
    },
    onError: (error) => toast.error("No se pudo eliminar el campo", { description: error.message }),
  });

  if (!archived.length) return null;

  function restore(item) {
    onChange((d) => {
      const current = d.entities.find((e) => e.key === entity.key);
      return updateEntity(d, entity.key, { fields: [...(current?.fields ?? []), { key: item.field, label: item.label ?? item.field, type: item.type }] });
    });
    toast.info(`"${item.label}" vuelve al borrador`, { description: "Al publicar se restaura con sus datos." });
  }

  const item = confirm.field;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Archive className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        <h3 className="text-sm font-semibold">Campos archivados</h3>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{archived.length}</span>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Se quitaron en una versión anterior; sus datos se conservan.</p>
      <ul className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
        {archived.map((row) => (
          <li key={row.field} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm">{row.label ?? row.field}</span>
              <span className="block font-mono text-xs text-[hsl(var(--muted-foreground))]">{row.field}</span>
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="outline">{row.rowsWithValue} con dato</Badge>
              {!readOnly && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => restore(row)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirm({ field: row, step: 1 })} disabled={purge.isPending}>
                    <Trash2 className="h-3.5 w-3.5" /> Eliminar
                  </Button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirm.step === 1}
        onOpenChange={(open) => !open && setConfirm({ field: null, step: 0 })}
        title="Eliminar campo archivado"
        description={item ? `"${item.label}" tiene datos en ${item.rowsWithValue} registro(s). Si lo eliminas, la columna se borra de la base de datos.` : ""}
        confirmLabel="Continuar"
        onConfirm={() => setConfirm((current) => ({ ...current, step: 2 }))}
      />
      <ConfirmDialog
        open={confirm.step === 2}
        onOpenChange={(open) => !open && setConfirm({ field: null, step: 0 })}
        title="¿Eliminar definitivamente?"
        description="Se guarda un respaldo de la tabla por 14 días, pero el campo ya no se podrá restaurar desde el Constructor. Esta acción no se puede deshacer."
        confirmLabel="Eliminar definitivamente"
        onConfirm={() => { purge.mutate(item); setConfirm({ field: null, step: 0 }); }}
      />
    </div>
  );
}
