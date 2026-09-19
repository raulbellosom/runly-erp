// apps/api/src/routes/chat/meridian-tools.js
//
// Read-only tools for the MeridIAn chat assistant (Spec 1). Every tool is
// scoped to the caller: get_recent_messages / get_conversation_messages /
// list_conversation_files go through chatService.listMessages, which
// membership-checks and throws ChatServiceError; search_my_conversations goes
// through chatSearchService, already scoped to the caller's conversations.
// describe_image verifies the attachment belongs to a conversation the caller
// is a live member of before sending any bytes to the vision model.
// search_runly (ERP reach, Fase A) reuses the global-search providers, gated
// per provider by the caller's own permissions.
import { SEARCH_PROVIDERS } from "../../services/search-providers.js";
import {
  resolveActiveMembership,
  computeScopedPermissions,
  isSystemAdminMembership,
  createPermissionKeysCache,
  COMPANY_ADMIN_ROLE_KEYS,
} from "../../lib/tenant-context.js";
import { get as cacheGet, set as cacheSet, TTL } from "../../lib/cache.js";

const RECENT_MAX = 50;
const SEARCH_MAX = 30;
const FILES_MAX = 50;

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_recent_messages",
      description: "Devuelve los mensajes recientes de la conversacion actual (la que el usuario tiene abierta con MeridIAn o desde donde se te invoco).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Cuantos mensajes traer (max 50, por defecto 30).", minimum: 1, maximum: RECENT_MAX },
          before: { type: "string", description: "ISO timestamp: trae mensajes anteriores a esta fecha (paginacion)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_my_conversations",
      description: "Busca mensajes por texto en TODAS las conversaciones de las que el usuario es miembro. Usa esto cuando el usuario pregunta por algo que se dijo en otro chat.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto a buscar." },
          limit: { type: "integer", description: "Max resultados (max 30, por defecto 15).", minimum: 1, maximum: SEARCH_MAX },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_conversation_messages",
      description: "Devuelve los mensajes recientes de UNA conversacion concreta por id. Solo funciona si el usuario es miembro de esa conversacion.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string", description: "Id de la conversacion." },
          limit: { type: "integer", minimum: 1, maximum: RECENT_MAX },
          before: { type: "string" },
        },
        required: ["conversationId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_conversation_files",
      description: "Lista los archivos e imagenes compartidos en una conversacion (por defecto la actual): nombre, tipo, quien lo envio y cuando. Para describir una imagen usa despues describe_image con su attachmentId.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string", description: "Id de la conversacion; por defecto la actual." },
          limit: { type: "integer", minimum: 1, maximum: FILES_MAX },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "describe_image",
      description: "Describe el contenido de una imagen adjunta del chat. Pasa el attachmentId (lo obtienes de get_recent_messages o list_conversation_files). Solo imagenes.",
      parameters: {
        type: "object",
        properties: {
          attachmentId: { type: "string" },
          question: { type: "string", description: "Pregunta concreta sobre la imagen (opcional)." },
        },
        required: ["attachmentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_runly",
      description: "Busca registros del ERP por nombre, correo o telefono: contactos (clientes/proveedores), usuarios del sistema y empleados. Usalo cuando el usuario pregunta por una persona o empresa que podria estar en Runly ('tienes el correo de Juan Perez', 'que datos hay de la empresa X'). Solo devuelve lo que el usuario ya tiene permiso de ver.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Nombre, correo, telefono o codigo a buscar." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_inventory",
      description: "Busca activos/equipos del inventario de la empresa por nombre, etiqueta o numero de serie. Ej: 'cuantas laptops hay', 'donde esta el activo ABC-123'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto a buscar (nombre, etiqueta, serie)." },
          status: { type: "string", description: "Filtro opcional de estado del activo." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_bank_accounts",
      description: "Lista las cuentas bancarias de la empresa que el usuario puede ver, con su saldo actual. Ej: 'cuanto tenemos en el banco', 'saldo de BBVA'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_calendar",
      description: "Lista los proximos eventos de la agenda del propio usuario. Ej: 'que tengo esta semana', 'mi agenda de manana'.",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", description: "Cuantos dias hacia adelante (max 30, por defecto 7)." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_tasks",
      description: "Lista las tareas asignadas al propio usuario en sus proyectos, ordenadas por fecha de vencimiento. Ej: 'que tareas tengo pendientes'.",
      parameters: {
        type: "object",
        properties: { status: { type: "string", description: "Filtro opcional por id de estado." } },
      },
    },
  },
];

