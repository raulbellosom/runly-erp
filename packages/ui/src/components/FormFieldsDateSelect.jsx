// packages/ui/src/components/FormFieldsDateSelect.jsx
//
// DateField, DateTimeField, YearField, SelectField, PhoneField. Extracted
// from FormFields.jsx on 2026-09-25 to keep that file under the CLAUDE.md
// 1000-line limit — re-exported from FormFields.jsx unchanged so every
// existing import path (package index and sibling components) keeps
// working without edits.
import { useState, useEffect, useMemo, forwardRef, useId } from "react";
import { Phone, CalendarDays } from "lucide-react";
import { cn } from "../lib/utils.js";
import { fieldCls, InputIcon, FieldWrapper } from "./form-field-base.jsx";
import { Combobox } from "./Combobox.jsx";
import {
  Calendar,
  DateSelectorShell,
  formatDateDisplay,
  formatDateTimeDisplay,
  parseDateTimeValue,
  composeDateTimeValue,
} from "./date-picker-shared.jsx";
import { TimeWheel } from "./TimeWheel.jsx";
import { Button } from "./Button.jsx";

// ─── DateField ────────────────────────────────────────────────────────────────

export const DateField = forwardRef(function DateField(
  {
    label,
    error: externalError,
    hint,
    required,
    validate,
    onBlur,
    onChange,
    value,
    id,
    icon,
    className,
    disabled,
    name,
    placeholder = "Seleccionar fecha",
  },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [localError, setLocalError] = useState("");
  const [open, setOpen] = useState(false);
  const error = externalError || localError;

  function emitChange(nextValue) {
    const next = nextValue ?? "";
    if (validate) setLocalError(validate(next) || "");
    onChange?.({ target: { name, value: next } });
  }

  const displayValue = formatDateDisplay(value);

  const trigger = (
    <button
      ref={ref}
      id={fieldId}
      name={name}
      type="button"
      disabled={disabled}
      className={fieldCls(
        error,
        cn(
          icon && "pl-9",
          "text-left flex items-center justify-between gap-2",
          className,
        ),
      )}
    >
      <span
        className={cn(
          "flex-1 truncate",
          !displayValue && "text-muted-foreground/70",
        )}
      >
        {displayValue || placeholder}
      </span>
      <CalendarDays size={14} className="text-muted-foreground shrink-0" />
    </button>
  );

  return (
    <FieldWrapper
      label={label}
      labelFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative">
        <InputIcon icon={icon} />
        <DateSelectorShell
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) onBlur?.();
          }}
          trigger={trigger}
          title={typeof label === "string" ? label : "Seleccionar fecha"}
        >
          <Calendar
            value={value}
            onChange={emitChange}
            onClose={() => setOpen(false)}
          />
          {value && (
            <div className="mt-2 pt-2 border-t border-[hsl(var(--border))] w-full">
              <button
                type="button"
                onClick={() => {
                  emitChange(undefined);
                  setOpen(false);
                }}
                className="w-full text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors py-1"
              >
                Limpiar fecha
              </button>
            </div>
          )}
        </DateSelectorShell>
      </div>
    </FieldWrapper>
  );
});

// ─── DateTimeField ────────────────────────────────────────────────────────────

