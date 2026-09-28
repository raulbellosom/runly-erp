// TIMELINE records view: records on a vertical line, grouped under a date
// heading per day (newest first unless the schema orders otherwise).
import { accentFor, dayKey, fieldMap, formatFieldValue, toLocalDate } from "./records-view-format.js";

const dayFmt = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

export function RunlyTimelineView({ schema, data, onOpen }) {
  const fields = fieldMap(data.fields);
  const dateField = fields.get(schema.dateField);
  const titleField = fields.get(schema.titleField);
  const descriptionField = fields.get(schema.descriptionField);
  const badgeField = fields.get(schema.badgeField);

  const groups = [];
  for (const record of data.records) {
    const date = toLocalDate(record[schema.dateField]);
    const key = date ? dayKey(date) : "__none__";
    let group = groups.at(-1);
    if (!group || group.key !== key) { group = { key, date, records: [] }; groups.push(group); }
    group.records.push(record);
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <h3 className="text-sm font-semibold capitalize text-[hsl(var(--muted-foreground))]">
            {group.date ? dayFmt.format(group.date) : "Sin fecha"}
          </h3>
          <ol className="relative ml-2 space-y-3 border-l-2 border-[hsl(var(--border))] pl-6">
            {group.records.map((record) => {
              const accent = badgeField ? accentFor(badgeField, record[schema.badgeField]) : "hsl(var(--primary))";
              const Tag = onOpen ? "button" : "div";
              return (
                <li key={record.id} className="relative">
                  <span className="absolute -left-[33px] top-4 h-3.5 w-3.5 rounded-full border-2 border-[hsl(var(--background))]" style={{ backgroundColor: accent }} aria-hidden="true" />
                  <Tag
                    type={onOpen ? "button" : undefined}
                    onClick={onOpen ? () => onOpen(record.id) : undefined}
                    className={`w-full space-y-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-left ${onOpen ? "cursor-pointer transition-colors hover:bg-[hsl(var(--muted))]/40" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{formatFieldValue(titleField, record[schema.titleField])}</span>
                      {dateField?.type === "datetime" && group.date && (
                        <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{timeFmt.format(toLocalDate(record[schema.dateField]))}</span>
                      )}
                      {badgeField && record[schema.badgeField] != null && (
                        <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs font-medium">{formatFieldValue(badgeField, record[schema.badgeField])}</span>
                      )}
                    </div>
                    {descriptionField && record[schema.descriptionField] != null && (
                      <p className="line-clamp-3 text-sm text-[hsl(var(--muted-foreground))]">{formatFieldValue(descriptionField, record[schema.descriptionField])}</p>
                    )}
                  </Tag>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
