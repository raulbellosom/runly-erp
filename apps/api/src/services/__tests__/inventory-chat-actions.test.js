import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { createInventoryChatActions } from '../inventory-chat-actions.js';
import { createInventoryChatService } from '../inventory-chat-service.js';
import { createInventoryChatAttachments } from '../inventory-chat-attachments.js';

const scope = { companyId: '01900000-0000-7000-8000-000000000001', actorId: '01900000-0000-7000-8000-000000000002', id: '01900000-0000-7000-8000-000000000003' };
const plan = { actions: [{ kind: 'brand', data: { name: 'Marca de prueba' } }, { kind: 'item', data: { name: 'Equipo', serialNumber: 'O0-I1-B8', brandName: 'Marca de prueba' } }] };
const noAuth = async () => {};

test('proposals validate input and check every kind of permission without writing', async () => {
  const checks = [];
  const svc = createInventoryChatActions({ prisma: {}, authorize: async (s, permissions) => { assert.equal(s.companyId, scope.companyId); checks.push(permissions); } });
  const p = await svc.prepare(plan, scope);
  assert.equal(p.status, 'pending'); assert.equal(p.actions[1].data.serialNumber, 'O0-I1-B8');
  assert.equal((await svc.prepare(plan, scope)).id, p.id);
  assert.ok(checks.flat().includes('inventory.catalog.manage')); assert.ok(checks.flat().includes('inventory.item.create'));
  for (const bad of [
    { actions: [{ kind: 'item', data: { name: 'X', companyId: scope.companyId } }] },
    { actions: [{ kind: 'brand', data: { name: 'x'.repeat(101) } }] },
    { actions: [{ kind: 'customField', data: { label: 'RAM', fieldKey: 'ram', fieldType: 'select' } }] },
    { actions: [{ kind: 'item', data: { name: 'X', status: 'assigned' } }] },
  ]) await assert.rejects(svc.prepare(bad, scope), e => e.status === 400);
  const denied = createInventoryChatActions({ prisma: {}, authorize: async (_s, p) => { if (p.includes('inventory.item.create')) throw Object.assign(new Error('Denied'), { status: 403 }); } });
  await assert.rejects(denied.prepare(plan, scope), e => e.status === 403);
});

async function fixture() {
  const proposal = await createInventoryChatActions({ prisma: {}, authorize: noAuth }).prepare(plan, scope);
  let row = { id: scope.id, company_id: scope.companyId, owner_id: scope.actorId, title: 'Crear', context: { mode: 'all' }, memory: {}, version: 0,
    messages: [{ id: 'message', role: 'assistant', text: 'Revisa', proposal }] };
  let executions = 0, fail = false;
  const prisma = {
    invItem: { count: async ({ where }) => where.id.in.length },
    $queryRaw: async (parts, ...args) => {
      const sql = parts.join('?');
      if (sql.startsWith('SELECT')) return args[0] === row.id && args[1] === row.company_id && args[2] === row.owner_id ? [structuredClone(row)] : [];
      if (sql.startsWith('UPDATE')) { row.messages = JSON.parse(args[0]); row.memory = JSON.parse(args[1]); row.version++; return [structuredClone(row)]; }
      throw new Error(sql);
    },
    $transaction: async fn => fn(prisma),
  };
  const actions = { execute: async stored => { executions++; assert.deepEqual(stored, proposal); if (fail) throw Object.assign(new Error('Missing required data'), { status: 400 }); return [{ kind: 'item', id: '01900000-0000-7000-8000-000000000004', name: 'Equipo', assetTag: 'INV-test' }]; } };
  const service = createInventoryChatService({ prisma, authorize: noAuth, actions });
  const input = { messageId: 'message', proposalId: proposal.id, decision: 'confirm' };
  return { service, input, executions: () => executions, fail: () => { fail = true; }, replace: () => { row.messages[0].proposal.status = 'superseded'; } };
}

test('confirmation uses the stored plan, is retry safe and records server results in memory', async () => {
  const f = await fixture();
  await assert.rejects(f.service.decide({ ...scope, input: { ...f.input, actions: plan.actions } }), e => e.status === 400);
  await assert.rejects(f.service.decide({ ...scope, companyId: scope.actorId, input: f.input }), e => e.status === 404);
  const first = await f.service.decide({ ...scope, input: f.input });
  assert.equal(first.messages[0].proposal.status, 'executed'); assert.equal(first.messages[0].references[0].label, 'INV-test');
  const retry = await f.service.decide({ ...scope, input: f.input });
  assert.deepEqual(retry, first); assert.equal(f.executions(), 1);
});

test('cancelled/replaced proposals cannot execute, and failed writes keep a reviewable proposal', async () => {
  const f = await fixture();
  await f.service.decide({ ...scope, input: { ...f.input, decision: 'cancel' } });
  assert.equal(f.executions(), 0);
  await assert.rejects(f.service.decide({ ...scope, input: f.input }), e => e.status === 409);
  const replaced = await fixture(); replaced.replace();
  await assert.rejects(replaced.service.decide({ ...scope, input: replaced.input }), e => e.status === 409);
  const failed = await fixture(); failed.fail();
  await assert.rejects(failed.service.decide({ ...scope, input: failed.input }), e => e.status === 400);
  assert.equal((await failed.service.get(scope)).messages[0].proposal.status, 'pending');
});

test('chat reads real DOCX and XLSX while preserving serial identifiers', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="test"><w:body><w:p><w:r><w:t>Modelo DEMO Serial O0-I1-B8</w:t></w:r></w:p></w:body></w:document>');
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Equipos');
  sheet.addRow(['Modelo', 'Serie']); sheet.addRow(['DEMO', '00-I1-B8']);
  const svc = createInventoryChatAttachments();
  const files = await svc.extract([new File([await zip.generateAsync({ type: 'nodebuffer' })], 'equipos.docx'), new File([await book.xlsx.writeBuffer()], 'equipos.xlsx')]);
  assert.match(files[0].text, /O0-I1-B8/); assert.match(files[1].text, /00-I1-B8/);
  await assert.rejects(svc.extract([new File(['fake zip'], 'fake.docx')]), e => e.status === 400);
  zip.file('word/document.xml', '<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///secret">]><w:t>&x;</w:t>');
  await assert.rejects(svc.extract([new File([await zip.generateAsync({ type: 'nodebuffer' })], 'bad.docx')]), e => e.status === 400);
});

test('chat passes actual image content to vision and stores only its thumbnail and analysis', async () => {
  let received;
  const svc = createInventoryChatAttachments({ vision: { describeImage: async args => { received = args; return { description: 'Serie O0-I1-B8' }; } } });
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const [file] = await svc.extract([new File([png], 'etiqueta.png', { type: 'image/png' })], 'Crea este equipo');
  assert.ok(received.imageBase64); assert.equal(received.mimeType, 'image/jpeg');
  assert.match(file.text, /O0-I1-B8/); assert.match(file.preview, /^data:image\/jpeg;base64,/);
});
