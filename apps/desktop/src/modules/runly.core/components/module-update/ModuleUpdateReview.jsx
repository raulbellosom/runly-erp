// Review -> preview -> apply for a module ZIP. Runs POST /modules/:key/upload/check
// (nothing is installed), shows what blocks the update, the database
// structure changes and warnings, previews the ZIP's React views, and only
// then lets the user apply it through the regular upload.
// See docs/superpowers/specs/2026-09-28-module-update-review-design.md.
import { useEffect, useState } from "react";
import { Button, Skeleton } from "@runly/ui";
import { AlertTriangle, CheckCircle2, Code2, Database, Layers, MonitorPlay, Rocket, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../../lib/runly";
import { CustomViewPreview } from "./CustomViewPreview";
import { DesignReviewList } from "./DesignReviewList";
import { StructureChangesTable, missingDecisions } from "./StructureChangesTable";

function ReportList({ icon: Icon, title, items, tone }) {
  if (!items?.length) return null;
  return (
    <section className={`space-y-1.5 rounded-xl p-3 ${tone}`}>
      <p className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" /> {title}</p>
      <ul className="list-disc space-y-0.5 pl-6 text-sm">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </section>
  );
}

// What happens to the module's Builder project (module-builder-package-sync.js).
function BuilderImpact({ builder }) {
  if (!builder || builder.action === "none") return null;
  if (builder.action === "keep") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-300">
        <Layers className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Sigues en modo visual: el Constructor guardará {builder.extensions?.views ? `tus ${builder.extensions.views} pantalla(s) React` : "tus archivos de componentes"} y las incluirá en cada publicación.
        </span>
      </p>
    );
  }
  return (
    <section className="space-y-1.5 rounded-xl bg-violet-500/10 p-3 text-sm text-violet-800 dark:text-violet-300">
      <p className="flex items-center gap-2 font-medium"><Code2 className="h-4 w-4" /> El proyecto pasará a modo desarrollador</p>
      <p className="text-xs">El Constructor dejará de editarlo y publicarlo para no borrar estos cambios (podrás volver al modo visual después):</p>
      <ul className="list-disc space-y-0.5 pl-6 text-xs">{(builder.reasons ?? []).map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </section>
  );
}

async function applyModuleZip({ moduleKey, file, token, decisions }) {
  const formData = new FormData();
  formData.append("file", file);
  if (decisions && Object.keys(decisions).length) formData.append("decisions", JSON.stringify(decisions));
  const toastId = toast.loading(`Aplicando ${moduleKey}...`);
  try {
    const result = await runly.modules.uploadModuleZip(moduleKey, formData, token);
    if (result?.error) {
      toast.error(result.error, { id: toastId, description: result.details ? JSON.stringify(result.details) : undefined });
      return null;
    }
    toast.success(`Módulo ${moduleKey} actualizado`, { id: toastId, description: `${result?.data?.fileCount ?? "?"} archivos aplicados.` });
    if (result?.data?.builderKept && result.data.builderExtensions?.views) {
      toast.info("Tus pantallas quedaron guardadas en el Constructor", {
        description: "Sigues en modo visual; se incluirán en cada publicación.",
      });
    }
    if (result?.data?.builderDetached) {
      toast.info("Este módulo pasó a modo desarrollador", {
        description: "El ZIP cambia código que el Constructor genera; ya no lo editará ni publicará, para no sobrescribirlo. Puedes volver al modo visual desde el editor.",
      });
    }
    return result.data;
  } catch (error) {
    toast.error("No se pudo aplicar la actualización", { id: toastId, description: error?.message ?? "Error desconocido" });
    return null;
  }
}

