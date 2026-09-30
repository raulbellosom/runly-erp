// "Estado" of an item (alta / baja) — mirrors inventory-admin-service.js.
// The operational status (disponible / asignado / mantenimiento) is shown as
// "Disponibilidad" so the two are never both called "Estado".
// Colors are the same everywhere: alta green, propuesta amber (warning),
// baja red, pendiente blue.

export const ADMIN_STATUSES = [
  { value: 'registration_pending', label: 'Pendiente de alta', color: '#2563eb' },
  { value: 'registered', label: 'Alta', color: '#16a34a' },
  { value: 'deregistration_proposed', label: 'Propuesta de baja', color: '#d97706' },
  { value: 'deregistered', label: 'Baja', color: '#dc2626' },
]
export const ADMIN_STATUS_BY_VALUE = Object.fromEntries(ADMIN_STATUSES.map((s) => [s.value, s]))

export const DEREGISTRATION_REASONS = [
  { value: 'obsolescence', label: 'Obsolescencia' },
  { value: 'damage', label: 'Daño' },
  { value: 'loss', label: 'Pérdida' },
  { value: 'theft', label: 'Robo' },
  { value: 'sale', label: 'Venta' },
  { value: 'donation', label: 'Donación' },
  { value: 'destruction', label: 'Destrucción' },
  { value: 'other', label: 'Otro' },
]
export const reasonLabel = (value) => DEREGISTRATION_REASONS.find((r) => r.value === value)?.label ?? value ?? ''

// Actions offered for each status, with the permission each one needs and
// the fields its dialog asks for.
export const ADMIN_ACTIONS = {
  confirm_registration: {
    from: 'registration_pending', permission: 'inventory.item.register',
    label: 'Confirmar alta', title: 'Confirmar alta', confirmLabel: 'Confirmar alta',
    description: 'El activo pasa a Alta y ya puede asignarse.', fields: { effectiveDate: true },
  },
  propose_deregistration: {
    from: 'registered', permission: 'inventory.item.update',
    label: 'Proponer baja', title: 'Proponer baja', confirmLabel: 'Enviar propuesta',
    description: 'La propuesta queda pendiente hasta que alguien con permiso la autorice o la rechace. El activo sigue operando mientras tanto.',
    fields: { reason: true },
  },
  approve_deregistration: {
    from: 'deregistration_proposed', permission: 'inventory.item.deregister',
    label: 'Autorizar baja', title: 'Autorizar baja', confirmLabel: 'Autorizar baja', destructive: true,
    description: 'El activo queda dado de baja y de solo lectura. Si estaba asignado, se registra su devolución.',
    fields: { effectiveDate: true },
  },
  reject_deregistration: {
    from: 'deregistration_proposed', permission: 'inventory.item.deregister',
    label: 'Rechazar baja', title: 'Rechazar propuesta de baja', confirmLabel: 'Rechazar propuesta',
    description: 'El activo vuelve a Alta.', fields: { comment: 'required' },
  },
  revert_deregistration: {
    from: 'deregistered', permission: 'inventory.item.deregister',
    label: 'Revertir baja', title: 'Revertir baja', confirmLabel: 'Revertir baja',
    description: 'El activo vuelve a Alta y se puede editar y asignar de nuevo.', fields: { comment: 'required' },
  },
}

export const actionsFor = (adminStatus) =>
  Object.entries(ADMIN_ACTIONS).filter(([, a]) => a.from === adminStatus).map(([key, a]) => ({ key, ...a }))

// List filter: empty = the API default (Alta + Propuesta de baja).
export const ADMIN_FILTER_OPTIONS = [
  ...ADMIN_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  { value: 'all', label: 'Todas' },
]
