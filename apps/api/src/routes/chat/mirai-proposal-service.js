// apps/api/src/routes/chat/mirai-proposal-service.js
//
// Lifecycle of MirAI action proposals (spec §5, §7): propose runs the
// action's prepare() only — it never writes to the module. confirm atomically
// claims the row, re-checks availability (module + permission), executes,
// audits and posts a system note MirAI reads on its next turn.
import { ChatServiceError } from "./chat-service-error.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function actionContext(prisma, scope, ctx) {
  return {
    prisma,
    companyId: scope.companyId,
    actorProfileId: scope.userId,
    actorAuthUserId: ctx.actorAuthUserId,
    actorProfile: scope.uctx?.profile ?? null,
  };
}

export function toPublicProposal(row) {
  const expired = row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now();
  return {
    id: row.id,
    actionKey: row.action_key,
    operation: row.operation,
    destructive: Boolean(row.destructive),
    status: expired ? "expired" : row.status,
    preview: row.preview,
    result: row.result ?? null,
    error: row.error ?? null,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at ?? null,
    createdAt: row.created_at,
  };
}

export function createMiraiProposalService({ prisma, registry, postNote = null }) {
  // ctx: { companyId, actorProfileId, actorAuthUserId, conversationId, surface, threadId }
  async function propose(ctx, { actionKey, args }) {
    const surface = ctx.surface === "panel" ? "panel" : "direct";
    const resolved = await registry.resolve(ctx, String(actionKey ?? ""));
    if (resolved.error) return { error: resolved.error };
    const { action, scope } = resolved;

    let prepared;
    try {
      prepared = await action.prepare(args && typeof args === "object" ? args : {}, actionContext(prisma, scope, ctx));
    } catch (err) {
      return { error: String(err?.message ?? err).slice(0, 200) };
    }
    if (!prepared || prepared.error) return { error: prepared?.error ?? "No se pudo preparar la accion." };

    await prisma.$executeRaw`
      UPDATE mirai_action_proposals SET status = 'superseded', decided_at = NOW()
      WHERE conversation_id = ${ctx.conversationId}::uuid AND actor_profile_id = ${scope.userId}::uuid
        AND surface = ${surface} AND status = 'pending'
    `;
    const [row] = await prisma.$queryRaw`
      INSERT INTO mirai_action_proposals
        (company_id, conversation_id, surface, thread_id, actor_profile_id, action_key, operation,
         target_id, input, preview, destructive, expires_at)
      VALUES (${scope.companyId}::uuid, ${ctx.conversationId}::uuid, ${surface}, ${ctx.threadId ?? null}::uuid,
        ${scope.userId}::uuid, ${action.key}, ${action.operation}, ${prepared.targetId ?? null},
        ${JSON.stringify(prepared.input)}::jsonb, ${JSON.stringify(prepared.preview)}::jsonb,
        ${action.operation === "delete"}, ${new Date(Date.now() + TTL_MS)})
      RETURNING id, preview
    `;
    return {
      status: "pending_confirmation",
      proposalId: row.id,
      preview: row.preview,
      note: "Propuesta creada. NO se ha ejecutado nada: el usuario debe confirmarla en la tarjeta.",
    };
  }

  async function loadOwned(id, ctx) {
    if (!UUID_RE.test(String(id ?? ""))) throw new ChatServiceError("Propuesta no encontrada.", 404);
    const [row] = await prisma.$queryRaw`SELECT * FROM mirai_action_proposals WHERE id = ${id}::uuid LIMIT 1`;
    if (!row || row.actor_profile_id !== ctx.actorProfileId || row.company_id !== ctx.companyId) {
      throw new ChatServiceError("Propuesta no encontrada.", 404);
    }
    return row;
  }

  async function get(id, ctx) {
    return toPublicProposal(await loadOwned(id, ctx));
  }

  async function confirm(id, ctx) {
    await loadOwned(id, ctx);
    const [claimed] = await prisma.$queryRaw`
      UPDATE mirai_action_proposals SET status = 'executing'
      WHERE id = ${id}::uuid AND status = 'pending' AND expires_at > NOW()
      RETURNING *
    `;
    if (!claimed) {
      await prisma.$executeRaw`
        UPDATE mirai_action_proposals SET status = 'expired'
        WHERE id = ${id}::uuid AND status = 'pending' AND expires_at <= NOW()
      `;
      const current = toPublicProposal(await loadOwned(id, ctx));
      throw new ChatServiceError(`La propuesta ya no esta pendiente (${current.status}).`, 409);
    }

    const resolved = await registry.resolve({ ...ctx, conversationId: claimed.conversation_id }, claimed.action_key);
    let status = "failed";
    let result = null;
    let error = null;
    if (resolved.error) {
      error = "Ya no tienes permiso para esta accion.";
    } else {
      try {
        result = await resolved.action.execute(claimed.input, actionContext(prisma, resolved.scope, ctx));
        status = "executed";
      } catch (err) {
        error = String(err?.message ?? err).slice(0, 300);
      }
    }

    const [row] = await prisma.$queryRaw`
      UPDATE mirai_action_proposals
      SET status = ${status}, result = ${result ? JSON.stringify(result) : null}::jsonb,
          error = ${error}, decided_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    await prisma.auditLog.create({
      data: {
        companyId: claimed.company_id,
        actorId: claimed.actor_profile_id,
        moduleKey: resolved.action?.moduleKey ?? null,
        action: `mirai.action.${claimed.action_key}`,
        metadata: { proposalId: id, operation: claimed.operation, status, targetId: claimed.target_id, resultId: result?.id ?? null, error },
      },
    }).catch(() => {});
    if (postNote) {
      const text = status === "executed"
        ? `Confirmado: ${result?.summary ?? "accion ejecutada"}`
        : `No se pudo ejecutar: ${error}`;
      try { await postNote({ proposal: row, text }); } catch (err) {
        console.error("[runly.chat] mirai action note", err?.message ?? err);
      }
    }
    return toPublicProposal(row);
  }

  async function cancel(id, ctx) {
    await loadOwned(id, ctx);
    const [row] = await prisma.$queryRaw`
      UPDATE mirai_action_proposals SET status = 'cancelled', decided_at = NOW()
      WHERE id = ${id}::uuid AND status = 'pending'
      RETURNING *
    `;
    if (!row) throw new ChatServiceError("La propuesta ya no esta pendiente.", 409);
    return toPublicProposal(row);
  }

  async function cancelPending(ctx) {
    const rows = await prisma.$queryRaw`
      UPDATE mirai_action_proposals SET status = 'cancelled', decided_at = NOW()
      WHERE conversation_id = ${ctx.conversationId}::uuid AND actor_profile_id = ${ctx.actorProfileId}::uuid
        AND surface = ${ctx.surface === "panel" ? "panel" : "direct"} AND status = 'pending'
      RETURNING id
    `;
    return { cancelled: rows.length };
  }

  async function attachMessage(proposalId, messageId) {
    await prisma.$executeRaw`
      UPDATE mirai_action_proposals SET message_id = ${messageId}::uuid WHERE id = ${proposalId}::uuid
    `;
  }

  return { propose, get, confirm, cancel, cancelPending, attachMessage };
}
