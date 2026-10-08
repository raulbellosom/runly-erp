import { Hono } from 'hono';
import { consumedServiceKeys } from '../services/module-services/module-services.js';

// Declared module runtime operations. These are ordinary tenant APIs, not a
// staging escape hatch: caller/provider activation, consent and user permissions
// remain mandatory. Event replay is an audited administrator operation.
export function createModuleRuntimeRoutes({ prisma, authMiddleware, requirePermission, moduleServices }) {
  const app = new Hono();
  async function active(c, key) {
    const row = await prisma.runlyModule.findUnique({ where: { key } });
    if (!row || row.status !== 'INSTALLED' || !row.enabled) return null;
    const disabled = await prisma.companyModule.findFirst({where:{companyId:c.get('companyId'),moduleId:row.id,enabled:false}});
    return disabled ? null : row;
  }
  app.post('/:key/services/:serviceKey/invoke', authMiddleware, requirePermission('core.modules.read'), async c => {
    const key = c.req.param('key'), serviceKey = c.req.param('serviceKey');
    const caller = await active(c, key);
    if (!caller) return c.json({error:'Módulo no disponible.'},404);
    if (!consumedServiceKeys(caller.manifest).includes(serviceKey)) return c.json({error:'Servicio no declarado.',code:'service_not_declared'},403);
    if (!await active(c,serviceKey.split(':')[0])) return c.json({error:'Proveedor no disponible.',code:'provider_unavailable'},409);
    try { return c.json({data:await moduleServices.forRequest(c,key).call(serviceKey,await c.req.json())}); }
    catch(error) { if(Number.isInteger(error.status))return c.json({error:error.message,code:error.code,fields:error.fields},error.status);throw error; }
  });
  async function eventOwner(c) {
    const caller=await active(c,c.req.param('key'));
    const events=caller?.manifest?.events?.subscribes??[];
    if(!events.length)return null;
    return {caller,events};
  }
  app.get('/:key/events',authMiddleware,requirePermission('core.modules.manage'),async c=>{
    const owner=await eventOwner(c);if(!owner)return c.json({error:'Suscripción no disponible.'},404);
    const data=await prisma.domainEventOutbox.findMany({where:{companyId:c.get('companyId'),event:{in:owner.events}},select:{id:true,event:true,payload:true,companyId:true,attempts:true,processedAt:true,nextAttemptAt:true,lastError:true},orderBy:{createdAt:'desc'},take:50});
    return c.json({data});
  });
  app.post('/:key/events/:id/retry',authMiddleware,requirePermission('core.modules.manage'),async c=>{
    const owner=await eventOwner(c);if(!owner)return c.json({error:'Suscripción no disponible.'},404);
    const row=await prisma.domainEventOutbox.findFirst({where:{id:c.req.param('id'),companyId:c.get('companyId'),event:{in:owner.events}}});
    if(!row)return c.json({error:'Evento no disponible.'},404);
    // No caller-supplied event, payload, company, SQL or handler can be executed.
    await prisma.domainEventOutbox.update({where:{id:row.id},data:{processedAt:null,nextAttemptAt:new Date(),lastError:null}});
    await prisma.auditLog.create({data:{companyId:row.companyId,actorId:c.get('userId')??null,moduleKey:owner.caller.key,entityType:'DomainEvent',entityId:row.id,action:'module.event.retry',metadata:{event:row.event}}});
    return c.json({data:{id:row.id,queued:true}},202);
  });
  return app;
}
