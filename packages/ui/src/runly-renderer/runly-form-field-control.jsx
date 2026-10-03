// The input control for one RunlyForm field, by type (text, select,
// relation with inline create, currency, file...). A plain render function,
// not a component, so controls keep their identity across RunlyForm renders.
// Extracted from RunlyForm.jsx to keep that file under the size limit; `ctx`
// carries the form state and handlers it needs.
import { TextareaField, SelectField, SwitchField, PhoneField, TextField, CurrencyField, CarColorPickerField, FieldWrapper, RelationSelectField } from "../components/FormFields.jsx";
import { MarkdownField } from "../components/MarkdownField.jsx";
import { DatePickerField } from "../components/DatePickerField.jsx";
import { FileAssetField } from "../components/FileAssetField.jsx";
import { normalizeOptions, resolveColorName, CAR_COLORS } from "./runly-form-utils.js";
import { normalizeRelationDescriptor, normalizeSpanishLabel } from "./renderer-adapters.js";
import { formatDisplayValue } from "./runly-form-preview.js";
import { resolveFieldIcon } from "./field-icons.js";

export function renderFormFieldControl(field, ctx) {
  const { formValues, fieldErrors, handleChange, apiBaseUrl, token, companyId, relationState, relationInlineErrors, initialData, allowInlineCreate, inlineCreateDepth, quickCreatingField, inlineCreateState, loadRelationOptions, handleRelationSearch, handleQuickCreate, openInlineCreate } = ctx;
  const value = formValues[field.name];
  const sharedProps = {
    label: field.label,
    required: field.required,
    hint: field.hint ?? undefined,
    error: fieldErrors[field.name],
  };
  // Leading icon: the blueprint's `icon`, else a default for the type.
  const FieldIcon = resolveFieldIcon(field);

  if (field.readonly) {
    const displayValue = formatDisplayValue(field, value) ?? "—";
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-[hsl(var(--foreground))]">
          {field.label}
        </p>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-sm">
          {displayValue}
        </div>
      </div>
    );
  }

  if (field.type === "file" && field.file) {
    return (
      <FileAssetField
        {...sharedProps}
        {...field.file}
        fieldName={field.name}
        value={value ?? null}
        onChange={(next) => handleChange(field.name, next)}
        apiBaseUrl={apiBaseUrl}
        token={token}
        companyId={companyId}
      />
    );
  }

  switch (field.type) {
    case "textarea":
      return (
        <TextareaField
          {...sharedProps}
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );

    case "markdown":
      return (
        <MarkdownField
          {...sharedProps}
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e?.target?.value ?? "")}
        />
      );

    case "select": {
      const options = normalizeOptions(field.options);
      return (
        <SelectField
          {...sharedProps}
          icon={FieldIcon}
          value={value ?? ""}
          options={options}
          onValueChange={(val) => handleChange(field.name, val)}
        />
      );
    }

    case "boolean":
      return (
        <SwitchField
          {...sharedProps}
          checked={Boolean(value)}
          onChange={(checked) => handleChange(field.name, Boolean(checked))}
        />
      );

    case "phone":
      return (
        <PhoneField
          {...sharedProps}
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );

    case "number":
      return (
        <TextField
          {...sharedProps}
          icon={FieldIcon}
          type="number"
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );

    case "decimal":
      return (
        <TextField
          {...sharedProps}
          icon={FieldIcon}
          type="number"
          step="0.0001"
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );

    case "currency":
      return (
        <CurrencyField
          {...sharedProps}
          icon={FieldIcon}
          value={value ?? 0}
          onChange={(val) => handleChange(field.name, val)}
          currency={field.currency ?? "MXN"}
          locale={field.locale ?? "es-MX"}
          allowNegative={field.allowNegative ?? false}
        />
      );

    case "date":
      return (
        <DatePickerField
          {...sharedProps}
          value={value ?? ""}
          onChange={(val) => handleChange(field.name, val ?? "")}
        />
      );

    case "datetime":
      return (
        <TextField
          {...sharedProps}
          icon={FieldIcon}
          type="datetime-local"
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );

    case "email":
      return (
        <TextField
          {...sharedProps}
          icon={FieldIcon}
          type="email"
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );

    case "color": {
      // Normalize legacy hex values to color names on first render
      const colorValue =
        value && String(value).startsWith("#")
          ? (resolveColorName(String(value)) ?? value)
          : value;
      return (
        <CarColorPickerField
          key={field.name}
          id={field.name}
          label={field.label}
          required={field.required}
          hint={field.hint ?? undefined}
          value={colorValue || ""}
          onChange={(name) => handleChange(field.name, name || "")}
          colors={CAR_COLORS}
          clearable
          error={fieldErrors[field.name]}
        />
      );
    }

    // hex-color: native browser color picker — stores a #rrggbb hex string.
    // Use this instead of "color" when a vehicle palette is not appropriate.
    case "hex-color": {
      const hexValue =
        value && String(value).startsWith("#") ? String(value) : "#000000";
      return (
        <FieldWrapper
          label={field.label}
          labelFor={field.name}
          required={field.required}
          hint={field.hint ?? undefined}
          error={fieldErrors[field.name]}
        >
          <div className="flex items-center gap-3">
            <input
              type="color"
              id={field.name}
              value={hexValue}
              onChange={(e) => handleChange(field.name, e.target.value)}
              className="h-10 w-16 rounded-lg border border-[hsl(var(--border))] bg-transparent cursor-pointer p-0.5"
            />
            <span className="text-sm font-mono text-[hsl(var(--muted-foreground))]">
              {hexValue}
            </span>
          </div>
        </FieldWrapper>
      );
    }

    case "relation": {
      const descriptor = normalizeRelationDescriptor(field);
      const relationError =
        fieldErrors[field.name] || relationInlineErrors[field.name] || "";
      if (!descriptor) {
        return (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-[hsl(var(--foreground))]">
              {field.label}
              {field.required ? " *" : ""}
            </p>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
              Relación no configurada
            </div>
            {relationError && (
              <p className="text-xs text-[hsl(var(--destructive))]">
                {relationError}
              </p>
            )}
          </div>
        );
      }
      const rs = relationState[field.name] ?? {
        options: [],
        loading: false,
        error: null,
      };
      const loadedOpts =
        descriptor.source === "static" ? descriptor.options : rs.options;
      // The saved value may not be in the first page of options (or come
      // from another module): show its label from the record's
      // <field>__label instead of an empty picker.
      const savedLabel = initialData?.[`${field.name}__label`];
      const staticOpts =
        value && savedLabel && !loadedOpts.some((option) => String(option.value) === String(value))
          ? [{ value: String(value), label: String(savedLabel) }, ...loadedOpts]
          : loadedOpts;
      const createActionLabel =
        descriptor.create?.label ?? normalizeSpanishLabel("Crear nuevo");
      const canInlineCreate =
        Boolean(descriptor.create?.enabled) &&
        allowInlineCreate &&
        inlineCreateDepth < 2;
      return (
        <RelationSelectField
          {...sharedProps}
          icon={FieldIcon}
          error={relationError}
          value={value ?? null}
          options={staticOpts}
          loading={descriptor.source === "remote" ? rs.loading : false}
          loadError={descriptor.source === "remote" ? rs.error : null}
          clearable={descriptor.clearable}
          onRetry={() => loadRelationOptions(field.name, descriptor, "")}
          onSearchChange={(search) =>
            handleRelationSearch(field.name, descriptor, search)
          }
          onChange={(val) => handleChange(field.name, val)}
          createActionLabel={createActionLabel}
          createActionMode={descriptor.create?.allowedWhen ?? "always"}
          createFromSearch={descriptor.create?.prefillFromSearch === true}
          isCreating={quickCreatingField === field.name}
          createDisabled={
            !canInlineCreate ||
            quickCreatingField === field.name ||
            (inlineCreateState.open &&
              inlineCreateState.fieldName === field.name)
          }
          onCreate={
            canInlineCreate
              ? descriptor.create.mode === "quick"
                ? (searchText) =>
                    handleQuickCreate(field.name, descriptor, searchText)
                : (searchText) =>
                    openInlineCreate(field.name, descriptor, searchText)
              : undefined
          }
        />
      );
    }

    default:
      return (
        <TextField
          {...sharedProps}
          icon={FieldIcon}
          type="text"
          value={value ?? ""}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );
  }
}
