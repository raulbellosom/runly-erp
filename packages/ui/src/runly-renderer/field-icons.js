// Field icons for RunlyForm inputs and RunlyDetail labels: any lucide icon by
// name ("MapPin" or "map-pin"), else a sensible default for the field type so
// every input says at a glance what it holds.
import * as Lucide from "lucide-react";

const TYPE_DEFAULTS = {
  date: Lucide.CalendarDays,
  datetime: Lucide.CalendarDays,
  email: Lucide.Mail,
  phone: Lucide.Phone,
  number: Lucide.Hash,
  integer: Lucide.Hash,
  decimal: Lucide.DollarSign,
  currency: Lucide.DollarSign,
  url: Lucide.Link2,
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
  return lucideByName(field?.icon) ?? TYPE_DEFAULTS[field?.type] ?? null;
}
