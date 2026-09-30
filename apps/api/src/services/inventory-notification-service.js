import { createNotificationService } from './notification-service.js'
import { COMPANY_ADMIN_ROLE_KEYS } from '../lib/tenant-context.js'

const REASON_LABELS = { obsolescence: 'Obsolescencia', damage: 'Daño', loss: 'Pérdida', theft: 'Robo', sale: 'Venta', donation: 'Donación', destruction: 'Destrucción', other: 'Otro' }

export function createInventoryNotificationService({ prisma, notificationService }) {
  const notifSvc = notificationService ?? createNotificationService({ prisma })

  async function notifyInvComment({ companyId, actorId, itemId, commentId, mentionedUserIds = [] }) {
    const recipients = mentionedUserIds.filter((id) => id !== actorId)
    if (recipients.length === 0) return
    try {
      const item = await prisma.invItem.findFirst({
        where: { id: itemId },
        select: { name: true },
      })
      if (!item) return
      await notifSvc.publish({
        companyId,
        actorId: actorId ?? null,
        input: {
          eventType: 'inventory.item.mention',
          title: 'Te mencionaron en inventario',
          body: `En el elemento "${item.name}"`,
          link: `/app/m/runly.inventory/inventory/${itemId}`,
          recipients: { userIds: recipients },
          channels: ['in_app', 'email', 'web_push'],
          priority: 'medium',
          sourceType: 'InvItem',
          sourceId: itemId,
          ...(commentId ? { dedupeKey: `inventory.item.mention:${commentId}` } : {}),
          metadata: { itemId },
        },
      })
    } catch (err) {
      console.error('[inventory.item.mention]', err?.message ?? err)
    }
  }

  async function notifyInvReaction({ companyId, actorId, commentId }) {
    try {
      const comment = await prisma.entityComment.findFirst({
        where: { id: commentId, companyId, entityType: 'InvItem' },
      })
      if (!comment) return
      if (comment.authorId === actorId) return
      const item = await prisma.invItem.findFirst({ where: { id: comment.entityId, companyId }, select: { id: true, name: true } })
      if (!item) return
      await notifSvc.publish({
        companyId,
        actorId: actorId ?? null,
        input: {
          eventType: 'inventory.item.reaction',
          title: 'Reaccionaron a tu comentario',
          body: `En el elemento "${item?.name ?? 'Inventario'}"`,
          link: `/app/m/runly.inventory/inventory/${item?.id ?? ''}`,
          recipients: { userIds: [comment.authorId] },
          channels: ['in_app', 'email', 'web_push'],
          priority: 'low',
          sourceType: 'InvComment',
          sourceId: commentId,
          metadata: { commentId, itemId: item?.id },
        },
      })
    } catch (err) {
      console.error('[inventory.item.reaction]', err?.message ?? err)
    }
  }

  // Profiles in the company holding `permissionKey` through their role, a
  // direct grant, or a company-admin role.
  async function profilesWithPermission(companyId, permissionKey) {
    const [memberships, grants] = await Promise.all([
      prisma.membership.findMany({
        where: {
          companyId,
          enabled: true,
          role: { OR: [{ key: { in: [...COMPANY_ADMIN_ROLE_KEYS] } }, { permissions: { some: { permission: { key: permissionKey } } } }] },
        },
        select: { userId: true },
      }),
      prisma.userPermissionGrant.findMany({ where: { companyId, permission: { key: permissionKey } }, select: { userId: true } }),
    ])
    return [...new Set([...memberships, ...grants].map((row) => row.userId))]
  }

  async function notifyDeregistrationProposed({ companyId, actorId, item, reason }) {
    try {
      const recipients = (await profilesWithPermission(companyId, 'inventory.item.deregister')).filter((id) => id !== actorId)
      if (recipients.length === 0) return
      await notifSvc.publish({
        companyId,
        actorId: actorId ?? null,
        input: {
          eventType: 'inventory.item.deregistration_proposed',
          title: 'Propuesta de baja por autorizar',
          body: `«${item.name}» (${item.assetTag})${reason ? ` · ${REASON_LABELS[reason] ?? reason}` : ''}`,
          link: `/app/m/runly.inventory/inventory/${item.id}`,
          recipients: { userIds: recipients },
          channels: ['in_app', 'email', 'web_push'],
          priority: 'medium',
          sourceType: 'InvItem',
          sourceId: item.id,
          dedupeKey: `inventory.item.deregistration_proposed:${item.id}:${Date.now()}`,
          metadata: { itemId: item.id, reason },
        },
      })
    } catch (err) {
      console.error('[inventory.item.deregistration_proposed]', err?.message ?? err)
    }
  }

  return { notifyInvComment, notifyInvReaction, notifyDeregistrationProposed }
}
