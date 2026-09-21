import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeContext } from "../../../providers/RealtimeProvider";

const TASK_DETAIL_ACTIONS = new Set([
  "updated",
  "moved",
  "comment_added",
  "comment_updated",
  "comment_deleted",
  "reaction_updated",
  "dependency_added",
  "dependency_removed",
  "field_values_updated",
]);

/**
 * Subscribe to broadcast project/task events for a project.
 * Invalidates the relevant queries whenever a team member changes something
 * in the same project, so open boards/lists/detail panels reflect it without
 * a manual reload. Mount once per project board/list.
 */
export function useProjectRealtime(projectId) {
  const queryClient = useQueryClient();
  const { on } = useRealtimeContext();

  useEffect(() => {
    if (!projectId) return;

    const offTask = on("projects.task.updated", ({ projectId: pid, taskId, action }) => {
      if (pid !== projectId) return;
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      if (taskId && TASK_DETAIL_ACTIONS.has(action)) {
        queryClient.invalidateQueries({ queryKey: ["projects", projectId, "tasks", taskId] });
        queryClient.invalidateQueries({ queryKey: ["projects", projectId, "tasks", taskId, "comments"] });
        queryClient.invalidateQueries({ queryKey: ["projects", projectId, "tasks", taskId, "dependencies"] });
        queryClient.invalidateQueries({ queryKey: ["projects", projectId, "tasks", taskId, "field-values"] });
        queryClient.invalidateQueries({ queryKey: ["activity", "Task", taskId] });
      }
    });

    const offStatus = on("projects.status.updated", ({ projectId: pid }) => {
      if (pid !== projectId) return;
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "statuses"] });
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "tasks"] });
    });

    const offProject = on("projects.project.updated", ({ projectId: pid }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (pid === projectId) {
        queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      }
    });

    const offMember = on("projects.member.updated", ({ projectId: pid }) => {
      if (pid !== projectId) return;
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "members"] });
    });

    const offFields = on("projects.fields.updated", ({ projectId: pid }) => {
      if (pid !== projectId) return;
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "fields"] });
    });

    return () => {
      offTask();
      offStatus();
      offProject();
      offMember();
      offFields();
    };
  }, [projectId, on, queryClient]);
}
