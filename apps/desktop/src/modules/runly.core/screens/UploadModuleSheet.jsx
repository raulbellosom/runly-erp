// Módulos > Subir módulo, and the Builder's "Subir actualización"
// (fixedModuleKey). Two steps: pick the ZIP, then review it
// (ModuleUpdateReview: validation, structure changes, React preview) before
// anything is applied.
import { useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Button,
  Input,
  Label,
} from "@runly/ui";
import { SearchCheck } from "lucide-react";
import { useAuth } from "../../../auth/AuthProvider";
import { ZipDropZone } from "../components/module-update/ZipDropZone";
import { ModuleUpdateReview } from "../components/module-update/ModuleUpdateReview";
import { guessKeyFromFilename, readModuleKeyFromZip } from "../lib/module-zip-key.js";
import { StarterPackageCard } from "../components/module-update/StarterPackageCard";

export function UploadModuleSheet({ open, onOpenChange, onSuccess, fixedModuleKey = null, title = "Subir módulo" }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const moduleKeyInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [moduleKey, setModuleKey] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const effectiveKey = (fixedModuleKey ?? moduleKey).trim();

  function handleFile(selected) {
    setFile(selected);
    if (fixedModuleKey) return;
    // Quick guess from the file name, then the real key from the manifest
    // inside the ZIP (Builder files are named <key>-<version>.zip).
    setModuleKey(guessKeyFromFilename(selected.name));
    readModuleKeyFromZip(selected).then((key) => { if (key) setModuleKey(key); });
  }

  function reset() {
    setFile(null);
    setModuleKey("");
    setReviewing(false);
  }

  function handleClose(nextOpen) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  const canReview = Boolean(file && effectiveKey && token);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        className={`flex w-full flex-col gap-0 overflow-hidden ${reviewing ? "sm:max-w-3xl" : "sm:max-w-md"}`}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (!fixedModuleKey) moduleKeyInputRef.current?.focus();
        }}
      >
        <SheetHeader className="shrink-0 pb-2">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {reviewing
              ? "Revisa qué va a cambiar y cómo se ven tus pantallas antes de aplicar."
              : "Primero se revisa el paquete (validación, cambios en la estructura de datos y vista previa); nada se aplica hasta que lo confirmes."}
          </SheetDescription>
        </SheetHeader>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        {reviewing ? (
          <div className="mt-4">
            <ModuleUpdateReview
              moduleKey={effectiveKey}
              file={file}
              token={token}
              onChangeFile={() => setReviewing(false)}
              onApplied={(result) => {
                handleClose(false);
                onSuccess?.(result);
              }}
            />
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label>Archivo ZIP</Label>
              <ZipDropZone file={file} onFile={handleFile} onClear={() => setFile(null)} />
            </div>

            {fixedModuleKey ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Módulo: <code>{fixedModuleKey}</code>. El ZIP debe declarar esta misma clave en <code>module.manifest.js</code>.
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="module-key">Clave del módulo</Label>
                <Input
                  ref={moduleKeyInputRef}
                  id="module-key"
                  value={moduleKey}
                  onChange={(e) => setModuleKey(e.target.value)}
                  placeholder="custom.mi-modulo"
                />
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Debe coincidir con el campo <code>key</code> en <code>module.manifest.js</code>.
                </p>
              </div>
            )}

            <Button className="w-full" disabled={!canReview} onClick={() => setReviewing(true)}>
              <SearchCheck className="h-4 w-4" />
              Revisar antes de aplicar
            </Button>

            <p className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
              El código del ZIP se ejecuta en esta instancia. Solo sube módulos de fuentes de confianza.
            </p>

            {!fixedModuleKey && <StarterPackageCard token={token} />}
          </div>
        )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
