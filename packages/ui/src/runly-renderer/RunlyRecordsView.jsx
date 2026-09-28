// Runtime entry for the CARDS / CALENDAR / TIMELINE / REPORT view kinds:
// owns the records-view query (month range for CALENDAR), loading/error/empty
// states and the page header, then delegates to the kind's renderer.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, GanttChart, LayoutGrid, Table2 } from "lucide-react";
import { EmptyState } from "../components/EmptyState.jsx";
import { ErrorState } from "../components/ErrorState.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { RunlyCardsView } from "./RunlyCardsView.jsx";
import { RunlyCalendarView, monthRange } from "./RunlyCalendarView.jsx";
import { RunlyTimelineView } from "./RunlyTimelineView.jsx";
import { RunlyReportView } from "./RunlyReportView.jsx";

export const RECORDS_VIEW_KINDS = ["CARDS", "CALENDAR", "TIMELINE", "REPORT"];

const EMPTY = {
  CARDS: { icon: LayoutGrid, title: "No hay registros todavía" },
  CALENDAR: { icon: CalendarDays, title: "Sin registros este mes" },
  TIMELINE: { icon: GanttChart, title: "No hay eventos todavía" },
  REPORT: { icon: Table2, title: "No hay datos para agrupar" },
};

export function RunlyRecordsView({ blueprint, kind, moduleKey, companyId, queryRecordsView, onOpen, resolveImage }) {
  const schema = blueprint.schema ?? {};
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const range = kind === "CALENDAR" ? monthRange(month) : null;
  const query = useQuery({
    queryKey: ["runly-records-view", companyId, moduleKey, blueprint.key, range?.from ?? null],
    queryFn: () => queryRecordsView({ viewKey: blueprint.key, ...(range ? { range } : {}) }),
    enabled: Boolean(companyId && moduleKey && blueprint.key),
    placeholderData: (previous) => previous,
  });

  const header = <PageHeader title={schema.title} description={schema.description} />;
  if (query.isLoading) {
    return (
      <div className="space-y-5 p-4 sm:p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="p-6">
        <ErrorState title="No se pudo cargar la vista" description="Revisa tu conexión e inténtalo nuevamente." onRetry={() => query.refetch()} />
      </div>
    );
  }

  const data = query.data ?? {};
  const isEmpty = kind === "REPORT" ? !data.groups?.length : !data.records?.length;
  const empty = EMPTY[kind] ?? EMPTY.CARDS;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {header}
      {data.truncated && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {kind === "REPORT" ? "Se muestran los primeros 100 grupos." : `Se muestran los primeros ${data.limit} registros.`}
        </p>
      )}
      {kind === "CALENDAR" && (
        <RunlyCalendarView schema={schema} data={{ records: [], fields: [], ...data }} month={month} onMonthChange={setMonth} onOpen={onOpen} />
      )}
      {kind !== "CALENDAR" && isEmpty && <EmptyState icon={empty.icon} title={empty.title} description="Los registros aparecerán aquí en cuanto se capturen." />}
      {kind === "CARDS" && !isEmpty && <RunlyCardsView schema={schema} data={data} onOpen={onOpen} resolveImage={resolveImage} />}
      {kind === "TIMELINE" && !isEmpty && <RunlyTimelineView schema={schema} data={data} onOpen={onOpen} />}
      {kind === "REPORT" && !isEmpty && <RunlyReportView schema={schema} data={data} />}
    </div>
  );
}
