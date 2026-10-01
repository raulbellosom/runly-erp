// apps/api/src/routes/chat/mirai-actions-wiring.js
//
// Builds the MirAI capability stack (registry + proposals + module tools +
// routes) from each module's mirai-capabilities.js. A new module adds one
// line to `capabilities`. Also owns the confirmation note posted back to chat.
import { createScopedErpContextResolver } from "./mirai-scoped-context.js";
import { createMiraiCapabilityRegistry } from "./mirai-capability-registry.js";
import { createMiraiProposalService } from "./mirai-proposal-service.js";
import { createModuleToolset } from "./mirai-module-tools.js";
import { createMiraiProposalRoutes } from "./mirai-proposal-routes.js";
import { createCalendarMiraiCapabilities } from "../calendar/mirai-capabilities.js";
import { createCalendarEventEffects } from "../calendar/calendar-event-effects.js";
import { createPfmMiraiCapabilities } from "../pfm/mirai-capabilities.js";
import { createInventoryMiraiCapabilities } from "../inventory/mirai-capabilities.js";
import { createContactsMiraiCapabilities } from "../contacts/mirai-capabilities.js";
import { createPurchasesMiraiCapabilities } from "../purchases/mirai-capabilities.js";
import { createProjectsMiraiCapabilities } from "../projects/mirai-capabilities.js";
import { createProjectsTaskEffects } from "../projects/projects-task-effects.js";
import { createProjectsNotificationService } from "../projects/projects-notification-service.js";
import { createProjectsCalendarBridge } from "../projects/projects-calendar-bridge.js";
import { createNotesMiraiCapabilities } from "../notes/mirai-capabilities.js";
import { createHrMiraiCapabilities } from "../hr/mirai-capabilities.js";
import { createFleetMiraiCapabilities } from "../fleet/mirai-capabilities.js";
import { createLedgerMiraiCapabilities } from "../ledger/mirai-capabilities.js";
import { createCanvasMiraiCapabilities } from "../canvas/mirai-capabilities.js";
import { createChatAttachmentAccess } from "./chat-attachment-access.js";

function createActionNotePoster({ prisma, broadcaster }) {
  return async function postNote({ proposal, text }) {
    const body = String(text).slice(0, 2000);
    if (proposal.surface === "panel") {
      if (!proposal.thread_id) return;
      await prisma.$executeRaw`
        INSERT INTO chat_mirai_message (thread_id, role, content)
        VALUES (${proposal.thread_id}::uuid, 'system', ${body})
      `;
      return;
    }
    const conversationId = proposal.conversation_id;
    const [msg] = await prisma.$queryRaw`
      INSERT INTO chat_messages (conversation_id, sender_user_id, sender_type, body, message_type)
      VALUES (${conversationId}::uuid, NULL, 'system', ${body}, 'system')
      RETURNING id, created_at
    `;
    await prisma.$executeRaw`
      UPDATE chat_conversations
      SET last_message_id = ${msg.id}::uuid, last_message_at = ${msg.created_at}, updated_at = NOW()
      WHERE id = ${conversationId}::uuid
    `;
    if (broadcaster) {
      const members = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members WHERE conversation_id = ${conversationId}::uuid AND left_at IS NULL
      `;
      broadcaster.broadcastToUsers(members.map((m) => m.user_id.toString()), "chat.message.new", {
        conversationId, messageId: msg.id, senderName: "MirAI",
      }).catch(() => {});
    }
  };
}

export function createMiraiActionsStack({ prisma, broadcaster = null, notificationService = null, resolveUserContext, calendarEventService, listMessages = null, signAttachmentUrl = null }) {
  // Lets capabilities read chat attachments with the caller's own access (ledger statement import).
  const attachments = listMessages && signAttachmentUrl
    ? createChatAttachmentAccess({ prisma, listMessages, signAttachmentUrl })
    : null;
  const capabilities = [
    createCalendarMiraiCapabilities({
      prisma,
      eventService: calendarEventService,
      effects: createCalendarEventEffects({ prisma, broadcaster }),
    }),
    createPfmMiraiCapabilities({ prisma }),
    createInventoryMiraiCapabilities({ prisma }),
    createContactsMiraiCapabilities({ prisma }),
    createPurchasesMiraiCapabilities({ prisma, broadcaster }),
    createProjectsMiraiCapabilities({
      prisma,
      effects: createProjectsTaskEffects({
        prisma,
        notifSvc: createProjectsNotificationService({ prisma, notificationService }),
        bridge: createProjectsCalendarBridge({ prisma }),
        broadcaster,
      }),
    }),
    createNotesMiraiCapabilities({ prisma }),
    createHrMiraiCapabilities({ prisma }),
    createFleetMiraiCapabilities({ prisma }),
    createLedgerMiraiCapabilities({ prisma, attachments }),
    createCanvasMiraiCapabilities({ prisma, broadcaster }),
  ];
  const resolveScopedErpContext = createScopedErpContextResolver({ prisma, resolveUserContext });
  const registry = createMiraiCapabilityRegistry({ prisma, resolveScopedErpContext, capabilities });
  const proposalService = createMiraiProposalService({
    prisma, registry, postNote: createActionNotePoster({ prisma, broadcaster }),
  });
  const toolset = createModuleToolset({ prisma, registry, proposalService });
  return {
    moduleTools: {
      toolset,
      attachMessage: proposalService.attachMessage,
    },
    createRoutes: ({ requirePermission, resolveProfileId }) =>
      createMiraiProposalRoutes({ requirePermission, proposalService, resolveProfileId }),
  };
}
