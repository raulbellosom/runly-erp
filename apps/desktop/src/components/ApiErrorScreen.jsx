import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  WifiOff,
  ServerCrash,
  ShieldOff,
  Lock,
  Clock,
  Search,
  AlertTriangle,
  RefreshCcw,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Zap,
  Copy,
  Check,
} from "lucide-react";
import { classifyError } from "../lib/classifyError.js";

// ─── Runly isotype (official mark, theme-aware) ──────────────────────────────
function AtlasIsotype({ size = 40, muted = false }) {
  return (
    <>
      <img
        src="/runly/runly-isotipo-light.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        width={size}
        height={size}
        className="dark:hidden"
        style={{ opacity: muted ? 0.45 : 1, objectFit: "contain" }}
      />
      <img
        src="/runly/runly-isotipo-dark.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        width={size}
        height={size}
        className="hidden dark:block"
        style={{ opacity: muted ? 0.45 : 1, objectFit: "contain" }}
      />
    </>
  );
}

// ─── Per-type config ──────────────────────────────────────────────────────────
const ERROR_CONFIG = {
  network: {
    icon: WifiOff,
    color: "#21C7FF",
    glowColor: "rgba(33,199,255,0.22)",
    badge: "SIN CONEXION",
    title: "No se puede conectar con el servidor",
    description:
      "La API no responde. Verifica que el servidor esté corriendo y que tu red tenga acceso.",
    pulse: true,
  },
  unauthorized: {
    icon: Lock,
    color: "#f59e0b",
    glowColor: "rgba(245,158,11,0.22)",
    badge: "401 · No autorizado",
    title: "Sesión inválida o expirada",
    description:
      "Tu sesión no es válida o ha expirado. Inicia sesión nuevamente para continuar.",
    pulse: false,
  },
  forbidden: {
    icon: ShieldOff,
    color: "#f97316",
    glowColor: "rgba(249,115,22,0.22)",
    badge: "403 · Prohibido",
    title: "Acceso denegado",
    description:
      "No tienes permisos para acceder a este recurso. Contacta al administrador.",
    pulse: false,
  },
  not_found: {
    icon: Search,
    color: "#8b5cf6",
    glowColor: "rgba(139,92,246,0.22)",
    badge: "404 · No encontrado",
    title: "Recurso no encontrado",
    description: "El recurso solicitado no existe o fue eliminado.",
    pulse: false,
  },
  timeout: {
    icon: Clock,
    color: "#f59e0b",
    glowColor: "rgba(245,158,11,0.22)",
    badge: "408 · Tiempo agotado",
    title: "La solicitud tardó demasiado",
    description:
      "El servidor no respondió en el tiempo esperado. Puede estar sobrecargado.",
    pulse: true,
  },
  validation: {
    icon: AlertTriangle,
    color: "#f97316",
    glowColor: "rgba(249,115,22,0.22)",
    badge: "422 · Datos inválidos",
    title: "Datos de la solicitud incorrectos",
    description:
      "La solicitud contiene datos que el servidor no puede procesar.",
    pulse: false,
  },
  rate_limit: {
    icon: Zap,
    color: "#f59e0b",
    glowColor: "rgba(245,158,11,0.22)",
    badge: "429 · Demasiadas solicitudes",
    title: "Límite de solicitudes alcanzado",
    description:
      "Has enviado demasiadas solicitudes en poco tiempo. Espera un momento.",
    pulse: true,
  },
  server_error: {
    icon: ServerCrash,
    color: "#ef4444",
    glowColor: "rgba(239,68,68,0.22)",
    badge: "500 · Error del servidor",
    title: "Error interno del servidor",
    description:
      "El servidor encontró un problema inesperado. Inténtalo de nuevo o contacta soporte.",
    pulse: false,
  },
  bad_gateway: {
    icon: ServerCrash,
    color: "#ef4444",
    glowColor: "rgba(239,68,68,0.22)",
    badge: "502 · Bad Gateway",
    title: "Servidor no disponible",
    description:
      "El servidor intermediario no pudo comunicarse con el API. Verifica el estado del sistema.",
    pulse: true,
  },
  unavailable: {
    icon: ServerCrash,
    color: "#ef4444",
    glowColor: "rgba(239,68,68,0.22)",
    badge: "503 · Servicio no disponible",
    title: "El servicio está temporalmente fuera de línea",
    description:
      "El servicio no está disponible en este momento. Puede estar en mantenimiento.",
    pulse: true,
  },
  client_error: {
    icon: AlertTriangle,
    color: "#f59e0b",
    glowColor: "rgba(245,158,11,0.22)",
    badge: "Error del cliente",
    title: "Error en la solicitud",
    description:
      "La solicitud no pudo completarse. Verifica los datos e inténtalo de nuevo.",
    pulse: false,
  },
  unknown: {
    icon: AlertTriangle,
    color: "#ef4444",
    glowColor: "rgba(239,68,68,0.22)",
    badge: "Error inesperado",
    title: "Ocurrió un error inesperado",
    description:
      "Algo salió mal. Intenta recargar la página o contacta al soporte técnico.",
    pulse: false,
  },
};

