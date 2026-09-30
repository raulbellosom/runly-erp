// packages/ui/src/components/FormFieldsRelation.jsx
//
// ComboboxField, RelationSelectField — presets over the unified Combobox
// (Combobox.jsx). Re-exported from FormFields.jsx so every existing import
// path keeps working. Any extra Combobox prop (groups, icons, avatars,
// `multiple`, `clearable`...) passes straight through.
import { Combobox } from "./Combobox.jsx";

// ─── ComboboxField ────────────────────────────────────────────────────────────

export function ComboboxField(props) {
  return <Combobox searchable {...props} />;
}

// ─── RelationSelectField ──────────────────────────────────────────────────────
// Combobox for relation fields loaded from a remote API or static list.
// Supports loading/error/clear states and remote search via onSearchChange.

export function RelationSelectField({
  createActionLabel = "Crear nuevo",
  createActionMode = "always",
  // eslint-disable-next-line no-unused-vars
  createFromSearch,
  ...props
}) {
  return (
    <Combobox
      searchable
      missingLabel="Registro no disponible"
      createMode={createActionMode === "empty-search" ? "empty-search" : "search"}
      createLabel={createActionMode === "empty-search" ? createActionLabel || "Crear nuevo" : undefined}
      {...props}
    />
  );
}
