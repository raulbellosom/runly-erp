import { useRef } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./Sheet.jsx";

// Lets a touch-device user choose between taking a new photo and picking an
// existing one, which a bare <input type="file"> cannot offer on Android —
// without a `capture` attribute Android always opens the gallery/document
// chooser, never the camera. Desktop callers should skip this component
// entirely (gate with useCoarsePointer()) and keep using a plain
// <input type="file"> click, since there is no camera-vs-gallery distinction
// on a mouse/trackpad device.
export function ImageSourceSheet({ open, onOpenChange, onPickFile, accept = "image/*" }) {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    onOpenChange(false);
    if (file) onPickFile(file);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Agregar imagen</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="w-full flex items-center gap-3 text-left px-3 py-3 text-sm rounded-lg text-foreground hover:bg-muted transition-colors"
          >
            <Camera className="w-4 h-4 shrink-0" />
            Tomar foto
          </button>
          <button
            onClick={() => galleryInputRef.current?.click()}
            className="w-full flex items-center gap-3 text-left px-3 py-3 text-sm rounded-lg text-foreground hover:bg-muted transition-colors"
          >
            <ImageIcon className="w-4 h-4 shrink-0" />
            Elegir de galería
          </button>
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept={accept}
          capture="environment"
          className="hidden"
          onChange={handleChange}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleChange}
        />
      </SheetContent>
    </Sheet>
  );
}