// ─── Animated icon ────────────────────────────────────────────────────────────
function AnimatedErrorIcon({ Icon, color, glowColor, pulse, reduced }) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer glow ring */}
      {!reduced && (
        <motion.div
          className="absolute rounded-full"
          style={{ width: 120, height: 120, background: glowColor }}
          animate={
            pulse
              ? { scale: [1, 1.18, 1], opacity: [0.6, 0.15, 0.6] }
              : { scale: 1, opacity: 0.5 }
          }
          transition={
            pulse ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : {}
          }
        />
      )}
      {/* Mid ring */}
      {!reduced && (
        <motion.div
          className="absolute rounded-full border"
          style={{
            width: 88,
            height: 88,
            borderColor: color,
            opacity: 0.22,
          }}
          animate={
            pulse ? { scale: [1, 1.08, 1], opacity: [0.22, 0.06, 0.22] } : {}
          }
          transition={
            pulse
              ? {
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.3,
                }
              : {}
          }
        />
      )}
      {/* Icon container */}
      <motion.div
        className="relative z-10 flex items-center justify-center rounded-2xl"
        style={{
          width: 72,
          height: 72,
          background: `${glowColor.replace("0.22", "0.12")}`,
          border: `1.5px solid ${color}30`,
          boxShadow: `0 0 32px ${glowColor}, 0 0 8px ${glowColor}`,
        }}
        initial={reduced ? false : { scale: 0.5, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        <Icon size={30} style={{ color }} strokeWidth={1.8} />
      </motion.div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
/**
 * ApiErrorScreen
 *
 * @param {object}   props
 * @param {Error}    props.error          The error object to classify and display.
 * @param {Function} props.onRetry        Callback for the "Reintentar" action.
 * @param {boolean}  props.fullScreen     If true (default), fills the full viewport.
 * @param {string}   props.context        Optional context label shown in details.
 * @param {string}   props.componentStack Optional React component stack (from componentDidCatch).
 */
export function ApiErrorScreen({ error, onRetry, fullScreen = true, context, componentStack }) {
  const reduced = useReducedMotion();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const { type, code } = classifyError(error);
  const cfg = ERROR_CONFIG[type] ?? ERROR_CONFIG.unknown;
  const Icon = cfg.icon;

  const summary = error?.message
    ? code
      ? `HTTP ${code} — ${error.message}`
      : error.message
    : "Sin detalles disponibles";
  // Everything a real diagnosis needs — not just the one-line message the
  // badge/summary already shows. error.stack already includes name+message,
  // so this is the JS stack (where it threw) plus the React tree (what was
  // rendering when it threw), the two things DevTools' console gives you
  // that this screen didn't before.
  const fullDetails = [
    context ? `Contexto: ${context}` : null,
    error?.stack || summary,
    componentStack ? `Component stack:${componentStack}` : null,
  ].filter(Boolean).join("\n\n");

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(fullDetails);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (permissions, insecure context) — the
      // details are still fully visible and selectable in the box below.
    }
  }

  const wrapperClass = fullScreen
    ? "fixed inset-0 z-[300] flex flex-col items-center justify-center overflow-hidden"
    : "flex min-h-[60dvh] flex-col items-center justify-center";

  return (
    <div
      className={wrapperClass}
      style={{ background: "hsl(var(--background))" }}
    >
      {/* ── Ambient background ────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 45%, ${cfg.glowColor}, transparent 72%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(10,29,68,0.35), transparent 70%)",
        }}
      />

      {/* ── Content card ─────────────────────────────────────── */}
      <motion.div
        className="relative z-10 flex w-full max-w-sm flex-col items-center gap-6 px-6"
        initial={reduced ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Brand header */}
        <div className="flex items-center gap-2 opacity-60">
          <AtlasIsotype size={22} muted />
          <span
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Runly ERP
          </span>
        </div>

        {/* Animated icon */}
        <AnimatedErrorIcon
          Icon={Icon}
          color={cfg.color}
          glowColor={cfg.glowColor}
          pulse={cfg.pulse}
          reduced={reduced}
        />

        {/* Badge */}
        <motion.span
          className="rounded-full px-3 py-1 text-[10px] font-bold tracking-widest uppercase"
          style={{
            background: `${cfg.glowColor}`,
            border: `1px solid ${cfg.color}40`,
            color: cfg.color,
          }}
          initial={reduced ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: 0.12 }}
        >
          {cfg.badge}
        </motion.span>

        {/* Text */}
        <motion.div
          className="flex flex-col items-center gap-2 text-center"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.2 }}
        >
          <h1
            className="text-lg font-semibold leading-snug tracking-tight"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {cfg.title}
          </h1>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {cfg.description}
          </p>
        </motion.div>

        {/* Actions */}
        <motion.div
          className="flex w-full flex-col gap-2 sm:flex-row"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.3 }}
        >
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 hover:brightness-110 active:scale-[0.97]"
              style={{
                background: cfg.color,
                color:
                  type === "network" ||
                  type === "bad_gateway" ||
                  type === "unavailable"
                    ? "#0A1D44"
                    : "#fff",
              }}
            >
              <RefreshCcw size={15} strokeWidth={2.2} />
              Reintentar
            </button>
          )}
          <button
            onClick={() => window.location.reload()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-150 hover:bg-[hsl(var(--muted))] active:scale-[0.97]"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <RotateCcw size={14} strokeWidth={2} />
            Recargar
          </button>
        </motion.div>

        {/* Technical details toggle */}
        <motion.div
          className="w-full"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.42 }}
        >
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 text-xs transition-colors duration-150 hover:opacity-80"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showDetails ? "Ocultar detalles" : "Ver detalles técnicos"}
          </button>

          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div
                  className="relative mt-3 rounded-xl p-3"
                  style={{
                    background: "hsl(var(--muted))",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  <button
                    onClick={copyDetails}
                    className="absolute right-2 top-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors duration-150 hover:bg-[hsl(var(--background))]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                    aria-label="Copiar detalles del error"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                  <pre
                    className="max-h-64 overflow-auto whitespace-pre-wrap break-all pr-14 font-mono text-[11px] leading-relaxed"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {fullDetails}
                  </pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}
