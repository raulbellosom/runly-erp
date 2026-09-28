import { Check } from "lucide-react";
import { cn } from "../lib/utils.js";
import { FieldWrapper } from "./form-field-base.jsx";

// Default accent palette — finance-friendly, works on the dark glass surfaces.
export const DEFAULT_SWATCHES = [
  "#0ea5e9", // sky
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f97316", // orange
  "#f59e0b", // amber
  "#22c55e", // green
  "#14b8a6", // teal
  "#64748b", // slate
];

/**
 * SwatchField — pick an accent color from a small preset palette.
 * Replaces a raw <input type="color"> where only a themeable accent is needed.
 *
 * Props: label, value (hex), onChange(hex), swatches?, required, error, hint, className
 */
export function SwatchField({
  label,
  value,
  onChange,
  swatches = DEFAULT_SWATCHES,
  required,
  error,
  hint,
  className,
  id,
  disabled = false,
}) {
  return (
    <FieldWrapper label={label} labelFor={id} required={required} error={error} hint={hint}>
      <div className={cn("flex flex-wrap gap-2", className)} role="radiogroup" aria-label={label}>
        {swatches.map((hex) => {
          const active = String(value ?? "").toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={hex}
              disabled={disabled}
              onClick={() => onChange(hex)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-transform",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100",
                "ring-offset-2 ring-offset-[hsl(var(--background))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                active ? "scale-110 ring-2 ring-[hsl(var(--foreground))]" : "hover:scale-105",
              )}
              style={{ backgroundColor: hex }}
            >
              {active && <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </FieldWrapper>
  );
}
