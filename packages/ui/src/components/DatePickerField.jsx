import { useState, useId } from "react";
import { CalendarDays } from "lucide-react";
import { FieldWrapper, fieldCls } from "./form-field-base.jsx";
import { cn } from "../lib/utils.js";
import { Calendar, DateSelectorShell, formatDateDisplay } from "./date-picker-shared.jsx";

export function DatePickerField({
  label,
  value,
  onChange,
  required,
  error,
  hint,
  placeholder = "Seleccionar fecha",
  className,
  disabled,
  compact = false,
  id: externalId,
}) {
  const autoId = useId();
  const id = externalId ?? autoId;
  const [open, setOpen] = useState(false);

  const displayValue = formatDateDisplay(value);

  const trigger = (
    <button
      id={compact ? undefined : id}
      type="button"
      disabled={disabled}
      aria-label={label ?? "Seleccionar fecha"}
      className={
        compact
          ? cn(
              "h-7 rounded-md border px-2 text-xs text-left flex items-center gap-1.5 bg-[hsl(var(--background))] transition-colors",
              "outline-none justify-between gap-2 disabled:cursor-not-allowed disabled:opacity-50",
              error
                ? "border-destructive focus:ring-destructive/20 focus:border-destructive"
                : "border-input",
            )
          : fieldCls(
              error,
              "text-left flex items-center justify-between gap-2",
            )
      }
    >
      <span className={cn(!displayValue && "text-muted-foreground/70")}>
        {displayValue || placeholder}
      </span>
      <CalendarDays
        size={compact ? 12 : 14}
        className="text-muted-foreground/70 shrink-0"
      />
    </button>
  );

  const picker = (
    <DateSelectorShell
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      title={typeof label === "string" ? label : "Seleccionar fecha"}
    >
      <Calendar
        value={value}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
      {value && (
        <div className="mt-2 pt-2 border-t border-[hsl(var(--border))] w-full">
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="w-full text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors py-1"
          >
            Limpiar fecha
          </button>
        </div>
      )}
    </DateSelectorShell>
  );

  if (compact) return picker;

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      required={required}
      error={error}
      hint={hint}
      className={className}
    >
      {picker}
    </FieldWrapper>
  );
}
