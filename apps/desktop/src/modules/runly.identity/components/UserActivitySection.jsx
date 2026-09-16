import { ActivityTimeline } from "@runly/ui";
import { runly } from "../../../lib/runly";

export default function UserActivitySection({ data, token }) {
  if (!data?.id) return null;
  return (
    <ActivityTimeline
      sdk={runly}
      token={token}
      entityType="UserProfile"
      entityId={data.id}
      limit={20}
      heightClass="max-h-[320px]"
      emptyMessage="Sin actividad registrada para este usuario."
    />
  );
}
