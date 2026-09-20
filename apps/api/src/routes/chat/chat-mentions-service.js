import { UserAccessError } from '../../services/user-access-service.js';
import { parseMentionIds } from "../../lib/mention-utils.js";

// Fixed, never-real-UUID sentinels so @everyone/@here can ride the exact same
// @[id:name] token format packages/ui/src/components/MentionTextarea.jsx
// already uses for real user/role UUIDs — no component change needed.
export const EVERYONE_MENTION_ID = "00000000-0000-0000-0000-000000000000";
export const HERE_MENTION_ID = "00000000-0000-0000-0000-000000000001";

// Deliberately duplicated from chat-permissions-service.js's roleHasPermission
// rather than imported: chat-service.js is about to import this file (Task 2),
// and chat-permissions-service.js already imports from chat-service.js, so
// importing chat-permissions-service.js here would close a real dependency
// cycle across the sibling services. Keep the two permission keys below
// ("mentions.everyone"/"mentions.here") in sync with CHAT_PERMISSIONS in
// chat-permissions-service.js if either is ever renamed.
function hasPermission(role, key) {
  if (!role) return false;
  if (role.isSystem) return true;
  return role.permissions?.[key] === true;
}

export function createChatMentionsService({ prisma }) {
  async function resolveMentions({ conversationId, senderProfileId, body, senderRole }) {
    const rawIds = parseMentionIds(body);
    if (!rawIds.length) {
      return { userIds: [], roleIds: [], everyone: false, here: false, notifyUserIds: [] };
    }

    // MirAI's composer token is handled by the assistant's own permission gate.
    const candidateIds = rawIds.filter((id) => id !== EVERYONE_MENTION_ID && id !== HERE_MENTION_ID && id !== '00000000-0000-0000-0000-00000000b07a');
    const wantsEveryone = rawIds.includes(EVERYONE_MENTION_ID);
    const wantsHere = rawIds.includes(HERE_MENTION_ID);

    let userIds = [];
    let roleIds = [];

    if (candidateIds.length) {
      const memberRows = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members
        WHERE conversation_id = ${conversationId} AND left_at IS NULL AND public.runly_chat_user_access(conversation_id, user_id) AND user_id = ANY(${candidateIds}::uuid[])
      `;
      userIds = memberRows
        .map((r) => r.user_id.toString())
        .filter((id) => id !== senderProfileId);

      const roleRows = await prisma.$queryRaw`
        SELECT id FROM chat_channel_roles WHERE conversation_id = ${conversationId} AND id = ANY(${candidateIds}::uuid[])
      `;
      roleIds = roleRows.map((r) => r.id);
      const eligible = new Set([...memberRows.map((r) => r.user_id.toString()), ...roleIds]);
      if (candidateIds.some((id) => !eligible.has(id))) throw new UserAccessError();
    }

    const everyone = wantsEveryone && hasPermission(senderRole, "mentions.everyone");
    const here = wantsHere && hasPermission(senderRole, "mentions.here");

    const notifySet = new Set(userIds);

    if (roleIds.length) {
      const roleHolderRows = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members
        WHERE conversation_id = ${conversationId} AND left_at IS NULL AND public.runly_chat_user_access(conversation_id, user_id)
          AND role_id = ANY(${roleIds}::uuid[]) AND user_id != ${senderProfileId}
      `;
      for (const r of roleHolderRows) notifySet.add(r.user_id.toString());
    }

    if (everyone || here) {
      const allRows = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members
        WHERE conversation_id = ${conversationId} AND left_at IS NULL AND public.runly_chat_user_access(conversation_id, user_id)
          AND user_id IS NOT NULL AND user_id != ${senderProfileId}
      `;
      for (const r of allRows) notifySet.add(r.user_id.toString());
    }

    return { userIds, roleIds, everyone, here, notifyUserIds: [...notifySet] };
  }

  return { resolveMentions };
}
