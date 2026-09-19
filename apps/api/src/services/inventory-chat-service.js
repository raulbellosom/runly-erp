import { z } from 'zod';
import { createInventoryAccess } from './inventory-access.js';
import { createInventoryAssistantService, inventoryContextSchema } from './inventory-assistant-service.js';
import { createInventoryChatAttachments } from './inventory-chat-attachments.js';
import { InventoryServiceError } from './inventory-service.js';
import { createInventoryChatActions } from './inventory-chat-actions.js';

const messageSchema = z.object({ content: z.string().trim().max(2000).default(''), requestKey: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/), version: z.number().int().min(0) }).strict();

export function createInventoryChatService({ prisma, authorize = createInventoryAccess({ prisma }).assertCurrent,
  assistant = createInventoryAssistantService({ prisma }), attachments = createInventoryChatAttachments(), actions = createInventoryChatActions({ prisma, authorize }) }) {
  const active = new Set();
  const attempts = new Map();
  async function list({ companyId, actorId }) {
    await authorize({ companyId, actorId });
    return prisma.$queryRaw`SELECT id, title, context, updated_at AS "updatedAt" FROM inventory_assistant_thread
      WHERE company_id = ${companyId}::uuid AND owner_id = ${actorId}::uuid ORDER BY updated_at DESC LIMIT 50`;
  }
  async function owned({ id, companyId, actorId }) {
    await authorize({ companyId, actorId });
    if (!z.uuid().safeParse(id).success) throw new InventoryServiceError('Conversación no disponible.', 404);
    const [thread] = await prisma.$queryRaw`SELECT * FROM inventory_assistant_thread
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND owner_id = ${actorId}::uuid`;
    if (!thread) throw new InventoryServiceError('Conversación no disponible.', 404);
    const ids = [...new Set([...(thread.context?.ids ?? []), ...(thread.memory?.recordIds ?? []), ...thread.messages.flatMap(message => (message.references ?? []).map(ref => ref.id))])];
    if (ids.length && await prisma.invItem.count({ where: { companyId, enabled: true, id: { in: ids } } }) !== ids.length) {
      throw new InventoryServiceError('Un equipo de esta conversación ya no está disponible. Crea una nueva consulta.', 409);
    }
    return thread;
  }
  function publicThread(thread) {
    return { id: thread.id, title: thread.title, context: thread.context, messages: thread.messages, version: thread.version, updatedAt: thread.updated_at };
  }
  async function create({ companyId, actorId, input }) {
    await authorize({ companyId, actorId });
    const parsed = inventoryContextSchema.safeParse(input?.context);
    if (!parsed.success) throw new InventoryServiceError('El contexto de la consulta no es válido.', 400);
    const context = parsed.data;
    if (context.ids.length && await prisma.invItem.count({ where: { companyId, enabled: true, id: { in: [...new Set(context.ids)] } } }) !== new Set(context.ids).size) throw new InventoryServiceError('Equipo no disponible.', 403);
    const [thread] = await prisma.$queryRaw`INSERT INTO inventory_assistant_thread (company_id, owner_id, title, context)
      VALUES (${companyId}::uuid, ${actorId}::uuid, 'Nueva consulta', ${JSON.stringify(context)}::jsonb) RETURNING *`;
    return publicThread(thread);
  }
  async function get(scope) { return publicThread(await owned(scope)); }
  async function remove({ id, companyId, actorId }) {
    await authorize({ companyId, actorId });
    if (!z.uuid().safeParse(id).success) throw new InventoryServiceError('Conversación no disponible.', 404);
    await prisma.$executeRaw`DELETE FROM inventory_assistant_thread WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND owner_id = ${actorId}::uuid`;
    return { deleted: true };
  }
  async function send({ input, files = [], ...scope }) {
    const parsed = messageSchema.safeParse(input);
    if (!parsed.success) throw new InventoryServiceError('El mensaje no es válido.', 400);
    if (!parsed.data.content && !files.length) throw new InventoryServiceError('Escribe una pregunta o adjunta un archivo.', 400);
    const thread = await owned(scope);
    if (thread.messages.some(message => message.requestKey === parsed.data.requestKey)) return publicThread(thread);
    if (thread.version !== parsed.data.version) throw new InventoryServiceError('Esta conversación cambió. Vuelve a abrirla antes de enviar.', 409);
    if (thread.messages.length >= 100) throw new InventoryServiceError('Esta conversación llegó a 50 consultas. Crea una nueva.', 400);
    const key = `${scope.companyId}:${scope.actorId}`;
    if (active.has(key)) throw new InventoryServiceError('Espera la respuesta anterior.', 429);
    const now = Date.now();
    for (const [entry, timestamps] of attempts) if (!timestamps.some(time => time > now - 60000)) attempts.delete(entry);
    const recent = (attempts.get(key) ?? []).filter(time => time > now - 60000);
    if (recent.length >= 10) throw new InventoryServiceError('Máximo 10 consultas por minuto. Espera un momento.', 429);
    attempts.set(key, [...recent, now]);
    active.add(key);
    try {
      const content = parsed.data.content || 'Analiza los archivos adjuntos en relación con el inventario.';
      const extracted = await attachments.extract(files, content);
      const result = await assistant.turn({ input: { content, context: thread.context }, companyId: scope.companyId, actorId: scope.actorId,
        trustedMemory: { messages: thread.memory.messages ?? [], recordIds: thread.memory.recordIds ?? [] }, attachments: extracted });
      await authorize(scope);
      const previousMessages = result.proposal ? thread.messages.map(message => message.proposal?.status === 'pending' ? { ...message, proposal: { ...message.proposal, status: 'superseded' } } : message) : thread.messages;
      const messages = [...previousMessages,
        { id: `${parsed.data.requestKey}:user`, requestKey: parsed.data.requestKey, role: 'user', text: content, attachments: extracted, createdAt: new Date().toISOString() },
        { id: `${parsed.data.requestKey}:assistant`, role: 'assistant', text: result.text, references: result.references, ...(result.proposal ? { proposal: result.proposal } : {}), createdAt: new Date().toISOString() }];
      const title = thread.messages.length ? thread.title : (parsed.data.content || files[0]?.name || 'Consulta de inventario').slice(0, 80);
      const [saved] = await prisma.$queryRaw`UPDATE inventory_assistant_thread SET title = ${title}, messages = ${JSON.stringify(messages)}::jsonb,
        memory = ${JSON.stringify(result.memory)}::jsonb, version = version + 1, updated_at = now()
        WHERE id = ${scope.id}::uuid AND company_id = ${scope.companyId}::uuid AND owner_id = ${scope.actorId}::uuid AND version = ${thread.version} RETURNING *`;
      if (!saved) throw new InventoryServiceError('Esta conversación cambió o fue eliminada. Vuelve a abrirla.', 409);
      return publicThread(saved);
    } finally { active.delete(key); }
  }
  async function decide({ input, ...scope }) {
    const parsed = z.object({ messageId: z.string().min(1).max(100), proposalId: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['confirm', 'cancel']) }).strict().safeParse(input);
    if (!parsed.success) throw new InventoryServiceError('Confirma una propuesta válida de esta conversación.', 400);
    await owned(scope);
    return prisma.$transaction(async db => {
      const [thread] = await db.$queryRaw`SELECT * FROM inventory_assistant_thread WHERE id = ${scope.id}::uuid
        AND company_id = ${scope.companyId}::uuid AND owner_id = ${scope.actorId}::uuid FOR UPDATE`;
      if (!thread) throw new InventoryServiceError('Conversación no disponible.', 404);
      const message = thread.messages.find(message => message.id === parsed.data.messageId && message.proposal?.id === parsed.data.proposalId);
      if (!message) throw new InventoryServiceError('Propuesta no disponible.', 404);
      if (message.proposal.status === 'executed' && parsed.data.decision === 'confirm') return publicThread(thread);
      if (message.proposal.status !== 'pending') throw new InventoryServiceError('La propuesta ya fue cancelada o reemplazada.', 409);
      const results = parsed.data.decision === 'confirm' ? await actions.execute(message.proposal, scope, db) : [];
      await authorize(scope);
      message.proposal = { ...message.proposal, status: parsed.data.decision === 'confirm' ? 'executed' : 'cancelled', results };
      message.references = [...(message.references ?? []), ...results.filter(row => row.kind === 'item').map(row => ({ id: row.id, label: row.assetTag || row.name }))];
      const resultText = parsed.data.decision === 'confirm' ? `El usuario confirmó la propuesta y el servidor la ejecutó: ${JSON.stringify(results)}` : 'El usuario canceló la propuesta. No se creó ningún registro.';
      const memory = { ...thread.memory, messages: [...(thread.memory.messages ?? []), { role: 'assistant', content: resultText }].slice(-8) };
      memory.recordIds = [...new Set([...(memory.recordIds ?? []), ...results.filter(row => row.kind === 'item').map(row => row.id)])];
      if (memory.recordIds.length > 200) { memory.messages = []; memory.recordIds = []; }
      const [saved] = await db.$queryRaw`UPDATE inventory_assistant_thread SET messages = ${JSON.stringify(thread.messages)}::jsonb,
        memory = ${JSON.stringify(memory)}::jsonb, version = version + 1, updated_at = now()
        WHERE id = ${scope.id}::uuid AND company_id = ${scope.companyId}::uuid AND owner_id = ${scope.actorId}::uuid RETURNING *`;
      return publicThread(saved);
    }, { timeout: 30000 });
  }
  return { list, create, get, remove, send, decide };
}
