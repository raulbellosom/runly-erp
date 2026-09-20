// Evaluate again at delivery time: a queued notification is not an access grant.
export async function canReceiveResourceEvent(prisma, userId, payload = {}) {
  if (!userId) return false;
  payload = { ...payload.metadata, ...payload };
  const conversationId = payload.conversationId ?? (payload.sourceType === 'chat_conversation' ? payload.sourceId : null);
  const noteId = payload.noteId ?? (payload.sourceType === 'Note' ? payload.sourceId : null);
  if (conversationId) {
    const [row] = await prisma.$queryRaw`SELECT public.runly_chat_user_access(${conversationId}::uuid, ${userId}::uuid) AS allowed`;
    return row?.allowed === true;
  }
  if (noteId) {
    const [row] = await prisma.$queryRaw`SELECT public.runly_note_user_access(${noteId}::uuid, ${userId}::uuid, false) AS allowed`;
    return row?.allowed === true;
  }
  if (payload.sourceType === 'Task' && !payload.projectId) {
    const task = await prisma.task.findFirst({ where: { id: payload.sourceId }, select: { projectId: true } });
    if (!task) return false;
    payload.projectId = task.projectId;
  }
  if (payload.sourceType === 'Project') payload.projectId = payload.sourceId;
  if (payload.projectId) {
    const project = await prisma.project.findFirst({ where: { id: payload.projectId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] }, select: { companyId: true } });
    if (!project) return false;
    payload = { ...payload, companyId: project.companyId };
  }
  if (payload.companyId) {
    const [row] = await prisma.$queryRaw`SELECT public.runly_member_active(${payload.companyId}::uuid, ${userId}::uuid) AS allowed`;
    return row?.allowed === true;
  }
  const user = await prisma.userProfile.findFirst({ where: { id: userId, enabled: true }, select: { id: true } });
  return Boolean(user);
}
