import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { createInventoryChatAttachments } from '../inventory-chat-attachments.js';
import { createInventoryChatService } from '../inventory-chat-service.js';
import { inventoryAssistantThread } from '../../manifests/official/inventory-assistant.model.js';
import { generateCreateTableSql, assertSafeMigrationSql } from '@runly/module-engine';

const companyId = '01900000-0000-7000-8000-000000000001';
const actorId = '01900000-0000-7000-8000-000000000002';
const id = '01900000-0000-7000-8000-000000000003';
const other = '01900000-0000-7000-8000-000000000004';
const scope = { id, companyId, actorId };
const requestKey = 'test-message-00000001';

function fixture({ reply, authorize = async () => {} } = {}) {
  let row = { id, company_id: companyId, owner_id: actorId, title: 'Nueva consulta', context: { mode: 'all' }, messages: [], memory: {}, version: 0 };
  let calls = 0;
  const prisma = {
    invItem: { count: async ({ where }) => where.id.in.length },
    $queryRaw: async (strings, ...args) => {
      const sql = strings.join('?');
      if (sql.startsWith('SELECT *')) return row && args[0] === row.id && args[1] === row.company_id && args[2] === row.owner_id ? [structuredClone(row)] : [];
      if (sql.startsWith('UPDATE')) {
        if (!row || args[3] !== id || args[4] !== companyId || args[5] !== actorId || args[6] !== row.version) return [];
        row = { ...row, title: args[0], messages: JSON.parse(args[1]), memory: JSON.parse(args[2]), version: row.version + 1 };
        return [structuredClone(row)];
      }
      throw new Error(sql);
    },
    $executeRaw: async (_strings, rowId, company, owner) => { if (rowId === id && company === companyId && owner === actorId) row = null; },
  };
  const service = createInventoryChatService({ prisma, authorize,
    assistant: { turn: async args => { calls++; await reply?.(args); return { text: 'Hay 20 equipos.', references: [], memory: { messages: [{ role: 'assistant', content: 'Hay 20 equipos.' }], recordIds: [] } }; } },
    attachments: { extract: async files => files.map(file => ({ name: file.name, text: 'S/N: A-001' })) },
  });
  return { service, calls: () => calls, change: fn => { row = fn(row); } };
}

test('chat attachments read text, preserve serials and bound the extraction budget', async () => {
  const svc = createInventoryChatAttachments();
  const [file] = await svc.extract([new File(['S/N: O0-I1-B8\n'.repeat(2000)], 'seriales.csv', { type: 'text/csv' })]);
  assert.match(file.text, /O0-I1-B8/); assert.equal(file.text.length, 12000); assert.equal(file.truncated, true);
  await assert.rejects(svc.extract(Array.from({ length: 6 }, () => new File(['a'], 'a.txt'))), e => e.status === 400);
  await assert.rejects(svc.extract([new File(['a'], 'programa.exe')]), e => e.status === 400);
  await assert.rejects(svc.extract([new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.txt')]), e => e.status === 400);
  await assert.rejects(svc.extract([new File(['not an image'], 'a.jpg')]), e => e.status === 400);
});

test('chat PDFs extract actual document text and reject disguised PDFs', async () => {
  const doc = new PDFDocument();
  const chunks = [];
  const ready = new Promise(resolve => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', resolve); });
  doc.text('Inventario: SERIAL-O0-I1'); doc.end(); await ready;
  const svc = createInventoryChatAttachments();
  const [file] = await svc.extract([new File(chunks, 'inventario.pdf', { type: 'application/pdf' })]);
  assert.match(file.text, /SERIAL-O0-I1/);
  await assert.rejects(svc.extract([new File(['fake pdf'], 'a.pdf')]), e => e.status === 400);
});

test('chat history is owner/company scoped and does not expose internal memory', async () => {
  const f = fixture();
  assert.equal((await f.service.get(scope)).memory, undefined);
  await assert.rejects(f.service.get({ ...scope, actorId: other }), e => e.status === 404);
  await assert.rejects(f.service.get({ ...scope, companyId: other }), e => e.status === 404);
  await f.service.remove({ ...scope, actorId: other });
  assert.equal((await f.service.get(scope)).id, id);
});

test('chat sends extracted files as untrusted data and retries without duplicate responses', async () => {
  let observed;
  const f = fixture({ reply: args => { observed = args; } });
  const args = { ...scope, input: { content: 'Compara estas series', requestKey, version: 0 }, files: [new File(['A-001'], 'series.txt')] };
  const first = await f.service.send(args);
  assert.equal(first.version, 1); assert.equal(first.messages.length, 2);
  assert.equal(observed.attachments[0].text, 'S/N: A-001'); assert.deepEqual(observed.trustedMemory, { messages: [], recordIds: [] });
  const retry = await f.service.send(args);
  assert.deepEqual(first, retry); assert.equal(f.calls(), 1);
  await assert.rejects(f.service.send({ ...args, input: { ...args.input, requestKey: 'another-message-key' } }), e => e.status === 409);
});

test('chat discards responses after permission revocation and concurrent deletion', async () => {
  let allowed = true;
  const f = fixture({ authorize: async () => { if (!allowed) throw Object.assign(new Error('revoked'), { status: 403 }); }, reply: () => { allowed = false; } });
  await assert.rejects(f.service.send({ ...scope, input: { content: 'Cuantos', requestKey, version: 0 } }), e => e.status === 403);
  allowed = true; assert.equal((await f.service.get(scope)).messages.length, 0);
  const deleted = fixture({ reply: () => deleted.change(() => null) });
  await assert.rejects(deleted.service.send({ ...scope, input: { content: 'Cuantos', requestKey, version: 0 } }), e => e.status === 409);
});

test('private conversation model enables RLS without granting client access', () => {
  const sql = generateCreateTableSql(inventoryAssistantThread);
  assert.match(sql, /DEFAULT uuidv7\(\)/); assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /REVOKE ALL ON TABLE .* FROM PUBLIC, anon, authenticated/);
  assert.doesNotThrow(() => assertSafeMigrationSql(sql));
  for (const part of sql.split(';').filter(s => s.trim())) assert.doesNotThrow(() => assertSafeMigrationSql(`${part.trim()};`));
  assert.throws(() => assertSafeMigrationSql('ALTER TABLE secrets DISABLE ROW LEVEL SECURITY;'));
  assert.throws(() => assertSafeMigrationSql('ALTER TABLE secrets ENABLE ROW LEVEL SECURITY; ALTER TABLE secrets DROP COLUMN owner;'));
});
