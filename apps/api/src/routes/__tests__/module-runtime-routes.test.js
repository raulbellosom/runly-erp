import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleRuntimeRoutes } from '../module-runtime-routes.js';
test('declared runtime invocation refuses unavailable/undeclared providers and delegates tenant authorization',async()=>{
  let invoked=0;
  const prisma={runlyModule:{findUnique:async({where})=>({id:where.key,key:where.key,status:'INSTALLED',enabled:true,manifest:{consumes:{'runly.contacts':['contacts.create']}}})},companyModule:{findFirst:async()=>null}};
  const authMiddleware=async(c,next)=>{c.set('companyId','company-A');await next();};
  const requirePermission=()=>async(c,next)=>next();
  const moduleServices={forRequest:(c,key)=>({call:async(service,args)=>{invoked++;assert.equal(c.get('companyId'),'company-A');assert.equal(key,'custom.example');return {id:'effect',...args};}})};
  const app=createModuleRuntimeRoutes({prisma,authMiddleware,requirePermission,moduleServices});
  const invoke=key=>app.request('/custom.example/services/'+encodeURIComponent(key)+'/invoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Example'})});
  assert.equal((await invoke('runly.inventory:items.search')).status,403);
  assert.equal(invoked,0);
  assert.equal((await invoke('runly.contacts:contacts.create')).status,200);
  prisma.companyModule.findFirst=async()=>({enabled:false});
  assert.equal((await invoke('runly.contacts:contacts.create')).status,404);
  assert.equal(invoked,1);
});
test('event administration cannot inspect or replay another company and never accepts a caller payload',async()=>{
  let replay=0;const updates=[];
  const prisma={runlyModule:{findUnique:async()=>({id:'mod',key:'custom.example',status:'INSTALLED',enabled:true,manifest:{events:{subscribes:['contacts.contact.created']}}})},companyModule:{findFirst:async()=>null},domainEventOutbox:{findFirst:async({where})=>{assert.equal(where.companyId,'A');return where.id==='own'?{id:'own',companyId:'A',event:'contacts.contact.created'}:null;},update:async args=>{replay++;updates.push(args);}},auditLog:{create:async()=>{}}};
  const app=createModuleRuntimeRoutes({prisma,authMiddleware:async(c,next)=>{c.set('companyId','A');await next();},requirePermission:()=>async(c,next)=>next()});
  assert.equal((await app.request('/custom.example/events/other/retry',{method:'POST'})).status,404);
  assert.equal((await app.request('/custom.example/events/own/retry',{method:'POST',body:JSON.stringify({companyId:'B',payload:{evil:true}})})).status,202);
  assert.equal(replay,1);assert.deepEqual(Object.keys(updates[0].data).sort(),['lastError','nextAttemptAt','processedAt']);
});
