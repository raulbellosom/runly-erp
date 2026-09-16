// Registry key: runly.hr:OrgChartSection
// Props (RunlyDetail "component" section contract): { data, apiBaseUrl, token, companyId }
// data.supervisor and data.reportees must be the nested relation objects
// getEmployee() already returns (not just their ids), each carrying its own
// profileImageFileId (own FileAsset cover, resolved via /files/:id/signed-url)
// and userProfile.id (linked account, resolved via the dedicated
// /identity/users/:id/avatar/signed-url — a user avatar isn't a
// company-scoped file entity, so it needs its own route, not fetchSignedUrl).
// No own card/header chrome — RunlyDetail's section wrapper already
// supplies one from the blueprint's label/icon (see the same treatment
// applied to HrEmployeeActivityPanel/HistorySection).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn, fetchSignedUrl, fetchUserAvatarSignedUrl } from "@runly/ui";
import { ChevronRight, User } from "lucide-react";

const STATUS_DOT = {
  active: "bg-emerald-500",
  vacation: "bg-amber-500",
  inactive: "bg-slate-400",
  terminated: "bg-red-500",
};

const ORG_AVATAR_COLORS = [
  "bg-blue-500/15 text-blue-600",
  "bg-emerald-500/15 text-emerald-600",
  "bg-violet-500/15 text-violet-600",
  "bg-amber-500/15 text-amber-600",
  "bg-rose-500/15 text-rose-600",
  "bg-cyan-500/15 text-cyan-600",
  "bg-pink-500/15 text-pink-600",
  "bg-indigo-500/15 text-indigo-600",
];

function orgAvatarColor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return ORG_AVATAR_COLORS[hash % ORG_AVATAR_COLORS.length];
}

function OrgNode({ firstName = "", lastName = "", jobTitle, status, isSelf, onClick, photoUrl }) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  const name = `${firstName} ${lastName}`.trim();
  const dot = STATUS_DOT[status];
  const avatarCls = isSelf
    ? "bg-(--brand-primary)/15 text-(--brand-primary)"
    : orgAvatarColor(name);

  return (
    <button
      type="button"
      disabled={isSelf || !onClick}
      onClick={onClick}
      className={cn(
        "group w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-150",
        isSelf
          ? "border-(--brand-primary)/30 bg-(--brand-primary)/6 cursor-default shadow-sm"
          : "border-[hsl(var(--border))]/80 bg-[hsl(var(--card))] hover:border-(--brand-primary)/30 hover:bg-[hsl(var(--muted))]/30 cursor-pointer",
        !onClick && !isSelf && "cursor-default",
      )}
    >
      <div
        className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden",
          !photoUrl && avatarCls,
        )}
      >
        {photoUrl ? (
          <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          initials || <User className="h-4 w-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p
            className={cn(
              "text-xs font-semibold truncate",
              isSelf ? "text-(--brand-primary)" : "text-[hsl(var(--foreground))]",
            )}
          >
            {name}
          </p>
          {isSelf && (
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full bg-(--brand-primary)/12 text-(--brand-primary)">
              Tú
            </span>
          )}
        </div>
        {jobTitle && (
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate leading-4 mt-0.5">
            {jobTitle}
          </p>
        )}
      </div>
      {dot && !isSelf && <div className={cn("h-2 w-2 rounded-full shrink-0", dot)} />}
      {!isSelf && onClick && (
        <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

function OrgConnector() {
  return (
    <div className="flex justify-center py-0.5">
      <div className="w-px h-4 bg-[hsl(var(--border))]" />
    </div>
  );
}

// Own cover photo wins; else fall back to the linked account's avatar.
// The two need different endpoints (see the imports above), so a request
// carries which one to use, keyed so multiple nodes sharing a photo only
// fetch it once.
function nodePhotoRequest(node) {
  if (node?.profileImageFileId) {
    return { key: `own:${node.profileImageFileId}`, kind: "own", id: node.profileImageFileId };
  }
  if (node?.userProfile?.id) {
    return { key: `user:${node.userProfile.id}`, kind: "user", id: node.userProfile.id };
  }
  return null;
}

export default function OrgChartSection({ data, apiBaseUrl, token, companyId }) {
  const navigate = useNavigate();
  const supervisor = data?.supervisor;
  const reportees = data?.reportees ?? [];

  const photoRequests = useMemo(() => {
    const map = new Map();
    for (const node of [data, supervisor, ...reportees]) {
      const req = nodePhotoRequest(node);
      if (req && !map.has(req.key)) map.set(req.key, req);
    }
    return [...map.values()];
  }, [data, supervisor, reportees]);
  const photoRequestsKey = photoRequests.map((r) => r.key).join(",");
  const [photoUrls, setPhotoUrls] = useState({});

  useEffect(() => {
    if (photoRequests.length === 0) {
      setPhotoUrls({});
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        photoRequests.map(async (req) => [
          req.key,
          req.kind === "own"
            ? await fetchSignedUrl(apiBaseUrl, token, req.id, companyId)
            : await fetchUserAvatarSignedUrl(apiBaseUrl, token, req.id, companyId),
        ]),
      );
      if (!cancelled) setPhotoUrls(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- photoRequestsKey is the stable dep; photoRequests itself is a new array every render
  }, [apiBaseUrl, token, companyId, photoRequestsKey]);

  const photoUrlFor = (node) => {
    const req = nodePhotoRequest(node);
    return req ? (photoUrls[req.key] ?? null) : null;
  };

  return (
    <div className="space-y-0.5">
      {supervisor ? (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] px-1 pb-1.5">
            Supervisor
          </p>
          <OrgNode
            firstName={supervisor.firstName}
            lastName={supervisor.lastName}
            status={supervisor.status}
            photoUrl={photoUrlFor(supervisor)}
            onClick={() => navigate(`/app/m/runly.hr/hr/employees/${supervisor.id}`)}
          />
          <OrgConnector />
        </>
      ) : (
        <div className="flex items-center gap-2 pb-2">
          <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
            Sin supervisor
          </span>
          <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
        </div>
      )}

      <OrgNode
        firstName={data?.firstName}
        lastName={data?.lastName}
        jobTitle={data?.jobTitle}
        status={data?.status}
        photoUrl={photoUrlFor(data)}
        isSelf
      />

      {reportees.length > 0 ? (
        <>
          <OrgConnector />
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] px-1 pt-0.5 pb-1.5">
            Reportes directos ({reportees.length})
          </p>
          <div className="space-y-1.5">
            {reportees.map((r) => (
              <OrgNode
                key={r.id}
                firstName={r.firstName}
                lastName={r.lastName}
                status={r.status}
                photoUrl={photoUrlFor(r)}
                onClick={() => navigate(`/app/m/runly.hr/hr/employees/${r.id}`)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <OrgConnector />
          <div className="flex items-center gap-2 pt-0.5">
            <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
              Sin reportes directos
            </span>
            <div className="h-px flex-1 bg-[hsl(var(--border))]/50" />
          </div>
        </>
      )}
    </div>
  );
}
