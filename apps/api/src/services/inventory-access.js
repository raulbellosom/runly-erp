import { computeScopedPermissions, isSystemAdminMembership, resolveActiveMembership } from '../lib/tenant-context.js';
import { InventoryServiceError } from './inventory-service.js';

export function createInventoryAccess({ prisma }) {
  async function assertCurrent({ companyId, actorId }, permissions = ['inventory.item.read']) {
    if (!companyId || !actorId) throw new InventoryServiceError('Sin empresa o usuario autorizado.', 403);
    const memberships = await prisma.membership.findMany({ where: { userId: actorId, enabled: true, user: { enabled: true }, role: { enabled: true } },
      include: { company: { select: { enabled: true } }, role: { include: { permissions: { where: { permission: { active: true } }, include: { permission: { select: { key: true } } } } } } } });
    const resolved = resolveActiveMembership({ memberships, requestedCompanyId: companyId });
    if (!resolved.ok || !resolved.membership) throw new InventoryServiceError('Ya no tienes acceso a esta empresa.', 403);
    const grants = await prisma.userPermissionGrant.findMany({ where: { userId: actorId, companyId, permission: { active: true } }, include: { permission: { select: { key: true } } } });
    const access = computeScopedPermissions({ activeMembership: resolved.membership, grantKeysForCompany: grants.map(g => g.permission.key) });
    if (!access.isCompanyAdmin && !isSystemAdminMembership(memberships) && permissions.some(p => !access.permissionSet.has(p))) {
      throw new InventoryServiceError('Ya no tienes permiso para consultar o registrar este inventario.', 403);
    }
  }
  return { assertCurrent };
}