function trimMessage(m) {
  return {
    senderName: m.sender?.displayName ?? (m.sender_type === "assistant" ? "MeridIAn" : m.sender_type === "system" ? "sistema" : "desconocido"),
    senderType: m.sender_type,
    body: m.deleted_at ? "(mensaje eliminado)" : String(m.body ?? "").slice(0, 2000),
    messageType: m.message_type,
    sentAt: m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at),
    attachmentCount: m.attachment_count ?? (m.attachments?.length ?? 0),
    attachmentIds: (m.attachments ?? []).map((a) => a.id),
  };
}

export function buildToolRunners({
  prisma, listMessages, chatSearchService, visionService, signAttachmentUrl, resolveUserContext,
  inventoryService, ledgerService, calendarEventService, projectsService, tasksService,
}) {
  const getAllActivePermissionKeys = createPermissionKeysCache({
    prisma,
    cacheGet,
    cacheSet,
    ttlSeconds: TTL.PERMISSIONS,
  });

  // Resolve the caller's RBAC context, SCOPED TO ctx.companyId (the caller's
  // validated active company, sourced from c.get("companyId") upstream in
  // meridian-routes.js — never from resolveUserContext's own raw,
  // union-across-every-company isAdmin/permissionSet, which would let a
  // user's admin role in Company A leak into a MeridIAn tool call made while
  // Company B is active). See
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §16
  // ("MeridIAn nunca debe obtener contexto de empresas diferentes").
  // Returns { uctx, companyId, userId, isAdmin, permissionSet } or { error }.
  async function resolveScopedErpContext(ctx) {
    if (typeof resolveUserContext !== "function") return { error: "Esa consulta no esta disponible aqui." };
    let uctx;
    try { uctx = await resolveUserContext(ctx.actorAuthUserId); } catch { uctx = null; }
    if (!uctx?.profile) return { error: "No pude verificar tus permisos." };

    const membershipResult = resolveActiveMembership({
      memberships: uctx.memberships,
      requestedCompanyId: ctx.companyId ?? null,
      strict: false,
    });
    const activeMembership = membershipResult.ok ? membershipResult.membership : null;
    const companyId = activeMembership?.companyId ?? null;
    if (!companyId) return { error: "Sin empresa activa." };

    const isSystemAdmin = isSystemAdminMembership(uctx.memberships);
    const grantSet = uctx.grantsByCompany?.get?.(companyId);
    const roleKey = activeMembership?.role?.key ?? null;
    const isCompanyAdminRole = Boolean(roleKey && COMPANY_ADMIN_ROLE_KEYS.has(roleKey));
    const allPermissionKeys =
      isSystemAdmin || isCompanyAdminRole ? await getAllActivePermissionKeys() : [];
    const { permissionSet, isCompanyAdmin } = computeScopedPermissions({
      activeMembership,
      grantKeysForCompany: grantSet ? [...grantSet] : [],
      allPermissionKeys,
      basePermissionKeys: [],
      isSystemAdmin,
    });

    return { uctx, companyId, userId: uctx.profile.id, isAdmin: isCompanyAdmin || isSystemAdmin, permissionSet };
  }

  // Assert a single module read permission on top of the scoped context.
  // Returns { uctx, companyId, userId } on success or { error } for the runner to return.
  async function erpContext(ctx, permissionKey) {
    const resolved = await resolveScopedErpContext(ctx);
    if (resolved.error) return resolved;
    if (!resolved.isAdmin && !resolved.permissionSet.has(permissionKey)) {
      return { error: "No tienes acceso a esa informacion." };
    }
    return { uctx: resolved.uctx, companyId: resolved.companyId, userId: resolved.userId };
  }

  async function get_recent_messages(args, ctx) {
    const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 30, 1), RECENT_MAX);
    try {
      const res = await listMessages({
        conversationId: ctx.conversationId, authUserId: ctx.actorAuthUserId,
        limit, before: args?.before || null,
      });
      return { messages: (res.data ?? []).map(trimMessage) };
    } catch (err) {
      return { error: err?.status === 403 || err?.status === 404 ? "Sin acceso a esa conversacion." : `No se pudo leer la conversacion: ${String(err?.message ?? err).slice(0, 160)}` };
    }
  }

  async function get_conversation_messages(args, ctx) {
    if (!args?.conversationId) return { error: "Falta conversationId." };
    const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 30, 1), RECENT_MAX);
    try {
      const res = await listMessages({
        conversationId: String(args.conversationId), authUserId: ctx.actorAuthUserId,
        limit, before: args?.before || null,
      });
      return { conversationId: String(args.conversationId), messages: (res.data ?? []).map(trimMessage) };
    } catch (err) {
      return { error: err?.status === 403 || err?.status === 404 ? "Sin acceso a esa conversacion." : `No se pudo leer la conversacion: ${String(err?.message ?? err).slice(0, 160)}` };
    }
  }

  async function search_my_conversations(args, ctx) {
    const q = String(args?.query ?? "").trim();
    if (!q) return { error: "Falta el texto a buscar." };
    const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 15, 1), SEARCH_MAX);
    try {
      const res = await chatSearchService.searchMessages({ authUserId: ctx.actorAuthUserId, q, conversationId: null, limit, offset: 0 });
      return {
        results: (res.data ?? []).map((r) => ({
          conversationId: r.conversationId ?? r.conversation_id,
          conversationTitle: r.conversationTitle ?? r.conversation_title ?? null,
          snippet: r.snippet ?? r.body_snippet ?? "",
          senderName: r.senderName ?? r.sender_name ?? null,
          sentAt: r.createdAt ?? r.created_at ?? null,
        })),
      };
    } catch (err) {
      return { error: `No se pudo buscar: ${String(err?.message ?? err).slice(0, 160)}` };
    }
  }

  async function list_conversation_files(args, ctx) {
    const conversationId = String(args?.conversationId || ctx.conversationId);
    const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 30, 1), FILES_MAX);
    try {
      await listMessages({ conversationId, authUserId: ctx.actorAuthUserId, limit: 1, before: null });
    } catch (err) {
      return { error: err?.status === 403 || err?.status === 404 ? "Sin acceso a esa conversacion." : `No se pudo acceder: ${String(err?.message ?? err).slice(0, 160)}` };
    }
    const rows = await prisma.$queryRaw`
      SELECT a.id, a.file_name, a.mime_type, a.size_bytes,
             up.display_name AS sender_name, m.created_at AS sent_at
      FROM chat_attachments a
      JOIN chat_messages m ON m.id = a.message_id
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      WHERE a.conversation_id = ${conversationId}::uuid
        AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `;
    return {
      files: rows.map((r) => ({
        attachmentId: r.id,
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: Number(r.size_bytes ?? 0),
        senderName: r.sender_name ?? null,
        sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at),
      })),
    };
  }

  async function describe_image(args, ctx) {
    const attachmentId = String(args?.attachmentId ?? "").trim();
    if (!attachmentId) return { error: "Falta attachmentId." };
    const [att] = await prisma.$queryRaw`
      SELECT a.id, a.mime_type, a.object_key, a.bucket, a.conversation_id
      FROM chat_attachments a
      WHERE a.id = ${attachmentId}::uuid
      LIMIT 1
    `;
    if (!att) return { error: "No encontre ese adjunto." };
    try {
      await listMessages({ conversationId: att.conversation_id, authUserId: ctx.actorAuthUserId, limit: 1, before: null });
    } catch {
      return { error: "Sin acceso a ese adjunto." };
    }
    if (!String(att.mime_type ?? "").startsWith("image/")) {
      return { error: "Ese adjunto no es una imagen; solo puedo describir imagenes." };
    }
    try {
      const { imageBase64 } = await fetchAttachmentBase64({ signAttachmentUrl, att });
      const { description } = await visionService.describeImage({
        imageBase64, mimeType: att.mime_type, question: args?.question,
      });
      return { description };
    } catch (err) {
      return { error: `No pude analizar la imagen: ${String(err?.message ?? err).slice(0, 160)}` };
    }
  }

  async function search_runly(args, ctx) {
    const q = String(args?.query ?? "").trim();
    if (q.length < 2) return { error: "Da al menos 2 caracteres para buscar." };
    const resolved = await resolveScopedErpContext(ctx);
    if (resolved.error) return resolved;
    const { companyId, userId, isAdmin, permissionSet } = resolved;
    const allowed = SEARCH_PROVIDERS.filter((p) => isAdmin || permissionSet.has(p.permission));
    if (!allowed.length) return { error: "No tienes permiso para buscar registros del ERP." };
    const settled = await Promise.allSettled(
      allowed.map((p) => p.run({ prisma, companyId, actorId: userId, q, limit: 5 })),
    );
    const groups = [];
    settled.forEach((r, i) => {
      if (r.status !== "fulfilled" || !Array.isArray(r.value) || !r.value.length) return;
      groups.push({
        tipo: allowed[i].label,
        resultados: r.value.map((it) => ({ nombre: it.title, detalle: it.subtitle ?? null })),
      });
    });
    return groups.length ? { groups } : { note: "Sin resultados en contactos, usuarios ni empleados." };
  }

  async function search_inventory(args, ctx) {
    if (!inventoryService?.listItems) return { error: "El modulo de inventario no esta disponible." };
    const c = await erpContext(ctx, "inventory.item.read");
    if (c.error) return c;
    try {
      const res = await inventoryService.listItems({
        companyId: c.companyId,
        search: String(args?.query ?? "").trim() || undefined,
        status: args?.status || undefined,
        limit: 8,
      });
      const rows = res?.data ?? res ?? [];
      return {
        items: rows.slice(0, 8).map((it) => ({
          nombre: it.name ?? null,
          etiqueta: it.assetTag ?? null,
          serie: it.serialNumber ?? null,
          estado: it.status ?? null,
          categoria: it.category?.name ?? it.categoryName ?? null,
          ubicacion: it.location?.name ?? it.locationName ?? null,
          asignadoA: it.assignedTo?.displayName ?? it.assignedToName ?? null,
        })),
        total: res?.total ?? rows.length,
      };
    } catch (err) {
      return { error: `No pude consultar inventario: ${String(err?.message ?? err).slice(0, 140)}` };
    }
  }

  async function list_bank_accounts(_args, ctx) {
    if (!ledgerService?.listAccounts) return { error: "El modulo de bancos no esta disponible." };
    const c = await erpContext(ctx, "ledger.accounts.read");
    if (c.error) return c;
    try {
      const res = await ledgerService.listAccounts({ companyId: c.companyId, actorId: c.userId });
      const rows = res?.data ?? res ?? [];
      return {
        cuentas: rows.map((a) => ({
          nombre: a.name ?? null,
          banco: a.bank_name ?? a.bankName ?? null,
          moneda: a.currency ?? null,
          saldo: a.current_balance != null ? Number(a.current_balance) : (a.currentBalance ?? null),
        })),
      };
    } catch (err) {
      return { error: `No pude consultar los bancos: ${String(err?.message ?? err).slice(0, 140)}` };
    }
  }

  async function list_my_calendar(args, ctx) {
    if (!calendarEventService?.listEvents) return { error: "El modulo de calendario no esta disponible." };
    const c = await erpContext(ctx, "calendar.events.read");
    if (c.error) return c;
    const days = Math.min(Math.max(parseInt(args?.days, 10) || 7, 1), 30);
    const start = new Date();
    const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
    try {
      const events = await calendarEventService.listEvents({ userId: c.userId, start, end });
      return {
        eventos: (events ?? []).slice(0, 25).map((e) => ({
          titulo: e.title ?? null,
          inicio: e.startAt instanceof Date ? e.startAt.toISOString() : String(e.startAt ?? ""),
          fin: e.endAt instanceof Date ? e.endAt.toISOString() : String(e.endAt ?? ""),
          calendario: e.calendar?.name ?? null,
        })),
      };
    } catch (err) {
      return { error: `No pude consultar tu agenda: ${String(err?.message ?? err).slice(0, 140)}` };
    }
  }

  async function list_my_tasks(args, ctx) {
    if (!projectsService?.listProjects || !tasksService?.listTasks) return { error: "El modulo de proyectos no esta disponible." };
    const c = await erpContext(ctx, "projects.task.read");
    if (c.error) return c;
    try {
      const projects = (await projectsService.listProjects(c.companyId, c.userId)) ?? [];
      const scanned = projects.slice(0, 8);
      const perProject = await Promise.all(
        scanned.map(async (p) => {
          const tasks = (await tasksService.listTasks(p.id, { assigneeId: c.userId, statusId: args?.status || undefined }).catch(() => [])) ?? [];
          return tasks.map((t) => ({
            titulo: t.title ?? null,
            proyecto: p.name ?? null,
            estado: t.status?.name ?? null,
            prioridad: t.priority ?? null,
            // eslint-disable-next-line no-restricted-syntax -- task.dueDate is a @db.Date (date-only); format the calendar date as UTC
            vence: t.dueDate ? (t.dueDate instanceof Date ? t.dueDate.toISOString().slice(0, 10) : String(t.dueDate).slice(0, 10)) : null,
          }));
        }),
      );
      const tareas = perProject.flat()
        .sort((a, b) => String(a.vence ?? "9999").localeCompare(String(b.vence ?? "9999")))
        .slice(0, 20);
      const out = { tareas };
      if (projects.length > 8) out.note = "Solo revise tus primeros 8 proyectos.";
      return out;
    } catch (err) {
      return { error: `No pude consultar tus tareas: ${String(err?.message ?? err).slice(0, 140)}` };
    }
  }

  return {
    get_recent_messages, get_conversation_messages, search_my_conversations,
    list_conversation_files, describe_image, search_runly,
    search_inventory, list_bank_accounts, list_my_calendar, list_my_tasks,
  };
}

