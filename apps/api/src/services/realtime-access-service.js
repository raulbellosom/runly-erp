export function createRealtimeAccessService({ prisma, broadcaster }) {
  async function revision() {
    const [row] = await prisma.$queryRaw`SELECT revision::text FROM realtime_authorization_revision WHERE id`;
    return row.revision;
  }

  async function allowed(topic, userId, edit = false) {
    if (typeof topic !== 'string') return false;
    const note = topic.match(/^note:(ydoc|canvas):([0-9a-f-]{36})$/i);
    if (note) {
      const [row] = await prisma.$queryRaw`SELECT
        public.runly_note_user_access(${note[2]}::uuid, ${userId ?? null}::uuid, ${edit})
        OR (${!edit} AND public.notes_realtime_is_public(${note[2]}::uuid)) AS allowed`;
      return row?.allowed === true;
    }
    if (!userId) return false;
    const chat = topic.match(/^chat:(presence|conv):([0-9a-f-]{36})$/i);
    if (chat) {
      const [row] = await prisma.$queryRaw`SELECT public.runly_chat_user_access(${chat[2]}::uuid, ${userId}::uuid) AS allowed`;
      return row?.allowed === true;
    }
    const company = topic.match(/^company:([0-9a-f-]{36}):(presence|events)$/i) ?? topic.match(/^chat:company:([0-9a-f-]{36})$/i);
    if (company) {
      const [row] = await prisma.$queryRaw`SELECT public.runly_member_active(${company[1]}::uuid, ${userId}::uuid) AS allowed`;
      return row?.allowed === true;
    }
    return topic === `user:${userId}:events` && Boolean(await prisma.userProfile.findFirst({ where: { id: userId, enabled: true }, select: { id: true } }));
  }

  async function relay({ topic, event, payload, actorId }) {
    // Arbitrary company/user events and guest messages can only be emitted by
    // their module service. This relay serves document edits and chat typing.
    const note = /^note:(ydoc|canvas):[0-9a-f-]{36}$/i.test(topic ?? '');
    const typing = /^chat:presence:[0-9a-f-]{36}$/i.test(topic ?? '') && event === 'typing';
    if ((!note && !typing) || !actorId || typeof event !== 'string' || event.length > 80) return false;
    if (JSON.stringify(payload ?? {}).length > 2_000_000) return false;
    if (!(await allowed(topic, actorId, note))) return false;
    const user = await prisma.userProfile.findFirst({ where: { id: actorId, enabled: true }, select: { displayName: true } });
    if (!user) return false;
    await broadcaster.broadcastToChannel(topic, event, typing ? { isTyping: Boolean(payload?.isTyping), userId: actorId, displayName: user.displayName } : payload,
      { authorize: () => allowed(topic, actorId, note) });
    return true;
  }

  async function presence({ topic, actorId, leave = false }) {
    if (!actorId || !(await allowed(topic, actorId))) return null;
    if (leave) {
      await prisma.$executeRaw`DELETE FROM realtime_user_presence WHERE topic = ${topic} AND user_id = ${actorId}::uuid`;
    } else {
      await prisma.$executeRaw`INSERT INTO realtime_user_presence (topic, user_id) VALUES (${topic}, ${actorId}::uuid)
        ON CONFLICT (topic, user_id) DO UPDATE SET seen_at = now()`;
    }
    const rows = await prisma.$queryRaw`SELECT u.id, u.display_name FROM realtime_user_presence p
      JOIN user_profile u ON u.id = p.user_id AND u.enabled
      WHERE p.topic = ${topic} AND p.seen_at > now() - interval '35 seconds' LIMIT 200`;
    const state = {};
    for (const user of rows) {
      if (!(await allowed(topic, user.id))) continue;
      state[user.id] = [{ userId: user.id, displayName: user.display_name, status: 'online', user: { id: user.id, name: user.display_name } }];
    }
    return state;
  }
  return { revision, allowed, relay, presence };
}
