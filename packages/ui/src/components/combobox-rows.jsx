// packages/ui/src/components/combobox-rows.jsx
//
// Visual building blocks of the unified Combobox (Combobox.jsx): search
// header, option rows (icon / avatar / color swatch / badge / description /
// trailing hint), group headers, match highlighting, empty / loading / error
// states and the sticky "Crear" footer. Pure presentation — all state and
// keyboard handling lives in Combobox.jsx.
import { isValidElement, useMemo } from "react";
import { AlertCircle, Check, CornerDownLeft, Loader2, Plus, Search, SearchX, X } from "lucide-react";
import { cn } from "../lib/utils.js";

// ─── Option visual (leading slot) ────────────────────────────────────────────

const AVATAR_TONES = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];

function initialsOf(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function toneOf(name) {
  let hash = 0;
  for (const ch of String(name ?? "")) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

// `option.avatar` may be a URL string or { src, name }; without a src the
// avatar falls back to colored initials derived from the name/label.
export function OptionVisual({ option, size = "md" }) {
  if (!option) return null;
  const px = size === "sm" ? "h-4 w-4 text-[8px]" : "h-5 w-5 text-[9px]";
  if (option.avatar !== undefined) {
    const avatar = typeof option.avatar === "string" ? { src: option.avatar } : option.avatar ?? {};
    const name = avatar.name ?? option.label;
    return avatar.src ? (
      <img src={avatar.src} alt="" className={cn(px, "shrink-0 rounded-full object-cover ring-1 ring-foreground/10")} />
    ) : (
      <span className={cn(px, "shrink-0 rounded-full inline-flex items-center justify-center font-semibold", toneOf(name))}>
        {initialsOf(name)}
      </span>
    );
  }
  if (option.color) {
    return (
      <span
        className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0 rounded-full ring-1 ring-inset ring-foreground/15")}
        style={{ backgroundColor: option.color }}
      />
    );
  }
  if (option.icon) {
    if (isValidElement(option.icon)) return <span className="shrink-0 inline-flex text-muted-foreground">{option.icon}</span>;
    const Icon = option.icon;
    return <Icon size={size === "sm" ? 13 : 15} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  return null;
}

// ─── Match highlighting ──────────────────────────────────────────────────────

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function HighlightedText({ text, search }) {
  const parts = useMemo(() => {
    const words = String(search ?? "").trim().split(/\s+/).filter(Boolean);
    if (typeof text !== "string" || words.length === 0) return null;
    const re = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi");
    return text.split(re);
  }, [text, search]);
  if (!parts) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-transparent text-foreground font-semibold underline decoration-primary/60 decoration-2 underline-offset-[3px]">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

// ─── Search header ───────────────────────────────────────────────────────────

export function ComboboxSearch({ inputRef, value, onChange, onClear, onKeyDown, placeholder, busy, listId, activeId }) {
  return (
    <div className="flex items-center gap-2.5 px-3 h-11 border-b border-foreground/[0.08]">
      <Search size={15} strokeWidth={2} className={cn("shrink-0 transition-colors duration-150", value ? "text-foreground" : "text-muted-foreground")} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        className="flex-1 min-w-0 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground/80"
      />
      {busy ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
      ) : value ? (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          aria-label="Limpiar búsqueda"
          className="runly-cbx-pop flex items-center justify-center h-5 w-5 rounded-full bg-foreground/[0.08] text-muted-foreground hover:bg-foreground/15 hover:text-foreground transition-colors shrink-0 cursor-pointer"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export function GroupHeader({ label, first }) {
  return (
    <div
      role="presentation"
      className={cn(
        "px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground select-none",
        first ? "pt-1.5" : "mt-1 pt-2.5 border-t border-foreground/[0.06]",
      )}
    >
      {label}
    </div>
  );
}

export function OptionRow({ id, index, option, active, selected, multiple, search, staggerDelay, onPick, onHover }) {
  const title = option.meta?.title ?? option.label;
  const badge = option.badge ?? option.meta?.badge;
  const description = option.description ?? option.meta?.subtitle;
  return (
    <button
      id={id}
      type="button"
      tabIndex={-1}
      role="option"
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      data-nav-index={index}
      disabled={option.disabled}
      onClick={() => onPick(option)}
      onMouseMove={onHover}
      style={staggerDelay != null ? { animationDelay: `${staggerDelay}ms` } : undefined}
      className={cn(
        "relative z-[1] w-full min-h-9 flex items-center gap-2.5 px-2.5 text-left text-sm rounded-lg outline-none cursor-pointer",
        "transition-colors duration-100",
        description ? "py-2" : "py-1.5",
        selected ? "text-foreground font-medium" : active ? "text-foreground" : "text-foreground/85",
        option.disabled && "opacity-45 cursor-not-allowed",
        staggerDelay != null && "runly-cbx-item-in",
      )}
    >
      {multiple && (
        <span
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-foreground/25 bg-transparent",
          )}
        >
          {selected && <Check size={11} strokeWidth={3} className="runly-cbx-pop" />}
        </span>
      )}
      <OptionVisual option={option} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          {badge ? (
            <span className="inline-flex items-center rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-foreground shrink-0">
              {badge}
            </span>
          ) : null}
          <span className="truncate">
            <HighlightedText text={title} search={search} />
          </span>
        </span>
        {description ? (
          <span className="block text-xs font-normal text-muted-foreground truncate mt-0.5">
            <HighlightedText text={description} search={search} />
          </span>
        ) : null}
      </span>
      {option.hint ? (
        <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{option.hint}</span>
      ) : null}
      {!multiple && (
        <span className="w-4 shrink-0 flex justify-end">
          {selected && <Check size={15} strokeWidth={2.5} className="runly-cbx-pop text-primary" />}
        </span>
      )}
    </button>
  );
}

export function CreateFooter({ id, index, active, term, text, isCreating, disabled, onClick, onHover }) {
  const blocked = disabled || isCreating;
  return (
    <div className="p-1 border-t border-foreground/[0.08]">
      <button
        id={id}
        type="button"
        tabIndex={-1}
        role="option"
        aria-selected={active}
        data-nav-index={index}
        disabled={blocked}
        onClick={onClick}
        onMouseMove={onHover}
        className={cn(
          "w-full min-h-9 flex items-center gap-2.5 px-2.5 py-1.5 text-left text-sm rounded-lg outline-none cursor-pointer transition-colors duration-100",
          active ? "bg-primary/12" : "hover:bg-primary/[0.08]",
          blocked && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          {isCreating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} strokeWidth={2.75} />}
        </span>
        <span className="flex-1 min-w-0 truncate text-foreground">
          {isCreating ? "Creando..." : text ? (
            <span className="font-medium">{text}</span>
          ) : (
            <>
              Crear <span className="font-semibold">&laquo;{term}&raquo;</span>
            </>
          )}
        </span>
        <CornerDownLeft
          size={13}
          className={cn("shrink-0 text-muted-foreground transition-opacity duration-150", active ? "opacity-100" : "opacity-0")}
        />
      </button>
    </div>
  );
}

// ─── States ──────────────────────────────────────────────────────────────────

export function ComboboxEmpty({ icon: Icon = SearchX, title, description }) {
  return (
    <div className="runly-cbx-fade flex flex-col items-center justify-center text-center px-4 py-6">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/[0.06] text-muted-foreground mb-2.5">
        <Icon size={17} strokeWidth={1.75} />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 text-xs text-muted-foreground max-w-[15rem] leading-relaxed">{description}</p> : null}
    </div>
  );
}

const SKELETON_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3"];

export function ComboboxSkeleton({ label = "Cargando opciones..." }) {
  return (
    <div role="status" aria-label={label} className="p-1 space-y-0.5">
      {SKELETON_WIDTHS.map((w, i) => (
        <div key={w} className="flex items-center gap-2.5 h-9 px-2.5">
          <span className="h-4 w-4 rounded-full bg-foreground/[0.07] animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
          <span className={cn("h-2.5 rounded-full bg-foreground/[0.07] animate-pulse", w)} style={{ animationDelay: `${i * 90}ms` }} />
        </div>
      ))}
    </div>
  );
}

export function ComboboxError({ onRetry }) {
  return (
    <div className="runly-cbx-fade flex flex-col items-center text-center px-4 py-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive mb-2.5">
        <AlertCircle size={17} strokeWidth={1.75} />
      </span>
      <p className="text-sm font-medium text-foreground">No se pudieron cargar las opciones</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs font-medium text-primary hover:underline underline-offset-2 cursor-pointer"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
