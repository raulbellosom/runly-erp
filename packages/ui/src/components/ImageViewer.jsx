import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from './Button.jsx';

export function ImageViewer({ src, alt = "Imagen", fileName, open, onClose, allowZoom = false }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  function handleDownload() {
    const a = document.createElement("a");
    a.href = src;
    a.download = fileName ?? alt;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        {/* Dark overlay — clickable to close */}
        <DialogPrimitive.Overlay
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200"
        />

        {/* Lightbox content */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={[
            "fixed inset-safe sm:inset-8 md:inset-12 z-50 flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200 pointer-events-none",
          ].join(" ")}
        >
          <DialogPrimitive.Title className="sr-only">{fileName ?? alt}</DialogPrimitive.Title>
          {/* Action bar — top right */}
          <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 pointer-events-auto">
            {allowZoom && <>
              <Button type="button" size="icon" variant="secondary" aria-label="Reducir imagen" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}><ZoomOut className="h-4 w-4" /></Button>
              <Button type="button" variant="secondary" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
              <Button type="button" size="icon" variant="secondary" aria-label="Ampliar imagen" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.5))}><ZoomIn className="h-4 w-4" /></Button>
            </>}
            <button
              onClick={handleDownload}
              aria-label="Descargar imagen"
              title="Descargar"
              className="h-8 w-8 rounded-xl flex items-center justify-center glass text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
            >
              <Download className="h-4 w-4" />
            </button>
            <DialogPrimitive.Close
              onClick={onClose}
              aria-label="Cerrar visor"
              title="Cerrar"
              className="h-8 w-8 rounded-xl flex items-center justify-center glass text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Image — fills available space */}
          <div className={zoom > 1 ? "flex-1 min-h-0 overflow-auto pointer-events-auto pt-10" : "flex-1 min-h-0 flex items-center justify-center pointer-events-auto"}>
            <img
              src={src}
              alt={alt}
              className={zoom > 1 ? "max-w-none rounded-2xl shadow-2xl" : "max-h-full max-w-full object-contain rounded-2xl shadow-2xl"}
              style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined}
              draggable={false}
            />
          </div>

          {/* Caption */}
          {(fileName || alt) && (
            <div className="mt-3 text-center pointer-events-auto">
              <p className="text-xs text-[hsl(var(--muted-foreground))]/70 select-none">
                {fileName ?? alt}
              </p>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
