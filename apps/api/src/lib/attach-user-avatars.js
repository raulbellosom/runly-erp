// apps/api/src/lib/attach-user-avatars.js
//
// Sets `avatarUrl` (a small signed thumbnail) on person objects embedded in a
// response — activity actors, HR employees, assignees — so any viewer of the
// record sees photos without needing identity.users.read for the per-user
// avatar route. A person resolves through its own `avatarFileId` (a
// UserProfile) or, failing that, its linked `userProfileId` (an HrEmployee).
// People without a photo get `avatarUrl: null`; the UI renders initials.
import { buildAvatarUrlMapByFileIds } from "./avatar-url-map.js";

export async function attachUserAvatarUrls(people, { prisma, supabaseAdmin, variant = "card" }) {
  const list = (people ?? []).filter((p) => p && typeof p === "object");
  if (!list.length) return people;
  if (!supabaseAdmin) {
    for (const person of list) person.avatarUrl ??= null;
    return people;
  }

  const profileIds = [...new Set(list.filter((p) => !p.avatarFileId && p.userProfileId).map((p) => p.userProfileId))];
  const fileIdByProfile = new Map();
  if (profileIds.length) {
    const profiles = await prisma.userProfile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, avatarFileId: true },
    });
    for (const profile of profiles) if (profile.avatarFileId) fileIdByProfile.set(profile.id, profile.avatarFileId);
  }

  const fileIdOf = (p) => p.avatarFileId ?? (p.userProfileId ? fileIdByProfile.get(p.userProfileId) : null) ?? null;
  const fileIds = [...new Set(list.map(fileIdOf).filter(Boolean))];
  const urlByFileId = fileIds.length
    ? await buildAvatarUrlMapByFileIds(fileIds, variant, { prisma, supabaseAdmin })
    : new Map();
  for (const person of list) {
    const fileId = fileIdOf(person);
    person.avatarUrl = fileId ? (urlByFileId.get(fileId) ?? null) : null;
  }
  return people;
}
