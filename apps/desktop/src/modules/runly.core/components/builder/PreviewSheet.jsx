// Module Builder — declarative preview (Etapa 13). Renders the server's
// buildPreview() response (normalized view + synthetic sample rows) against
// lightweight @runly/ui table/card primitives — not the production
// RunlyTable/RunlyForm/RunlyDashboard components, which are wired for live
// API data and column-config persistence. This keeps preview instant and
// side-effect free (no install, no real data) at the cost of not being a
// pixel-perfect match for the installed screen; see the plan's "known
// limitations" note.
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SelectField,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  ErrorState,
  Skeleton,
} from "@runly/ui";
import { LayoutDashboard, BarChart3 } from "lucide-react";
import { runly } from "../../../../lib/runly";

function TablePreview({ entity, rows }) {
  const fields = entity?.fields ?? [];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {fields.map((f) => <TableHead key={f.key}>{f.label}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            {fields.map((f) => <TableCell key={f.key}>{formatValue(row[f.key])}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return value.label ?? JSON.stringify(value);
  return String(value);
}

function DetailPreview({ entity, rows }) {
  const row = rows[0];
  if (!row) return null;
  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        {(entity?.fields ?? []).map((f) => (
          <div key={f.key} className="flex items-center justify-between border-b border-[hsl(var(--border))] py-1.5 text-sm">
            <span className="text-[hsl(var(--muted-foreground))]">{f.label}</span>
            <span className="font-medium">{formatValue(row[f.key])}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function KanbanPreview({ view, entity, rows }) {
  const groupBy = view.groupBy ?? view.schema?.groupBy;
  const titleField = view.card?.titleField ?? view.schema?.card?.titleField;
  const columns = [...new Set(rows.map((r) => r[groupBy]))].filter((v) => v !== undefined);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((columnValue) => (
        <div key={String(columnValue)} className="min-w-52 space-y-2">
          <Badge variant="outline">{String(columnValue)}</Badge>
          {rows.filter((r) => r[groupBy] === columnValue).map((row) => (
            <Card key={row.id}>
              <CardContent className="p-3 text-sm">{formatValue(row[titleField]) ?? row.id}</CardContent>
            </Card>
          ))}
        </div>
      ))}
      {!columns.length && <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un campo para agrupar en la pestaña Vistas.</p>}
    </div>
  );
}

function DashboardPreview({ view }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(view.widgets ?? view.schema?.widgets ?? []).map((widget) => (
        <Card key={widget.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {widget.type === "chart" ? <BarChart3 className="h-4 w-4" /> : <LayoutDashboard className="h-4 w-4" />}
              {widget.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-[hsl(var(--muted-foreground))]">
            Vista previa simplificada — {widget.type === "stat" ? "42" : "datos de ejemplo"}
          </CardContent>
        </Card>
      ))}
      {!(view.widgets ?? view.schema?.widgets ?? []).length && <p className="text-sm text-[hsl(var(--muted-foreground))]">Este dashboard no tiene widgets todavía.</p>}
    </div>
  );
}

export function PreviewSheet({ open, onOpenChange, projectId, token, definition }) {
  const [viewKey, setViewKey] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    runly.builder.previewProject(projectId, viewKey, token)
      .then((res) => { setData(res.data); if (!viewKey) setViewKey(res.data.view.key); })
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewKey, projectId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Preview</SheetTitle>
          <SheetDescription>Datos de ejemplo, generados a partir de los tipos de campo. No representan información real.</SheetDescription>
        </SheetHeader>
        <div className="p-4 space-y-4">
          {data?.availableViews?.length > 0 && (
            <SelectField
              label="Vista"
              options={data.availableViews.map((v) => ({ value: v.key, label: `${v.kind} — ${v.key}` }))}
              value={viewKey ?? ""}
              onValueChange={setViewKey}
            />
          )}
          {loading && <Skeleton className="h-48 w-full rounded-xl" />}
          {error && <ErrorState title="No se pudo generar la vista previa" description={error.message} />}
          {!loading && !error && data && (
            <>
              {data.view.kind === "TABLE" && <TablePreview entity={data.entity} rows={data.rows} />}
              {(data.view.kind === "FORM" || data.view.kind === "DETAIL") && <DetailPreview entity={data.entity} rows={data.rows} />}
              {data.view.kind === "KANBAN" && <KanbanPreview view={data.view.schema ?? data.view} entity={data.entity} rows={data.rows} />}
              {data.view.kind === "DASHBOARD" && <DashboardPreview view={data.view.schema ?? data.view} />}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
