import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createUserAccessService } from '../user-access-service.js';
import { createCollaborationInvitationsService } from '../collaboration-invitations-service.js';
import { createRealtimeAccessService } from '../realtime-access-service.js';
import { createTasksService } from '../../routes/projects/tasks-service.js';
import { createChatService } from '../../routes/chat/chat-service.js';
import { createNotesService } from '../../routes/notes/notes-service.js';
import { createFoldersService } from '../../routes/notes/folders-service.js';
import { createTagsService } from '../../routes/notes/tags-service.js';
import { createSharesService } from '../../routes/notes/shares-service.js';
import { createLedgerService } from '../../routes/ledger/ledger-service.js';
import { createLedgerLinkService } from '../../routes/pfm/ledger-link-service.js';
import { createRealtimeBroadcaster } from '../realtime-broadcaster.js';
import { createNotesRouter } from '../../routes/notes/index.js';
import { createChatSearchService } from '../../routes/chat/chat-search-service.js';
import { createCalendarEventService } from '../../routes/calendar/calendar-event-service.js';
import { createCalendarService } from '../../routes/calendar/calendar-service.js';
import { createPublicBookingsRouter } from '../../routes/website/bookings-routes.js';
import { createDistRoutes } from '../../routes/website/dist-routes.js';
import { createPublicWebsiteRouter } from '../../routes/public-website.js';
import { invalidatePrimaryCache } from '../dist-serve-service.js';
import { createProjectsRouter } from '../../routes/projects/projects-routes.js';
import { createPosOrderService } from '../../routes/pos/pos-order-service.js';
import { createPosSessionService } from '../../routes/pos/pos-session-service.js';
import { createPosFloorService } from '../../routes/pos/pos-floor-service.js';
import { createPosReservationService } from '../../routes/pos/pos-reservation-service.js';
import { createChatEntityReferencesService } from '../../routes/chat/chat-entity-references-service.js';
import { createContactsService } from '../contacts-service.js';
import { createHrService } from '../hr-service.js';
import { createProjectsService } from '../../routes/projects/projects-service.js';

