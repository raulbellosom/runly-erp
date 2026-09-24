import { getOfficeFormat } from '@runly/core';
import { OfficeError } from './errors.js';
import { createFileAccess, FileAccessError } from '../files/access.js';

export const OFFICE_FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createOfficeAccess({ prisma }) {
  const fileAccess = createFileAccess({ prisma });
  async function authorize({ authUserId, fileId, mode = 'view', claims }, db = prisma) {
    if (!OFFICE_FILE_ID.test(fileId)) throw new OfficeError('Identificador de archivo inválido.', 400, 'invalid_file_id');
    const profile = await db.userProfile.findUnique({ where: { authUserId } });
    if (!profile?.enabled) throw new OfficeError('No tienes acceso al documento.', 403, 'forbidden');
    const file = await db.fileAsset.findUnique({ where: { id: fileId }, include: { invItemFiles: { include: { item: true } }, calendarFiles: true } });
    if (!file?.enabled) throw new OfficeError('Archivo no encontrado.', 404, 'file_not_found');
    let companyId = file.entityId;
    let task;
    if (file.entityType === 'Task') {
      task = await db.task.findUnique({ where: { id: file.entityId }, include: { project: { include: { members: true } } } });
      companyId = task?.project.companyId;
    }
    if (!companyId || (claims && (claims.companyId !== companyId || claims.profileId !== profile.id))) throw new OfficeError('No tienes acceso al documento.', 403, 'forbidden');
    const membership = await db.membership.findFirst({
      where: { userId: profile.id, companyId, enabled: true, company: { enabled: true } },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const role = membership?.role;
    if (!role?.enabled) throw new OfficeError('No tienes acceso al documento.', 403, 'forbidden');
    const permissions = new Set();
    for (const { permission } of role.permissions) if (permission.active) permissions.add(permission.key);
    const admin = ['runly.admin', 'system.admin'].includes(role.key);
    const can = key => admin || permissions.has(key);
    const requireAccess = key => { if (!can(key)) throw new OfficeError('No tienes permiso para abrir o editar este documento.', 403, 'forbidden'); };
    requireAccess('files.assets.read');
    if (mode === 'edit') requireAccess('files.assets.update');
    const operation = mode === 'edit' ? 'update' : 'read';
    // Authoritative relations take precedence, even if upload metadata says AtlasFile.
    if (file.calendarFiles.length) throw new OfficeError('Este origen aún no admite edición Office.', 403, 'unsupported_scope');
    for (const relation of file.invItemFiles) {
      if (relation.item.companyId !== companyId || !relation.item.enabled) throw new OfficeError('No tienes acceso al origen.', 403, 'forbidden');
      requireAccess(`inventory.item.${operation}`);
    }
    if (task) {
      requireAccess(`projects.task.${operation}`);
      const project = task.project;
      const member = project.members.find(m => m.userId === profile.id);
      if (project.ownerId !== profile.id && (!member || (mode === 'edit' && member.role === 'VIEWER'))) throw new OfficeError('No tienes acceso al proyecto.', 403, 'forbidden');
      if (mode === 'edit' && project.status !== 'ACTIVE') throw new OfficeError('El proyecto no está activo.', 403, 'forbidden');
    } else if (file.entityType === 'HrEmployee' || file.entityType === 'Contact') {
      const sourceId = file.metadata?.sourceEntityId;
      if (!OFFICE_FILE_ID.test(sourceId ?? '')) throw new OfficeError('Origen no verificable.', 403, 'unsupported_scope');
      const hr = file.entityType === 'HrEmployee';
      const parent = await (hr ? db.hrEmployee : db.contact).findFirst({ where: { id: sourceId, companyId, enabled: true } });
      if (!parent) throw new OfficeError('Origen no encontrado.', 403, 'forbidden');
      requireAccess(`${hr ? 'hr.employee' : 'contacts.contacts'}.${operation}`);
    } else if (file.entityType === 'InvItem' && file.invItemFiles.length) {
      // Verified above from the persisted join, never from the supplied item UUID.
    } else if (file.entityType !== 'AtlasFile' || ![null, 'runly.files', 'atlas.files'].includes(file.moduleKey) || (file.metadata?.sourceEntityId && file.metadata.sourceEntityId !== companyId)) {
      throw new OfficeError('Este origen aún no admite edición Office.', 403, 'unsupported_scope');
    }
    try { await fileAccess.assertAccess(file, { profileId: profile.id, admin }, mode === 'edit' ? 'write' : 'read', db); }
    catch (error) { if (error instanceof FileAccessError) throw new OfficeError(error.message, error.status, 'forbidden'); throw error; }
    const format = getOfficeFormat(file);
    if (!format || file.bucket !== 'runly-files' || file.visibility === 'PUBLIC') throw new OfficeError('Formato o almacenamiento no compatible con Office.', 415, 'unsupported_format');
    if (file.sizeBytes > 10 * 1024 * 1024) throw new OfficeError('El archivo supera 10 MB.', 413, 'file_too_large');
    return { source: 'file_asset', file, profile, companyId, format };
  }

  // Chat attachments live in raw-SQL tables (chat_attachments), not Prisma
  // models. Access is gated by active conversation membership; editing also
  // requires a non-guest role and an original NOT uploaded by a guest. The
  // returned `file` is normalised to the same camelCase shape the FileAsset
  // path yields, so the WOPI service can treat both origins uniformly.
  async function authorizeChatAttachment({ authUserId, attachmentId, mode = 'view' }, db = prisma) {
    if (!OFFICE_FILE_ID.test(attachmentId ?? '')) throw new OfficeError('Identificador de archivo inválido.', 400, 'invalid_file_id');
    const profile = await db.userProfile.findUnique({ where: { authUserId } });
    if (!profile?.enabled) throw new OfficeError('No tienes acceso al documento.', 403, 'forbidden');

    const rows = await db.$queryRaw`
      SELECT a.id, a.conversation_id, a.bucket, a.object_key, a.file_name, a.mime_type,
             a.size_bytes, a.uploaded_by_guest_id, a.content_revision, a.checksum,
             a.office_lock, a.office_lock_expires_at, a.updated_at,
             c.company_id AS company_id
      FROM chat_attachments a
      JOIN chat_conversations c ON c.id = a.conversation_id
      WHERE a.id = ${attachmentId}::uuid
      LIMIT 1
    `;
    const att = rows[0];
    if (!att) throw new OfficeError('Archivo no encontrado.', 404, 'file_not_found');
    const companyId = att.company_id;
    if (!companyId) throw new OfficeError('No tienes acceso al documento.', 403, 'forbidden');

    const memberRows = await db.$queryRaw`
      SELECT role FROM chat_conversation_members
      WHERE conversation_id = ${att.conversation_id}::uuid
        AND user_id = ${profile.id}::uuid
        AND left_at IS NULL
        AND public.runly_chat_user_access(conversation_id, user_id)
      LIMIT 1
    `;
    const role = memberRows[0]?.role;
    if (!role) throw new OfficeError('No perteneces a esta conversación.', 403, 'forbidden');
    if (mode === 'edit') {
      if (!['owner', 'admin', 'member'].includes(role)) throw new OfficeError('Solo lectura en esta conversación.', 403, 'read_only');
      if (att.uploaded_by_guest_id) throw new OfficeError('Este archivo lo subió un invitado; solo lectura.', 403, 'unsupported_scope');
    }

    const file = {
      id: att.id,
      originalName: att.file_name,
      mimeType: att.mime_type,
      bucket: att.bucket,
      objectKey: att.object_key,
      sizeBytes: Number(att.size_bytes),
      contentRevision: att.content_revision,
      checksum: att.checksum,
      officeLock: att.office_lock,
      officeLockExpiresAt: att.office_lock_expires_at,
      updatedAt: att.updated_at,
      conversationId: att.conversation_id,
    };
    const format = getOfficeFormat({ originalName: file.originalName, mimeType: file.mimeType });
    if (!format || file.bucket !== 'runly-chat') throw new OfficeError('Formato o almacenamiento no compatible con Office.', 415, 'unsupported_format');
    if (file.sizeBytes > 10 * 1024 * 1024) throw new OfficeError('El archivo supera 10 MB.', 413, 'file_too_large');
    return { source: 'chat_attachment', file, profile, companyId, format, conversationId: file.conversationId };
  }

  return { authorize, authorizeChatAttachment };
}
