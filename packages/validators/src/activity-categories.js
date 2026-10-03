// Audit-trail categories derived from an activity `type` (spec
// 2026-10-03-audit-trail-design §5). Shared by the API (filtering) and the UI
// (icons/filters) so both always agree. Order matters: the first matching
// rule wins, and more specific segments (comment/file) come first.

export const ACTIVITY_CATEGORIES = ["created", "updated", "status", "assignment", "comment", "file"];

// Each rule: `contains` segments (".comment.") or `endsWith` suffixes.
const RULES = [
  { category: "comment", contains: [".comment."] },
  { category: "file", contains: [".file.", ".document.", ".attachment."] },
  { category: "assignment", contains: [".assign", ".return"] },
  { category: "created", endsWith: [".create", ".created"] },
  { category: "updated", endsWith: [".update", ".updated"] },
  { category: "status", contains: [".admin.", ".status", "registration"], endsWith: [".enable", ".disable", ".delete", ".deleted"] },
];

export function activityCategory(type) {
  const t = String(type ?? "").toLowerCase();
  for (const rule of RULES) {
    if (rule.contains?.some((seg) => t.includes(seg))) return rule.category;
    if (rule.endsWith?.some((suffix) => t.endsWith(suffix))) return rule.category;
  }
  return "other";
}

// Prisma `where` fragment (an OR list on `type`) for one category, or null for
// an unknown one. Approximate by design for "created"/"updated": a comment or
// file type never ends in .create/.update/.created/.updated in this codebase.
export function activityCategoryWhere(category) {
  const rule = RULES.find((r) => r.category === category);
  if (!rule) return null;
  const or = [
    ...(rule.contains ?? []).map((seg) => ({ type: { contains: seg, mode: "insensitive" } })),
    ...(rule.endsWith ?? []).map((suffix) => ({ type: { endsWith: suffix, mode: "insensitive" } })),
  ];
  return { OR: or };
}
