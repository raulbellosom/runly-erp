import { User, Paperclip, Landmark, IdCard, SquareKanban, CheckSquare, CalendarDays, Car, Package } from "lucide-react";
import { runly } from "../../../lib/runly";

// Every connector type the chat composer's "+" picker can attach to a
// message. `flat: false` marks the one type with no single cross-project
// list endpoint (task) — it can't participate in the "Todos" merged search
// and instead gets its own project -> task cascade (see TaskPickerCascade in
// EntityReferencePicker.jsx). Values must match the backend's `entityType`
// enum in chatSendMessageSchema (packages/validators/src/chat.js)
// byte-for-byte, since these strings round-trip to the API unchanged.
export const ENTITY_TYPE_LIST = [
  { value: "contact", label: "Contacto", Icon: User, flat: true },
  { value: "file", label: "Archivo", Icon: Paperclip, flat: true },
  { value: "ledger_account", label: "Cuenta contable", Icon: Landmark, flat: true },
  { value: "hr_employee", label: "Colaborador", Icon: IdCard, flat: true },
  { value: "project", label: "Proyecto", Icon: SquareKanban, flat: true },
  { value: "task", label: "Tarea", Icon: CheckSquare, flat: false },
  { value: "calendar_event", label: "Evento", Icon: CalendarDays, flat: true },
  { value: "vehicle", label: "Vehículo", Icon: Car, flat: true },
  { value: "inventory_item", label: "Artículo de inventario", Icon: Package, flat: true },
];

export const ENTITY_TYPE_BY_VALUE = Object.fromEntries(ENTITY_TYPE_LIST.map((t) => [t.value, t]));

export const FLAT_ENTITY_TYPES = ENTITY_TYPE_LIST.filter((t) => t.flat);

// Every branch returns the same normalized option shape — { label, value,
// subtitle, status, statusBadgeType, coverImageFileId, mimeType, sizeBytes }
// — so a single ConnectorRow can render any type without per-type branching,
// and "Todos" can merge results from every type into one list. Each type's
// list is fetched ONCE (a capped page, cached 30s) rather than per keystroke;
// the search box filters the cached page client-side (see
// matchesConnectorSearch below) — same reasoning as the previous
// per-type ComboboxField pickers this replaces.
export async function fetchEntityOptions(entityType, token) {
  if (entityType === "contact") {
    // Dedicated lightweight picker endpoint (server clamps limit to 30).
    const res = await runly.contacts.picker(token, { limit: 100 });
    return (res?.data ?? []).map((c) => ({ label: c.name, value: c.id, subtitle: c.phone ?? c.email ?? null }));
  }
  if (entityType === "file") {
    const res = await runly.files.list({ pageSize: 100 }, token);
    return (res?.data ?? []).map((f) => ({
      label: f.originalName,
      value: f.id,
      subtitle: null,
      mimeType: f.mimeType ?? null,
      sizeBytes: f.sizeBytes ?? null,
    }));
  }
  if (entityType === "hr_employee") {
    // The SDK's listEmployees only forwards q/status/enabled/limit — NOT
    // pageSize (silently dropped) — so `limit` is used explicitly here
    // rather than relying on the server's own default `limit` fallback.
    const res = await runly.hr.listEmployees(token, { limit: 100 });
    return (res?.data ?? []).map((e) => ({
      label: `${e.firstName} ${e.lastName}`.trim(),
      value: e.id,
      subtitle: e.jobTitle ?? e.department ?? null,
    }));
  }
  if (entityType === "ledger_account") {
    // No server-side search/filter param exists on this endpoint — fetch the
    // full list once (typically small per company) and filter client-side.
    const res = await runly.ledger.listAccounts(token, {});
    return (res?.data ?? []).map((a) => ({
      // bank already lives in the label ("Cuenta · BBVA") — no separate
      // subtitle needed, unlike the other types.
      label: a.bank ? `${a.name} · ${a.bank}` : a.name,
      value: a.id,
      subtitle: null,
    }));
  }
  if (entityType === "project") {
    // GET /projects (projects-routes.js) returns the array directly —
    // `c.json(projects)`, not `{ data: [...] }` — unlike contact/hr_employee/
    // ledger_account above. `res?.data ?? res ?? []` covers both shapes, same
    // defensive pattern ProjectsScreen.jsx already uses for this same call.
    const res = await runly.projects.listProjects(token);
    return (res?.data ?? res ?? []).map((p) => ({ label: p.name, value: p.id, subtitle: null }));
  }
  if (entityType === "calendar_event") {
    // A fixed 90-days-back / 365-days-ahead window — this is a "mention an
    // event you'd realistically want to reference," not the full calendar
    // history. listEvents requires start/end (calendar-event-service.js
    // throws 400 without them).
    const now = Date.now();
    const start = new Date(now - 90 * 86400000).toISOString();
    const end = new Date(now + 365 * 86400000).toISOString();
    const res = await runly.calendar.listEvents(token, { start, end });
    return (res ?? []).map((e) => {
      const startDate = new Date(e.startAt);
      return {
        label: e.title,
        value: e.id,
        subtitle: Number.isNaN(startDate.getTime())
          ? null
          : startDate.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }),
      };
    });
  }
  if (entityType === "vehicle") {
    const res = await runly.fleet.listVehicles({ pageSize: 100 }, token);
    return (res?.data ?? []).map((v) => ({
      label: v.plate || v.name || "Vehiculo",
      value: v.id,
      subtitle: [v.vehicle_brand_name, v.vehicle_model_name, v.vehicle_model_year].filter(Boolean).join(" ") || null,
      status: v.status ?? null,
      statusBadgeType: "vehicle",
      coverImageFileId: v.cover_image_file_asset_id ?? null,
    }));
  }
  if (entityType === "inventory_item") {
    // limit (not pageSize) — inventory's own param name, see
    // runly.inventory.listItems' route/service signature.
    const res = await runly.inventory.listItems({ limit: 100 }, token);
    return (res?.data ?? []).map((i) => ({
      label: i.name,
      value: i.id,
      subtitle: [i.assetTag, i.categoryName].filter(Boolean).join(" · ") || null,
      status: i.status ?? null,
      statusBadgeType: "inventory_item",
      coverImageFileId: i.coverImageFileId ?? null,
    }));
  }
  return [];
}

// Case-insensitive match against every text field a normalized option
// exposes — shared by every list view (the per-type lists and "Todos") so
// filtering behaves identically no matter which one is active.
export function matchesConnectorSearch(opt, query) {
  if (!query?.trim()) return true;
  const q = query.trim().toLowerCase();
  return [opt.label, opt.subtitle].filter(Boolean).some((v) => v.toLowerCase().includes(q));
}
