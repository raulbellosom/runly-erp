import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createInventoryAssistantService } from '../../services/inventory-assistant-service.js';
import { createInventoryChatService } from '../../services/inventory-chat-service.js';
import { CHAT_TOTAL_LIMIT } from '../../services/inventory-chat-attachments.js';

export function createInventoryAssistantRouter({ prisma, requirePermission, assistant = createInventoryAssistantService({ prisma }), chat = createInventoryChatService({ prisma, assistant }) }) {
  const router = new Hono();
  const scope = c => ({ companyId: c.get('companyId'), actorId: c.get('userId'), authUserId: c.get('authUserId'), id: c.req.param('id') });
  const handle = action => async c => {
    try { return c.json({ data: await action(c) }); }
    catch (error) {
      const status = error instanceof SyntaxError ? 400 : [400, 403, 404, 409, 429, 502, 503].includes(error.status) ? error.status : 500;
      return c.json({ error: status === 500 ? 'No se pudo abrir o guardar la conversación. Intenta de nuevo.' : error.message }, status);
    }
  };
  const read = requirePermission('inventory.item.read');
  router.get('/inventory/ai/threads', read, handle(c => chat.list(scope(c))));
  router.post('/inventory/ai/threads', read, bodyLimit({ maxSize: 30000 }), handle(async c => chat.create({ ...scope(c), input: await c.req.json() })));
  router.get('/inventory/ai/threads/:id', read, handle(c => chat.get(scope(c))));
  router.delete('/inventory/ai/threads/:id', read, handle(c => chat.remove(scope(c))));
  router.post('/inventory/ai/threads/:id/decision', read, bodyLimit({ maxSize: 10000 }), handle(async c => chat.decide({ ...scope(c), input: await c.req.json() })));
  router.post('/inventory/ai/threads/:id/messages', read, bodyLimit({ maxSize: CHAT_TOTAL_LIMIT + 100000, onError: c => c.json({ error: 'Los archivos superan 20 MB en total.' }, 413) }), handle(async c => {
    if (c.req.header('content-type')?.includes('multipart/form-data')) {
      const form = await c.req.formData();
      const files = form.getAll('files');
      if (files.some(file => typeof file === 'string')) return Promise.reject(Object.assign(new Error('Adjuntos inválidos.'), { status: 400 }));
      return chat.send({ ...scope(c), input: JSON.parse(form.get('message')), files });
    }
    return chat.send({ ...scope(c), input: await c.req.json() });
  }));
  router.post('/inventory/ai/messages', requirePermission('inventory.item.read'), bodyLimit({ maxSize: 120000 }), async c => {
    try {
      const result = await assistant.turn({ input: await c.req.json(), companyId: c.get('companyId'), actorId: c.get('userId') });
      return c.json({ data: result });
    } catch (err) {
      if (err instanceof SyntaxError) return c.json({ error: 'La solicitud no contiene JSON válido.' }, 400);
      const status = [400, 403, 409, 429, 502, 503].includes(err.status) ? err.status : 500;
      return c.json({ error: status === 500 ? 'No se pudo consultar el inventario. Intenta de nuevo.' : err.message }, status);
    }
  });
  return router;
}
