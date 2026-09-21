import { useMemo } from "react";
import { EmptyState, LoadingState } from "@runly/ui";
import { CalendarOff, CornerDownRight } from "lucide-react";
import { useTasks, useStatuses } from "../hooks/useProjectsData";

const DEFAULT_BAR_COLOR = "#6366f1";

const COL_WIDTH = 120;
const ROW_HEIGHT = 40;

function getWeeks(start, end) {
  const weeks = [];
  const cur = new Date(start);
  cur.setDate(cur.getDate() - cur.getDay());
  while (cur <= end) {
    weeks.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

function weekLabel(d) {
  return d.toLocaleDateString("es-MX", { month: "short", day: "numeric" });
}

function msToPercent(ms, totalMs) {
  return Math.max(0, Math.min(100, (ms / totalMs) * 100));
}

export default function TimelineView({
  projectId,
  onTaskClick,
  showSubtasks = false,
}) {
  const { data: tasksData, isLoading } = useTasks(projectId, {
    ...(showSubtasks ? { include_subtasks: "true" } : { parentTaskId: "null" }),
  });
  const tasks = tasksData?.data ?? tasksData ?? [];
  const { data: statusesData } = useStatuses(projectId);
  const statuses = statusesData?.data ?? statusesData ?? [];
  const statusMap = useMemo(() => {
    const m = {};
    for (const s of statuses) m[s.id] = s;
    return m;
  }, [statuses]);

  const { datedTasks, undatedTasks, weeks, timelineStart, totalMs } =
    useMemo(() => {
      const dated = tasks.filter((t) => t.startDate || t.dueDate);
      const undated = tasks.filter((t) => !t.startDate && !t.dueDate);
      if (dated.length === 0)
        return {
          datedTasks: dated,
          undatedTasks: undated,
          weeks: [],
          timelineStart: new Date(),
          totalMs: 1,
        };
      const dates = dated.flatMap((t) =>
        [t.startDate, t.dueDate].filter(Boolean).map((d) => new Date(d)),
      );
      const min = new Date(Math.min(...dates));
      const max = new Date(Math.max(...dates));
      min.setDate(min.getDate() - 7);
      max.setDate(max.getDate() + 7);
      function sortWithSubtasks(list) {
        const parents = list.filter((t) => !t.parentTaskId);
        const children = list.filter((t) => t.parentTaskId);
        const result = [];
        for (const p of parents) {
          result.push(p);
          result.push(...children.filter((c) => c.parentTaskId === p.id));
        }
        const inResult = new Set(result.map((t) => t.id));
        result.push(...children.filter((c) => !inResult.has(c.id)));
        return result;
      }
      const datedSorted = sortWithSubtasks(dated);
      const undatedSorted = sortWithSubtasks(undated);
      return {
        datedTasks: datedSorted,
        undatedTasks: undatedSorted,
        weeks: getWeeks(min, max),
        timelineStart: min,
        totalMs: max - min,
      };
    }, [tasks]);

  if (isLoading) return <LoadingState />;

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={CalendarOff}
        title="Sin tareas"
        description="Este proyecto no tiene tareas todavia."
      />
    );
  }

  if (datedTasks.length === 0) {
    return (
      <EmptyState
        icon={CalendarOff}
        title="Sin fechas"
        description="Agrega startDate o dueDate a las tareas para verlas en el timeline."
      />
    );
  }

  const totalWidth = weeks.length * COL_WIDTH;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-44 shrink-0 border-r border-border overflow-y-auto">
        <div
          style={{ height: ROW_HEIGHT }}
          className="border-b border-border"
        />
        {datedTasks.map((task) => (
          <button
            type="button"
            key={task.id}
            onClick={() => onTaskClick(task.id)}
            style={{ height: ROW_HEIGHT }}
            className={[
              "w-full flex items-center px-3 text-sm text-left truncate border-b border-border hover:bg-muted/50 cursor-pointer",
              task.parentTaskId ? "border-l-2 border-l-indigo-400/60 pl-2" : "",
            ].join(" ")}
          >
            {task.parentTaskId && (
              <CornerDownRight
                size={10}
                className="text-indigo-400/70 mr-1 shrink-0"
              />
            )}
            <div className="truncate min-w-0">
              {task.taskNumber != null && (
                <span className="text-[10px] text-muted-foreground font-mono block leading-none mb-0.5">
                  T-{task.taskNumber}
                </span>
              )}
              <span className="truncate">{task.title}</span>
            </div>
          </button>
        ))}
        {undatedTasks.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
              Sin fecha
            </div>
            {undatedTasks.map((task) => (
              <button
                type="button"
                key={task.id}
                onClick={() => onTaskClick(task.id)}
                style={{ height: ROW_HEIGHT }}
                className={[
                  "w-full flex items-center px-3 text-sm text-left truncate border-b border-border text-muted-foreground hover:bg-muted/50 cursor-pointer",
                  task.parentTaskId
                    ? "border-l-2 border-l-indigo-400/60 pl-2"
                    : "",
                ].join(" ")}
              >
                {task.parentTaskId && (
                  <CornerDownRight
                    size={10}
                    className="text-indigo-400/70 mr-1 shrink-0"
                  />
                )}
                <div className="truncate min-w-0">
                  {task.taskNumber != null && (
                    <span className="text-[10px] text-muted-foreground font-mono block leading-none mb-0.5">
                      T-{task.taskNumber}
                    </span>
                  )}
                  <span className="truncate">{task.title}</span>
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <div style={{ minWidth: totalWidth }}>
          <div
            className="flex border-b border-border sticky top-0 bg-background z-10"
            style={{ height: ROW_HEIGHT }}
          >
            {weeks.map((w, i) => (
              <div
                key={i}
                style={{ width: COL_WIDTH }}
                className="shrink-0 flex items-center justify-center text-xs text-muted-foreground border-r border-border"
              >
                {weekLabel(w)}
              </div>
            ))}
          </div>

          {datedTasks.map((task) => {
            const start = task.startDate
              ? new Date(task.startDate)
              : new Date(task.dueDate);
            const end = task.dueDate
              ? new Date(task.dueDate)
              : new Date(task.startDate);
            const isMilestone = !task.startDate && Boolean(task.dueDate);

            const leftPct = msToPercent(start - timelineStart, totalMs);
            const widthPct = isMilestone
              ? 0
              : msToPercent(end - start, totalMs);
            const barColor = statusMap[task.statusId]?.color ?? DEFAULT_BAR_COLOR;

            return (
              <div
                key={task.id}
                style={{ height: ROW_HEIGHT, position: "relative" }}
                className="border-b border-border"
              >
                {weeks.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: i * COL_WIDTH,
                      top: 0,
                      bottom: 0,
                      width: 1,
                    }}
                    className="bg-border"
                  />
                ))}
                {isMilestone ? (
                  <button
                    type="button"
                    onClick={() => onTaskClick(task.id)}
                    style={{
                      position: "absolute",
                      left: `calc(${leftPct}% - 6px)`,
                      top: "50%",
                      transform: "translateY(-50%) rotate(45deg)",
                      width: 12,
                      height: 12,
                      background: barColor,
                      cursor: "pointer",
                    }}
                    title={task.title}
                    aria-label={task.title}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onTaskClick(task.id)}
                    style={{
                      position: "absolute",
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      top: "50%",
                      transform: "translateY(-50%)",
                      height: 20,
                      background: barColor,
                      borderRadius: 10,
                      minWidth: 20,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 8,
                      overflow: "hidden",
                    }}
                    title={task.title}
                  >
                    <span className="text-[10px] text-white whitespace-nowrap overflow-hidden">
                      {task.title}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
