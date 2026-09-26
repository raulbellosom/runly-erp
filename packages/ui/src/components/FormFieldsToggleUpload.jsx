// packages/ui/src/components/FormFieldsToggleUpload.jsx
//
// CheckboxField, SwitchField, RadioGroupField, TagsField, DropzoneField.
// Extracted from FormFields.jsx on 2026-09-25 to keep that file under the
// CLAUDE.md 1000-line limit — re-exported from FormFields.jsx unchanged so
// every existing import path (package index and sibling components) keeps
// working without edits.
import { useState, useRef, useCallback } from "react";
import { Check, AlertCircle, Tag, X, Upload } from "lucide-react";
import { cn } from "../lib/utils.js";
import { FIELD_ERROR, FIELD_NORMAL, FieldWrapper } from "./form-field-base.jsx";

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
