// packages/ui/src/components/FormFields.jsx
//
// Thin barrel — the actual field components were split on 2026-09-25 into
// FormFieldsInput.jsx, FormFieldsDateSelect.jsx, FormFieldsToggleUpload.jsx,
// FormFieldsRelation.jsx and FormFieldsCreatable.jsx to keep every file
// under the CLAUDE.md 1000-line limit (this file was 2633 lines). Kept as a
// re-export so every existing `./FormFields.jsx` import (the package's
// public index and several sibling components) keeps working unchanged.
export { FieldWrapper } from "./form-field-base.jsx";
export {
  TextField,
  PasswordField,
  TextareaField,
  NumberField,
  CurrencyField,
} from "./FormFieldsInput.jsx";
export {
  DateField,
  DateTimeField,
  YearField,
  SelectField,
  PhoneField,
} from "./FormFieldsDateSelect.jsx";
export {
  CheckboxField,
  SwitchField,
  RadioGroupField,
  TagsField,
  DropzoneField,
} from "./FormFieldsToggleUpload.jsx";
export { ComboboxField, RelationSelectField } from "./FormFieldsRelation.jsx";
export {
  CreatableComboboxField,
  CarColorPickerField,
} from "./FormFieldsCreatable.jsx";