export const DateTimeField = forwardRef(function DateTimeField(
  {
    label,
    error: externalError,
    hint,
    required,
    validate,
    onBlur,
    onChange,
    value,
    id,
    icon,
    className,
    disabled,
    name,
    placeholder = "Seleccionar fecha y hora",
  },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [localError, setLocalError] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parseDateTimeValue(value));
  const error = externalError || localError;

  // Keep the working draft in sync with the committed value whenever the
  // picker is closed, instead of only re-syncing inside the open-transition
  // handler — removes any dependency on exact click/render-order timing.
  useEffect(() => {
    if (!open) setDraft(parseDateTimeValue(value));
  }, [value, open]);

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) onBlur?.();
  }

  // Every pick (day or time) is applied immediately so the trigger always
  // shows the value being built; "Listo" only closes the picker.
  function updateDraft(patch) {
    const nextDraft = { ...draft, ...patch };
    setDraft(nextDraft);
    const next = composeDateTimeValue(
      nextDraft.date,
      nextDraft.hour,
      nextDraft.minute,
      nextDraft.meridiem,
    );
    if (!next) return;
    if (validate) setLocalError(validate(next) || "");
    onChange?.({ target: { name, value: next } });
  }

  const displayValue = formatDateTimeDisplay(value);

  const trigger = (
    <button
      ref={ref}
      id={fieldId}
      name={name}
      type="button"
      disabled={disabled}
      className={fieldCls(
        error,
        cn(
          icon && "pl-9",
          "min-w-0 text-left flex items-center justify-between gap-2",
          className,
        ),
      )}
    >
      <span
        className={cn(
          "flex-1 truncate",
          !displayValue && "text-muted-foreground/70",
        )}
      >
        {displayValue || placeholder}
      </span>
      <CalendarDays size={14} className="text-muted-foreground shrink-0" />
    </button>
  );

  return (
    <FieldWrapper
      label={label}
      labelFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative">
        <InputIcon icon={icon} />
        <DateSelectorShell
          open={open}
          onOpenChange={handleOpenChange}
          trigger={trigger}
          title={typeof label === "string" ? label : "Seleccionar fecha y hora"}
          footer={
            <Button
              type="button"
              size="sm"
              className="w-full mt-3"
              onClick={() => handleOpenChange(false)}
            >
              Listo
            </Button>
          }
        >
          <Calendar
            value={draft.date}
            onChange={(nextDate) => updateDraft({ date: nextDate })}
            onClose={() => {}}
          />
          <TimeWheel
            hour={draft.hour}
            minute={draft.minute}
            meridiem={draft.meridiem}
            onChange={(next) => updateDraft(next)}
          />
        </DateSelectorShell>
      </div>
    </FieldWrapper>
  );
});

// ─── YearField ────────────────────────────────────────────────────────────────

export function YearField({
  label,
  error: externalError,
  hint,
  required,
  validate,
  onBlur,
  id,
  icon,
  value,
  onChange,
  min = 1900,
  max = 2100,
  className,
  ...props
}) {
  const [localError, setLocalError] = useState("");
  const error = externalError || localError;

  function handleBlur(e) {
    if (validate) setLocalError(validate(e.target.value) || "");
    onBlur?.(e);
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative w-32">
        <InputIcon icon={icon} />
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={onChange}
          onBlur={handleBlur}
          placeholder={String(new Date().getFullYear())}
          className={fieldCls(
            error,
            cn(
              "w-32",
              icon && "pl-9",
              "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
              className,
            ),
          )}
          {...props}
        />
      </div>
    </FieldWrapper>
  );
}

// ─── SelectField ─────────────────────────────────────────────────────────────
// Preset over the unified Combobox: the search box appears automatically once
// the list is long enough (> 8 options). Options may be strings or
// `{ value, label, icon?, disabled?, ... }` (any Combobox option field works).

export const SelectField = forwardRef(function SelectField(
  { validate, error: externalError, options = [], value, onValueChange, onChange, className, ...props },
  ref,
) {
  const [localError, setLocalError] = useState("");
  const error = externalError || localError;

  // Empty-string values were never selectable (Radix threw on them); keep
  // skipping them so existing option lists render the same.
  const cleanOptions = useMemo(
    () =>
      options.filter((opt) => {
        const val = typeof opt === "object" && opt !== null ? opt.value : opt;
        return val !== "" && val != null;
      }),
    [options],
  );

  return (
    <Combobox
      ref={ref}
      searchable="auto"
      triggerClassName={className}
      error={error}
      options={cleanOptions}
      value={value}
      onChange={onValueChange ?? onChange}
      onOpenChange={(open) => {
        if (!open && validate) setLocalError(validate(value) || "");
      }}
      {...props}
    />
  );
});

// ─── PhoneField ───────────────────────────────────────────────────────────────

export const PhoneField = forwardRef(function PhoneField(
  {
    label,
    error: externalError,
    hint,
    required,
    validate,
    onBlur,
    id,
    className,
    ...props
  },
  ref,
) {
  const [localError, setLocalError] = useState("");
  const error = externalError || localError;

  function handleBlur(e) {
    if (validate) setLocalError(validate(e.target.value) || "");
    onBlur?.(e);
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative">
        <InputIcon icon={Phone} />
        <input
          ref={ref}
          id={id}
          type="tel"
          inputMode="tel"
          onBlur={handleBlur}
          className={fieldCls(error, cn("pl-9", className))}
          {...props}
        />
      </div>
    </FieldWrapper>
  );
});