// Explicitly opt in with a disposable database whose migrations have been applied.
const connectionString = process.env.RUNLY_ISOLATION_TEST_DATABASE_URL;
describe('company and resource isolation against PostgreSQL', { skip: !connectionString }, () => {
  let db, access, invites, realtime, a, b, c, actor, peer, other, project, status, task, conversation, note;
  const companies = [], users = [], conversations = [], notes = [];
  const unavailable = (err) => err.status === 404;
  const uuid = async () => (await db.$queryRaw`SELECT uuidv7()::text AS id`)[0].id;

  before(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const suffix = Date.now();
    for (const name of ['A', 'B', 'C']) companies.push(await db.company.create({ data: { name: `Isolation ${name}`, slug: `isolation-${name.toLowerCase()}-${suffix}` } }));
    [a, b, c] = companies;
    for (const name of ['actor', 'peer', 'other']) users.push(await db.userProfile.create({ data: { authUserId: await uuid(), displayName: name, email: `${name}-${suffix}@isolation.test` } }));
    [actor, peer, other] = users;
    const role = await db.role.findFirst({ where: { key: 'runly.admin', companyId: null } });
    assert.ok(role, 'run seed before this integration suite');
    for (const [company, user] of [[a, actor], [a, peer], [b, actor], [c, other]]) {
      await db.membership.create({ data: { companyId: company.id, userId: user.id, roleId: role.id } });
    }
    access = createUserAccessService({ prisma: db });
    invites = createCollaborationInvitationsService({ prisma: db });
    realtime = createRealtimeAccessService({ prisma: db, broadcaster: { broadcastToChannel: async () => {} } });
    project = await db.project.create({ data: { companyId: a.id, name: 'Private project', ownerId: actor.id } });
    await db.projectMember.createMany({ data: [{ projectId: project.id, userId: actor.id, role: 'OWNER' }, { projectId: project.id, userId: peer.id, role: 'MEMBER' }] });
    status = await db.taskStatus.create({ data: { projectId: project.id, name: 'Pending', color: '#000000', position: 0 } });
    task = await createTasksService({ prisma: db }).createTask(project.id, actor.id, { title: 'Private task', statusId: status.id, assigneeId: peer.id });
    [conversation] = await db.$queryRaw`INSERT INTO chat_conversations (type, company_id, created_by_user_id, title)
      VALUES ('group', ${a.id}::uuid, ${actor.id}::uuid, 'Private group') RETURNING id`;
    conversations.push(conversation.id);
    await db.$executeRaw`INSERT INTO chat_conversation_members (conversation_id, user_id, role)
      VALUES (${conversation.id}::uuid, ${actor.id}::uuid, 'owner'), (${conversation.id}::uuid, ${peer.id}::uuid, 'member')`;
    note = await createNotesService({ prisma: db }).createNote({ userId: actor.id, companyId: a.id, title: 'Private note' });
    notes.push(note.id);
  });

  after(async () => {
    if (!db) return;
    for (const id of conversations) await db.$executeRaw`DELETE FROM chat_conversations WHERE id = ${id}::uuid`;
    for (const id of notes) await db.$executeRaw`DELETE FROM notes WHERE id = ${id}::uuid`;
    if (project) await db.project.delete({ where: { id: project.id } });
    await db.company.deleteMany({ where: { id: { in: companies.map((x) => x.id) } } });
    await db.userProfile.deleteMany({ where: { id: { in: users.map((x) => x.id) } } });
    await db.$disconnect();
  });

  it('A/B/C: directory, search, and projection use only the requested membership', async () => {
    const list = await access.listCandidates({ companyId: a.id, actorId: actor.id });
    assert.deepEqual(list.map((u) => u.id).sort(), [actor.id, peer.id].sort());
    assert.equal(list.some((u) => 'email' in u || 'memberships' in u || 'authUserId' in u), false);
    assert.deepEqual(await access.listCandidates({ companyId: a.id, actorId: actor.id, search: other.email }), []);
    assert.deepEqual((await access.listCandidates({ companyId: b.id, actorId: actor.id })).map((u) => u.id), [actor.id]);
    await assert.rejects(access.listCandidates({ companyId: c.id, actorId: actor.id }), unavailable);
    await assert.rejects(access.assertCandidates({ companyId: a.id, userIds: [other.id] }), unavailable);
  });

  it('A/E: foreign targets cannot be assigned, mentioned, messaged or invited by UUID', async () => {
    await assert.rejects(createTasksService({ prisma: db }).addAssignee(task.id, other.id), unavailable);
    await assert.rejects(createChatService({ prisma: db }).createConversation({ authUserId: actor.authUserId, companyId: a.id, type: 'direct', memberUserIds: [other.id] }), unavailable);
    await assert.rejects(createSharesService({ prisma: db }).shareNote(note.id, actor.id, { targetUserId: other.id, permission: 'read' }), unavailable);
    await assert.rejects(db.projectTaskAssignee.create({ data: { taskId: task.id, userId: other.id } }));
    assert.equal(await realtime.allowed(`chat:presence:${conversation.id}`, other.id), false);
    assert.equal(await realtime.allowed(`company:${a.id}:presence`, other.id), false);
  });

  it('B: sharing a company does not grant access to a private note', async () => {
    await assert.rejects(createNotesService({ prisma: db }).getNote(note.id, peer.id), unavailable);
    assert.equal(await realtime.allowed(`note:ydoc:${note.id}`, peer.id), false);
    assert.equal(await realtime.allowed(`chat:presence:${conversation.id}`, peer.id), true);
  });

  it('F: single-use collaboration grants expose only the invited resource', async () => {
    const invitation = await invites.create({ resourceType: 'note', resourceId: note.id, actorId: actor.id, companyId: a.id, permission: 'read' });
    await invites.accept({ token: invitation.token, actorId: other.id });
    assert.equal((await invites.list({ resourceType: 'note', resourceId: note.id, companyId: a.id, actorId: actor.id }))[0].id, invitation.id);
    const sharedRouter = createNotesRouter({ prisma: db,
      authMiddleware: async (ctx, next) => { ctx.set('authUserId', other.authUserId); await next(); },
      requirePermission: () => (ctx) => ctx.json({ error: 'Denied' }, 403),
    });
    assert.equal((await sharedRouter.request(`/notes/${note.id}`)).status, 200, 'explicit read grant works without company/module privileges');
    assert.equal((await sharedRouter.request('/notes')).status, 403, 'grant does not expose the module directory');
    assert.equal((await sharedRouter.request(`/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Denied' }) })).status, 403);
    assert.equal((await createNotesService({ prisma: db }).getNote(note.id, other.id)).id, note.id);
    assert.equal(await realtime.allowed(`note:ydoc:${note.id}`, other.id), true);
    assert.equal(await realtime.allowed(`note:ydoc:${note.id}`, other.id, true), false);
    await assert.rejects(access.listCandidates({ companyId: a.id, actorId: other.id }), unavailable);
    await assert.rejects(invites.accept({ token: invitation.token, actorId: peer.id }), unavailable);
    await invites.revoke({ invitationId: invitation.id, actorId: actor.id, companyId: a.id });
    assert.equal(await realtime.allowed(`note:ydoc:${note.id}`, other.id), false);
    const chatInvite = await invites.create({ resourceType: 'chat', resourceId: conversation.id, actorId: actor.id, companyId: a.id });
    await invites.accept({ token: chatInvite.token, actorId: other.id });
    assert.equal(await realtime.allowed(`chat:presence:${conversation.id}`, other.id), true);
    assert.equal(await realtime.allowed(`company:${a.id}:presence`, other.id), false);
    await invites.revoke({ invitationId: chatInvite.id, actorId: actor.id, companyId: a.id });
    assert.equal(await realtime.allowed(`chat:presence:${conversation.id}`, other.id), false);
  });

  it('D: membership revocation invalidates resources, targets and the Realtime topic', async () => {
    const revision = await realtime.revision();
    await db.membership.update({ where: { companyId_userId: { companyId: a.id, userId: peer.id } }, data: { enabled: false } });
    assert.notEqual(await realtime.revision(), revision);
    await assert.rejects(access.assertCompanyMember(a.id, peer.id), unavailable);
    assert.equal(await realtime.allowed(`chat:presence:${conversation.id}`, peer.id), false);
    assert.equal(await realtime.presence({ topic: `company:${a.id}:presence`, actorId: peer.id }), null);
    assert.equal(await realtime.relay({ topic: `chat:presence:${conversation.id}`, event: 'typing', payload: {}, actorId: peer.id }), false);
    const [member] = await db.$queryRaw`SELECT left_at FROM chat_conversation_members WHERE conversation_id = ${conversation.id}::uuid AND user_id = ${peer.id}::uuid`;
    assert.ok(member.left_at);
    await db.task.update({ where: { id: task.id }, data: { title: 'Historical assignment retained' } });
  });

  it('C: message search and assistant reads cannot cross the selected company', async () => {
    const chat = createChatService({ prisma: db });
    await db.$executeRaw`INSERT INTO chat_messages (conversation_id, sender_user_id, sender_type, body, message_type)
      VALUES (${conversation.id}::uuid, ${actor.id}::uuid, 'user', 'ConfidentialCompanyAlpha', 'text')`;
    const search = createChatSearchService({ prisma: db });
    assert.equal((await chat.listConversations({ authUserId: actor.authUserId, companyId: b.id })).data.length, 0);
    assert.equal((await chat.listConversations({ authUserId: actor.authUserId, companyId: a.id })).data.length, 1);
    assert.equal((await search.searchMessages({ authUserId: actor.authUserId, companyId: b.id, q: 'ConfidentialCompanyAlpha' })).data.length, 0);
    assert.equal((await search.searchMessages({ authUserId: actor.authUserId, companyId: a.id, q: 'ConfidentialCompanyAlpha' })).data.length, 1);
    await assert.rejects(chat.listMessages({ authUserId: actor.authUserId, conversationId: conversation.id, companyId: b.id }), unavailable);
  });

  it('E: direct PostgREST privileges deny identity access and RLS denies foreign conversations', async () => {
    const [grants] = await db.$queryRaw`SELECT has_table_privilege('authenticated','public.user_profile','SELECT') AS directory,
      has_table_privilege('anon','public.membership','SELECT') AS membership,
      has_table_privilege('authenticated','public.chat_messages','INSERT') AS writes`;
    assert.deepEqual(grants, { directory: false, membership: false, writes: false });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub', ${other.authUserId}, true)`;
      await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');
      const rows = await tx.$queryRaw`SELECT id FROM chat_conversations WHERE id = ${conversation.id}::uuid`;
      assert.deepEqual(rows, []);
    });
  });

  it('D: broadcaster sends only to the current revision and rechecks revoked recipients', async () => {
    const originalFetch = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (_url, options) => { sent.push(...JSON.parse(options.body).messages); return { ok: true }; };
    try {
      const broadcaster = createRealtimeBroadcaster({ prisma: db, supabaseUrl: 'https://realtime.example', serviceRoleKey: 'test-only' });
      await broadcaster.broadcastToUsers([actor.id, peer.id, other.id], 'chat.message.new', { conversationId: conversation.id });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].topic, `user:${actor.id}:events@${await realtime.revision()}`);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('F: company invitations require the matching identity, acceptance, and current inviter rights', async () => {
    const invitation = await invites.create({ resourceType: 'company', resourceId: a.id, companyId: a.id, actorId: actor.id, email: other.email });
    await assert.rejects(access.assertCompanyMember(a.id, other.id), unavailable);
    await assert.rejects(invites.accept({ token: invitation.token, actorId: peer.id }), unavailable);
    await invites.accept({ token: invitation.token, actorId: other.id });
    await access.assertCompanyMember(a.id, other.id);
    await assert.rejects(invites.accept({ token: invitation.token, actorId: other.id }), unavailable);
    await invites.revoke({ invitationId: invitation.id, companyId: a.id, actorId: actor.id });
    await assert.rejects(access.assertCompanyMember(a.id, other.id), unavailable);
    await access.assertCompanyMember(c.id, other.id);
    const cancelled = await invites.create({ resourceType: 'company', resourceId: a.id, companyId: a.id, actorId: actor.id, email: other.email });
    await invites.revoke({ invitationId: cancelled.id, companyId: a.id, actorId: actor.id });
    await assert.rejects(invites.accept({ token: cancelled.token, actorId: other.id }), unavailable);
  });

  it('H: project dependencies and attachments cannot reference foreign companies, tasks or private files', async () => {
    const foreignProject = await db.project.create({ data: { companyId: b.id, name: 'Other project', ownerId: actor.id } });
    const files = [];
    try {
      const foreignStatus = await db.taskStatus.create({ data: { projectId: foreignProject.id, name: 'Pending', color: '#000000', position: 0 } });
      const foreignTask = await db.task.create({ data: { projectId: foreignProject.id, statusId: foreignStatus.id, title: 'Other task', createdBy: actor.id, position: 0 } });
      const ownTask = await db.task.create({ data: { projectId: project.id, statusId: status.id, title: 'Own task', createdBy: actor.id, position: 1 } });
      const router = createProjectsRouter({ prisma: db, requirePermission: () => async (ctx, next) => {
        ctx.set('companyId', a.id); ctx.set('userContext', { profile: actor }); await next();
      } });
      const base = `/projects/${project.id}/tasks/${task.id}`;
      const post = (path, body) => router.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await post(`${base}/dependencies`, { blockerId: foreignTask.id })).status, 404);
      assert.equal(await db.taskDependency.count({ where: { blockedId: task.id } }), 0);
      assert.equal((await post(`${base}/dependencies`, { blockerId: ownTask.id })).status, 201);

      for (const [company, sourceId, owner, accessScope] of [[b, null, actor, 'COMPANY'], [a, null, actor, 'COMPANY'], [a, ownTask.id, actor, 'COMPANY'], [a, null, other, 'RESTRICTED']]) {
        files.push(await db.fileAsset.create({ data: { bucket: 'runly-files', moduleKey: 'runly.files', objectKey: await uuid(), originalName: 'example.txt', mimeType: 'text/plain', sizeBytes: 1,
          entityId: company.id, entityType: sourceId ? 'Task' : 'AtlasFile', uploadedById: owner.id, accessScope,
          metadata: { companyId: company.id, sourceEntityId: sourceId } } }));
      }
      const [foreign, own, otherTaskFile, privateFile] = files;
      for (const file of [foreign, otherTaskFile]) {
        assert.equal((await post(`${base}/attachments`, { file_asset_id: file.id })).status, 404);
        assert.equal((await router.request(`${base}/attachments/${file.id}`, { method: 'DELETE' })).status, 404);
        assert.equal((await db.fileAsset.findUnique({ where: { id: file.id } })).enabled, true);
      }
      assert.equal((await post(`${base}/attachments`, { file_asset_id: privateFile.id })).status, 403);
      assert.equal((await post(`${base}/attachments`, {})).status, 404);
      assert.equal((await post(`${base}/attachments`, { file_asset_id: own.id })).status, 201);
      const attached = await db.fileAsset.findUnique({ where: { id: own.id } });
      assert.equal(attached.entityId, a.id);
      assert.equal(attached.metadata.sourceEntityId, task.id);
      // Existing bad links must not expose the foreign task through either read.
      await db.taskDependency.create({ data: { blockedId: task.id, blockerId: foreignTask.id } });
      assert.equal((await (await router.request(`${base}/dependencies`)).json()).blockedBy.length, 1);
      const detail = await (await router.request(base)).json();
      assert.equal(detail.blockedBy.length, 1);
      assert.deepEqual(detail.attachments.map(file => file.id), [own.id]);
      const list = await (await router.request(`/projects/${project.id}/tasks`)).json();
      assert.equal(list.find(row => row.id === task.id)._count.attachments, 1);
      assert.deepEqual((await (await router.request(`${base}/attachments`)).json()).map(file => file.id), [own.id]);
      assert.equal((await router.request(`${base}/attachments/${own.id}`, { method: 'DELETE' })).status, 200);
    } finally {
      await db.fileAsset.deleteMany({ where: { id: { in: files.map(file => file.id) } } });
      await db.project.delete({ where: { id: foreignProject.id } });
    }
  });

  it('I: POS rejects foreign outlet, terminal, session, table, zone and guest references before writing', async () => {
    const scope = { companyId: a.id, actorId: actor.id };
    const orders = createPosOrderService({ prisma: db });
    const sessions = createPosSessionService({ prisma: db });
    const floors = createPosFloorService({ prisma: db });
    const reservations = createPosReservationService({ prisma: db });
    const outlets = [], terminals = [], layouts = [], tables = [], cash = [];
    try {
      for (const company of [a, b, a]) {
        const outlet = await db.posOutlet.create({ data: { companyId: company.id, name: `Outlet ${outlets.length}` } }); outlets.push(outlet);
        const terminal = await db.posTerminal.create({ data: { companyId: company.id, outletId: outlet.id, name: 'Terminal' } }); terminals.push(terminal);
        const floor = await floors.createFloor({ companyId: company.id, actorId: actor.id, data: { outletId: outlet.id, name: 'Floor' } }); layouts.push(floor);
        tables.push(await floors.createTable({ companyId: company.id, actorId: actor.id, data: { floorId: floor.id, name: 'Table' } }));
        cash.push(await sessions.openSession({ companyId: company.id, actorId: actor.id, data: { outletId: outlet.id, terminalId: terminal.id, openingCashAmount: 0 } }));
      }
      const data = { outletId: outlets[0].id, terminalId: terminals[0].id, sessionId: cash[0].id, tableId: tables[0].id };
      for (const [field, foreignId] of [['outletId', outlets[1].id], ['terminalId', terminals[1].id], ['sessionId', cash[1].id], ['tableId', tables[1].id],
        ['terminalId', terminals[2].id], ['sessionId', cash[2].id], ['tableId', tables[2].id]]) {
        await assert.rejects(orders.createOrder({ ...scope, data: { ...data, [field]: foreignId } }), unavailable);
      }
      assert.equal(await db.posOrder.count({ where: { companyId: a.id } }), 0);
      assert.equal((await db.posTable.findUnique({ where: { id: tables[1].id } })).status, 'AVAILABLE');
      await assert.rejects(sessions.openSession({ ...scope, data: { outletId: outlets[0].id, terminalId: terminals[1].id } }), unavailable);
      await assert.rejects(floors.createFloor({ ...scope, data: { outletId: outlets[1].id, name: 'Invalid' } }), unavailable);
      const zone = await db.posFloorZone.create({ data: { floorId: layouts[1].id, name: 'Zone' } });
      await assert.rejects(floors.createTable({ ...scope, data: { floorId: layouts[0].id, zoneId: zone.id, name: 'Invalid' } }), unavailable);
      await assert.rejects(floors.updateTable({ ...scope, tableId: tables[0].id, data: { zoneId: zone.id } }), unavailable);
      const order = await orders.createOrder({ ...scope, data });
      await assert.rejects(orders.updateOrder({ ...scope, id: order.id, data: { tableId: tables[1].id } }), unavailable);
      const foreignOrder = await orders.createOrder({ companyId: b.id, actorId: actor.id, data: { outletId: outlets[1].id } });
      const guest = await db.posGuestSeat.findFirst({ where: { orderId: foreignOrder.id } });
      await assert.rejects(orders.addOrderLine({ ...scope, orderId: order.id, data: { guestSeatId: guest.id } }), unavailable);
      const line = await db.posOrderLine.create({ data: { orderId: order.id, productName: 'Example', quantity: 1, unitPrice: 10, totalAmount: 10 } });
      await assert.rejects(orders.updateOrderLine({ ...scope, orderId: order.id, lineId: line.id, data: { guestSeatId: guest.id } }), unavailable);
      const booking = { outletId: outlets[0].id, guestName: 'Example', scheduledAt: new Date().toISOString() };
      await assert.rejects(reservations.createReservation({ ...scope, data: { ...booking, outletId: outlets[1].id } }), unavailable);
      await assert.rejects(reservations.createReservation({ ...scope, data: { ...booking, tableId: tables[1].id } }), unavailable);
      const reservation = await reservations.createReservation({ ...scope, data: booking });
      await assert.rejects(reservations.seatReservation({ ...scope, id: reservation.id, sessionId: cash[1].id }), unavailable);
      assert.equal((await db.posReservation.findUnique({ where: { id: reservation.id } })).status, 'CONFIRMED');
      await reservations.seatReservation({ ...scope, id: reservation.id, sessionId: cash[0].id });
      assert.equal((await db.posReservation.findUnique({ where: { id: reservation.id } })).status, 'SEATED');
    } finally {
      const companyId = { in: [a.id, b.id] };
      await db.posReservation.deleteMany({ where: { companyId } });
      await db.posOrder.deleteMany({ where: { companyId } });
      await db.posSession.deleteMany({ where: { companyId } });
      await db.posTable.deleteMany({ where: { companyId } });
      await db.posFloor.deleteMany({ where: { companyId } });
      await db.posTerminal.deleteMany({ where: { companyId } });
      await db.posOutlet.deleteMany({ where: { companyId } });
    }
  });

  it('J: chat references use the conversation company and require access to the source project', async () => {
    const contacts = [], employees = [];
    const hiddenProject = await db.project.create({ data: { companyId: a.id, ownerId: other.id, name: 'Hidden project' } });
    try {
      for (const company of [a, b]) {
        contacts.push(await db.contact.create({ data: { companyId: company.id, name: 'Example', type: 'person' } }));
        employees.push(await db.hrEmployee.create({ data: { companyId: company.id, firstName: 'Example', lastName: 'Employee' } }));
      }
      const hiddenStatus = await db.taskStatus.create({ data: { projectId: hiddenProject.id, name: 'Pending', position: 0, color: '#000000' } });
      const hiddenTask = await db.task.create({ data: { projectId: hiddenProject.id, statusId: hiddenStatus.id, createdBy: other.id, title: 'Hidden task', position: 0 } });
      const references = createChatEntityReferencesService({ prisma: db, contactsService: createContactsService({ prisma: db }),
        hrService: createHrService({ prisma: db }), tasksService: createTasksService({ prisma: db }), projectsService: createProjectsService({ prisma: db }) });
      const refs = [{ entityType: 'contact', recordId: contacts[0].id }, { entityType: 'hr_employee', recordId: employees[0].id },
        { entityType: 'project', recordId: project.id }, { entityType: 'task', recordId: task.id }];
      assert.equal((await references.resolveEntityRefs({ authUserId: actor.authUserId, companyId: a.id, entityRefs: refs })).length, 4);
      assert.deepEqual(await references.resolveEntityRefs({ authUserId: actor.authUserId, companyId: b.id, entityRefs: refs }), []);
      assert.deepEqual(await references.resolveEntityRefs({ authUserId: actor.authUserId, entityRefs: refs }), []);
      assert.deepEqual(await references.resolveEntityRefs({ authUserId: actor.authUserId, companyId: a.id, entityRefs: [
        { entityType: 'project', recordId: hiddenProject.id }, { entityType: 'task', recordId: hiddenTask.id },
        { entityType: 'contact', recordId: contacts[1].id }, { entityType: 'hr_employee', recordId: employees[1].id },
      ] }), []);
    } finally {
      await db.hrEmployee.deleteMany({ where: { id: { in: employees.map(row => row.id) } } });
      await db.contact.deleteMany({ where: { id: { in: contacts.map(row => row.id) } } });
      await db.project.delete({ where: { id: hiddenProject.id } });
    }
  });

  it('G: active-company calendar operations, website uploads and public bookings cannot cross companies', async () => {
    const calendar = await db.calendarCalendar.create({ data: { companyId: b.id, ownerId: actor.id, name: 'Scope test' } });
    const event = await db.calendarEvent.create({ data: { calendarId: calendar.id, title: 'Scope test', startAt: new Date() } });
    const sites = [];
    try {
      const events = createCalendarEventService({ prisma: db });
      const calendars = createCalendarService({ prisma: db });
      assert.equal((await events.getEvent(actor.id, event.id, b.id)).id, event.id);
      await assert.rejects(events.getEvent(actor.id, event.id, a.id), unavailable);
      await assert.rejects(events.updateEvent(actor.id, event.id, { title: 'Foreign update' }, a.id), unavailable);
      await assert.rejects(events.addReminder(actor.id, event.id, 10, a.id), unavailable);
      await assert.rejects(calendars.updateCalendar(actor.id, calendar.id, { name: 'Foreign update' }, a.id), unavailable);
      const builder = JSON.stringify({ content: [{ type: 'BookingFormBlock', props: { calendarId: calendar.id, serviceDuration: 30 } }] });
      for (const company of [a, b]) {
        const [site] = await db.$queryRaw`INSERT INTO website_site (id, company_id, name, domain, updated_at)
          VALUES (uuidv7(), ${company.id}::uuid, 'Scope test', ${`${company.id}.example.test`}, NOW()) RETURNING id`;
        sites.push(site);
        await db.$executeRaw`INSERT INTO website_page (id, company_id, site_id, title, slug, route_path, status, published_builder_data, updated_at)
          VALUES (uuidv7(), ${company.id}::uuid, ${site.id}::uuid, 'Booking', 'booking', '/booking', 'published', ${builder}::jsonb, NOW())`;
      }
      const bookings = createPublicBookingsRouter({ prisma: db });
      invalidatePrimaryCache();
      // The seed deliberately leaves setup unfinished. Model only its completed
      // flag here; all website/domain/company queries still hit PostgreSQL.
      const publicWebsite = createPublicWebsiteRouter({ prisma: {
        $queryRaw: (...args) => db.$queryRaw(...args),
        instanceConfig: { findUnique: args => args.where.key === 'initialized'
          ? Promise.resolve({ value: 'true' }) : db.instanceConfig.findUnique(args) },
      } });
      const publicResponse = await publicWebsite.request('/resolve?path=/booking', { headers: { Host: `${b.id}.example.test` } });
      assert.equal(publicResponse.status, 200);
      const publicBody = await publicResponse.json();
      assert.equal(publicBody.site.id, sites[1].id);
      assert.equal(publicBody.site.company, b.slug);
      assert.equal(publicBody.page.routePath, '/booking');
      const submit = (siteId) => bookings.request('/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Site-Id': siteId },
        body: JSON.stringify({ calendarId: calendar.id, name: 'Visitor', email: 'visitor@example.test', date: '2026-10-15', time: '12:00', serviceDuration: 999 }) });
      assert.equal((await submit(sites[0].id)).status, 404);
      assert.equal((await submit(sites[1].id)).status, 200);
      const booking = await db.calendarEvent.findFirst({ where: { calendarId: calendar.id, sourceModule: 'website' } });
      assert.equal(booking.endAt - booking.startAt, 30 * 60_000);
      const dist = createDistRoutes({ prisma: db, supabaseAdmin: {}, requirePermission: () => async (c, next) => { c.set('companyId', a.id); await next(); } });
      assert.equal((await dist.request(`/website/sites/${sites[1].id}/dist`, { method: 'DELETE' })).status, 404);
      const form = new FormData(); form.append('file', new Blob(['test']), 'site.zip');
      assert.equal((await dist.request(`/website/sites/${sites[1].id}/dist/upload`, { method: 'POST', body: form })).status, 404);
    } finally {
      for (const site of sites) {
        await db.$executeRaw`DELETE FROM website_page WHERE site_id = ${site.id}::uuid`;
        await db.$executeRaw`DELETE FROM website_site WHERE id = ${site.id}::uuid`;
      }
      await db.calendarCalendar.delete({ where: { id: calendar.id } });
    }
  });

  it('K: note folders/tags and personal-finance annotations stay scoped to their company', async () => {
    const folders = createFoldersService({ prisma: db });
    const tags = createTagsService({ prisma: db });
    const folderIds = [], tagIds = [], noteIds = [];
    try {
      const folderA = await folders.createFolder({ userId: actor.id, companyId: a.id, name: 'Folder A' });
      const folderB = await folders.createFolder({ userId: actor.id, companyId: b.id, name: 'Folder B' });
      folderIds.push(folderA.id, folderB.id);
      const listA = await folders.listFolders({ userId: actor.id, companyId: a.id });
      assert.ok(listA.some((f) => f.id === folderA.id));
      assert.ok(!listA.some((f) => f.id === folderB.id));
      await assert.rejects(folders.createFolder({ userId: actor.id, companyId: a.id, name: 'Invalid', parentFolderId: folderB.id }), unavailable);
      await assert.rejects(folders.updateFolder(folderA.id, actor.id, { parentFolderId: folderB.id }, a.id), unavailable);
      await assert.rejects(folders.updateFolder(folderA.id, actor.id, { name: 'Renamed' }, b.id), unavailable);
      await assert.rejects(folders.deleteFolder(folderB.id, actor.id, a.id), unavailable);

      const tagA = await tags.createTag({ userId: actor.id, companyId: a.id, name: 'Tag A' });
      const tagB = await tags.createTag({ userId: actor.id, companyId: b.id, name: 'Tag B' });
      tagIds.push(tagA.id, tagB.id);
      const tagsA = await tags.listTags({ userId: actor.id, companyId: a.id });
      assert.ok(tagsA.some((t) => t.id === tagA.id));
      assert.ok(!tagsA.some((t) => t.id === tagB.id));
      await assert.rejects(tags.updateTag(tagA.id, actor.id, { name: 'x' }, b.id), unavailable);
      await assert.rejects(tags.deleteTag(tagB.id, actor.id, a.id), unavailable);

      const noteA = await createNotesService({ prisma: db }).createNote({ userId: actor.id, companyId: a.id, title: 'Scoped note' });
      noteIds.push(noteA.id);
      await assert.rejects(tags.setNoteTags(noteA.id, actor.id, [tagB.id]), (err) => err.status === 403);
      assert.equal((await tags.setNoteTags(noteA.id, actor.id, [tagA.id])).count, 1);
    } finally {
      for (const id of noteIds) await db.$executeRaw`DELETE FROM notes WHERE id = ${id}::uuid`;
      for (const id of tagIds) await db.$executeRaw`DELETE FROM note_tags WHERE id = ${id}::uuid`;
      for (const id of folderIds) await db.$executeRaw`DELETE FROM note_folders WHERE id = ${id}::uuid`;
    }

    const ledgerAccounts = [], wallets = [];
    try {
      const ledgerService = createLedgerService({ prisma: db });
      const ledgerLink = createLedgerLinkService({ prisma: db, ledgerService });
      for (const company of [a, b]) {
        const account = await db.ledgerAccount.create({ data: { companyId: company.id, ownerId: actor.id, name: 'Account', bank: 'Bank' } });
        ledgerAccounts.push(account);
        wallets.push(await db.pfmWallet.create({ data: { companyId: company.id, ownerId: actor.id, name: 'Wallet', kind: 'DEBIT', ledgerAccountId: account.id } }));
      }
      const [accountA] = ledgerAccounts;
      const [walletA, walletB] = wallets;
      const txn = await db.ledgerTransaction.create({ data: { companyId: a.id, accountId: accountA.id, fecha: new Date(), nombre: 'Example', deposito: 100 } });
      const scope = { actorId: actor.id, ledgerAccountId: accountA.id, ledgerTransactionId: txn.id, data: { note: 'Foreign attempt' } };
      // Own company, but the wallet belongs to company B: the wallet itself must resolve under the active company.
      await assert.rejects(ledgerLink.enrichLedgerMovement({ ...scope, companyId: a.id, walletId: walletB.id }), unavailable);
      // Same wallet/account pairing, but the active company is B: the ledger account does not resolve there.
      await assert.rejects(ledgerLink.enrichLedgerMovement({ ...scope, companyId: b.id, walletId: walletB.id }), (err) => err.status === 403);
      const enrichment = await ledgerLink.enrichLedgerMovement({ ...scope, companyId: a.id, walletId: walletA.id, data: { note: 'Own note' } });
      assert.equal(enrichment.companyId, a.id);
      assert.equal(enrichment.walletId, walletA.id);
      const movements = await ledgerLink.getLinkedMovements({ companyId: a.id, actorId: actor.id, walletId: walletA.id, ledgerAccountId: accountA.id, query: {} });
      assert.equal(movements.data.find((row) => row.id === txn.id)?.note, 'Own note');
    } finally {
      await db.pfmLedgerEnrichment.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } });
      await db.ledgerTransaction.deleteMany({ where: { accountId: { in: ledgerAccounts.map((x) => x.id) } } });
      await db.pfmWallet.deleteMany({ where: { id: { in: wallets.map((w) => w.id) } } });
      await db.ledgerAccount.deleteMany({ where: { id: { in: ledgerAccounts.map((x) => x.id) } } });
    }
  });
});
