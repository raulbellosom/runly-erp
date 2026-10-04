// Field icons for RunlyForm inputs and RunlyDetail labels: any lucide icon by
// name ("MapPin" or "map-pin"), else one inferred from the field so every
// input says at a glance what it holds — even when the blueprint declares
// a plain `type: "text"` and no `icon`.
//
// Resolution order: explicit `icon` -> strong type default (date, email...)
// -> field name/key -> field label (Spanish) -> weak type fallback.
import * as Lucide from "lucide-react";
import { inferFieldIcon } from "../lib/field-icon-inference.js";

export { inferFieldIcon };

const STRONG_TYPE_DEFAULTS = {
  date: Lucide.CalendarDays,
  datetime: Lucide.CalendarDays,
  email: Lucide.Mail,
  phone: Lucide.Phone,
  currency: Lucide.DollarSign,
  url: Lucide.Link2,
};

const WEAK_TYPE_DEFAULTS = {
  number: Lucide.Hash,
  integer: Lucide.Hash,
  decimal: Lucide.Hash,
  text: Lucide.Type,
  textarea: Lucide.AlignLeft,
  markdown: Lucide.AlignLeft,
  select: Lucide.List,
  relation: Lucide.Link2,
  boolean: Lucide.ToggleLeft,
  file: Lucide.Paperclip,
  color: Lucide.Palette,
  "hex-color": Lucide.Palette,
};

// `icons` holds the canonical names; aliases (Building2, ...) are only
// module exports. Non-icon exports (createLucideIcon, icons) are skipped.
function lookup(name) {
  const icon = Lucide.icons?.[name] ?? (/^[A-Z]/.test(name) && name !== "Icon" ? Lucide[name] : null);
  return icon && (typeof icon === "object" || typeof icon === "function") && name !== "createLucideIcon" ? icon : null;
}

export function lucideByName(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const raw = name.trim();
  const pascal = raw
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return lookup(raw) ?? lookup(pascal);
}

export function resolveFieldIcon(field) {
  return (
    lucideByName(field?.icon) ??
    STRONG_TYPE_DEFAULTS[field?.type] ??
    inferFieldIcon(field) ??
    WEAK_TYPE_DEFAULTS[field?.type] ??
    null
  );
}
