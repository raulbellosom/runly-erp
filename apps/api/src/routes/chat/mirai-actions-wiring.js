// apps/api/src/routes/chat/mirai-actions-wiring.js
//
// Builds the MirAI action stack (registry + proposals + tools + routes) from
// each module's mirai-actions.js. A new module adds one spread line to
// `actions`. Also owns the confirmation note posted back to the chat.
import { createScopedErpContextResolver } from "./mirai-scoped-context.js";
import { createMiraiActionRegistry } from "./mirai-action-registry.js";
import { createMiraiProposalService } from "./mirai-proposal-service.js";
import { ACTION_TOOL_DEFS, buildActionToolRunners } from "./mirai-action-tools.js";
import { createMiraiProposalRoutes } from "./mirai-proposal-routes.js";
import { createCalendarMiraiActions } from "../calendar/mirai-actions.js";
import { createCalendarEventEffects } from "../calendar/calendar-event-effects.js";

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

export function createMiraiActionsStack({ prisma, broadcaster = null, resolveUserContext, calendarEventService }) {
  const actions = [
    ...createCalendarMiraiActions({
      prisma,
      eventService: calendarEventService,
      effects: createCalendarEventEffects({ prisma, broadcaster }),
    }),
  ];
  const resolveScopedErpContext = createScopedErpContextResolver({ prisma, resolveUserContext });
  const registry = createMiraiActionRegistry({ prisma, resolveScopedErpContext, actions });
  const proposalService = createMiraiProposalService({
    prisma, registry, postNote: createActionNotePoster({ prisma, broadcaster }),
  });
  return {
    actionTools: {
      defs: ACTION_TOOL_DEFS,
      runners: buildActionToolRunners({ registry, proposalService }),
      attachMessage: proposalService.attachMessage,
    },
    createRoutes: ({ requirePermission, resolveProfileId }) =>
      createMiraiProposalRoutes({ requirePermission, proposalService, resolveProfileId }),
  };
}
