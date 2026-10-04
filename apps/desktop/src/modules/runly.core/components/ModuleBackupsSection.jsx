// Pre-update backups of a custom module (spec
// 2026-10-03-rme3-module-platform-v2 §12.3): taken automatically before every
// structural update, kept 14 days. "Restaurar" puts the backed-up rows back
// into the current tables (all or nothing). Hidden when there are none or the
// user lacks core.modules.manage (the API answers 403).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog } from "@runly/ui";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";

const RESTORE_ERRORS = {
  BACKUP_RESTORE_INCOMPATIBLE: "La estructura actual tiene campos obligatorios que el respaldo no tiene.",
  BACKUP_EXPIRED: "El respaldo ya venció.",
};

const formatDate = (value) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

export function ModuleBackupsSection({ moduleKey, token }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(null);
  const query = useQuery({
    queryKey: ["module-backups", moduleKey],
    queryFn: async () => {
      const result = await runly.modules.backups(moduleKey, token);
      return result?.error ? [] : result?.data ?? [];
    },
    enabled: Boolean(token && moduleKey),
    retry: false,
  });
  const restore = useMutation({
    mutationFn: async (backup) => {
      const result = await runly.modules.restoreBackup(moduleKey, backup.id, token);
      if (result?.error) throw new Error(RESTORE_ERRORS[result.error] ?? result.error);
      return result.data;
    },
    onSuccess: (data) => {
      toast.success("Respaldo restaurado", { description: (data.restored ?? []).map((item) => `${item.table}: ${item.rows} registro(s)`).join(" · ") });
      queryClient.invalidateQueries({ queryKey: ["module-backups", moduleKey] });
    },
    onError: (error) => toast.error("No se pudo restaurar", { description: error.message }),
  });

  const backups = query.data ?? [];
  if (!backups.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Respaldos antes de actualizar</h3>
      <ul className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
        {backups.map((backup) => (
          <li key={backup.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 text-sm">
              <span className="block">{formatDate(backup.createdAt)}{backup.versionFrom ? ` · desde v${backup.versionFrom}` : ""}</span>
              <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                {(backup.tables ?? []).reduce((sum, table) => sum + (table.rows ?? 0), 0)} registro(s) · vence {formatDate(backup.expiresAt)}
                {backup.restoredAt ? ` · restaurado ${formatDate(backup.restoredAt)}` : ""}
              </span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPending(backup)} disabled={restore.isPending}>
              <RotateCcw className="h-3.5 w-3.5" /> Restaurar
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
        title="Restaurar respaldo"
        description="Los registros actuales del módulo se reemplazan por los del respaldo. La estructura actual se conserva; si algún dato no cabe en ella, no se cambia nada."
        confirmLabel="Restaurar"
        onConfirm={() => { restore.mutate(pending); setPending(null); }}
      />
    </div>
  );
}
