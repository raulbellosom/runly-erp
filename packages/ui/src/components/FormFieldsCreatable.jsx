// packages/ui/src/components/FormFieldsCreatable.jsx
//
// CreatableComboboxField, CarColorPickerField — presets over the unified
// Combobox (Combobox.jsx). Re-exported from FormFields.jsx so every existing
// import path keeps working.
import { Combobox } from "./Combobox.jsx";

// ─── CreatableComboboxField ───────────────────────────────────────────────────
// Shows a "+ Crear «X»" footer when the search term does not match any
// existing entry. Calls `onCreate(name)` when chosen.

export function CreatableComboboxField(props) {
  return <Combobox searchable createMode="search" {...props} />;
}

// ─── CarColorPickerField ──────────────────────────────────────────────────────
// Searchable color picker for vehicle colors.
// `colors` prop: [{ name, hex, group }]  — passed from the renderer.
// Stores the color NAME as value, not hex (legacy "#hex" values still render).

export function CarColorPickerField({
  colors = [],
  clearable = true,
  placeholder = "Seleccionar color...",
  value,
  ...props
}) {
  const options = colors.map((c) => ({
    value: c.name,
    label: c.name,
    color: c.hex,
    group: c.group,
    keywords: c.group,
  }));
  if (value && !colors.some((c) => c.name === value || c.hex === value)) {
    const legacyHex = String(value).startsWith("#") ? String(value) : undefined;
    options.unshift({ value, label: String(value), color: legacyHex, group: "Actual" });
  }
  const matchedByHex = colors.find((c) => c.hex === value && c.name !== value);
  return (
    <Combobox
      searchable
      clearable={clearable}
      placeholder={placeholder}
      searchPlaceholder="Buscar color..."
      options={options}
      value={matchedByHex ? matchedByHex.name : value}
      {...props}
    />
  );
}
