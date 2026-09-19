import { AlertCircle } from "lucide-react";
import { cn } from "../lib/utils.js";

// ─── Base styles ──────────────────────────────────────────────────────────────
// Canonical text-field chrome shared by FormFields.jsx, DatePickerField.jsx, and
// any other field-shaped trigger. Do not re-inline this string elsewhere — import
// `fieldCls` (or `FIELD_BASE`/`FIELD_NORMAL`/`FIELD_ERROR` for custom composition).

export const FIELD_BASE = [
  "h-11 w-full rounded-lg border px-3.5 text-sm glass-subtle",
  "bg-card text-foreground placeholder:text-muted-foreground",
  "transition-all duration-150 outline-none",
  "focus:ring-2 focus:ring-primary/20 focus:border-primary",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

export const FIELD_NORMAL = "border-border";
export const FIELD_ERROR =
  "border-destructive focus:ring-destructive/20 focus:border-destructive";

export function fieldCls(error, extra) {
  return cn(FIELD_BASE, error ? FIELD_ERROR : FIELD_NORMAL, extra);
}

// ─── InputIcon ────────────────────────────────────────────────────────────────

export function InputIcon({ icon: Icon }) {
  if (!Icon) return null;
  return (
    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10">
      <Icon size={14} strokeWidth={1.75} />
    </span>
  );
}

// ─── FieldWrapper ─────────────────────────────────────────────────────────────

export function FieldWrapper({
  label,
  labelFor,
  required,
  error,
  hint,
  children,
  className,
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 min-w-0", className)}>
      {label && (
        <label
          htmlFor={labelFor}
          className="text-[13px] font-medium leading-none text-foreground/80 select-none cursor-default"
        >
          {label}
          {required && (
            <span
              className="text-destructive ml-1 text-[11px]"
              aria-hidden="true"
            >
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-xs text-destructive leading-none"
        >
          <AlertCircle size={11} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}