// ---------------------------------------------------------------------------
// Spec 3 — the single tool for a `@meridIAn` channel mention. No assertMember:
// the mention came from a channel member and the reply is public in that same
// channel, so reading its recent history exposes nothing the members don't see.
// ---------------------------------------------------------------------------
export const CHANNEL_TOOL_DEFS = [{
  type: "function",
  function: {
    name: "get_channel_messages",
    description: "Devuelve los mensajes recientes de ESTE canal (donde te mencionaron). Es tu unica fuente de contexto ademas de tu conocimiento general.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 40, description: "Cuantos traer (max 40, por defecto 25)." },
      },
    },
  },
}];

export function buildChannelToolRunners({ prisma }) {
  async function get_channel_messages(args, ctx) {
    const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 25, 1), 40);
    const rows = await prisma.$queryRaw`
      SELECT m.sender_type, m.body, m.message_type, m.created_at, m.attachment_count,
             up.display_name AS sender_name
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      WHERE m.conversation_id = ${ctx.conversationId}::uuid
        AND m.deleted_at IS NULL
        AND m.thread_root_id IS NULL
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `;
    rows.reverse();
    return {
      messages: rows.map((m) => ({
        senderName: m.sender_name ?? (m.sender_type === "assistant" ? "MeridIAn" : m.sender_type === "system" ? "sistema" : "desconocido"),
        senderType: m.sender_type,
        body: String(m.body ?? "").slice(0, 2000),
        messageType: m.message_type,
        sentAt: m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at),
        attachmentCount: m.attachment_count ?? 0,
      })),
    };
  }
  return { get_channel_messages };
}

// Download an attachment's bytes via a service-role signed URL and return
// base64. `signAttachmentUrl` is injected by meridian-service (Task 6), so this
// module never imports supabase and the non-image tests never reach here.
async function fetchAttachmentBase64({ signAttachmentUrl, att }) {
  const url = await signAttachmentUrl(att.bucket, att.object_key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`descarga fallo (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error("imagen demasiado grande");
  return { imageBase64: buf.toString("base64") };
}