export function ModuleUpdateReview({ moduleKey, file, token, onApplied, onChangeFile }) {
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState("");
  const [applying, setApplying] = useState(false);
  const [decisions, setDecisions] = useState({});

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setCheckError("");
    setReport(null);
    setDecisions({});
    const formData = new FormData();
    formData.append("file", file);
    runly.modules.checkModuleZip(moduleKey, formData, token)
      .then((result) => {
        if (cancelled) return;
        if (result?.error) setCheckError(result.error);
        else setReport(result.data);
      })
      .catch((error) => !cancelled && setCheckError(error?.message ?? "No se pudo revisar el paquete."))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [moduleKey, file, token]);

  async function apply() {
    setApplying(true);
    const result = await applyModuleZip({ moduleKey, file, token, decisions });
    setApplying(false);
    if (result && !report.installed) {
      toast.info("Falta instalarlo", { description: "Ve al Catálogo de módulos e instala el módulo para usarlo y ver sus pantallas con datos." });
    }
    if (result) onApplied?.(result);
  }

  if (checking) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Revisando el paquete y comparándolo con el módulo instalado...</p>
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }
  if (checkError) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{checkError}</p>
        <Button variant="outline" onClick={onChangeFile}>Elegir otro archivo</Button>
      </div>
    );
  }

  const versionLine = report.installed
    ? `v${report.currentVersion} → v${report.nextVersion ?? "?"}`
    : `Módulo nuevo · v${report.nextVersion ?? "?"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{moduleKey}</p>
          <p className="text-sm font-semibold">{report.valid === false ? "Paquete no válido" : versionLine}</p>
        </div>
        {report.inspection && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {report.inspection.files} archivos · {report.inspection.views} vistas{report.inspection.hasComponents ? " · pantallas React" : ""}
          </p>
        )}
      </div>

      {!report.blocked && (
        <p className="rounded-xl bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-300">
          Esto es solo una revisión: todavía no se ha subido nada. Cuando estés conforme, da clic en{" "}
          <strong>{report.installed ? "Aplicar actualización" : "Subir módulo"}</strong>
          {report.installed ? "." : " y después instálalo desde el Catálogo de módulos."}
        </p>
      )}

      {report.noChanges && (
        <p className="rounded-xl bg-[hsl(var(--muted))] p-3 text-sm">El ZIP es idéntico al módulo instalado; aplicarlo solo vuelve a sincronizarlo.</p>
      )}

      <BuilderImpact builder={report.builder} />
      <ReportList icon={ShieldAlert} title="No se puede aplicar" items={report.blockers} tone="bg-red-500/10 text-red-700 dark:text-red-300" />
      {report.structure?.length > 0 ? (
        <StructureChangesTable rows={report.structure} decisions={decisions} onChange={setDecisions} disabled={applying} />
      ) : report.valid !== false && (
        report.changes.length ? (
          <ReportList icon={Database} title="Cambios en la estructura de datos" items={report.changes} tone="bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" />
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Sin cambios en la estructura de datos.
          </p>
        )
      )}
      <ReportList icon={AlertTriangle} title="Revisa antes de aplicar" items={report.warnings} tone="bg-amber-500/10 text-amber-800 dark:text-amber-300" />
      <DesignReviewList findings={report.designReview} />

      {report.preview && (
        <section className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium"><MonitorPlay className="h-4 w-4" /> Vista previa de tus pantallas React</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Así se verán con tus datos reales. Los datos vienen de la versión instalada del módulo: los cambios en <code>api/</code> se ven hasta aplicar.
          </p>
          {!report.installed && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Este módulo aún no está instalado, así que su API todavía no existe: si tus pantallas consultan datos, en la vista previa verás errores de carga (404). Aplica e instala el módulo para probarlas con datos.
            </p>
          )}
          <CustomViewPreview moduleKey={moduleKey} previewId={report.preview.id} views={report.customViews} token={token} />
        </section>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 pt-3">
        <Button variant="outline" onClick={onChangeFile} disabled={applying}>Elegir otro archivo</Button>
        <Button onClick={apply} disabled={report.blocked || applying || missingDecisions(report.structure, decisions).length > 0}>
          <Rocket className="h-4 w-4" />
          {applying ? "Aplicando..." : report.installed ? "Aplicar actualización" : "Subir módulo"}
        </Button>
      </div>
    </div>
  );
}
