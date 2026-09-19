import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryIntakeService } from '../inventory-intake-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';
const ACTOR = '01900000-0000-7000-8000-000000000002';
const FIELD = '01900000-0000-7000-8000-000000000003';
const context = { companyId: COMPANY, actorId: ACTOR, authUserId: 'auth-user' };
function input(serial = 'O0-I1-B8') {
  return { key: 'a'.repeat(32), common: { name: 'Laptop', model: 'XPS' }, units: [{ serialNumber: serial, confirmedIdentifiers: { serialNumber: serial } }] };
}
function fixture({ matches = [], definitions = [], vision, configured = true } = {}) {
  let audits = [], items = [], queries = [], locks = 0;
  const db = {
    invItem: {
      findMany: async q => { queries.push(q); return matches; },
      create: async ({ data }) => { const row = { id: `item-${items.length}`, ...data }; items.push(row); return row; },
    },
    invCustomField: { findMany: async () => definitions },
    invCategory: { findFirst: async () => null },
    userProfile: { findFirst: async () => ({ id: ACTOR }) },
    auditLog: {
      findFirst: async ({ where }) => audits.find(a => a.action === where.action && a.companyId === where.companyId && a.actorId === where.actorId && a.metadata.key === where.metadata.equals) ??
        audits.find(a => a.action === where.action && a.companyId === where.companyId && a.actorId === where.actorId && a.metadata.key === where.metadata?.equals),
      create: async ({ data }) => { audits.push(data); return data; },
    },
    $queryRaw: async () => { locks++; return []; },
  };
  db.$transaction = async fn => {
    const oldAudits = [...audits], oldItems = [...items];
    try { return await fn(db); } catch (err) { audits = oldAudits; items = oldItems; throw err; }
  };
  const service = createInventoryIntakeService({ prisma: db,
    env: configured ? { GROQ_API_KEY: 'test-key' } : {},
    prepareImage: async b => b,
    vision: vision ?? { extractInventory: async () => ({ parsed: { observations: [{ field: 'serialNumber', value: 'O0-I1-B8', status: 'observed' }] }, model: 'test' }) },
  });
  return { service, db, state: () => ({ audits, items, queries, locks }) };
}
function photo(name = 'label.jpg') { return new File(['test-image'], name, { type: 'image/jpeg' }); }

test('recognition preserves identifiers and issues evidence scoped to the actor/company', async () => {
  const { service } = fixture();
  const { images } = await service.recognize({ ...context, files: [photo()] });
  assert.equal(images[0].observations[0].value, 'O0-I1-B8');
  const body = input();
  body.proofs = [images[0].proof]; body.units[0].sourceImageIds = [images[0].imageId];
  assert.equal((await service.validate({ ...context, input: body })).issues.length, 0);
  await assert.rejects(service.validate({ ...context, companyId: ACTOR, input: body }), /no pertenece/);
  await assert.rejects(service.validate({ ...context, actorId: COMPANY, input: body }), /no pertenece/);
  body.proofs[0] += 'x';
  await assert.rejects(service.validate({ ...context, input: body }), /no pertenece/);
});
test('recognition refuses missing identity, oversized batches and unsupported image types', async () => {
  const { service } = fixture();
  await assert.rejects(service.recognize({ files: [photo()] }), /autorizado/);
  await assert.rejects(service.recognize({ ...context, files: Array.from({ length: 4 }, () => photo()) }), /3/);
  await assert.rejects(service.recognize({ ...context, files: [new File(['svg'], 'x.svg', { type: 'image/svg+xml' })] }), /fotografías/);
});
test('one failed photo does not discard successful observations from the batch', async () => {
  let count = 0;
  const { service } = fixture({ vision: { extractInventory: async () => {
    if (++count === 1) throw new Error('provider failed');
    return { parsed: { observations: [{ field: 'serialNumber', value: 'do not trust', status: 'unreadable' }] } };
  } } });
  const { images } = await service.recognize({ ...context, files: [photo('1'), photo('2')] });
  assert.ok(images[0].error); assert.equal(images[1].observations[0].value, null);
});

test('recognition retains the transcription and valid fields when another field is malformed', async () => {
  const { service } = fixture({ vision: { extractInventory: async () => ({ parsed: { rawText: 'Laptop DEMO\nRMN HSN-DEMO\nS/N O0-I1', observations: [
    { field: 'model', value: 'Laptop DEMO', status: 'observed' },
    { field: 'partNumber', value: 'HSN-DEMO', status: 'observed' },
    { field: 'unsupportedField', value: 'discard', status: 'observed' },
  ] } }) } });
  const { images: [image] } = await service.recognize({ ...context, files: [photo()] });
  assert.equal(image.error, undefined); assert.ok(image.proof);
  assert.match(image.rawText, /S\/N O0-I1/); assert.equal(image.observations.length, 2);
  assert.deepEqual(image.observations.filter(o => o.field === 'model').map(o => o.value), ['Laptop DEMO']);
  assert.equal(image.observations.find(o => o.value === 'HSN-DEMO').field, 'description');
  assert.equal(image.warnings.length, 1);
});

