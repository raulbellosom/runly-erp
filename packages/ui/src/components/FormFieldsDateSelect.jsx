// packages/ui/src/components/FormFieldsDateSelect.jsx
//
// DateField, DateTimeField, YearField, SelectField, PhoneField. Extracted
// from FormFields.jsx on 2026-09-25 to keep that file under the CLAUDE.md
// 1000-line limit — re-exported from FormFields.jsx unchanged so every
// existing import path (package index and sibling components) keeps
// working without edits.
import { useState, useEffect, useMemo, forwardRef, useId } from "react";
import { Check, ChevronDown, ChevronUp, Phone, CalendarDays } from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "../lib/utils.js";
import { fieldCls, InputIcon, FieldWrapper } from "./form-field-base.jsx";
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

  function commit() {
    const next = composeDateTimeValue(
      draft.date,
      draft.hour,
      draft.minute,
      draft.meridiem,
    );
    if (validate) setLocalError(validate(next) || "");
    onChange?.({ target: { name, value: next } });
    setOpen(false);
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
              onClick={commit}
            >
              Aceptar
            </Button>
          }
        >
          <Calendar
            value={draft.date}
            onChange={(nextDate) =>
              setDraft((d) => ({ ...d, date: nextDate }))
            }
            onClose={() => {}}
          />
          <TimeWheel
            hour={draft.hour}
            minute={draft.minute}
            meridiem={draft.meridiem}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
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

export const SelectField = forwardRef(function SelectField(
  {
    label,
    error: externalError,
    hint,
    required,
    validate,
    id,
    icon,
    options = [],
    placeholder,
    value,
    onValueChange,
    onChange,
    disabled,
    className,
  },
  ref,
) {
  const [localError, setLocalError] = useState("");
  const error = externalError || localError;

  const handleValueChange = onValueChange ?? onChange;

  // Explicitly compute the label for the current value so Radix Select doesn't
  // have to rely on its DocumentFragment portal mechanism (unreliable with
  // programmatically-set values in React 19).
  const selectedLabel = useMemo(() => {
    if (!value) return null;
    const opt = options.find((o) =>
      typeof o === "string" ? o === value : o.value === value,
    );
    if (!opt) return null;
    return typeof opt === "string" ? opt : opt.label;
  }, [value, options]);

  function handleOpenChange(open) {
    if (!open && validate) {
      setLocalError(validate(value) || "");
    }
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
        <InputIcon icon={icon} />
        <SelectPrimitive.Root
          value={value || ""}
          onValueChange={handleValueChange}
          onOpenChange={handleOpenChange}
          disabled={disabled}
        >
          <SelectPrimitive.Trigger
            id={id}
            ref={ref}
            className={cn(
              fieldCls(
                error,
                cn(
                  "flex items-center justify-between cursor-pointer text-left gap-2",
                  icon && "pl-9",
                  className,
                ),
              ),
            )}
            aria-label={label}
          >
            <span
              className={cn(
                "flex-1 truncate text-sm",
                selectedLabel == null && "text-muted-foreground",
              )}
            >
              {selectedLabel != null ? (
                selectedLabel
              ) : (
                <SelectPrimitive.Value
                  placeholder={placeholder || "Seleccionar..."}
                />
              )}
            </span>
            <SelectPrimitive.Icon asChild>
              <ChevronDown
                size={14}
                strokeWidth={1.75}
                className="text-muted-foreground/60 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
              />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>

          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={5}
              className={cn(
                "z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg",
                "border border-border bg-card text-foreground shadow-xl",
                "data-[state=open]:animate-in data-[state=closed]:animate-out",
                "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
              )}
            >
              <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground">
                <ChevronUp size={13} />
              </SelectPrimitive.ScrollUpButton>

              <SelectPrimitive.Viewport className="p-1 max-h-64 overflow-y-auto">
                {options.map((opt) => {
                  const val = typeof opt === "string" ? opt : opt.value;
                  const lbl = typeof opt === "string" ? opt : opt.label;
                  // Radix Select throws on an empty-string item value. Skip such
                  // options rather than crash the whole screen.
                  if (val === "" || val == null) {
                    if (import.meta.env?.DEV) {
                      console.warn(
                        "[SelectField] skipped an option with an empty value:",
                        lbl,
                      );
                    }
                    return null;
                  }
                  return (
                    <SelectPrimitive.Item
                      key={val}
                      value={val}
                      className={cn(
                        "relative flex w-full cursor-default select-none items-center",
                        "rounded-md py-2 pl-8 pr-3 text-sm outline-none",
                        "transition-colors duration-100",
                        "focus:bg-muted focus:text-foreground",
                        "data-[state=checked]:text-primary data-[state=checked]:bg-primary/10 data-[state=checked]:font-medium",
                        "data-disabled:pointer-events-none data-disabled:opacity-50",
                      )}
                    >
                      <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
                        <SelectPrimitive.ItemIndicator>
                          <Check
                            size={11}
                            strokeWidth={2.5}
                            className="text-primary"
                          />
                        </SelectPrimitive.ItemIndicator>
                      </span>
                      <SelectPrimitive.ItemText>{lbl}</SelectPrimitive.ItemText>
                    </SelectPrimitive.Item>
                  );
                })}
              </SelectPrimitive.Viewport>

              <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground">
                <ChevronDown size={13} />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      </div>
    </FieldWrapper>
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
