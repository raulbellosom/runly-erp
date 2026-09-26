// apps/desktop/src/modules/runly.core/components/ModuleCatalogDialogs.jsx
//
// The module catalog screen's non-detail dialogs: the error-diagnostic
// Dialog and the three destructive-action ConfirmDialogs (uninstall,
// cleanup-failed-install, purge-orphaned-tables). Extracted from
// ModuleCatalog.jsx on 2026-09-25 to keep that file under the CLAUDE.md
// 1000-line limit. All state lives in the parent screen — this component
// only renders it and forwards the same callbacks/setters verbatim.
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  LoadingState,
  TextField,
} from "@runly/ui";
import { Database } from "lucide-react";
import { toast } from "sonner";
import { ERROR_STAGE_LABEL } from "../lib/moduleCatalogHelpers";

export function ModuleCatalogDialogs({
  errorDialog,
  setErrorDialog,
  onCopyErrorDetails,
  confirmUninstall,
  setConfirmUninstall,
  purgeOnUninstall,
  setPurgeOnUninstall,
  confirmCleanup,
  setConfirmCleanup,
  cleanupConfirmation,
  setCleanupConfirmation,
  confirmDbPurge,
  setConfirmDbPurge,
  lifecycleMutation,
}) {
  return (
    <>
      <Dialog
        open={Boolean(errorDialog.open)}
        onOpenChange={(open) => {
          if (!open) {
            setErrorDialog({
              open: false,
              module: null,
              loading: false,
              detail: null,
            });
          }
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Detalle del error del módulo</DialogTitle>
            <DialogDescription>
              {errorDialog?.module?.name ?? "Módulo"} ·{" "}
              {errorDialog?.module?.key ?? "-"}
            </DialogDescription>
          </DialogHeader>
          {errorDialog.loading ? (
            <LoadingState message="Cargando diagnóstico..." />
          ) : (
            <div className="space-y-3">
              {errorDialog?.detail?.raw && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {errorDialog.detail.raw.stage && (
                    <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5">
                      Etapa:{" "}
                      {ERROR_STAGE_LABEL[errorDialog.detail.raw.stage] ??
                        String(errorDialog.detail.raw.stage)}
                    </span>
                  )}
                  {errorDialog.detail.raw.code && (
                    <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 font-mono">
                      {String(errorDialog.detail.raw.code)}
                    </span>
                  )}
                  {errorDialog.detail.raw.requestId && (
                    <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 font-mono">
                      RequestId: {String(errorDialog.detail.raw.requestId)}
                    </span>
                  )}
                </div>
              )}
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
                <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">
                  {errorDialog?.detail?.copyText ??
                    "No hay detalle de error disponible."}
                </pre>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCopyErrorDetails}
                >
                  Copiar detalle
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmUninstall)}
        onOpenChange={(v) => {
          if (!v) {
            setConfirmUninstall(null);
            setPurgeOnUninstall(false);
          }
        }}
        title="¿Desinstalar módulo?"
        description="El módulo será desinstalado. Esta acción no se puede deshacer."
        detail={confirmUninstall?.name}
        confirmLabel="Desinstalar"
        onConfirm={() =>
          lifecycleMutation.mutate({
            action: "uninstall",
            module: confirmUninstall,
            purge: purgeOnUninstall,
          })
        }
        loading={lifecycleMutation.isPending}
      >
        {confirmUninstall?.manifest?.lifecycle?.supportsDataPurge && (
          <div
            className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] p-3 cursor-pointer hover:bg-[hsl(var(--muted)/0.4)] transition-colors"
            onClick={() => setPurgeOnUninstall((v) => !v)}
          >
            <Checkbox
              className="mt-0.5"
              checked={purgeOnUninstall}
              onCheckedChange={(v) => setPurgeOnUninstall(Boolean(v))}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-sm leading-snug">
              <span className="font-medium text-[hsl(var(--foreground))]">
                Eliminar todos los datos
              </span>
              <span className="block text-[hsl(var(--muted-foreground))]">
                {confirmUninstall?.manifest?.lifecycle
                  ?.defaultUninstallPolicy === "purge-owned-tables"
                  ? "Se eliminarán permanentemente todos los datos y tablas propias de este módulo."
                  : "Se borrarán permanentemente todos los registros de este módulo."}
              </span>
            </span>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(confirmCleanup)}
        onOpenChange={(v) => {
          if (!v) {
            setConfirmCleanup(null);
            setCleanupConfirmation("");
          }
        }}
        title="¿Limpiar intento fallido?"
        description='Esta limpieza puede eliminar tablas vacías del módulo. Escribe "ACEPTO" para confirmar.'
        detail={confirmCleanup?.name}
        confirmLabel="Limpiar"
        onConfirm={() => {
          if (cleanupConfirmation.trim() !== "ACEPTO") {
            toast.error('Debes escribir "ACEPTO" para continuar.');
            return;
          }
          lifecycleMutation.mutate({
            action: "cleanup",
            module: confirmCleanup,
          });
        }}
        loading={lifecycleMutation.isPending}
      >
        <TextField
          label="Confirmación"
          value={cleanupConfirmation}
          onChange={(e) => setCleanupConfirmation(e.target.value)}
          placeholder='Escribe "ACEPTO"'
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(confirmDbPurge)}
        onOpenChange={(v) => {
          if (!v) setConfirmDbPurge(null);
        }}
        title="¿Purgar tablas de la base de datos?"
        description="El módulo está desinstalado pero puede tener tablas residuales en la base de datos. Esta acción las eliminará permanentemente junto con todos sus datos. No se puede deshacer."
        detail={confirmDbPurge?.name}
        confirmLabel="Purgar base de datos"
        onConfirm={() =>
          lifecycleMutation.mutate({
            action: "purge-orphaned-tables",
            module: confirmDbPurge,
          })
        }
        loading={lifecycleMutation.isPending}
      >
        <div className="flex items-start gap-2 rounded-md border border-red-300 dark:border-red-800 bg-red-100 dark:bg-red-950/30 p-3">
          <Database className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
            Se eliminarán todas las tablas propias del módulo y sus registros
            asociados en la base de datos.
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}
