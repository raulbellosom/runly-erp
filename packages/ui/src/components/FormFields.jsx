import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useMemo,
  useId,
} from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  EyeOff,
  AlertCircle,
  Upload,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  Phone,
  Tag,
  Search,
  Plus,
  CalendarDays,
} from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "../lib/utils.js";
import { useIsolatedScroll } from "../hooks/useIsolatedScroll.js";
import { useComboboxPopover, computeDropdownStyle } from "../hooks/useComboboxPopover.js";
import { LoadingState } from "./LoadingState.jsx";
import {
  FIELD_BASE,
  FIELD_NORMAL,
  FIELD_ERROR,
  fieldCls,
  InputIcon,
  FieldWrapper,
} from "./form-field-base.jsx";
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

export { FieldWrapper };

// ─── TextField ────────────────────────────────────────────────────────────────

export const TextField = forwardRef(function TextField(
  {
    label,
    error: externalError,
    hint,
    required,
    validate,
    onBlur,
    id,
    icon,
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
        <input
          ref={ref}
          id={id}
          className={fieldCls(error, cn(icon && "pl-9", className))}
          onBlur={handleBlur}
          {...props}
        />
        <InputIcon icon={icon} />
      </div>
    </FieldWrapper>
  );
});

// ─── PasswordField ────────────────────────────────────────────────────────────

