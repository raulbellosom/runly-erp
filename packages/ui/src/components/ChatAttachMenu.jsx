import { useRef, useState } from "react";
import { Camera, Image as ImageIcon, FileText } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover.jsx";
import { cn } from "../lib/utils.js";

const TILE = "flex flex-col items-center gap-1.5 text-xs font-medium text-foreground";
const ICON = "flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm transition-transform active:scale-95";

// A WhatsApp-style attachment picker: tapping the trigger (usually a paperclip
// button) opens a small popover with a tile per source (camera / gallery /
// document) instead of a plain drag-and-drop box, which reads better in a
// narrow chat composer than a full dropzone. Inputs stay mounted for the
// popover's whole open lifetime and only close it from onChange (after the
// native file dialog has already resolved) — closing on tap would unmount the
// input mid-dialog on some browsers and drop the selection.
export function ChatAttachMenu({
  trigger,
  disabled = false,
  showCamera = true,
  imageAccept = "image/*",
  documentAccept = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.md",
  onPickCamera,
  onPickImages,
  onPickDocuments,
}) {
  const [open, setOpen] = useState(false);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const documentRef = useRef(null);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild disabled={disabled}>{trigger}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-auto p-3">
        <div className="flex items-start gap-4">
          {showCamera && (
            <button type="button" className={TILE} onClick={() => cameraRef.current?.click()}>
              <span className={cn(ICON, "bg-slate-500")}><Camera className="h-5 w-5" /></span>
              Cámara
            </button>
          )}
          <button type="button" className={TILE} onClick={() => galleryRef.current?.click()}>
            <span className={cn(ICON, "bg-fuchsia-500")}><ImageIcon className="h-5 w-5" /></span>
            Imagen
          </button>
          <button type="button" className={TILE} onClick={() => documentRef.current?.click()}>
            <span className={cn(ICON, "bg-sky-500")}><FileText className="h-5 w-5" /></span>
            Documento
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            setOpen(false);
            if (file) onPickCamera?.(file);
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept={imageAccept}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            setOpen(false);
            if (files.length) onPickImages?.(files);
          }}
        />
        <input
          ref={documentRef}
          type="file"
          accept={documentAccept}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            setOpen(false);
            if (files.length) onPickDocuments?.(files);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
