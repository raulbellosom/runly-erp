import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FlipHorizontal2,
  FlipVertical2,
  Link2,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Share2,
  X,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ContextMenu.jsx";
import { getOfficeFormat } from "@runly/core";
import { getFileKind, getKindLabel, formatBytes } from "../lib/file-kind";
import { useHlsPlayback } from "../lib/useHlsPlayback";
import { FileVisual } from "./FileVisual";
import { PDFViewer } from "./PDFViewer";

const HLS_MIME_TYPES = new Set(["application/vnd.apple.mpegurl", "application/x-mpegurl"]);

// Re-encodes an arbitrary image blob as PNG via an offscreen canvas. Some
// browsers only accept image/png for navigator.clipboard.write, so this is
// the fallback when the source blob's own MIME type (e.g. image/webp) is
// rejected.
function blobToPng(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error("canvas toBlob failed"));
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function getDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function touchPoint(t) {
  return { x: t.clientX, y: t.clientY };
}

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

export function AdvancedFileViewer({
  open,
  onOpenChange,
  files,
  activeIndex,
  onIndexChange,
  onResolveSignedUrl,
  zIndex = 50,
  onOpenInOffice = null,
  canOpenInOffice = null,
}) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  // `zoom` is a multiplier over the computed fit scale (see fitScale below), so
  // zoom === 1 always means "fills the visible area" and the toolbar's 100%
  // reads true regardless of the file's natural pixel size.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [pinching, setPinching] = useState(false);
  const [filmstripOpen, setFilmstripOpen] = useState(true);
  const [naturalSize, setNaturalSize] = useState(null);   // { w, h } from <img onLoad>
  const [containerSize, setContainerSize] = useState(null); // { w, h } from ResizeObserver
  // Real thumbnails for image/video files (browser-painted first frame for
  // video, same trick as MessageAttachments.jsx's VideoCard) resolved only
  // for a small window around the active index -- resolving+loading all of
  // them at once for a 21-item gallery is exactly the loading-cost problem
  // the filmstrip must avoid. Farther-away files just show the generic file
  // icon until they enter the window.
  const [mediaThumbUrls, setMediaThumbUrls] = useState({});

  const imageContainerRef = useRef(null);
  const hlsVideoRef = useRef(null);
  const thumbRefs = useRef(new Map());
  const mediaThumbFetching = useRef(new Set());
  const pointersRef = useRef(new Map());
  const gestureRef = useRef({
    mode: null,
    startDistance: 0,
    startZoom: 1,
    startPan: { x: 0, y: 0 },
    startPoint: { x: 0, y: 0 },
  });
  // Touch-gesture snapshots (iOS-reliable Touch Events path — see the effect
  // near handlePointerDown). Refs, not state, so per-frame updates never
  // re-render mid-gesture.
  const pinchRef = useRef(null); // { dist, zoom, pan, center } | null
  const panRef = useRef(null);   // { point, pan } | null
  const lastTapRef = useRef(0);
  // Set when the manual touch double-tap handler below fires, so the mouse
  // dblclick handler (handleImageDoubleClick) can ignore the synthetic
  // dblclick some mobile browsers fire right after two touchend events —
  // that MouseEvent has no usable pointerType, so it slips past this
  // handler's own touch guard and would otherwise instantly undo the zoom.
  const suppressDblClickRef = useRef(0);

  const file = files?.[activeIndex] ?? null;
  const kind = useMemo(() => getFileKind(file), [file]);
  // HLS sources (runly.chat call recordings, via a blob: URL wrapping a
  // rewritten manifest — see ChatRecordingsGallery.jsx) can't use a plain
  // <video src>: hls.js has to demux the stream itself. Everything else
  // (regular mp4/webm attachments) keeps the existing <video src> below,
  // untouched.
  const isHlsSource = kind === "video" && HLS_MIME_TYPES.has(String(file?.mimeType ?? "").toLowerCase());
  useHlsPlayback(hlsVideoRef, !loading && signedUrl && isHlsSource ? signedUrl : null);
  const [hlsDownloading, setHlsDownloading] = useState(false);
  const officeOpenable = useMemo(() => {
    if (!onOpenInOffice || !file) return false;
    if (canOpenInOffice && !canOpenInOffice(file)) return false;
    return Boolean(
      getOfficeFormat({
        originalName: file.originalName ?? file.fileName ?? file.name ?? "",
        mimeType: file.mimeType ?? "",
      }),
    );
  }, [onOpenInOffice, canOpenInOffice, file]);
  const canPrev = activeIndex > 0;
  const canNext = activeIndex >= 0 && activeIndex < files.length - 1;

  useEffect(() => {
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragging(false);
    setPinching(false);
    setNaturalSize(null);
    pointersRef.current.clear();
    pinchRef.current = null;
    panRef.current = null;
    gestureRef.current = {
      mode: null,
      startDistance: 0,
      startZoom: 1,
      startPan: { x: 0, y: 0 },
      startPoint: { x: 0, y: 0 },
    };
  }, [file?.id]);

  // Only the current file's own cached URL, not the whole mediaThumbUrls map,
  // so this doesn't get invalidated (see effect below) every time some other
  // file's filmstrip thumbnail resolves in the background — that thrashing
  // used to cancel-and-restart the active file's own fetch on every
  // unrelated thumbnail resolution, which with many files could keep it from
  // ever finishing.
  const cachedActiveUrl = file?.id ? (mediaThumbUrls[file.id] ?? null) : null;

  useEffect(() => {
    let active = true;
    if (!open || !file?.id) {
      setSignedUrl(null);
      return () => {
        active = false;
      };
    }

    // The filmstrip's windowed thumbnail resolver (below) already fetches a
    // signed URL for any image/video within +/-THUMB_WINDOW of wherever the
    // user has been browsing — reuse it instead of re-fetching, so paging to
    // an adjacent file (the common case) swaps instantly with no spinner
    // flash instead of re-running the whole async round trip on every click.
    if (cachedActiveUrl) {
      setSignedUrl(cachedActiveUrl);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    async function loadSignedUrl() {
      try {
        setLoading(true);
        const url = await onResolveSignedUrl(file);
        if (!active) return;
        setSignedUrl(url || null);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSignedUrl();
    return () => {
      active = false;
    };
  }, [open, file?.id, onResolveSignedUrl, cachedActiveUrl]);

  useEffect(() => {
    if (zoom <= 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);

  // Keep the active thumbnail visible when paging via arrows/keyboard, not
  // just when clicking a thumbnail directly.
  useEffect(() => {
    if (!filmstripOpen) return;
    const el = thumbRefs.current.get(activeIndex);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeIndex, filmstripOpen]);

  // Resolve real thumbnails for image/video files within +/-3 of the active
  // index (see the mediaThumbUrls state comment above for why this is
  // windowed instead of resolving the whole gallery at once).
  const THUMB_WINDOW = 3;
  useEffect(() => {
    if (!open || !filmstripOpen || !onResolveSignedUrl || (files?.length ?? 0) <= 1) return;
    const start = Math.max(0, activeIndex - THUMB_WINDOW);
    const end = Math.min(files.length - 1, activeIndex + THUMB_WINDOW);
    for (let i = start; i <= end; i++) {
      const f = files[i];
      if (!f) continue;
      const fKind = getFileKind(f);
      if (fKind !== "video" && fKind !== "image") continue;
      // Images that already carry a pre-built thumbnailUrl (e.g. the chat
      // gallery's small "card" variant) never need this network round trip —
      // using it directly below works instantly for every file in a large
      // gallery, not just the +/-THUMB_WINDOW currently in view.
      if (fKind === "image" && f.thumbnailUrl) continue;
      if (mediaThumbUrls[f.id] || mediaThumbFetching.current.has(f.id)) continue;
      mediaThumbFetching.current.add(f.id);
      // onResolveSignedUrl may be sync (a blob-URL resolver) or async — normalise
      // before chaining so a plain string / null return never throws
      // ".then of null/undefined" out of this effect (which the app-level
      // ErrorBoundary would surface as a full-screen "SIN CONEXION").
      Promise.resolve(onResolveSignedUrl(f))
        .then((url) => {
          if (url) setMediaThumbUrls((prev) => ({ ...prev, [f.id]: url }));
        })
        .finally(() => {
          mediaThumbFetching.current.delete(f.id);
        });
    }
    // mediaThumbUrls intentionally omitted: it's only read here as an
    // already-fetched guard, and mediaThumbFetching's ref-based in-flight
    // guard is what actually prevents duplicate requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex, files, filmstripOpen, onResolveSignedUrl]);

  const nudgeZoom = useCallback((direction) => {
    setZoom((value) =>
      clampZoom(Number((value + direction * ZOOM_STEP).toFixed(2))),
    );
  }, []);

  // Track the image container's box so "fit" can be recomputed on modal
  // resize / device rotation, not just on first paint.
  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el || kind !== "image") return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [kind, signedUrl, loading]);

  // Scale at which the image, at its natural size, exactly fills the visible
  // area (by whichever axis binds first). No cap: big images shrink, small
  // images grow — it never exceeds the modal's visible box. Accounts for the
  // 90/270 rotation swap so a rotated photo still fits.
  const rotatedQuarter = Math.abs(rotation % 180) === 90;
  const fitScale = useMemo(() => {
    if (!naturalSize || !containerSize || !naturalSize.w || !naturalSize.h) return 1;
    const natW = rotatedQuarter ? naturalSize.h : naturalSize.w;
    const natH = rotatedQuarter ? naturalSize.w : naturalSize.h;
    const s = Math.min(containerSize.w / natW, containerSize.h / natH);
    return Number.isFinite(s) && s > 0 ? s : 1;
  }, [naturalSize, containerSize, rotatedQuarter]);

  // `zoom` (toolbar %) is a multiplier over the fit; this is the real scale.
  const effectiveScale = fitScale * zoom;

  const clampPan = useCallback(
    (next) => {
      if (!naturalSize || !containerSize) return { x: 0, y: 0 };
      const natW = rotatedQuarter ? naturalSize.h : naturalSize.w;
      const natH = rotatedQuarter ? naturalSize.w : naturalSize.h;
      const maxX = Math.max(0, (natW * effectiveScale - containerSize.w) / 2);
      const maxY = Math.max(0, (natH * effectiveScale - containerSize.h) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [naturalSize, containerSize, effectiveScale, rotatedQuarter],
  );

  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el) return;
    function handleImageWheel(event) {
      event.preventDefault();
      event.stopPropagation();
      nudgeZoom(event.deltaY > 0 ? -1 : 1);
    }
    el.addEventListener("wheel", handleImageWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleImageWheel);
  }, [nudgeZoom, signedUrl, loading, kind]);

  // Latest transform state for the imperative Touch Events handlers below —
  // refs so per-frame reads never force the effect to re-bind its listeners.
  const liveRef = useRef({});
  liveRef.current = { zoom, pan, clampPan };

  // Touch gestures (pinch-zoom + pan + double-tap). iOS WebKit's multi-touch
  // Pointer Events are unreliable — `pointercancel` storms during a pinch made
  // the old handler re-seed its start distance every frame (the "1% per pinch"
  // bug). Raw Touch Events with a non-passive listener are the robust path;
  // the Pointer handlers below are now mouse/trackpad only.
  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el || kind !== "image") return;

    function centerAbs() {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function onTouchStart(e) {
      if (e.touches.length >= 2) {
        e.preventDefault();
        const p0 = touchPoint(e.touches[0]);
        const p1 = touchPoint(e.touches[1]);
        const c = centerAbs();
        const mid = getMidpoint(p0, p1);
        pinchRef.current = {
          dist: getDistance(p0, p1) || 1,
          zoom: liveRef.current.zoom,
          pan: liveRef.current.pan,
          centerAbs: c,
          midRel: { x: mid.x - c.x, y: mid.y - c.y },
        };
        panRef.current = null;
        lastTapRef.current = 0;
        setPinching(true);
        setDragging(false);
      } else if (e.touches.length === 1) {
        const p = touchPoint(e.touches[0]);
        panRef.current = { point: p, pan: liveRef.current.pan };
        // double-tap -> toggle fit / 2x, anchored at the tap
        const now = Date.now();
        if (now - lastTapRef.current < 280) {
          e.preventDefault();
          lastTapRef.current = 0;
          suppressDblClickRef.current = now;
          const c = centerAbs();
          setZoom((z) => {
            const zoomingIn = z <= 1;
            if (!zoomingIn) {
              setPan({ x: 0, y: 0 });
              return 1;
            }
            setPan(
              liveRef.current.clampPan({
                x: -(p.x - c.x) * 0.6,
                y: -(p.y - c.y) * 0.6,
              }),
            );
            return 2;
          });
        } else {
          lastTapRef.current = now;
        }
      }
    }

    function onTouchMove(e) {
      if (e.touches.length >= 2 && pinchRef.current) {
        e.preventDefault();
        const p0 = touchPoint(e.touches[0]);
        const p1 = touchPoint(e.touches[1]);
        const snap = pinchRef.current;
        const ratio = getDistance(p0, p1) / snap.dist;
        const nextZoom = clampZoom(snap.zoom * ratio);
        const scaleRatio = nextZoom / snap.zoom;
        const mid = getMidpoint(p0, p1);
        const m1 = { x: mid.x - snap.centerAbs.x, y: mid.y - snap.centerAbs.y };
        setZoom(nextZoom);
        setPan(
          liveRef.current.clampPan({
            x: m1.x + scaleRatio * (snap.pan.x - snap.midRel.x),
            y: m1.y + scaleRatio * (snap.pan.y - snap.midRel.y),
          }),
        );
        return;
      }
      if (e.touches.length === 1 && panRef.current) {
        // Only pan when zoomed past fit — otherwise a one-finger drag on a
        // fitted image would do nothing but churn renders.
        if (liveRef.current.zoom <= 1) return;
        e.preventDefault();
        const p = touchPoint(e.touches[0]);
        const snap = panRef.current;
        setDragging(true);
        setPan(
          liveRef.current.clampPan({
            x: snap.pan.x + (p.x - snap.point.x),
            y: snap.pan.y + (p.y - snap.point.y),
          }),
        );
      }
    }

    function onTouchEnd(e) {
      if (e.touches.length === 1) {
        // dropped from a pinch to one finger — reseed pan from here so the
        // transition into a one-finger drag doesn't jump
        pinchRef.current = null;
        setPinching(false);
        panRef.current = { point: touchPoint(e.touches[0]), pan: liveRef.current.pan };
      } else if (e.touches.length === 0) {
        pinchRef.current = null;
        panRef.current = null;
        setPinching(false);
        setDragging(false);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [kind, signedUrl, loading]);

  function handlePointerDown(event) {
    if (kind !== "image" || event.pointerType === "touch") return;

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    event.currentTarget.setPointerCapture(event.pointerId);

    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      gestureRef.current = {
        ...gestureRef.current,
        mode: "pinch",
        startDistance: getDistance(points[0], points[1]),
        startZoom: zoom,
      };
      setDragging(false);
      setPinching(true);
      return;
    }

    gestureRef.current = {
      ...gestureRef.current,
      mode: "pan",
      startPan: pan,
      startPoint: { x: event.clientX, y: event.clientY },
    };
    setDragging(true);
  }

  function handlePointerMove(event) {
    if (kind !== "image" || event.pointerType === "touch") return;
    if (!pointersRef.current.has(event.pointerId)) return;

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const points = [...pointersRef.current.values()];

    if (points.length >= 2 && gestureRef.current.startDistance > 0) {
      const distance = getDistance(points[0], points[1]);
      const ratio = distance / gestureRef.current.startDistance;
      setZoom(
        clampZoom(Number((gestureRef.current.startZoom * ratio).toFixed(2))),
      );
      return;
    }

    if (gestureRef.current.mode !== "pan") return;
    const dx = event.clientX - gestureRef.current.startPoint.x;
    const dy = event.clientY - gestureRef.current.startPoint.y;
    setPan({
      x: gestureRef.current.startPan.x + dx,
      y: gestureRef.current.startPan.y + dy,
    });
  }

  function handlePointerEnd(event) {
    if (kind !== "image" || event.pointerType === "touch") return;

    pointersRef.current.delete(event.pointerId);
    setDragging(false);

    const points = [...pointersRef.current.values()];
    if (points.length === 1) {
      const point = points[0];
      gestureRef.current = {
        ...gestureRef.current,
        mode: "pan",
        startPan: pan,
        startPoint: { x: point.x, y: point.y },
      };
      return;
    }

    if (points.length === 0) {
      setPinching(false);
      gestureRef.current = {
        ...gestureRef.current,
        mode: null,
        startDistance: 0,
      };
    }
  }

  function handleImageDoubleClick(event) {
    if (kind !== "image" || event.pointerType === "touch") return;
    if (Date.now() - suppressDblClickRef.current < 500) return;
    event.preventDefault();
    const isZoomed = zoom > 1;
    const nextZoom = isZoomed ? 1 : 2;

    setZoom(nextZoom);
    if (nextZoom === 1) {
      setPan({ x: 0, y: 0 });
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - (rect.left + rect.width / 2);
    const offsetY = event.clientY - (rect.top + rect.height / 2);
    setPan(clampPan({ x: -offsetX * 0.6, y: -offsetY * 0.6 }));
  }

  function resetTransforms() {
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  // `download` is silently ignored by the browser for cross-origin URLs
  // (every Supabase Storage signed URL is cross-origin from this app's own
  // origin) — it just navigates there instead, so a PDF opens in a new
  // tab/window rather than saving to disk. Fetching the bytes first and
  // downloading via a same-origin blob: URL is what actually forces a save.
  async function downloadCurrent() {
    if (!signedUrl || !file) return;
    const filename = file.originalName ?? file.name ?? "archivo";
    // HLS sources need a real, single, playable file built first — see
    // downloadHlsAsMp4's own header comment for why this is a lossless
    // client-side remux, not server-side transcoding.
    if (isHlsSource) {
      setHlsDownloading(true);
      const toastId = toast.loading("Preparando descarga (puede tardar según la duración)...");
      try {
        const { downloadHlsAsMp4 } = await import("../lib/downloadHlsAsMp4.js");
        await downloadHlsAsMp4(signedUrl, filename);
        toast.success("Descarga lista", { id: toastId });
      } catch (err) {
        console.warn("[files] HLS -> MP4 download failed", err);
        toast.error("No se pudo generar la descarga", { id: toastId });
      } finally {
        setHlsDownloading(false);
      }
      return;
    }
    try {
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error(`download fetch failed: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    }
  }

  // Native right-click "copy image" is unreliable for cross-origin signed
  // URLs (and unavailable at all in some webviews), so this gives users an
  // explicit, always-working copy action instead.
  async function copyCurrentImage() {
    if (!signedUrl || kind !== "image") return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Clipboard API no disponible");
      }
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error(`copy fetch failed: ${res.status}`);
      const blob = await res.blob();
      try {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      } catch {
        // Some browsers only accept image/png on the clipboard — re-encode
        // and retry once before giving up.
        const pngBlob = await blobToPng(blob);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      }
      toast.success("Imagen copiada al portapapeles");
    } catch (err) {
      console.warn("[files] copy image to clipboard failed", err);
      toast.error("No se pudo copiar la imagen");
    }
  }

  // Signed URLs expire (~1h), so this is a "paste it somewhere in the next
  // hour" convenience, not a permanent link — same tradeoff as the top bar's
  // "abrir externo".
  async function copyCurrentLink() {
    if (!signedUrl) return;
    try {
      await navigator.clipboard.writeText(signedUrl);
      toast.success("Enlace copiado al portapapeles");
    } catch (err) {
      console.warn("[files] copy link to clipboard failed", err);
      toast.error("No se pudo copiar el enlace");
    }
  }

  // Web Share API — mainly useful on mobile (native share sheet). Tries to
  // share the actual file first (so e.g. WhatsApp/Mail get a real
  // attachment); falls back to sharing the link when the browser can't share
  // files or the fetch is slow enough to risk losing the user-activation
  // window `share()` requires.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function shareCurrentFile() {
    if (!signedUrl || !file || !canShare) return;
    const filename = file.originalName ?? file.name ?? "archivo";
    try {
      const res = await fetch(signedUrl);
      if (res.ok) {
        const blob = await res.blob();
        const shareFile = new File([blob], filename, { type: blob.type });
        if (navigator.canShare?.({ files: [shareFile] })) {
          await navigator.share({ files: [shareFile], title: filename });
          return;
        }
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.warn("[files] share as file failed, falling back to link", err);
    }
    try {
      await navigator.share({ url: signedUrl, title: filename });
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.warn("[files] share link failed", err);
      toast.error("No se pudo compartir el archivo");
    }
  }

  const gestureActive = dragging || pinching;

  // scale() is the fit-relative effective scale, so the image renders at its
  // natural box size and this brings it to "fills the visible area" at zoom 1.
  const imageTransformStyle = {
    transform: `rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1}) scale(${effectiveScale})`,
    transformOrigin: "center",
    transition: gestureActive ? "none" : "transform 120ms ease",
    width: naturalSize ? `${naturalSize.w}px` : undefined,
    height: naturalSize ? `${naturalSize.h}px` : undefined,
    maxWidth: "none",
    maxHeight: "none",
  };

  const panTransformStyle = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
    transition: gestureActive ? "none" : "transform 120ms ease",
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay
          style={{ zIndex }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200"
        />

        {/* Viewer panel — fills almost the full viewport */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          style={{ zIndex }}
          onPointerDownOutside={(e) => {
            // Prevent accidental close during pinch/pan gestures
            if (gestureRef.current.mode !== null) e.preventDefault();
          }}
          className={[
            "fixed inset-0 flex flex-col overflow-hidden",
            "glass-strong",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200",
          ].join(" ")}
        >
          {/* ── TOP BAR ─────────────────────────────────── */}
          <div className="flex items-center gap-2 px-3 h-12 safe-top shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]/60">
            {/* File info */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <FileVisual
                file={file}
                previewUrl={null}
                className="h-6 w-6 shrink-0 rounded opacity-80"
              />
              <div className="flex items-baseline gap-2 min-w-0">
                <DialogPrimitive.Title className="text-[13px] font-medium text-[hsl(var(--foreground))] truncate">
                  {file?.originalName ?? "Vista de archivo"}
                </DialogPrimitive.Title>
                {file?.sizeBytes > 0 && (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 shrink-0 hidden sm:inline tabular-nums">
                    {formatBytes(file.sizeBytes)}
                  </span>
                )}
              </div>
            </div>

            {/* Center: navigation counter */}
            {(files?.length ?? 0) > 1 && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => canPrev && onIndexChange(activeIndex - 1)}
                  disabled={!canPrev}
                  aria-label="Archivo anterior"
                  title="Anterior"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]/70 min-w-11 text-center tabular-nums select-none">
                  {activeIndex + 1} / {files.length}
                </span>
                <button
                  onClick={() => canNext && onIndexChange(activeIndex + 1)}
                  disabled={!canNext}
                  aria-label="Archivo siguiente"
                  title="Siguiente"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Right: actions + close */}
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Open-external/share assume `signedUrl` is a real, fetchable,
                  shareable resource. For an HLS source it's a blob: URL
                  wrapping manifest TEXT (see useHlsPlayback/ChatRecordingsGallery)
                  — opening/sharing it would hand the user a few hundred
                  bytes of "#EXTM3U..." mislabeled as a video. Download is
                  different: downloadCurrent below routes HLS through
                  downloadHlsAsMp4 (client-side remux to a real .mp4) instead
                  of the plain fetch+save path, so it stays visible. */}
              {!isHlsSource && (
                <button
                  onClick={() => signedUrl && window.open(signedUrl, "_blank")}
                  disabled={!signedUrl}
                  aria-label="Abrir en pestaña nueva"
                  title="Abrir externo"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
              {kind === "image" && (
                <button
                  onClick={copyCurrentImage}
                  disabled={!signedUrl}
                  aria-label="Copiar imagen"
                  title="Copiar imagen"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={downloadCurrent}
                disabled={!signedUrl || hlsDownloading}
                aria-label={isHlsSource ? "Descargar como MP4" : "Descargar archivo"}
                title={isHlsSource ? "Descargar como MP4 (se genera en tu navegador)" : "Descargar"}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
              >
                {hlsDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              </button>
              {canShare && !isHlsSource && (
                <button
                  onClick={shareCurrentFile}
                  disabled={!signedUrl}
                  aria-label="Compartir archivo"
                  title="Compartir"
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="w-px h-3.5 bg-[hsl(var(--border))] mx-1" />
              <DialogPrimitive.Close
                aria-label="Cerrar visor"
                title="Cerrar"
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-all duration-150"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* ── CONTENT AREA ────────────────────────────── */}
          {/* Right-click (desktop) / long-press (touch) anywhere over the file
              surface opens the Runly context menu instead of the browser's
              native one. Item list adapts to the current file kind. */}
          <ContextMenu>
            <ContextMenuTrigger asChild>
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {/* Loading state */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-[hsl(var(--muted-foreground))]/50" />
              </div>
            )}

            {/* No URL state */}
            {!loading && !signedUrl && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center border border-[hsl(var(--border))]">
                  <FileVisual
                    file={file}
                    previewUrl={null}
                    className="h-7 w-7 opacity-40"
                  />
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]/70">
                  Sin vista previa disponible.
                </p>
              </div>
            )}

            {/* Image viewer */}
            {!loading && signedUrl && kind === "image" && (
              <div
                className={`h-full w-full overflow-hidden flex items-center justify-center touch-none select-none ${
                  dragging ? "cursor-grabbing" : "cursor-grab"
                }`}
                ref={imageContainerRef}
                onDoubleClick={handleImageDoubleClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
                onPointerLeave={handlePointerEnd}
              >
                <div
                  style={panTransformStyle}
                  className="flex items-center justify-center"
                >
                  {/* Rendered at natural size; imageTransformStyle's scale()
                      is the fit-relative effective scale (zoom 1 == fits the
                      visible area). Hidden until measured to avoid a
                      one-frame full-resolution flash. */}
                  <img
                    src={signedUrl}
                    alt={file?.originalName ?? "Archivo"}
                    draggable={false}
                    onLoad={(e) =>
                      setNaturalSize({
                        w: e.currentTarget.naturalWidth,
                        h: e.currentTarget.naturalHeight,
                      })
                    }
                    className="will-change-transform pointer-events-none block"
                    style={{ ...imageTransformStyle, visibility: naturalSize ? "visible" : "hidden" }}
                  />
                </div>
              </div>
            )}

            {/* PDF viewer */}
            {!loading && signedUrl && kind === "pdf" && (
              <PDFViewer url={signedUrl} />
            )}

            {/* Video player (HLS: hls.js/native attaches via useHlsPlayback above, no src prop) */}
            {!loading && signedUrl && kind === "video" && isHlsSource && (
              <div className="h-full w-full flex items-center justify-center bg-black">
                <video
                  key={signedUrl}
                  ref={hlsVideoRef}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-full max-w-full"
                  style={{ outline: "none" }}
                />
              </div>
            )}

            {/* Video player (regular file — mp4/webm/etc.) */}
            {!loading && signedUrl && kind === "video" && !isHlsSource && (
              <div className="h-full w-full flex items-center justify-center bg-black">
                <video
                  key={signedUrl}
                  src={signedUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-full max-w-full"
                  style={{ outline: "none" }}
                />
              </div>
            )}

            {/* Audio player */}
            {!loading && signedUrl && kind === "audio" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8">
                <div className="h-20 w-20 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center border border-[hsl(var(--border))]">
                  <FileVisual file={file} previewUrl={null} className="h-10 w-10 opacity-60" />
                </div>
                <p className="text-sm font-medium text-center truncate max-w-xs">
                  {file?.originalName ?? file?.name ?? "Audio"}
                </p>
                <audio
                  key={signedUrl}
                  src={signedUrl}
                  controls
                  className="w-full max-w-sm"
                  style={{ outline: "none" }}
                />
              </div>
            )}

            {/* Generic (unsupported) */}
            {!loading && signedUrl && kind !== "image" && kind !== "pdf" && kind !== "video" && kind !== "audio" && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="w-full max-w-xs glass rounded-2xl p-6">
                  <div className="flex items-center gap-4 mb-5">
                    <FileVisual
                      file={file}
                      previewUrl={null}
                      className="h-12 w-12 rounded-xl bg-[hsl(var(--muted))] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[hsl(var(--foreground))] truncate">
                        {file?.originalName}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                        {getKindLabel(kind)}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]/70">
                        {formatBytes(file?.sizeBytes ?? 0)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]/70 mb-4 leading-relaxed">
                    {officeOpenable
                      ? "Este documento se edita en el editor de Office."
                      : "No hay vista previa disponible para este tipo de archivo."}
                  </p>
                  {officeOpenable && (
                    <button
                      onClick={() => {
                        onOpenChange(false);
                        onOpenInOffice(file);
                      }}
                      className="w-full h-9 mb-2 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] bg-[hsl(var(--primary))] hover:opacity-90 transition-opacity"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir en editor de Office
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={downloadCurrent}
                      className="flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted-foreground))]/20 transition-colors duration-150"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Descargar
                    </button>
                    <button
                      onClick={() => window.open(signedUrl, "_blank")}
                      className="flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted-foreground))]/20 transition-colors duration-150"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir
                    </button>
                    {canShare && (
                      <button
                        onClick={shareCurrentFile}
                        className="flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted-foreground))]/20 transition-colors duration-150"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Compartir
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Overlaid navigation arrows (multi-file). Independent of `loading`/
                `signedUrl` — this is generic chrome, not the active file's
                content, so it must stay put while the next file's content
                loads instead of flashing away and back on every click. */}
            {(files?.length ?? 0) > 1 && (
              <>
                {canPrev && (
                  <button
                    onClick={() => onIndexChange(activeIndex - 1)}
                    aria-label="Archivo anterior"
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl flex items-center justify-center glass text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                {canNext && (
                  <button
                    onClick={() => onIndexChange(activeIndex + 1)}
                    aria-label="Archivo siguiente"
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl flex items-center justify-center glass text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                )}
              </>
            )}

            {/* ── FLOATING GLASS FILMSTRIP (multi-file) ───────
                Overlays the content area (iOS Photos style) instead of a
                docked bar cramped against the bottom toolbar. Auto-hides
                while a pinch/pan gesture is running. Independent of `loading`
                for the same reason as the nav arrows above. */}
            {(files?.length ?? 0) > 1 && (
              <>
                {filmstripOpen ? (
                  <div
                    className={[
                      // PDFViewer renders its own full-height bottom toolbar
                      // inside this same content box (see the "PDF viewer"
                      // block above) — bottom-3 alone would float this right
                      // on top of it, so PDF gets pushed above that bar.
                      "absolute left-1/2 -translate-x-1/2 z-20",
                      kind === "pdf" ? "bottom-15" : "bottom-3",
                      "max-w-[calc(100%-1.5rem)] glass rounded-2xl p-1.5",
                      "flex items-center gap-1.5",
                      "transition-all duration-200",
                      gestureActive
                        ? "opacity-0 translate-y-2 pointer-events-none"
                        : "opacity-100",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2 overflow-x-auto px-0.5 py-0.5">
                      {files.map((f, i) => {
                        const fKind = getFileKind(f);
                        const mediaThumbUrl = mediaThumbUrls[f.id] ?? null;
                        return (
                          <button
                            key={f.id ?? i}
                            ref={(node) => {
                              if (node) thumbRefs.current.set(i, node);
                              else thumbRefs.current.delete(i);
                            }}
                            onClick={() => onIndexChange(i)}
                            aria-label={`Ir a ${f.originalName ?? f.name ?? `archivo ${i + 1}`}`}
                            aria-current={i === activeIndex}
                            className={[
                              "h-12 w-12 shrink-0 rounded-lg overflow-hidden transition-all duration-150",
                              i === activeIndex
                                ? "ring-2 ring-(--brand-primary) opacity-100"
                                : "opacity-50 hover:opacity-90",
                            ].join(" ")}
                          >
                            {fKind === "video" && mediaThumbUrl ? (
                              // #t=0.1 forces the browser to seek and paint
                              // that frame as a thumbnail — same trick as
                              // MessageAttachments.jsx's VideoCard.
                              <video
                                src={`${mediaThumbUrl}#t=0.1`}
                                className="h-12 w-12 object-cover pointer-events-none"
                                muted
                                playsInline
                                preload="metadata"
                              />
                            ) : (
                              <FileVisual
                                file={f}
                                previewUrl={fKind === "image" ? (f.thumbnailUrl ?? mediaThumbUrl) : null}
                                className="h-12 w-12 object-cover"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setFilmstripOpen(false)}
                      aria-label="Ocultar miniaturas"
                      title="Ocultar miniaturas"
                      className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/50 transition-colors"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setFilmstripOpen(true)}
                    aria-label="Mostrar miniaturas"
                    title="Mostrar miniaturas"
                    className={[
                      "absolute left-1/2 -translate-x-1/2 z-20",
                      kind === "pdf" ? "bottom-15" : "bottom-3",
                      "h-8 px-3 glass rounded-full flex items-center gap-1.5",
                      "text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                      "transition-all duration-200",
                      gestureActive ? "opacity-0 pointer-events-none" : "opacity-100",
                    ].join(" ")}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                    {activeIndex + 1} / {files.length}
                  </button>
                )}
              </>
            )}
          </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              style={{ zIndex: zIndex + 10 }}
              className="w-56"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {kind === "image" && (
                <ContextMenuItem onSelect={copyCurrentImage} disabled={!signedUrl}>
                  <Copy />
                  Copiar imagen
                </ContextMenuItem>
              )}
              <ContextMenuItem onSelect={downloadCurrent} disabled={!signedUrl}>
                <Download />
                Descargar
              </ContextMenuItem>
              {canShare && (
                <ContextMenuItem onSelect={shareCurrentFile} disabled={!signedUrl}>
                  <Share2 />
                  Compartir
                </ContextMenuItem>
              )}
              <ContextMenuItem onSelect={copyCurrentLink} disabled={!signedUrl}>
                <Link2 />
                Copiar enlace
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => signedUrl && window.open(signedUrl, "_blank")}
                disabled={!signedUrl}
              >
                <ExternalLink />
                Abrir en pestaña nueva
              </ContextMenuItem>

              {kind === "image" && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => setRotation((v) => v - 90)}>
                    <RotateCcw />
                    Rotar a la izquierda
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => setRotation((v) => v + 90)}>
                    <RotateCw />
                    Rotar a la derecha
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => setFlipX((v) => !v)}>
                    <FlipHorizontal2 />
                    Voltear horizontal
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => setFlipY((v) => !v)}>
                    <FlipVertical2 />
                    Voltear vertical
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={resetTransforms}>
                    <RefreshCw />
                    Restablecer vista
                  </ContextMenuItem>
                </>
              )}

              {(files?.length ?? 0) > 1 && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => canPrev && onIndexChange(activeIndex - 1)}
                    disabled={!canPrev}
                  >
                    <ChevronLeft />
                    Archivo anterior
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => canNext && onIndexChange(activeIndex + 1)}
                    disabled={!canNext}
                  >
                    <ChevronRight />
                    Archivo siguiente
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>

          {/* ── BOTTOM TOOLBAR ───────────────────────────── */}
          {/* Always reserved at the same height once a file is loaded, so
              the modal's shape stays uniform across file kinds instead of
              growing/shrinking as you page between an image and a video —
              only the image kind actually populates it with controls.
              Skipped for "pdf": PDFViewer already renders its own full-height
              toolbar (page nav + zoom/rotate/flip) at its own bottom edge —
              reserving this one too would stack two toolbars for PDFs only. */}
          {!loading && signedUrl && kind !== "pdf" && (
            <div className="flex items-center justify-center gap-1.5 px-3 h-12 safe-bottom shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]/60 overflow-x-auto">
              {kind === "image" && (
                <>
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
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
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
                </>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
