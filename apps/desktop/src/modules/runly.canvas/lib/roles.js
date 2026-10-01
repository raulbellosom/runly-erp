// Board roles (CanvasCollaborator.role). Rank mirrors the API's ROLE_RANK.
export const BOARD_ROLES = {
  OWNER: { label: 'Propietario', description: 'Control total: edita, comparte y crea enlaces públicos.' },
  EDITOR: { label: 'Editor', description: 'Dibuja, mueve y edita todo el contenido del Board.' },
  COMMENTER: { label: 'Comentarista', description: 'Ve el Board, abre hotspots y agrega archivos; no edita el dibujo.' },
  VIEWER: { label: 'Lector', description: 'Solo ve el Board y abre hotspots.' },
}
export const ASSIGNABLE_ROLES = ['EDITOR', 'COMMENTER', 'VIEWER']

export const canEditBoard = (role) => role === 'OWNER' || role === 'EDITOR'
export const canShareBoard = (role) => role === 'OWNER'
export const roleLabel = (role) => BOARD_ROLES[role]?.label ?? 'Lector'
