import { canReceiveResourceEvent } from './notification-access.js'
export function createRealtimeBroadcaster({ supabaseUrl, serviceRoleKey, prisma }) {
  const endpoint = `${supabaseUrl}/realtime/v1/api/broadcast`

  async function _send(messages, authorize = null) {
    await prisma.$transaction(async (tx) => {
      const [scope] = await tx.$queryRaw`SELECT revision::text FROM realtime_authorization_revision WHERE id FOR SHARE`;
      if (authorize && !(await authorize())) return;
      const safe = [];
      for (const message of messages) {
        const match = message.topic.match(/^user:([0-9a-f-]{36}):events$/i);
        if (!match || await canReceiveResourceEvent(tx, match[1], message.payload)) safe.push(message);
      }
      if (!safe.length) return;
      messages = safe;
      messages = messages.map((message) => ({ ...message, topic: `${message.topic}@${scope.revision}` }));
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
      },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(`[realtime-broadcaster] broadcast failed status=${res.status}`, text.slice(0, 200))
    }
    });
  }

  // private: true on every message sent through this service. Every topic
  // this broadcaster ever targets (user:*:events, company:*:events,
  // chat:presence:*, chat:conv:*, chat:company:*) was switched to Realtime
  // Authorization (`{ config: { private: true } }` on the client's
  // `.channel()` call) during the 2026-09-11 multi-tenant sweep. Realtime
  // treats private and non-private subscribers to the SAME topic string as
  // two distinct delivery pools — a message posted without `private: true`
  // silently never reaches a client that joined privately, even though that
  // client's subscription itself succeeded. Omitting this flag here was
  // exactly that bug: every server-sent chat message/notification/presence
  // event stopped arriving in real time the moment those RLS policies went
  // live, without the subscribe-side auth ever failing or logging anything.
  async function broadcastToUser(profileId, event, payload) {
    if (!profileId || !(await canReceiveResourceEvent(prisma, profileId, payload))) return
    await _send([{
      topic: `user:${profileId}:events`,
      event,
      payload: payload ?? {},
      private: true,
    }]).catch((err) => {
      console.warn('[realtime-broadcaster] broadcastToUser error:', err?.message)
    })
  }

  async function broadcastToUsers(profileIds, event, payload) {
    const candidates = [...new Set((profileIds ?? []).filter(Boolean))]
    const checks = await Promise.all(candidates.map((id) => canReceiveResourceEvent(prisma, id, payload)))
    const ids = candidates.filter((_, i) => checks[i])
    if (!ids.length) return
    await _send(
      ids.map((id) => ({
        topic: `user:${id}:events`,
        event,
        payload: payload ?? {},
        private: true,
      })),
    ).catch((err) => {
      console.warn('[realtime-broadcaster] broadcastToUsers error:', err?.message)
    })
  }

  async function broadcastToCompany(companyId, event, payload) {
    if (!companyId) return
    await _send([{
      topic: `company:${companyId}:events`,
      event,
      payload: payload ?? {},
      private: true,
    }]).catch((err) => {
      console.warn('[realtime-broadcaster] broadcastToCompany error:', err?.message)
    })
  }

  async function broadcastToChannel(channelName, event, payload, { authorize } = {}) {
    if (!channelName) return
    await _send([{
      topic: channelName,
      event,
      payload: payload ?? {},
      private: true,
    }], authorize).catch((err) => {
      console.warn('[realtime-broadcaster] broadcastToChannel error:', err?.message)
    })
  }

  return { broadcastToUser, broadcastToUsers, broadcastToCompany, broadcastToChannel }
}

export function createNoopBroadcaster() {
  return {
    broadcastToUser: async () => {},
    broadcastToUsers: async () => {},
    broadcastToCompany: async () => {},
    broadcastToChannel: async () => {},
  }
}
