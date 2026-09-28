// Module Builder — "Modo desarrollador": explains how to extend a module with
// code and hosts the actions. React screens only (components/ + CUSTOM views)
// are kept by the Builder, which stays in visual mode ("modo mixto"); any
// other code change switches to developer mode, which can be left again with
// "Volver al modo visual" (module-builder-package-sync.js).
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@runly/ui";
import { AlertTriangle, Code2, Download, FileCode2, Layers, Lock, MousePointerClick, Upload } from "lucide-react";

const STEPS = [
  { icon: Download, title: "Descarga el ZIP", text: "Trae el módulo completo y el archivo GUIA_DESARROLLO_RUNLY.md: cómo crear una pantalla React, qué librerías puedes usar (con su versión) y las reglas de diseño de Runly." },
  { icon: FileCode2, title: "Programa en tu editor", text: "Con VS Code u otro editor, agrega tus pantallas siguiendo la guía. No necesitas publicar antes." },
  { icon: Upload, title: "Sube la actualización", text: "Primero se revisa: validación, cambios en la estructura de datos y vista previa de tus pantallas React. Nada se aplica hasta que lo confirmes. Si es un módulo nuevo, después dale Instalar en su tarjeta del catálogo." },
];

function Section({ icon: Icon, title, children, tone = "default" }) {
  const warning = tone === "warning";
  return (
    <div className={`space-y-3 rounded-xl border p-4 ${warning ? "border-amber-500/40 bg-amber-500/10" : "border-[hsl(var(--border))]"}`}>
      <p className={`flex items-center gap-2 text-base font-semibold ${warning ? "text-amber-700 dark:text-amber-300" : ""}`}>
        <Icon className={`h-5 w-5 ${warning ? "text-amber-600 dark:text-amber-400" : "text-[hsl(var(--muted-foreground))]"}`} />
        {title}
      </p>
      {children}
    </div>
  );
}

export function DeveloperModeDialog({
  open, onOpenChange, advanced, onDownload, downloading, onConvert, converting, onUpload,
  onReattach, reattaching, reattachBlocked, onDownloadInstalled, downloadingInstalled,
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-5 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Code2 className="h-5 w-5 text-violet-600" />
            Modo desarrollador
          </DialogTitle>
          <DialogDescription className="text-sm">
            Para agregar a este módulo pantallas propias en React u otro código que el Constructor no genera.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-1">
        {advanced && (
          <p className="rounded-lg bg-violet-500/10 px-4 py-3 text-sm font-medium text-violet-700 dark:text-violet-300">
            Este módulo está en modo desarrollador: el Constructor no lo edita ni lo publica.
          </p>
        )}

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
                {index === 2 && onUpload && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={onUpload}>
                    <Upload className="h-4 w-4" />
                    Subir actualización
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>

        {!advanced && (
          <>
            <Section icon={Layers} title="Pantallas React sin salir del modo visual">
              <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                Si tu ZIP solo <strong>agrega</strong> pantallas (archivos en <code>components/</code>, vistas <code>*.custom.js</code> y sus entradas de menú), el Constructor las guarda y las vuelve a incluir cada vez que publicas. Sigues editando todo lo demás aquí. Las verás en la pestaña Vistas, en "Pantallas propias (código)".
              </p>
            </Section>
            <Section icon={Lock} title="¿Cuándo pasa a modo desarrollador?">
              <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                Si el ZIP cambia otros archivos (por ejemplo <code>api/</code>, los modelos o archivos que genera el Constructor), el proyecto pasa <strong>solo</strong> a modo desarrollador para no borrar tu código. Antes de aplicar, la revisión te avisa. También puedes congelarlo desde ya.
              </p>
              {confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-red-600">Podrás volver al modo visual después.</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
                  <Button size="sm" variant="destructive" disabled={converting} onClick={onConvert}>
                    {converting ? "Convirtiendo..." : "Sí, convertir"}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                  <Code2 className="h-4 w-4" />
                  Convertir a modo desarrollador ahora
                </Button>
              )}
            </Section>
          </>
        )}

        {advanced && (
          <Section icon={AlertTriangle} title="Volver al modo visual" tone="warning">
            <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
              El Constructor conserva tus pantallas React (<code>components/</code> y vistas personalizadas). Cualquier otro cambio de código se perdería en la siguiente publicación: antes de volver te decimos cuál.
            </p>
            {reattachBlocked ? (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-[hsl(var(--background))] p-3 text-sm text-amber-800 dark:text-amber-300">
                <p className="font-medium">Al volver se perderá en la siguiente publicación:</p>
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
            ) : (
              <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300" disabled={reattaching} onClick={() => onReattach(false)}>
                <MousePointerClick className="h-4 w-4" />
                {reattaching ? "Revisando..." : "Volver al modo visual"}
              </Button>
            )}
          </Section>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
