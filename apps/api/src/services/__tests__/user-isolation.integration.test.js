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
import { createSharesService } from '../../routes/notes/shares-service.js';
import { createRealtimeBroadcaster } from '../realtime-broadcaster.js';
import { createNotesRouter } from '../../routes/notes/index.js';
import { createChatSearchService } from '../../routes/chat/chat-search-service.js';

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
});
