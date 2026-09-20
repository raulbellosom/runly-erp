import { createUserAccessService } from './user-access-service.js';
import { parseMentionIds } from '../lib/mention-utils.js';

export class CommentsServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'CommentsServiceError';
    this.status = status;
  }
}

export function createCommentsService({ prisma }) {
  const access = createUserAccessService({ prisma });
  function entityPermission(entityType) {
    return { Task: 'projects.project.read', GrowthLead: 'growth.leads.read', InvItem: 'inventory.item.read' }[entityType];
  }
  async function assertEntity(entityType, entityId, companyId, userId) {
    await access.assertCompanyMember(companyId, userId, entityPermission(entityType));
    if (entityType === 'GrowthLead') {
      if (await prisma.growthLead.findFirst({ where: { id: entityId, companyId }, select: { id: true } })) return null;
    } else if (entityType === 'InvItem') {
      if (await prisma.invItem.findFirst({ where: { id: entityId, companyId }, select: { id: true } })) return null;
    } else if (entityType === 'Task') {
      const task = await prisma.task.findFirst({ where: { id: entityId, project: { companyId } }, select: { projectId: true, project: { select: { ownerId: true } } } });
      if (task && (task.project.ownerId === userId || await prisma.projectMember.findFirst({ where: { projectId: task.projectId, userId }, select: { id: true } }))) return task.projectId;
    }
    throw new CommentsServiceError('Recurso no encontrado.', 404);
  }
  async function assertComment(commentId, userId, companyId, entityId) {
    if (!companyId || !entityId) throw new CommentsServiceError('Recurso no encontrado.', 404);
    const comment = await prisma.entityComment.findFirst({ where: { id: commentId, companyId, entityId } });
    if (!comment) throw new CommentsServiceError('Recurso no encontrado.', 404);
    const projectId = await assertEntity(comment.entityType, comment.entityId, companyId, userId);
    return { comment, projectId };
  }

  async function resolveProfileId(authUserId) {
    if (!authUserId) return null;
    const profile = await prisma.userProfile.findFirst({
      where: { authUserId, enabled: true },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  async function listComments(entityType, entityId, companyId, userId) {
    await assertEntity(entityType, entityId, companyId, userId);
    return prisma.entityComment.findMany({
      where: { entityType, entityId, companyId },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
        mentions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        reactions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function createComment(entityType, entityId, authorAuthId, body, companyId) {
    const authorId = await resolveProfileId(authorAuthId);
    if (!authorId) throw new CommentsServiceError('Autor no encontrado.', 404);
    if (!body?.trim()) throw new CommentsServiceError('El comentario no puede estar vacío.', 400);

    const projectId = await assertEntity(entityType, entityId, companyId, authorId);
    const mentionIds = parseMentionIds(body);
    await access.assertCandidates({ companyId, userIds: mentionIds, projectId, permission: entityPermission(entityType) });

    const comment = await prisma.entityComment.create({
      data: {
        companyId,
        entityType,
        entityId,
        authorId,
        body: body.trim(),
        mentions: mentionIds.length
          ? { create: mentionIds.map((userId) => ({ userId })) }
          : undefined,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
        mentions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        reactions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    return comment;
  }

  async function updateComment(commentId, authorAuthId, body, companyId, entityId) {
    const authorId = await resolveProfileId(authorAuthId);
    if (!authorId) throw new CommentsServiceError('Autor no encontrado.', 404);
    if (!body?.trim()) throw new CommentsServiceError('El comentario no puede estar vacío.', 400);

    const { comment: existing, projectId } = await assertComment(commentId, authorId, companyId, entityId);
    if (!existing) throw new CommentsServiceError('Comentario no encontrado.', 404);
    if (existing.authorId !== authorId) throw new CommentsServiceError('No tienes permiso para editar este comentario.', 403);

    const mentionIds = parseMentionIds(body);
    await access.assertCandidates({ companyId, userIds: mentionIds, projectId, permission: entityPermission(existing.entityType) });

    await prisma.entityCommentMention.deleteMany({ where: { commentId } });

    const comment = await prisma.entityComment.update({
      where: { id: commentId },
      data: {
        body: body.trim(),
        editedAt: new Date(),
        mentions: mentionIds.length
          ? { create: mentionIds.map((userId) => ({ userId })) }
          : undefined,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
        mentions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        reactions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    return comment;
  }

  async function deleteComment(commentId, requesterAuthId, companyId, entityId) {
    const requesterId = await resolveProfileId(requesterAuthId);
    if (!requesterId) throw new CommentsServiceError('Usuario no encontrado.', 404);

    const { comment: existing } = await assertComment(commentId, requesterId, companyId, entityId);
    if (!existing) throw new CommentsServiceError('Comentario no encontrado.', 404);
    if (existing.authorId !== requesterId) throw new CommentsServiceError('No tienes permiso para eliminar este comentario.', 403);

    await prisma.entityComment.delete({ where: { id: commentId } });
  }

  async function toggleReaction(commentId, userAuthId, emoji, companyId, entityId) {
    const userId = await resolveProfileId(userAuthId);
    if (!userId) throw new CommentsServiceError('Usuario no encontrado.', 404);
    await assertComment(commentId, userId, companyId, entityId);
    if (!emoji?.trim()) throw new CommentsServiceError('Emoji requerido.', 400);

    const existing = await prisma.entityCommentReaction.findFirst({
      where: { commentId, userId, emoji },
    });

    if (existing) {
      await prisma.entityCommentReaction.delete({ where: { id: existing.id } });
      return { removed: true, emoji };
    }

    const reaction = await prisma.entityCommentReaction.create({
      data: { commentId, userId, emoji },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    return { removed: false, reaction };
  }

  return { listComments, createComment, updateComment, deleteComment, toggleReaction };
}