test('text-only readings remain available and provider throttling has a specific per-photo error', async () => {
  const text = fixture({ vision: { extractInventory: async () => ({ parsed: { rawText: 'Etiqueta legible', observations: [] } }) } });
  const first = (await text.service.recognize({ ...context, files: [photo()] })).images[0];
  assert.equal(first.rawText, 'Etiqueta legible'); assert.equal(first.error, undefined);
  const limited = fixture({ vision: { extractInventory: async () => { throw Object.assign(new Error('El servicio respondio 429'), { status: 502 }); } } });
  const failed = (await limited.service.recognize({ ...context, files: [photo()] })).images[0];
  assert.match(failed.error, /límite temporal/); assert.equal(failed.proof, undefined);
});
test('AI is optional: manual validation works without a provider key', async () => {
  const { service } = fixture({ configured: false });
  await assert.rejects(service.recognize({ ...context, files: [photo()] }), e => e.status === 503);
  assert.equal((await service.validate({ ...context, input: input() })).issues.length, 0);
});
test('rejects unconfirmed identifiers, duplicate serials and fabricated evidence', async () => {
  const { service } = fixture();
  const body = input(); body.units[0].confirmedIdentifiers.serialNumber = 'different';
  body.units.push({ ...body.units[0] }); body.units[0].sourceImageIds = ['b'.repeat(64)];
  const { issues } = await service.validate({ ...context, input: body });
  assert.ok(issues.some(i => i.message.includes('Confirma')));
  assert.ok(issues.some(i => i.message.includes('repetida')));
  assert.ok(issues.some(i => i.message.includes('fotografía')));
});
test('queries duplicates only in the authenticated company, including disabled assets', async () => {
  const { service, state } = fixture({ matches: [{ id: 'existing', assetTag: 'INV-1', serialNumber: 'O0-I1-B8', enabled: false }] });
  const body = input();
  assert.equal((await service.validate({ ...context, input: body })).issues.length, 1);
  assert.equal(state().queries[0].where.companyId, COMPANY);
  body.units[0].duplicateAcknowledged = true;
  assert.equal((await service.validate({ ...context, input: body })).issues.length, 0);
  body.units[0].assetTag = 'INV-1'; body.units[0].confirmedIdentifiers.assetTag = 'INV-1';
  assert.ok((await service.validate({ ...context, input: body })).issues.some(i => i.field === 'assetTag'));
});
test('foreign catalogs and custom fields cannot be written', async () => {
  const { service } = fixture();
  const body = input(); body.common.categoryId = FIELD;
  await assert.rejects(service.validate({ ...context, input: body }), /catálogo/);
  delete body.common.categoryId; body.common.customValues = [{ fieldId: FIELD, value: 'foreign' }];
  await assert.rejects(service.validate({ ...context, input: body }), /personalizados/);
});
test('model and part number can repeat across independently confirmed units', async () => {
  const { service } = fixture();
  const body = input(); body.common.partNumber = 'PN-SHARED';
  body.units = ['SN-1', 'SN-2'].map(serialNumber => ({ serialNumber, confirmedIdentifiers: { serialNumber, partNumber: 'PN-SHARED' } }));
  assert.equal((await service.validate({ ...context, input: body })).issues.length, 0);
});
test('creates 20 independent units atomically and retries recover the same IDs', async () => {
  const { service, db, state } = fixture();
  db.auditLog.findFirst = async ({ where }) => state().audits.find(a => a.action === where.action && a.metadata.key === where.metadata.equals);
  const body = input(); body.units = Array.from({ length: 20 }, (_, i) => ({ serialNumber: `SN-${i}`, confirmedIdentifiers: { serialNumber: `SN-${i}` } }));
  const first = await service.create({ ...context, input: body });
  assert.equal(first.items.length, 20);
  assert.equal(new Set(first.items.map(i => i.assetTag)).size, 20);
  assert.equal(state().audits.length, 21);
  const second = await service.create({ ...context, input: body });
  assert.equal(second.replayed, true); assert.deepEqual(second.items, first.items);
  assert.equal(state().items.length, 20);
  body.common.name = 'Changed';
  await assert.rejects(service.create({ ...context, input: body }), e => e.status === 409);
});
test('a failure halfway through rolls back all records and the idempotency entry', async () => {
  const { service, db, state } = fixture();
  const create = db.invItem.create;
  db.invItem.create = async args => { if (state().items.length === 1) throw new Error('database failed'); return create(args); };
  const body = input(); body.units.push({ serialNumber: 'SN-2', confirmedIdentifiers: { serialNumber: 'SN-2' } });
  await assert.rejects(service.create({ ...context, input: body }), /database failed/);
  assert.equal(state().items.length, 0); assert.equal(state().audits.length, 0);
});
