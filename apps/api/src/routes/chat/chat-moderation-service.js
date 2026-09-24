import { Prisma } from "@prisma/client";
import { resolveUserProfileId } from "./chat-service.js";

export class ChatModerationServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ChatModerationServiceError";
    this.status = status;
  }
}

// Mirrors PROTECTED_IDENTITY_ROLE_KEYS / hasProtectedIdentityAdminRole in apps/api/src/index.js
// (used by the identity user-delete endpoint). Kept as a local copy here because
// resolveReport is reachable via the narrower identity.chat_reports.manage permission
// (not identity.users.update), so someone granted only "review chat reports" must not
// be able to disable a Runly Admin / System Admin account through this side door.
const PROTECTED_IDENTITY_ROLE_KEYS = new Set(["runly.admin", "system.admin"]);

function hasProtectedIdentityAdminRole(user) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  return memberships.some((membership) => {
    if (!membership?.enabled) return false;
    const roleKey = String(membership?.role?.key ?? "")
      .trim()
      .toLowerCase();
    return PROTECTED_IDENTITY_ROLE_KEYS.has(roleKey);
  });
}

export function createChatModerationService({ prisma }) {
  async function getUserProfileId(authUserId) {
    return resolveUserProfileId(prisma, authUserId);
  }

  async function muteConversation({ conversationId, authUserId, muted }) {
    const profileId = await getUserProfileId(authUserId);
    await prisma.$executeRaw`
      UPDATE chat_conversation_members
      SET muted_at = ${muted ? new Date() : null}
      WHERE conversation_id = ${conversationId} AND user_id = ${profileId} AND left_at IS NULL
    `;
    return { conversationId, muted };
  }

  async function blockUser({ authUserId, targetUserId }) {
    const profileId = await getUserProfileId(authUserId);
    if (profileId.toString() === targetUserId) {
      throw new ChatModerationServiceError("No puedes bloquearte a ti mismo.", 400);
    }
    await prisma.$executeRaw`
      INSERT INTO chat_blocks (blocker_user_id, blocked_user_id)
      VALUES (${profileId}, ${targetUserId})
      ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
    `;
    return { blocked: true };
  }

  async function unblockUser({ authUserId, targetUserId }) {
    const profileId = await getUserProfileId(authUserId);
    await prisma.$executeRaw`
      DELETE FROM chat_blocks WHERE blocker_user_id = ${profileId} AND blocked_user_id = ${targetUserId}
    `;
    return { blocked: false };
  }

  async function getBlockStatus({ authUserId, targetUserId }) {
    const profileId = await getUserProfileId(authUserId);
    const rows = await prisma.$queryRaw`
      SELECT blocker_user_id, blocked_user_id FROM chat_blocks
      WHERE (blocker_user_id = ${profileId} AND blocked_user_id = ${targetUserId})
         OR (blocker_user_id = ${targetUserId} AND blocked_user_id = ${profileId})
    `;
    const blockedByMe = rows.some((r) => r.blocker_user_id.toString() === profileId.toString());
    const blockedByThem = rows.some((r) => r.blocker_user_id.toString() === targetUserId);
    return { blockedByMe, blockedByThem };
  }

  async function getGroupsInCommon({ authUserId, targetUserId }) {
    const profileId = await getUserProfileId(authUserId);
    const rows = await prisma.$queryRaw`
      SELECT c.id, c.type, c.title, c.avatar_url, c.avatar_emoji
      FROM chat_conversations c
      WHERE c.type IN ('group', 'channel')
        AND c.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM chat_conversation_members
          WHERE conversation_id = c.id AND user_id = ${profileId} AND left_at IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM chat_conversation_members
          WHERE conversation_id = c.id AND user_id = ${targetUserId} AND left_at IS NULL
        )
      ORDER BY c.title ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      avatarUrl: r.avatar_url,
      avatarEmoji: r.avatar_emoji,
    }));
  }

  async function createReport({ authUserId, reportedUserId, conversationId = null, reason, note = null, alsoBlock = false }) {
    const profileId = await getUserProfileId(authUserId);
    if (profileId.toString() === reportedUserId) {
      throw new ChatModerationServiceError("No puedes reportarte a ti mismo.", 400);
    }
    const rows = await prisma.$queryRaw`
      INSERT INTO chat_reports (reporter_user_id, reported_user_id, conversation_id, reason, note)
      VALUES (${profileId}, ${reportedUserId}, ${conversationId}, ${reason}, ${note})
      RETURNING id, status
    `;
    if (alsoBlock) {
      await prisma.$executeRaw`
        INSERT INTO chat_blocks (blocker_user_id, blocked_user_id)
        VALUES (${profileId}, ${reportedUserId})
        ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
      `;
    }
    return { id: rows[0].id, status: rows[0].status };
  }

  async function listReports({ status = null }) {
    const statusClause = status ? Prisma.sql`WHERE r.status = ${status}` : Prisma.empty;
    const rows = await prisma.$queryRaw`
      SELECT
        r.id, r.reporter_user_id, reporter.display_name AS reporter_display_name,
        r.reported_user_id, reported.display_name AS reported_display_name,
        r.conversation_id, r.reason, r.note, r.status,
        r.reviewed_by_user_id, r.reviewed_at, r.created_at
      FROM chat_reports r
      LEFT JOIN user_profile reporter ON reporter.id = r.reporter_user_id
      LEFT JOIN user_profile reported ON reported.id = r.reported_user_id
      ${statusClause}
      ORDER BY r.created_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      reporterUserId: r.reporter_user_id,
      reporterDisplayName: r.reporter_display_name,
      reportedUserId: r.reported_user_id,
      reportedDisplayName: r.reported_display_name,
      conversationId: r.conversation_id,
      reason: r.reason,
      note: r.note,
      status: r.status,
      reviewedByUserId: r.reviewed_by_user_id,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
    }));
  }

  async function resolveReport({ reportId, authUserId, action }) {
    if (action !== "dismiss" && action !== "disable_user") {
      throw new ChatModerationServiceError("Accion invalida.", 400);
    }

    const reportRows = await prisma.$queryRaw`
      SELECT id, reported_user_id, status FROM chat_reports WHERE id = ${reportId} LIMIT 1
    `;
    if (!reportRows.length) throw new ChatModerationServiceError("Reporte no encontrado.", 404);
    if (reportRows[0].status !== "open") {
      throw new ChatModerationServiceError("Este reporte ya fue resuelto.", 400);
    }
    const reviewerProfileId = await getUserProfileId(authUserId);
    const newStatus = action === "disable_user" ? "user_disabled" : "dismissed";

    if (action === "disable_user") {
      const targetUser = await prisma.userProfile.findUnique({
        where: { id: reportRows[0].reported_user_id },
        include: {
          memberships: {
            where: { enabled: true },
            include: { role: { select: { key: true } } },
          },
        },
      });
      if (hasProtectedIdentityAdminRole(targetUser)) {
        throw new ChatModerationServiceError(
          "No se puede deshabilitar un usuario con rol Runly Admin o System Admin.",
          400,
        );
      }

      // Both writes must land together: a crash between them would otherwise
      // leave the user disabled while the report still shows status "open".
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE user_profile SET enabled = false WHERE id = ${reportRows[0].reported_user_id}
        `;
        await tx.$executeRaw`
          UPDATE chat_reports
          SET status = ${newStatus}, reviewed_by_user_id = ${reviewerProfileId}, reviewed_at = NOW()
          WHERE id = ${reportId}
        `;
      });
    } else {
      await prisma.$executeRaw`
        UPDATE chat_reports
        SET status = ${newStatus}, reviewed_by_user_id = ${reviewerProfileId}, reviewed_at = NOW()
        WHERE id = ${reportId}
      `;
    }

    return { id: reportId, status: newStatus };
  }

  return {
    muteConversation,
    blockUser,
    unblockUser,
    getBlockStatus,
    getGroupsInCommon,
    createReport,
    listReports,
    resolveReport,
  };
}
