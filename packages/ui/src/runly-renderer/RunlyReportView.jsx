// REPORT records view: one row per group value with its measures, a relative
// bar on the first measure for quick comparison, and a totals footer.
import { fieldMap, formatMeasure } from "./records-view-format.js";

export function RunlyReportView({ schema, data }) {
  const fields = fieldMap(data.fields);
  const groupField = fields.get(schema.groupBy);
  const measures = schema.measures ?? [];
  const lead = measures[0];
  const leadMax = Math.max(...data.groups.map((group) => Number(group.measures[lead?.key] ?? 0)), 0) || 1;

  return (
    <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs text-[hsl(var(--muted-foreground))]">
              <th scope="col" className="px-4 py-2.5 text-left font-medium">{groupField?.label ?? schema.groupBy}</th>
              {measures.map((measure) => <th key={measure.key} scope="col" className="px-4 py-2.5 text-right font-medium">{measure.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group) => (
              <tr key={String(group.value)} className="border-b border-[hsl(var(--border))] last:border-0">
                <td className="px-4 py-3 font-medium">{group.label}</td>
                {measures.map((measure, index) => {
                  const value = group.measures[measure.key];
                  return (
                    <td key={measure.key} className="px-4 py-3 text-right tabular-nums">
                      {index === 0 ? (
                        <span className="inline-flex items-center justify-end gap-3">
                          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[hsl(var(--muted))] sm:block" aria-hidden="true">
                            <span className="block h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${(Number(value ?? 0) / leadMax) * 100}%` }} />
                          </span>
                          {formatMeasure(measure, fields.get(measure.field), value)}
                        </span>
                      ) : formatMeasure(measure, fields.get(measure.field), value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 font-semibold">
              <td className="px-4 py-3">Total</td>
              {measures.map((measure) => (
                <td key={measure.key} className="px-4 py-3 text-right tabular-nums">{formatMeasure(measure, fields.get(measure.field), data.totals?.[measure.key])}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
