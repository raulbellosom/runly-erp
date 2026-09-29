// Module Builder — "Modo desarrollador": explains how to extend a module with
// code and hosts the actions. React screens only (components/ + CUSTOM views)
// are kept by the Builder, which stays in visual mode ("modo mixto"); any
// other code change switches to developer mode, which can be left again with
// "Volver al modo visual" (module-builder-package-sync.js). The mode switch
// sits at the top as two cards (current one marked) so it is never missed.
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@runly/ui";
import { AlertTriangle, Code2, Download, FileCode2, MousePointerClick, Upload } from "lucide-react";

const STEPS = [
  { icon: Download, title: "Descarga el ZIP", text: "Trae el módulo completo y el archivo GUIA_DESARROLLO_RUNLY.md: cómo crear una pantalla React, qué librerías puedes usar (con su versión) y las reglas de diseño de Runly." },
  { icon: FileCode2, title: "Programa en tu editor", text: "Con VS Code u otro editor, agrega tus pantallas siguiendo la guía. No necesitas publicar antes ni cambiar de modo." },
  { icon: Upload, title: "Sube la actualización", text: "Primero se revisa: validación, cambios en la estructura de datos y vista previa de tus pantallas React. Nada se aplica hasta que lo confirmes. Si es un módulo nuevo, después dale Instalar en su tarjeta del catálogo." },
];

function ModeCard({ icon: Icon, title, text, current, accent, children }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 ${current ? `${accent} ring-1` : "border-[hsl(var(--border))]"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-base font-semibold">
          <Icon className="h-5 w-5" />
          {title}
        </p>
        {current && <Badge variant="secondary">Actual</Badge>}
      </div>
      <p className="flex-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{text}</p>
      {children}
    </div>
  );
}

function ConvertAction({ converting, onConvert }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-auto min-h-9 w-full justify-center whitespace-normal rounded-lg border-amber-500/60 bg-amber-500/10 py-2 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
        onClick={() => setConfirming(true)}
      >
        <AlertTriangle className="h-4 w-4" />
        Cambiar a modo desarrollador
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        El Constructor dejará de editar y publicar este módulo; solo se actualizará subiendo ZIPs. Podrás volver al modo visual después.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
        <Button size="sm" variant="destructive" disabled={converting} onClick={onConvert}>
          {converting ? "Cambiando..." : "Sí, cambiar"}
        </Button>
      </div>
    </div>
  );
}

function ReattachAction({ reattaching, reattachBlocked, onReattach, downloadingInstalled, onDownloadInstalled }) {
  if (!reattachBlocked) {
    return (
      <Button size="sm" variant="outline" disabled={reattaching} onClick={() => onReattach(false)}>
        <MousePointerClick className="h-4 w-4" />
        {reattaching ? "Revisando..." : "Volver al modo visual"}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Al volver se perderá en la siguiente publicación:
      </p>
      <ul className="list-disc pl-5">{reattachBlocked.lost.map((item) => <li key={item}>{item}</li>)}</ul>
      {reattachBlocked.kept?.views > 0 && <p>Se conservan {reattachBlocked.kept.views} pantalla(s) React.</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" disabled={downloadingInstalled} onClick={onDownloadInstalled}>
          <Download className="h-4 w-4" />
          {downloadingInstalled ? "Preparando..." : "Descargar respaldo"}
        </Button>
        <Button size="sm" variant="destructive" disabled={reattaching} onClick={() => onReattach(true)}>
          {reattaching ? "Volviendo..." : "Volver de todos modos"}
        </Button>
      </div>
    </div>
  );
}

export function DeveloperModeDialog({
  open, onOpenChange, advanced, onDownload, downloading, onConvert, converting, onUpload,
  onReattach, reattaching, reattachBlocked, onDownloadInstalled, downloadingInstalled,
}) {
  // Remount the convert confirmation each time the dialog opens.
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    if (open) setOpenCount((count) => count + 1);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl" className="flex max-h-[90vh] flex-col gap-5 overflow-hidden">
        {/* The body below scrolls on its own, so the header never needs the
            mobile sticky backdrop (it showed as an opaque white box). */}
        <DialogHeader className="mb-0 shrink-0 max-md:bg-transparent max-md:backdrop-blur-none">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Code2 className="h-5 w-5 text-violet-600" />
            Modo desarrollador
          </DialogTitle>
          <DialogDescription className="text-sm">
            Para agregar a este módulo pantallas propias en React u otro código que el Constructor no genera.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-1">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Modo de edición</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ModeCard
                icon={MousePointerClick}
                title="Visual"
                current={!advanced}
                accent="border-emerald-500/50 bg-emerald-500/5 ring-emerald-500/30"
                text="Editas y publicas desde el Constructor. Si tu ZIP solo agrega pantallas React (components/ y vistas *.custom.js), se conservan en cada publicación."
              >
                {advanced && (
                  <ReattachAction
                    reattaching={reattaching}
                    reattachBlocked={reattachBlocked}
                    onReattach={onReattach}
                    downloadingInstalled={downloadingInstalled}
                    onDownloadInstalled={onDownloadInstalled}
                  />
                )}
              </ModeCard>
              <ModeCard
                icon={Code2}
                title="Desarrollador"
                current={advanced}
                accent="border-violet-500/50 bg-violet-500/5 ring-violet-500/30"
                text="El módulo se edita como código y se actualiza subiendo ZIPs; el Constructor no lo edita ni lo publica para no borrar tu código. Pasa solo a este modo si subes cambios en api/, modelos o archivos generados."
              >
                {!advanced && <ConvertAction key={openCount} converting={converting} onConvert={onConvert} />}
              </ModeCard>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Cómo trabajar con código</h3>
            <ol className="space-y-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-sm font-semibold">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-base font-semibold">
                      <step.icon className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{step.text}</p>
                    {index === 0 && (
                      <Button size="sm" className="mt-2" disabled={downloading} onClick={onDownload}>
                        <Download className="h-4 w-4" />
                        {downloading ? "Preparando..." : "Descargar ZIP con guía"}
                      </Button>
                    )}
                    {index === 2 && !advanced && (
                      <p className="mt-2 rounded-lg bg-[hsl(var(--muted))] px-3 py-2 text-sm leading-relaxed">
                        Disponible en modo desarrollador. Si tu ZIP solo <strong>agrega</strong> pantallas React, también puedes subirlo en <strong>Módulos &gt; Subir módulo</strong> y el módulo sigue en modo visual.
                      </p>
                    )}
                    {index === 2 && advanced && onUpload && (
                      <Button size="sm" variant="outline" className="mt-2" onClick={onUpload}>
                        <Upload className="h-4 w-4" />
                        Subir actualización
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
