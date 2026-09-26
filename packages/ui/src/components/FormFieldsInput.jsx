// packages/ui/src/components/FormFieldsInput.jsx
//
// TextField, PasswordField, TextareaField, NumberField, CurrencyField.
// Extracted from FormFields.jsx on 2026-09-25 to keep that file under the
// CLAUDE.md 1000-line limit — re-exported from FormFields.jsx unchanged so
// every existing import path (package index and sibling components) keeps
// working without edits.
import { useState, useEffect, forwardRef, useId } from "react";
import { Eye, EyeOff, Check } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  FIELD_ERROR,
  FIELD_NORMAL,
  fieldCls,
  InputIcon,
  FieldWrapper,
} from "./form-field-base.jsx";

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
  const generatedId = useId();
  const inputId = id ?? generatedId;
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
      labelFor={inputId}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          className={fieldCls(error, cn(icon && "pl-9", "pr-11", className))}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          autoComplete="new-password"
          required={required}
          {...props}
        />
        <InputIcon icon={icon} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150 z-10"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-controls={inputId}
          aria-pressed={visible}
          disabled={props.disabled}
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
