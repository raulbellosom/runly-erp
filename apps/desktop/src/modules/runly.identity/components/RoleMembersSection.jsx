import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage, EmptyState, Skeleton } from "@runly/ui";
import { Users } from "lucide-react";
import { runly } from "../../../lib/runly";

export default function RoleMembersSection({ data, token }) {
  const navigate = useNavigate();
  const roleId = data?.id;
  const membersQuery = useQuery({
    queryKey: ["identity-role-members", roleId],
    queryFn: () => runly.identity.listRoleMembers(roleId, token),
    enabled: Boolean(token && roleId),
  });
  const members = membersQuery.data?.data ?? [];

  if (membersQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (members.length === 0) {
    return <EmptyState icon={Users} title="Sin usuarios" description="Ningún usuario tiene asignado este rol." />;
  }

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <button
          key={member.id}
          type="button"
          onClick={() => navigate(`/app/m/runly.identity/identity/users/${member.id}`)}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[hsl(var(--muted))]/30"
        >
          <Avatar className="h-8 w-8">
            {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.displayName || "Usuario"} />}
            <AvatarFallback>{(member.displayName || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{member.displayName}</p>
            <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{member.companyName}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
