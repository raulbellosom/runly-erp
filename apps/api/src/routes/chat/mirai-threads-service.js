// apps/api/src/routes/chat/mirai-threads-service.js
//
// A user's MirAI conversations ("threads", spec 2026-10-01-mirai-sidebar-v2 §2).
// Each thread is a `mirai` chat conversation owned by the caller with the
// company's bot as the other member. Creation is serialized per user+company
// with an advisory lock (the old one-per-user unique index was dropped).
import { ChatServiceError } from "./chat-service-error.js";

export const DEFAULT_THREAD_TITLE = "Nueva conversacion";
const DEFAULT_TITLES = new Set(["MirAI", DEFAULT_THREAD_TITLE]);
const LIST_MAX = 50;
const TITLE_MAX = 80;
const AUTO_TITLE_MAX = 60;
const WELCOME = "Hola, soy MirAI, tu asistente inteligente de Runly. Puedo consultar y analizar la informacion de tus modulos, buscar en internet, leer los archivos que me adjuntes y preparar acciones que tu confirmas en una tarjeta. Preguntame lo que necesites.";

export function autoTitleFrom(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > AUTO_TITLE_MAX ? `${clean.slice(0, AUTO_TITLE_MAX - 3).trimEnd()}...` : clean;
}

export function createMiraiThreadsService({ prisma, getOrCreateMiraiProfile }) {
  function requireActor({ companyId, actorProfileId }) {
    if (!actorProfileId) throw new ChatServiceError("Se requiere un usuario autenticado.", 401);
    if (!companyId) throw new ChatServiceError("Empresa activa requerida.", 400);
  }

  async function latest({ companyId, actorProfileId }, db = prisma) {
    const [row] = await db.$queryRaw`
      SELECT c.id
      FROM chat_conversations c
      WHERE c.type = 'mirai' AND c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM chat_conversation_members m WHERE m.conversation_id = c.id AND m.user_id = ${actorProfileId}::uuid AND m.left_at IS NULL)
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
      LIMIT 1
    `;
    return row?.id ?? null;
  }

  async function insertThread({ companyId, actorProfileId, botId, title }, db) {
    const [conv] = await db.$queryRaw`
      INSERT INTO chat_conversations (type, title, created_by_user_id, company_id, is_public)
      VALUES ('mirai', ${title}, ${actorProfileId}::uuid, ${companyId}::uuid, false)
      RETURNING id, title
    `;
    await db.$executeRaw`
      INSERT INTO chat_conversation_members (conversation_id, user_id, role, pinned_at)
      VALUES (${conv.id}::uuid, ${actorProfileId}::uuid, 'owner', NOW())
      ON CONFLICT DO NOTHING
    `;
    await db.$executeRaw`
      INSERT INTO chat_conversation_members (conversation_id, user_id, role)
      VALUES (${conv.id}::uuid, ${botId}::uuid, 'member')
      ON CONFLICT DO NOTHING
    `;
    const [msg] = await db.$queryRaw`
      INSERT INTO chat_messages (conversation_id, sender_user_id, sender_type, body, message_type)
      VALUES (${conv.id}::uuid, ${botId}::uuid, 'assistant', ${WELCOME}, 'text')
      RETURNING id, created_at
    `;
    await db.$executeRaw`
      UPDATE chat_conversations SET last_message_id = ${msg.id}::uuid, last_message_at = ${msg.created_at}
      WHERE id = ${conv.id}::uuid
    `;
    return { id: conv.id, title: conv.title };
  }

  // Serializes creation per user+company; `onlyIfNone` turns it into ensure.
  async function createLocked({ companyId, actorProfileId, title, onlyIfNone }) {
    const botId = await getOrCreateMiraiProfile({ companyId });
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mirai:${companyId}:${actorProfileId}`}, 0))::text AS locked`;
      if (onlyIfNone) {
        const existing = await latest({ companyId, actorProfileId }, tx);
        if (existing) return { id: existing, created: false };
      }
      return { ...(await insertThread({ companyId, actorProfileId, botId, title }, tx)), created: true };
    });
  }

  async function ensure(ctx) {
    requireActor(ctx);
    const existing = await latest(ctx);
    if (existing) return { conversationId: existing, created: false };
    const out = await createLocked({ ...ctx, title: "MirAI", onlyIfNone: true });
    return { conversationId: out.id, created: out.created };
  }

  async function create(ctx) {
    requireActor(ctx);
    const out = await createLocked({ ...ctx, title: DEFAULT_THREAD_TITLE, onlyIfNone: false });
    return { id: out.id, title: out.title };
  }

  async function list(ctx) {
    requireActor(ctx);
    const rows = await prisma.$queryRaw`
      SELECT c.id, c.title, COALESCE(c.last_message_at, c.created_at) AS last_at,
        (SELECT LEFT(m.body, 120) FROM chat_messages m
          WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.thread_root_id IS NULL
          ORDER BY m.created_at DESC LIMIT 1) AS preview
      FROM chat_conversations c
      WHERE c.type = 'mirai' AND c.company_id = ${ctx.companyId}::uuid AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM chat_conversation_members m WHERE m.conversation_id = c.id AND m.user_id = ${ctx.actorProfileId}::uuid AND m.left_at IS NULL)
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
      LIMIT ${LIST_MAX}
    `;
    return rows.map((r) => ({
      id: r.id,
      title: r.title || DEFAULT_THREAD_TITLE,
      lastMessageAt: r.last_at instanceof Date ? r.last_at.toISOString() : r.last_at,
      preview: r.preview ?? "",
    }));
  }

  async function assertOwned(id, ctx) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ""))) throw new ChatServiceError("Conversacion no encontrada.", 404);
    const [row] = await prisma.$queryRaw`
      SELECT c.id FROM chat_conversations c
      WHERE c.id = ${id}::uuid AND c.type = 'mirai' AND c.company_id = ${ctx.companyId}::uuid
        AND c.deleted_at IS NULL AND c.created_by_user_id = ${ctx.actorProfileId}::uuid
      LIMIT 1
    `;
    if (!row) throw new ChatServiceError("Conversacion no encontrada.", 404);
  }

  async function rename(id, title, ctx) {
    requireActor(ctx);
    const clean = String(title ?? "").replace(/\s+/g, " ").trim();
    if (!clean || clean.length > TITLE_MAX) throw new ChatServiceError(`El titulo debe tener entre 1 y ${TITLE_MAX} caracteres.`, 400);
    await assertOwned(id, ctx);
    await prisma.$executeRaw`UPDATE chat_conversations SET title = ${clean}, updated_at = NOW() WHERE id = ${id}::uuid`;
    return { id, title: clean };
  }

  async function remove(id, ctx) {
    requireActor(ctx);
    await assertOwned(id, ctx);
    await prisma.$executeRaw`UPDATE chat_conversations SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id}::uuid`;
    await prisma.$executeRaw`
      UPDATE mirai_action_proposals SET status = 'cancelled', decided_at = NOW()
      WHERE conversation_id = ${id}::uuid AND status = 'pending'
    `;
    return { deleted: true };
  }

  // First user message in a thread with a default title names the thread.
  async function autoTitle({ conversationId, text }) {
    const title = autoTitleFrom(text);
    if (!title) return;
    const [row] = await prisma.$queryRaw`
      SELECT c.title,
        (SELECT COUNT(*)::int FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender_type = 'user' AND m.deleted_at IS NULL) AS user_messages
      FROM chat_conversations c WHERE c.id = ${conversationId}::uuid AND c.type = 'mirai'
    `;
    if (!row || !DEFAULT_TITLES.has(row.title) || row.user_messages !== 1) return;
    await prisma.$executeRaw`UPDATE chat_conversations SET title = ${title}, updated_at = NOW() WHERE id = ${conversationId}::uuid`;
  }

  return { ensure, create, list, rename, remove, autoTitle, latest };
}
