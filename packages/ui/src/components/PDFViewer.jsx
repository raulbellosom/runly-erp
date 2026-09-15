import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
} from "lucide-react";

// Worker served from public/ — copied there via pnpm postinstall (see package.json)
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

// Mirrors the bottom-toolbar button in AdvancedFileViewer so the PDF and image
// viewers expose the same zoom/rotate/flip controls with identical styling.
function ToolbarBtn({ children, title, onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        "h-8 w-8 sm:h-7 sm:w-7 rounded-md flex items-center justify-center transition-all duration-150",
        "disabled:opacity-30 disabled:cursor-not-allowed",
        active
          ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
          : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function PDFViewer({ url }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [containerWidth, setContainerWidth] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const containerRef = useRef(null);
  const widthRef = useRef(0);

  useEffect(() => {
    setPageNumber(1);
    setNumPages(null);
    setZoom(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
  }, [url]);

  // Re-rendering the PDF page is expensive and blanks the canvas, so ignore the
  // sub-pixel width jitter the container emits while the dialog opens (and the
  // ~15px step a toggling scrollbar would otherwise cause — `scrollbar-gutter`
  // keeps that reserved). Only a real change past 1px re-renders the page.
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const next = Math.floor(el.clientWidth) - 32;
    if (next > 0 && Math.abs(next - widthRef.current) > 1) {
      widthRef.current = next;
      setContainerWidth(next);
    }
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [measure]);

  function nudgeZoom(direction) {
    setZoom((value) =>
      clampZoom(Number((value + direction * ZOOM_STEP).toFixed(2))),
    );
  }

  function resetTransforms() {
    setZoom(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
  }

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const flipStyle =
    flipX || flipY
      ? { transform: `scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})` }
      : undefined;

  return (
    <div className="relative h-full w-full flex flex-col">
      {/* Scrollable PDF page area */}
      <div
        ref={containerRef}
        style={{ scrollbarGutter: "stable" }}
        className="flex-1 min-h-0 overflow-auto overscroll-contain flex justify-center bg-[hsl(var(--muted))]/20"
      >
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={
            <div className="flex items-center justify-center min-h-40 w-full">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--muted-foreground))]/50" />
            </div>
          }
          error={
            <div className="flex flex-col items-center justify-center min-h-40 w-full gap-3">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Error al cargar el PDF.
              </p>
              <button
                onClick={() => window.open(url, "_blank")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium glass text-[hsl(var(--foreground))]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir en visor externo
              </button>
            </div>
          }
        >
          {containerWidth && (
            <div style={flipStyle}>
              <Page
                pageNumber={pageNumber}
                width={containerWidth}
                scale={zoom}
                rotate={normalizedRotation}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                loading={null}
                className="my-4 shadow-lg"
              />
            </div>
          )}
        </Document>
      </div>

      {/* Bottom toolbar: page navigation + zoom / rotate / flip (mirrors the
          image viewer's toolbar in AdvancedFileViewer) */}
      <div className="flex items-center justify-center gap-1.5 px-3 h-12 safe-bottom shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]/60 overflow-x-auto">
        {/* Page navigation group */}
        <div className="flex items-center rounded-lg bg-[hsl(var(--muted))]/60 p-0.5 shrink-0">
          <ToolbarBtn
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            title="Pagina anterior"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 min-w-14 text-center tabular-nums select-none px-1">
            {pageNumber} / {numPages ?? "—"}
          </span>
          <ToolbarBtn
            onClick={() => setPageNumber((p) => Math.min(numPages ?? p, p + 1))}
            disabled={!numPages || pageNumber >= numPages}
            title="Pagina siguiente"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>

        <div className="w-px h-4 bg-[hsl(var(--border))] mx-0.5 shrink-0" />

        {/* Zoom group */}
        <div className="flex items-center rounded-lg bg-[hsl(var(--muted))]/60 p-0.5 shrink-0">
          <ToolbarBtn
            onClick={() => nudgeZoom(-1)}
            title="Reducir zoom"
            disabled={zoom <= MIN_ZOOM}
          >
            <Minus className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <button
            onClick={() => setZoom(1)}
            title="Restablecer zoom"
            className="h-7 min-w-13 px-2 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors duration-150 tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </button>
          <ToolbarBtn
            onClick={() => nudgeZoom(1)}
            title="Aumentar zoom"
            disabled={zoom >= MAX_ZOOM}
          >
            <Plus className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>

        <div className="w-px h-4 bg-[hsl(var(--border))] mx-0.5 shrink-0" />

        {/* Rotate group */}
        <div className="flex items-center rounded-lg bg-[hsl(var(--muted))]/60 p-0.5 shrink-0">
          <ToolbarBtn
            onClick={() => setRotation((v) => v - 90)}
            title="Rotar izquierda"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => setRotation((v) => v + 90)}
            title="Rotar derecha"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>

        <div className="w-px h-4 bg-[hsl(var(--border))] mx-0.5 shrink-0" />

        {/* Flip group */}
        <div className="flex items-center rounded-lg bg-[hsl(var(--muted))]/60 p-0.5 shrink-0">
          <ToolbarBtn
            onClick={() => setFlipX((v) => !v)}
            title="Voltear horizontal"
            active={flipX}
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => setFlipY((v) => !v)}
            title="Voltear vertical"
            active={flipY}
          >
            <FlipVertical2 className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>

        <div className="w-px h-4 bg-[hsl(var(--border))] mx-0.5 shrink-0" />

        {/* Reset */}
        <div className="shrink-0">
          <ToolbarBtn onClick={resetTransforms} title="Restablecer todo">
            <RefreshCw className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>
      </div>
    </div>
  );
}