function calcStrength(pw) {
  if (!pw || pw.length < 1) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

const STRENGTH_META = [
  null,
  {
    label: "Muy débil",
    color: "bg-destructive",
    tip: "Agrega más caracteres para mejorar la seguridad.",
  },
  {
    label: "Débil",
    color: "bg-warning",
    tip: "Agrega una mayúscula o un número.",
  },
  {
    label: "Buena",
    color: "bg-primary/70",
    tip: "Agrega un símbolo para hacerla más fuerte.",
  },
  {
    label: "Fuerte",
    color: "bg-success",
    tip: "Excelente. Tu contraseña es segura.",
  },
];

const STRENGTH_CRITERIA = [
  { label: "Al menos 8 caracteres", test: (pw) => pw.length >= 8 },
  { label: "Al menos 12 caracteres", test: (pw) => pw.length >= 12 },
  { label: "Una letra mayúscula", test: (pw) => /[A-Z]/.test(pw) },
  { label: "Un número", test: (pw) => /[0-9]/.test(pw) },
  { label: "Un símbolo (!@#$…)", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export function PasswordField({
  label,
  error: externalError,
  hint,
  required,
  validate,
  onBlur,
  id,
  icon,
  showStrength = false,
  value,
  onChange,
  className,
  ...props
}) {
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState("");
  const [focused, setFocused] = useState(false);
  const error = externalError || localError;
  const strength = showStrength ? calcStrength(value || "") : 0;
  const meta = STRENGTH_META[strength];

  function handleBlur(e) {
    setFocused(false);
    if (validate) setLocalError(validate(e.target.value) || "");
    onBlur?.(e);
  }

  const showBar = showStrength && value && value.length > 0;

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          className={fieldCls(error, cn(icon && "pl-9", "pr-11", className))}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          autoComplete="new-password"
          {...props}
        />
        <InputIcon icon={icon} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150 z-10"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      {showBar && (
        <div className="mt-3 space-y-2.5">
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-300",
                    i <= strength ? meta?.color : "bg-muted",
                  )}
                />
              ))}
            </div>
            {meta && (
              <div className="flex items-baseline justify-between gap-4">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    strength === 1 && "text-destructive",
                    strength === 2 && "text-warning",
                    strength === 3 && "text-primary/80",
                    strength === 4 && "text-success",
                  )}
                >
                  {meta.label}
                </span>
                <span className="text-[11px] text-muted-foreground text-right leading-snug">
                  {meta.tip}
                </span>
              </div>
            )}
          </div>
          {(focused || strength < 4) && (
            <ul className="grid grid-cols-1 gap-1 pt-2 border-t border-border/40">
              {STRENGTH_CRITERIA.map(({ label, test }) => {
                const met = test(value || "");
                return (
                  <li
                    key={label}
                    className={cn(
                      "flex items-center gap-2 text-[11px] transition-colors duration-200",
                      met ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 transition-all duration-200",
                        met ? "bg-success/15" : "bg-muted",
                      )}
                    >
                      {met && (
                        <Check
                          size={8}
                          strokeWidth={3}
                          className="text-success"
                        />
                      )}
                    </span>
                    {label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </FieldWrapper>
  );
}

// ─── TextareaField ────────────────────────────────────────────────────────────

export const TextareaField = forwardRef(function TextareaField(
  {
    label,
    error: externalError,
    hint,
    required,
    validate,
    onBlur,
    id,
    maxLength,
    value,
    onChange,
    className,
    rows = 4,
    ...props
  },
  ref,
) {
  const [localError, setLocalError] = useState("");
  const error = externalError || localError;
  const charCount = typeof value === "string" ? value.length : 0;

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
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        onBlur={handleBlur}
        className={cn(
          "w-full rounded-lg border px-3.5 py-3 text-sm glass-subtle bg-card resize-y",
          "min-h-25 text-foreground placeholder:text-muted-foreground",
          "transition-all duration-150 outline-none",
          "focus:ring-2 focus:ring-primary/20 focus:border-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error ? FIELD_ERROR : FIELD_NORMAL,
          className,
        )}
        {...props}
      />
      {maxLength && (
        <p className="text-right text-[11px] text-muted-foreground -mt-0.5">
          {charCount} / {maxLength}
        </p>
      )}
    </FieldWrapper>
  );
});

// MarkdownField is in its own file: MarkdownField.jsx
// ─── NumberField ──────────────────────────────────────────────────────────────

// Native <input type="number"> silently lets the caret buffer hold "e", "+",
// "-" and other syntax valid only in scientific/signed notation — visually
// typeable even though a bad final string just resolves to an empty value.
// Block anything that isn't a digit, a single decimal point, or (when
// allowed) a single leading minus, so what you type is what you get.
function handleNumericKeyDown(e, { allowNegative, allowDecimal }) {
  const allowed = [
    "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "Tab", "Enter", "Home", "End",
  ];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (/^[0-9]$/.test(e.key)) return;
  const el = e.currentTarget;
  if (allowDecimal && e.key === ".") {
    if (el.value.includes(".")) e.preventDefault();
    return;
  }
  if (allowNegative && e.key === "-") {
    if (el.selectionStart !== 0 || el.value.includes("-")) e.preventDefault();
    return;
  }
  e.preventDefault();
}

export const NumberField = forwardRef(function NumberField(
  {
    label,
    error: externalError,
    hint,
    required,
    validate,
    onBlur,
    onKeyDown,
    id,
    icon,
    prefix,
    suffix,
    className,
    allowNegative = true,
    allowDecimal = true,
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

  function handleKeyDown(e) {
    handleNumericKeyDown(e, { allowNegative, allowDecimal });
    onKeyDown?.(e);
  }

  const hasLeft = icon || prefix;

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative flex items-center">
        {icon && !prefix && <InputIcon icon={icon} />}
        {prefix && (
          <span className="absolute left-3.5 text-sm text-muted-foreground select-none pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type="number"
          inputMode={allowDecimal ? "decimal" : "numeric"}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={fieldCls(
            error,
            cn(
              hasLeft && "pl-9",
              suffix && "pr-9",
              "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
              className,
            ),
          )}
          {...props}
        />
        {suffix && (
          <span className="absolute right-3.5 text-sm text-muted-foreground select-none pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </FieldWrapper>
  );
});

// ─── CurrencyField ────────────────────────────────────────────────────────────

export const CurrencyField = forwardRef(function CurrencyField(
  {
    label,
    error,
    hint,
    required,
    id,
    icon,
    value,
    onChange,
    locale = "es-MX",
    currency = "MXN",
    symbol = "$",
    className,
    min,
    max,
    allowNegative = false,
    allowDecimal: _allowDecimal,
    fractionDigits: _fractionDigits,
    ...props
  },
  ref,
) {
  function toCents(decimalValue) {
    if (decimalValue == null || decimalValue === "") return 0;
    return Math.round(Math.abs(Number(decimalValue)) * 100);
  }

  function toDecimal(cents) {
    return cents / 100;
  }

  function formatCents(cents) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(toDecimal(cents));
  }

  const [cents, setCents] = useState(() => toCents(value));
  const [negative, setNegative] = useState(() => Number(value) < 0);

  useEffect(() => {
    setCents(toCents(value));
    setNegative(Number(value) < 0);
  }, [value]);

  function handleKeyDown(e) {
    const allowed = [
      "Backspace",
      "Delete",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
      "Enter",
    ];
    if (allowed.includes(e.key)) return;
    if (allowNegative && e.key === "-") {
      e.preventDefault();
      const nextNegative = !negative;
      setNegative(nextNegative);
      onChange?.(nextNegative ? -toDecimal(cents) : toDecimal(cents));
      return;
    }
    if (!/^\d$/.test(e.key)) e.preventDefault();
  }

  function handleChange(e) {
    const digits = e.target.value.replace(/\D/g, "");
    const newCents = parseInt(digits, 10) || 0;
    const clamped =
      min != null || max != null
        ? Math.min(
            max != null ? toCents(max) : Infinity,
            Math.max(min != null ? toCents(min) : 0, newCents),
          )
        : newCents;
    setCents(clamped);
    onChange?.(negative ? -toDecimal(clamped) : toDecimal(clamped));
  }

  function handleFocus(e) {
    e.target.select();
  }

  const displayValue = (negative && cents > 0 ? "-" : "") + formatCents(cents);

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative flex items-center">
        {icon ? (
          <InputIcon icon={icon} />
        ) : (
          <span className="absolute left-3.5 text-sm text-[hsl(var(--foreground))]/70 select-none pointer-events-none">
            {symbol}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode="numeric"
          value={displayValue}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          onFocus={handleFocus}
          className={fieldCls(error, cn("pl-9", className))}
          placeholder={formatCents(0)}
          {...props}
        />
      </div>
    </FieldWrapper>
  );
});

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
      <CalendarDays size={14} className="text-muted-foreground/70 shrink-0" />
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
      <CalendarDays size={14} className="text-muted-foreground/70 shrink-0" />
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

// ─── CheckboxField ────────────────────────────────────────────────────────────

export function CheckboxField({
  label,
  hint,
  required,
  error,
  id,
  checked,
  onChange,
  className,
  children,
  disabled = false,
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className={cn(
          "flex items-start gap-3 select-none group",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        )}
      >
        <div
          className={cn(
            "mt-0.5 w-4 h-4 shrink-0 rounded border-2 transition-all duration-150",
            "flex items-center justify-center",
            checked
              ? "bg-primary border-primary"
              : cn("border-border", !disabled && "group-hover:border-primary/50"),
            error && !checked && "border-destructive",
          )}
        >
          {checked && (
            <Check size={10} strokeWidth={3} className="text-white" />
          )}
        </div>
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="sr-only"
          required={required}
        />
        <div className="flex flex-col gap-0.5">
          {label && (
            <span
              className={cn(
                "text-sm font-medium leading-tight",
                disabled ? "text-muted-foreground" : "text-foreground/80",
              )}
            >
              {label}
              {required && (
                <span className="text-destructive ml-1 text-[11px]">*</span>
              )}
            </span>
          )}
          {children && (
            <span className="text-xs text-muted-foreground">{children}</span>
          )}
        </div>
      </label>
      {error && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-xs text-destructive leading-none ml-7"
        >
          <AlertCircle size={11} className="shrink-0" />
          {error}
        </p>
      )}
      {!error && hint && (
        <p className="text-xs text-muted-foreground ml-7">{hint}</p>
      )}
    </div>
  );
}

// ─── SwitchField ─────────────────────────────────────────────────────────────

export function SwitchField({
  label,
  hint,
  required,
  error,
  id,
  checked,
  onChange,
  className,
  description,
  disabled = false,
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          {label && (
            <label
              htmlFor={id}
              className={cn(
                "text-sm font-medium select-none",
                disabled
                  ? "text-muted-foreground cursor-not-allowed"
                  : "text-foreground/80 cursor-pointer",
              )}
            >
              {label}
              {required && (
                <span className="text-destructive ml-1 text-[11px]">*</span>
              )}
            </label>
          )}
          {description && (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </div>
        <button
          type="button"
          role="switch"
          id={id}
          aria-checked={checked}
          disabled={disabled}
          onClick={() => !disabled && onChange?.(!checked)}
          className={cn(
            "relative w-10 h-6 rounded-full transition-all duration-200 shrink-0",
            "focus:outline-none focus:ring-2 focus:ring-primary/30",
            disabled ? "opacity-50 cursor-not-allowed" : "",
            checked ? "bg-primary" : "bg-muted border border-border",
          )}
        >
          <span
            className={cn(
              "absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200",
              checked ? "left-5" : "left-1",
            )}
          />
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-xs text-destructive leading-none"
        >
          <AlertCircle size={11} className="shrink-0" />
          {error}
        </p>
      )}
      {!error && hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ─── RadioGroupField ─────────────────────────────────────────────────────────

export function RadioGroupField({
  label,
  hint,
  required,
  error,
  name,
  value,
  onChange,
  options = [],
  className,
}) {
  return (
    <FieldWrapper label={label} error={error} hint={hint} required={required}>
      <div className={cn("flex flex-col gap-2", className)}>
        {options.map((opt) => {
          const optValue = typeof opt === "string" ? opt : opt.value;
          const optLabel = typeof opt === "string" ? opt : opt.label;
          const optDesc = typeof opt === "object" ? opt.description : null;
          const isChecked = value === optValue;
          return (
            <label
              key={optValue}
              className={cn(
                "flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all duration-150 select-none",
                isChecked
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 transition-all duration-150 flex items-center justify-center",
                  isChecked ? "border-primary" : "border-border",
                )}
              >
                {isChecked && (
                  <div className="w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
              <input
                type="radio"
                name={name}
                value={optValue}
                checked={isChecked}
                onChange={() => onChange?.(optValue)}
                className="sr-only"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground/80 leading-tight">
                  {optLabel}
                </span>
                {optDesc && (
                  <span className="text-xs text-muted-foreground">
                    {optDesc}
                  </span>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </FieldWrapper>
  );
}

// ─── TagsField ────────────────────────────────────────────────────────────────

export function TagsField({
  label,
  hint,
  required,
  error: externalError,
  id,
  value = [],
  onChange,
  placeholder = "Escribe y presiona Enter",
  className,
  // Optional per-item check. Return an error string to reject the entry, or
  // null/"" to accept. Also used to filter a multi-item paste.
  validateItem,
  // Normalize each entry before it is stored (e.g. lowercase + trim an email).
  normalizeItem = (v) => v.trim(),
  type = "text",
  inputMode,
}) {
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState("");
  const error = externalError || localError;
  const inputRef = useRef(null);

  function commit(raw) {
    const tag = normalizeItem(String(raw ?? ""));
    if (!tag) return false;
    if (value.includes(tag)) {
      setLocalError("Elemento duplicado");
      return false;
    }
    if (validateItem) {
      const err = validateItem(tag);
      if (err) {
        setLocalError(err);
        return false;
      }
    }
    setLocalError("");
    onChange?.([...value, tag]);
    return true;
  }

  function addTag() {
    if (commit(input)) setInput("");
  }

  function removeTag(i) {
    onChange?.(value.filter((_, idx) => idx !== i));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === ";") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !input && value.length > 0)
      removeTag(value.length - 1);
  }

  function handlePaste(e) {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!/[,;\s]/.test(text)) return; // single value — let it fall through to onChange
    e.preventDefault();
    const parts = text.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) {
      const tag = normalizeItem(p);
      if (!tag || next.includes(tag)) continue;
      if (validateItem && validateItem(tag)) continue;
      next.push(tag);
    }
    if (next.length !== value.length) { onChange?.(next); setLocalError(""); }
    setInput("");
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
    >
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "flex flex-wrap items-center gap-1.5 min-h-11 rounded-lg border px-2.5 py-2 glass-subtle bg-card",
          "transition-all duration-150 cursor-text",
          "focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary",
          error ? FIELD_ERROR : FIELD_NORMAL,
          className,
        )}
      >
        <Tag
          size={14}
          strokeWidth={1.75}
          className="text-muted-foreground/60 shrink-0"
        />
        {value.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="flex items-center gap-1 rounded bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-medium text-primary"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(i);
              }}
              className="text-primary/60 hover:text-primary transition-colors"
              aria-label={`Eliminar ${tag}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type={type}
          inputMode={inputMode}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={addTag}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-24 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
    </FieldWrapper>
  );
}

// ─── DropzoneField ────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function DropzoneField({
  label,
  error: externalError,
  hint,
  required,
  id,
  accept,
  maxSize,
  multiple = false,
  value,
  onChange,
  placeholder = "Arrastra tu archivo aquí o haz clic para seleccionar",
  className,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [sizeError, setSizeError] = useState("");
  const inputRef = useRef(null);

  const files = value ? (Array.isArray(value) ? value : [value]) : [];
  const error = externalError || sizeError;

  const processFiles = useCallback(
    (newFiles) => {
      setSizeError("");
      if (maxSize) {
        const oversized = Array.from(newFiles).find((f) => f.size > maxSize);
        if (oversized) {
          setSizeError(
            `Archivo demasiado grande. Máximo ${formatBytes(maxSize)}`,
          );
          return;
        }
      }
      onChange?.(multiple ? Array.from(newFiles) : newFiles[0] || null);
    },
    [maxSize, multiple, onChange],
  );

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }

  function handleChange(e) {
    if (e.target.files?.length) processFiles(e.target.files);
  }

  function removeFile(index) {
    const updated = files.filter((_, i) => i !== index);
    onChange?.(multiple ? updated : null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="Zona de carga de archivos"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3",
          "rounded-lg border-2 border-dashed px-6 py-8 text-center",
          "transition-all duration-150 cursor-pointer select-none",
          isDragging
            ? "border-primary bg-primary/5"
            : error
              ? "border-destructive/40 bg-destructive/5 hover:border-destructive/60"
              : "border-border bg-muted/30 hover:border-primary/40 hover:bg-primary/3",
          className,
        )}
      >
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors duration-150",
            isDragging ? "bg-primary/15" : "bg-muted",
          )}
        >
          <Upload
            size={17}
            className={cn(
              "transition-colors",
              isDragging ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">
            {placeholder}
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {accept && (
              <span>
                {accept
                  .replace(/image\//g, "")
                  .replace(/\*/g, "todos")
                  .toUpperCase()}
              </span>
            )}
            {accept && maxSize && <span>·</span>}
            {maxSize && <span>Máximo {formatBytes(maxSize)}</span>}
          </div>
        </div>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleChange}
          className="sr-only"
        />
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5 mt-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3.5 py-2.5"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-foreground truncate">
                  {file.name}
                </span>
                <span className="text-[11px] text-muted-foreground mt-0.5">
                  {formatBytes(file.size)}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                className="ml-3 shrink-0 text-muted-foreground hover:text-destructive transition-colors duration-150"
                aria-label={`Eliminar ${file.name}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </FieldWrapper>
  );
}

// ─── ComboboxField ────────────────────────────────────────────────────────────

export function ComboboxField({
  label,
  id,
  required,
  error: externalError,
  hint,
  icon,
  options = [],
  value,
  onChange,
  onValueChange,
  onSearchChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin resultados",
  minSearchLength = 0,
  className,
}) {
  const handleChange = onChange ?? onValueChange;
  const {
    open, setOpen, search, setSearch, dropdownStyle,
    containerRef, dropdownRef, searchRef, handleOpen: handlePopoverOpen, close,
  } = useComboboxPopover({ dropHeight: 260, minWidth: 220 });
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected = options.find((o) => o.value === value);

  const filtered =
    search.length >= minSearchLength
      ? options
          .filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 200)
      : minSearchLength > 0
        ? []
        : options.slice(0, 200);

  function handleOpen() {
    handlePopoverOpen(() => {
      if (options.length === 0) onSearchChange?.("");
    });
  }

  function handleSelect(opt) {
    handleChange(opt.value);
    close();
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={externalError}
      hint={hint}
      required={required}
    >
      <div ref={containerRef} className={cn("relative", className)}>
        <button
          type="button"
          id={id}
          onClick={handleOpen}
          className={cn(
            fieldCls(
              externalError,
              cn(
                "flex items-center justify-between text-left cursor-pointer",
                icon && "pl-9",
              ),
            ),
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <InputIcon icon={icon} />
          <span
            className={cn(
              "truncate",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={cn(
              "text-muted-foreground/60 shrink-0 ml-2 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>

        {open &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                ...(dropdownStyle.flipped
                  ? { bottom: dropdownStyle.bottom }
                  : { top: dropdownStyle.top }),
                left: dropdownStyle.left,
                width: dropdownStyle.width,
                zIndex: 9999,
                pointerEvents: "auto",
              }}
              className={cn(
                "glass-shell rounded-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              <div className={cn(
                "flex items-center gap-2 px-3 py-2",
                dropdownStyle.flipped ? "border-t border-border" : "border-b border-border",
              )}>
                <Search
                  size={13}
                  className="text-muted-foreground/50 shrink-0"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="flex items-center justify-center h-4 w-4 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto overscroll-contain" role="listbox">
                {search.length < minSearchLength ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    Escribe al menos {minSearchLength} letras para buscar
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {emptyText}
                  </p>
                ) : (
                  filtered.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={opt.value === value}
                      onClick={() => handleSelect(opt)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm transition-colors duration-100 flex items-center gap-2",
                        opt.value === value
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground hover:bg-muted/50",
                      )}
                    >
                      <span className="flex-1 truncate">{opt.label}</span>
                      {opt.value === value && (
                        <Check size={13} className="shrink-0 text-primary" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
}

// ─── RelationSelectField ──────────────────────────────────────────────────────
// Combobox for relation fields loaded from a remote API or static list.
// Supports loading/error/clear states and remote search via onSearchChange.

export function RelationSelectField({
  label,
  id,
  required,
  error: externalError,
  hint,
  icon,
  options = [],
  value,
  onChange,
  loading = false,
  loadError = null,
  onRetry,
  onSearchChange,
  clearable = false,
  createActionLabel = "Crear nuevo",
  createActionMode = "always",
  createFromSearch = false,
  createDisabled = false,
  onCreate,
  placeholder = "Seleccionar...",
  className,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected =
    value != null && value !== ""
      ? options.find((o) => String(o.value) === String(value))
      : undefined;

  useEffect(() => {
    function handleOutside(e) {
      const inContainer = containerRef.current?.contains(e.target);
      const inDropdown = dropdownRef.current?.contains(e.target);
      if (!inContainer && !inDropdown) {
        if (search) onSearchChange?.("");
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [search, onSearchChange]);

  function handleOpen() {
    if (!open && containerRef.current) {
      setDropdownStyle(
        computeDropdownStyle(containerRef.current, 260, 220, true),
      );
      if (options.length === 0 && !loading) {
        onSearchChange?.("");
      }
    }
    setOpen((o) => !o);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function handleSearchChange(e) {
    const term = e.target.value;
    setSearch(term);
    onSearchChange?.(term);
  }

  function handleSelect(opt) {
    if (opt.disabled) return;
    onChange?.(opt.value);
    setOpen(false);
    setSearch("");
  }

  function handleCreate() {
    if (createDisabled || typeof onCreate !== "function") return;
    const searchText = search.trim();
    onCreate(searchText);
    setOpen(false);
    setSearch("");
  }

  const displayLabel =
    value != null && value !== ""
      ? selected
        ? selected.label
        : !loading
          ? "Registro no disponible"
          : null
      : null;
  const selectedMeta = selected?.meta ?? null;

  const filtered = search
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  const trimmedSearch = search.trim();
  const canShowCreate =
    typeof onCreate === "function" &&
    (createActionMode === "always" ||
      (createActionMode === "empty-search" && trimmedSearch.length === 0) ||
      (createActionMode === "has-search" && trimmedSearch.length > 0));
  const createLabel = (() => {
    if (createFromSearch && trimmedSearch.length > 0)
      return `Crear "${trimmedSearch}"`;
    return createActionLabel || "Crear nuevo";
  })();

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={externalError}
      hint={hint}
      required={required}
    >
      <div ref={containerRef} className={cn("relative", className)}>
        <button
          type="button"
          id={id}
          onClick={handleOpen}
          className={cn(
            fieldCls(
              externalError,
              cn(
                "flex items-center justify-between text-left cursor-pointer gap-2",
                icon && "pl-9",
              ),
            ),
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <InputIcon icon={icon} />
          <span
            className={cn(
              "flex-1 truncate text-sm",
              !displayLabel && !loading && "text-muted-foreground",
              displayLabel === "Registro no disponible" &&
                "text-muted-foreground italic",
            )}
          >
            {loading && value != null && value !== ""
              ? "Cargando opciones..."
              : (displayLabel ?? placeholder)}
          </span>
          <span className="flex items-center gap-0.5 shrink-0">
            {clearable && value != null && value !== "" && !loading && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Limpiar selección"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange?.(null);
                }}
                className="flex items-center justify-center h-4 w-4 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={10} />
              </span>
            )}
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              className={cn(
                "text-muted-foreground/60 transition-transform duration-150",
                open && "rotate-180",
              )}
            />
          </span>
        </button>

        {open &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                ...(dropdownStyle.flipped
                  ? { bottom: dropdownStyle.bottom }
                  : { top: dropdownStyle.top }),
                left: dropdownStyle.left,
                width: dropdownStyle.width,
                zIndex: 9999,
                pointerEvents: "auto",
              }}
              className={cn(
                "rounded-xl border border-border/80 bg-card text-foreground shadow-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              <div className={cn(
                "flex items-center gap-2 px-3 py-2",
                dropdownStyle.flipped ? "border-t border-border" : "border-b border-border",
              )}>
                <Search
                  size={13}
                  className="text-muted-foreground/50 shrink-0"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={handleSearchChange}
                  placeholder="Buscar..."
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      onSearchChange?.("");
                    }}
                    className="flex items-center justify-center h-4 w-4 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto overscroll-contain" role="listbox">
                {loading ? (
                  <LoadingState size="sm" message="Cargando opciones..." />
                ) : loadError ? (
                  <div className="px-3 py-4 text-center space-y-2">
                    <p className="text-xs text-destructive">
                      No se pudieron cargar las opciones
                    </p>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
                      >
                        Reintentar
                      </button>
                    )}
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {options.length === 0
                      ? "Sin opciones disponibles"
                      : "Sin resultados"}
                  </p>
                ) : (
                  filtered.map((opt) => {
                    const isSelected = String(opt.value) === String(value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelect(opt)}
                        disabled={opt.disabled}
                        className={cn(
                          "w-full text-left px-3 transition-colors duration-100 flex items-center gap-2",
                          opt.meta ? "py-2.5" : "py-2",
                          isSelected
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground hover:bg-muted/50",
                          opt.disabled &&
                            "opacity-50 cursor-not-allowed pointer-events-none",
                        )}
                      >
                        {opt.meta ? (
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {opt.meta.badge ? (
                                <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary shrink-0">
                                  {opt.meta.badge}
                                </span>
                              ) : null}
                              {opt.meta.title ? (
                                <span
                                  className={cn(
                                    "text-sm font-medium truncate",
                                    isSelected
                                      ? "text-primary"
                                      : "text-foreground",
                                  )}
                                >
                                  {opt.meta.title}
                                </span>
                              ) : null}
                            </div>
                            {opt.meta.subtitle ? (
                              <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                                {opt.meta.subtitle}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="flex-1 truncate text-sm">
                            {opt.label}
                          </span>
                        )}
                        {isSelected && (
                          <Check size={13} className="shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })
                )}
                {canShowCreate && (
                  <>
                    <div className="mx-3 my-1 border-t border-border" />
                    <button
                      type="button"
                      role="option"
                      onClick={handleCreate}
                      disabled={createDisabled}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm transition-colors duration-100 flex items-center gap-2",
                        "text-primary hover:bg-primary/5",
                        createDisabled && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Plus size={14} className="shrink-0" />
                      <span className="font-medium">{createLabel}</span>
                    </button>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
}

// ─── CreatableComboboxField ───────────────────────────────────────────────────
// Same as ComboboxField but shows a "+ Crear «X»" option when the search term
// does not match any existing entry. Calls `onCreate(name)` when chosen.

export function CreatableComboboxField({
  label,
  id,
  required,
  error: externalError,
  hint,
  icon,
  options = [],
  value,
  onChange,
  onCreate,
  isCreating = false,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin resultados",
  className,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected = options.find((o) => o.value === value);

  const filtered = options
    .filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 200);

  const trimmed = search.trim();
  const showCreate =
    typeof onCreate === "function" &&
    trimmed.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  useEffect(() => {
    function handleOutside(e) {
      if (
        !containerRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function handleOpen() {
    const willOpen = !open;
    if (willOpen && containerRef.current) {
      setDropdownStyle(computeDropdownStyle(containerRef.current, 260, 220, true));
    }
    setOpen((o) => !o);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function handleSelect(opt) {
    onChange(opt.value);
    setOpen(false);
    setSearch("");
  }

  function handleCreate() {
    if (!trimmed || isCreating) return;
    onCreate(trimmed);
    setOpen(false);
    setSearch("");
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={externalError}
      hint={hint}
      required={required}
    >
      <div ref={containerRef} className={cn("relative", className)}>
        <button
          type="button"
          id={id}
          onClick={handleOpen}
          className={cn(
            fieldCls(
              externalError,
              cn(
                "flex items-center justify-between text-left cursor-pointer",
                icon && "pl-9",
              ),
            ),
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <InputIcon icon={icon} />
          <span
            className={cn(
              "truncate",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={cn(
              "text-muted-foreground/60 shrink-0 ml-2 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>

        {open &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                ...(dropdownStyle.flipped
                  ? { bottom: dropdownStyle.bottom }
                  : { top: dropdownStyle.top }),
                left: dropdownStyle.left,
                width: dropdownStyle.width,
                zIndex: 9999,
                pointerEvents: "auto",
              }}
              className={cn(
                "rounded-xl border border-border/80 bg-card text-foreground shadow-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              <div className={cn(
                "flex items-center gap-2 px-3 py-2",
                dropdownStyle.flipped ? "border-t border-border" : "border-b border-border",
              )}>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && showCreate) {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto overscroll-contain" role="listbox">
                {filtered.length === 0 && !showCreate && (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {emptyText}
                  </p>
                )}
                {filtered.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    onClick={() => handleSelect(opt)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors duration-100",
                      opt.value === value
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted/50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
                {showCreate && (
                  <>
                    {filtered.length > 0 && (
                      <div className="mx-3 my-1 border-t border-border" />
                    )}
                    <button
                      type="button"
                      role="option"
                      disabled={isCreating}
                      onClick={handleCreate}
                      className="w-full text-left px-3 py-2 text-sm transition-colors duration-100 flex items-center gap-2 text-primary hover:bg-primary/5 disabled:opacity-50 disabled:cursor-wait font-medium"
                    >
                      <span className="text-base leading-none">+</span>
                      {isCreating ? (
                        <span>Creando...</span>
                      ) : (
                        <span>
                          Crear{" "}
                          <span className="text-foreground font-semibold">
                            &ldquo;{trimmed}&rdquo;
                          </span>
                        </span>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
}

// ─── CarColorPickerField ──────────────────────────────────────────────────────
// Searchable color picker for vehicle colors.
// `colors` prop: [{ name, hex, group }]  — passed from the renderer.
// Stores the color NAME as value, not hex.

export function CarColorPickerField({
  label,
  id,
  required,
  error: externalError,
  hint,
  value,
  onChange,
  colors = [],
  clearable = true,
  placeholder = "Seleccionar color...",
  className,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  // Portaled dropdown: keep wheel/touch scroll working inside a Dialog/Sheet.
  useIsolatedScroll(dropdownRef, open);

  const selected = colors.find((c) => c.name === value) ?? null;

  // resolve hex for any stored value (name or legacy #hex)
  function resolveHex(v) {
    if (!v) return null;
    if (String(v).startsWith("#")) return String(v);
    return colors.find((c) => c.name === v)?.hex ?? null;
  }
  const selectedHex = resolveHex(value);

  const groups = [...new Set(colors.map((c) => c.group))];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? colors.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.group.toLowerCase().includes(term),
      )
    : null;

  useEffect(() => {
    function handleOutside(e) {
      if (
        !containerRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function handleOpen() {
    if (!open && containerRef.current) {
      setDropdownStyle(
        computeDropdownStyle(containerRef.current, 320, 260, true),
      );
    }
    setOpen((o) => !o);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function handleSelect(color) {
    onChange(color.name);
    setOpen(false);
    setSearch("");
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange(null);
  }

  function isSelected(color) {
    return color.name === value || color.hex === value;
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={externalError}
      hint={hint}
      required={required}
    >
      <div ref={containerRef} className={cn("relative", className)}>
        <button
          type="button"
          id={id}
          onClick={handleOpen}
          className={cn(
            fieldCls(
              externalError,
              "flex items-center gap-2.5 text-left cursor-pointer pr-3",
            ),
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {selectedHex ? (
            <span
              className="h-5 w-5 shrink-0 rounded-full border border-border/60 shadow-sm"
              style={{ backgroundColor: selectedHex }}
            />
          ) : (
            <span className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/30" />
          )}
          <span
            className={cn(
              "flex-1 truncate text-sm",
              selected || value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selected
              ? selected.name
              : value && !value.startsWith("#")
                ? value
                : placeholder}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {clearable && value && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                className="flex items-center justify-center h-4 w-4 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Limpiar color"
              >
                <X size={10} />
              </span>
            )}
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              className={cn(
                "text-muted-foreground/60 transition-transform duration-150",
                open && "rotate-180",
              )}
            />
          </span>
        </button>

        {open &&
          createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                ...(dropdownStyle.flipped
                  ? { bottom: dropdownStyle.bottom }
                  : { top: dropdownStyle.top }),
                left: dropdownStyle.left,
                width: dropdownStyle.width,
                zIndex: 9999,
              }}
              className={cn(
                "rounded-xl border border-border/80 bg-card text-foreground shadow-xl overflow-hidden",
                dropdownStyle.flipped && "flex flex-col-reverse",
              )}
            >
              {/* Search */}
              <div className={cn(
                "flex items-center gap-2 px-3 py-2",
                dropdownStyle.flipped ? "border-t border-border" : "border-b border-border",
              )}>
                <Search
                  size={13}
                  className="text-muted-foreground/50 shrink-0"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar color..."
                  className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="flex items-center justify-center h-4 w-4 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto overscroll-contain" role="listbox">
                {/* Clear option */}
                {clearable && value && !term && (
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      onChange(null);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 border-b border-border/50"
                  >
                    <X size={11} />
                    Sin color
                  </button>
                )}

                {/* Filtered flat list */}
                {term ? (
                  filtered.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                      Sin resultados
                    </p>
                  ) : (
                    filtered.map((color) => (
                      <ColorOption
                        key={color.name}
                        color={color}
                        selected={isSelected(color)}
                        onSelect={handleSelect}
                      />
                    ))
                  )
                ) : (
                  /* Grouped list */
                  groups.map((group) => (
                    <div key={group}>
                      <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
                        {group}
                      </p>
                      {colors
                        .filter((c) => c.group === group)
                        .map((color) => (
                          <ColorOption
                            key={color.name}
                            color={color}
                            selected={isSelected(color)}
                            onSelect={handleSelect}
                          />
                        ))}
                    </div>
                  ))
                )}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </FieldWrapper>
  );
}

function ColorOption({ color, selected, onSelect }) {
  const isLight = isLightColor(color.hex);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(color)}
      className={cn(
        "w-full text-left px-3 py-1.5 text-sm transition-colors duration-100 flex items-center gap-2.5",
        selected
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "h-5 w-5 shrink-0 rounded-full border shadow-sm",
          isLight ? "border-border/80" : "border-transparent",
        )}
        style={{ backgroundColor: color.hex }}
      />
      <span className="flex-1 truncate">{color.name}</span>
      {selected && <Check size={13} className="shrink-0 text-primary" />}
    </button>
  );
}

function isLightColor(hex) {
  if (!hex || !hex.startsWith("#")) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 180;
}
