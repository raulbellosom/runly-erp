// Module Builder — edit the visibility rule of a tab, section or field:
// "Mostrar solo si <campo> <operador> <valor>". Only select/boolean fields
// can drive a rule; `excludeFields` are the fields inside the element itself
// (an element cannot depend on a field it hides).
import { useEffect, useState } from "react";
import {
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SelectField,
} from "@runly/ui";
import { RULE_FIELD_TYPES } from "../../lib/layoutHelpers";

const SELECT_OPERATORS = [
  { value: "equals", label: "es igual a" },
  { value: "notEquals", label: "no es igual a" },
  { value: "in", label: "es uno de" },
  { value: "filled", label: "tiene valor" },
  { value: "empty", label: "está vacío" },
];
const BOOLEAN_OPERATORS = [
  { value: "filled", label: "es Sí" },
  { value: "empty", label: "es No" },
];

function optionList(field) {
  return (field?.options ?? []).map((option) => (typeof option === "object"
    ? { value: String(option.value), label: option.label ?? String(option.value) }
    : { value: String(option), label: String(option) }));
}

function toDraft(rule) {
  if (!rule) return { field: "", operator: "equals", value: "", values: [] };
  if ("equals" in rule) return { field: rule.field, operator: "equals", value: String(rule.equals), values: [] };
  if ("notEquals" in rule) return { field: rule.field, operator: "notEquals", value: String(rule.notEquals), values: [] };
  if (Array.isArray(rule.in)) return { field: rule.field, operator: "in", value: "", values: rule.in.map(String) };
  return { field: rule.field, operator: rule.truthy ? "filled" : "empty", value: "", values: [] };
}

function toRule(draft) {
  if (!draft.field) return null;
  if (draft.operator === "filled") return { field: draft.field, truthy: true };
  if (draft.operator === "empty") return { field: draft.field, truthy: false };
  if (draft.operator === "in") return draft.values.length ? { field: draft.field, in: draft.values } : null;
  return draft.value ? { field: draft.field, [draft.operator]: draft.value } : null;
}

export function RuleDialog({ open, onOpenChange, title, rule, fields, excludeFields = [], onSave }) {
  const [draft, setDraft] = useState(toDraft(rule));
  useEffect(() => {
    if (open) setDraft(toDraft(rule));
  }, [open, rule]);

  const candidates = (fields ?? []).filter((field) => RULE_FIELD_TYPES.has(field.type) && !excludeFields.includes(field.key));
  const field = candidates.find((item) => item.key === draft.field);
  const isBoolean = field?.type === "boolean";
  const options = optionList(field);
  const nextRule = toRule(draft);

  function patch(next) {
    setDraft((current) => ({ ...current, ...next }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Condición: {title}</DialogTitle>
          <DialogDescription>Se muestra solo cuando se cumple la condición. Los campos requeridos ocultos no se exigen.</DialogDescription>
        </DialogHeader>
        {!candidates.length ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Necesitas un campo de selección o sí/no fuera de este elemento.</p>
        ) : (
          <div className="space-y-4">
            <SelectField
              label="Campo"
              placeholder="Selecciona un campo"
              options={candidates.map((item) => ({ value: item.key, label: item.label }))}
              value={draft.field}
              onValueChange={(value) => {
                const nextField = candidates.find((item) => item.key === value);
                patch({ field: value, operator: nextField?.type === "boolean" ? "filled" : "equals", value: "", values: [] });
              }}
            />
            {field && (
              <SelectField
                label="Condición"
                options={isBoolean ? BOOLEAN_OPERATORS : SELECT_OPERATORS}
                value={draft.operator}
                onValueChange={(operator) => patch({ operator })}
              />
            )}
            {field && !isBoolean && ["equals", "notEquals"].includes(draft.operator) && (
              <SelectField label="Valor" placeholder="Selecciona un valor" options={options} value={draft.value} onValueChange={(value) => patch({ value })} />
            )}
            {field && !isBoolean && draft.operator === "in" && (
              <div className="space-y-2">
                {options.map((option) => (
                  <CheckboxField
                    key={option.value}
                    label={option.label}
                    checked={draft.values.includes(option.value)}
                    onChange={(event) => patch({ values: event.target.checked ? [...draft.values, option.value] : draft.values.filter((value) => value !== option.value) })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {rule ? (
            <Button variant="ghost" className="mr-auto text-red-600" onClick={() => { onSave(null); onOpenChange(false); }}>Quitar condición</Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!nextRule} onClick={() => { onSave(nextRule); onOpenChange(false); }}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
