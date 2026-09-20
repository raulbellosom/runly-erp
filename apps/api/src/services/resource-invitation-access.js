// A capability grants operations on one resource, never a module or directory.
export function withResourceInvitationAccess({ prisma, requirePermission, resourceType }) {
  return (permission) => async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const read = c.req.method === 'GET';
    const note = resourceType === 'note' && path.match(/\/notes\/([0-9a-f-]{36})(?:\/(ydoc|canvas))?$/i);
    const chat = resourceType === 'chat' && path.match(/\/chat\/conversations\/([0-9a-f-]{36})(?:\/(messages))?$/i);
    const permittedOperation = note ? read || ['PATCH', 'PUT'].includes(c.req.method)
      : chat ? read || (chat[2] === 'messages' && c.req.method === 'POST') : false;
    if (permittedOperation) {
      const [grant] = note
        ? await prisma.$queryRaw`SELECT u.id, n.company_id FROM user_profile u
            JOIN note_shares s ON s.shared_with_user_id = u.id AND s.external_access
            JOIN notes n ON n.id = s.note_id
            WHERE u.auth_user_id = ${c.get('authUserId')}::uuid AND n.id = ${note[1]}::uuid
              AND public.runly_note_user_access(n.id, u.id, ${!read})`
        : await prisma.$queryRaw`SELECT u.id, v.company_id FROM user_profile u
            JOIN chat_conversation_members m ON m.user_id = u.id AND m.external_access
            JOIN chat_conversations v ON v.id = m.conversation_id
            WHERE u.auth_user_id = ${c.get('authUserId')}::uuid AND v.id = ${chat[1]}::uuid
              AND public.runly_chat_user_access(v.id, u.id)`;
      if (grant) {
        c.set('userId', grant.id);
        c.set('companyId', grant.company_id);
        c.set('userContext', { profile: { id: grant.id }, isAdmin: false, permissionSet: new Set(), memberships: [] });
        return next();
      }
    }
    return requirePermission(permission)(c, next);
  };
}
