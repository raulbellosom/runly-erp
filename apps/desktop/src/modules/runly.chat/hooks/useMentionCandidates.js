import { useMemo } from "react";
import { useChatConversationDetail } from "./useChatConversationDetail";
import { useChannelRoles } from "./useChannelRoles";
import { useMiraiStatus } from "./useMirAI";
import { MIRAI_MENTION_ID, MIRAI_NAME } from "../lib/mirai";
import { roleHasPermission, findOwnMember, CHAT_PERMISSIONS } from "../lib/chatPermissions";

// Fixed sentinel UUIDs — must stay byte-identical to
// apps/api/src/routes/chat/chat-mentions-service.js's EVERYONE_MENTION_ID /
// HERE_MENTION_ID. Never a real UUIDv7 (version/variant nibbles are both 0
// here; a real generated id can never match), so these safely ride the same
// @[id:name] token format MentionTextarea already uses for real users/roles.
export const EVERYONE_MENTION_ID = "00000000-0000-0000-0000-000000000000";
export const HERE_MENTION_ID = "00000000-0000-0000-0000-000000000001";

// Only meaningful for `channel`/`group` conversations — for `direct`/
// `external_support`, roles/everyone/here don't exist, and this hook simply
// returns the other member(s) as plain mention candidates (still useful:
// mentioning the other party in a direct chat is harmless, just redundant).
export function useMentionCandidates(conversationId, currentUserId) {
  const { data: convData } = useChatConversationDetail(conversationId);
  const { data: rolesData } = useChannelRoles(conversationId);
  const { data: miraiStatus } = useMiraiStatus();

  return useMemo(() => {
    const members = convData?.data?.members ?? [];
    const roles = rolesData?.data ?? [];
    const convType = convData?.data?.type ?? null;
    const ownMember = findOwnMember(members, currentUserId);

    // MirAI as a mention candidate — everywhere except its own dedicated
    // chat and external_support, and only when the assistant is available to
    // this user (configured + chat.mirai.use). Inserted as an @[id:name]
    // token that the API resolves via matchMiraiMention.
    const miraiCandidate =
      miraiStatus?.available === true &&
      convType !== "mirai" &&
      convType !== "external_support"
        ? [{ id: MIRAI_MENTION_ID, displayName: MIRAI_NAME }]
        : [];

    // Excludes guest members (userId is NULL for a chat_conversation_members row
    // backed by guest_session_id, e.g. an external_support visitor) — they have
    // no real UUID to serialize into a @[id:name] token. Without this filter,
    // MentionTextarea's insertMention silently maps the display name to a null
    // uuid, toSerialized leaves the raw "@[Usuario]" text unconverted (it never
    // matches the stored-token regex), and that garbled literal text ships
    // straight to the external website visitor reading the reply.
    const memberCandidates = members
      .filter((m) => m.userId && m.userId !== currentUserId)
      .map((m) => ({ id: m.userId, displayName: m.displayName ?? "Usuario", avatarUrl: m.avatarUrl, email: m.email }));

    const roleCandidates = roles.map((r) => ({ id: r.id, displayName: r.name }));

    const sentinelCandidates = [];
    if (roleHasPermission(ownMember, CHAT_PERMISSIONS.MENTIONS_EVERYONE)) {
      sentinelCandidates.push({ id: EVERYONE_MENTION_ID, displayName: "everyone" });
    }
    if (roleHasPermission(ownMember, CHAT_PERMISSIONS.MENTIONS_HERE)) {
      sentinelCandidates.push({ id: HERE_MENTION_ID, displayName: "here" });
    }

    return [...miraiCandidate, ...memberCandidates, ...roleCandidates, ...sentinelCandidates];
  }, [convData, rolesData, currentUserId, miraiStatus?.available]);
}
