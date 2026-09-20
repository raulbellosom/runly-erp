import {
  Building2,
  Container,
  Hash,
  MapPinned,
  PackageOpen,
  RadioTower,
  Scale,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
export { createInitialForm } from './catalog-form-state.js'

export const RESOURCE_ORDER = ['sites', 'stations', 'materials', 'assignments', 'series']

export const RESOURCE_PATHS = {
  sites: '/app/m/custom.dispatch/sitios',
  stations: '/app/m/custom.dispatch/estaciones',
  materials: '/app/m/custom.dispatch/materiales',
  assignments: '/app/m/custom.dispatch/responsables',
  series: '/app/m/custom.dispatch/folios',
}

export const CATALOGS = {
  sites: {
    label: 'Sitios',
    singular: 'sitio',
    title: 'Sitios operativos',
    description: 'Minas, bancos y patios donde se originan los despachos.',
    icon: MapPinned,
    createLabel: 'Agregar sitio',
    emptyTitle: 'No hay sitios operativos',
    emptyDescription: 'Registra un sitio para asociar estaciones, materiales y folios.',
  },
  stations: {
    label: 'Estaciones',
    singular: 'estación',
    title: 'Puntos de operación',
    description: 'Puntos de venta, báscula y salida física asociados a cada sitio.',
    icon: RadioTower,
    createLabel: 'Agregar estación',
    emptyTitle: 'No hay estaciones',
    emptyDescription: 'Registra los puntos de venta, báscula o salida del sitio.',
  },
  materials: {
    label: 'Materiales',
    singular: 'material',
    title: 'Materiales despachables',
    description: 'Materiales disponibles para despacho por volumen o toneladas.',
    icon: PackageOpen,
    createLabel: 'Agregar material',
    emptyTitle: 'No hay materiales',
    emptyDescription: 'Registra grava, GRIMM y cualquier otro material que pueda venderse.',
  },
  assignments: {
    label: 'Responsables',
    singular: 'responsable',
    title: 'Responsables por estación',
    description: 'Usuarios asignados a cada estación y responsables de recibir alertas de salida.',
    icon: UsersRound,
    createLabel: 'Asignar responsable',
    emptyTitle: 'No hay responsables asignados',
    emptyDescription: 'Vincula usuarios de Runly con cada estación operativa.',
  },
  series: {
    label: 'Folios',
    singular: 'serie',
    title: 'Series de folios',
    description: 'Numeración independiente para vales con báscula y vales por volumen.',
    icon: Hash,
    createLabel: 'Agregar serie',
    emptyTitle: 'No hay series de folios',
    emptyDescription: 'Configura una serie para SCALE y otra para VOLUME.',
  },
}

export const STATION_TYPES = [
  { value: 'SALES', label: 'Venta / expedición' },
  { value: 'SCALE', label: 'Báscula' },
  { value: 'GATE', label: 'Pluma / salida física' },
]

export const ASSIGNMENT_TYPES = [
  { value: 'OPERATOR', label: 'Operador' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'GUARD', label: 'Guardia (referencia)' },
]

export const VOUCHER_TYPES = [
  { value: 'SCALE', label: 'Vale con báscula' },
  { value: 'VOLUME', label: 'Vale por volumen' },
]

export const STATION_LABEL = Object.fromEntries(STATION_TYPES.map((item) => [item.value, item.label]))
export const ASSIGNMENT_LABEL = Object.fromEntries(ASSIGNMENT_TYPES.map((item) => [item.value, item.label]))
export const VOUCHER_LABEL = Object.fromEntries(VOUCHER_TYPES.map((item) => [item.value, item.label]))

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'DEPOSIT', label: 'Depósito' },
  { value: 'OTHER', label: 'Otro' },
]

export const TICKET_STATUS_LABEL = {
  CREATED: 'Creado',
  READY_FOR_EXIT: 'Listo para salida',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  CORRECTION_REQUIRED: 'Requiere corrección',
  USED: 'Usado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
}

export const TICKET_STATUS_VARIANT = {
  CREATED: 'secondary',
  READY_FOR_EXIT: 'success',
  PENDING_APPROVAL: 'warning',
  CORRECTION_REQUIRED: 'warning',
  USED: 'success',
  CANCELLED: 'destructive',
  EXPIRED: 'destructive',
}

export const TICKET_EVENT_LABEL = {
  TICKET_CREATED: 'Vale creado',
  FOLIO_ASSIGNED: 'Folio asignado',
  READY_FOR_EXIT: 'Listo para salida',
  VOUCHER_PRINTED: 'Vale impreso',
  VOUCHER_REPRINTED: 'Vale reimpreso',
  TARE_RECORDED: 'Tara registrada',
  GROSS_RECORDED: 'Peso bruto registrado',
  AUXILIARY_WEIGHT_RECORDED: 'Peso auxiliar registrado',
  WEIGHING_CORRECTED: 'Pesaje corregido',
  WEIGHING_EXCEPTION_AUTHORIZED: 'Excepción de pesaje autorizada',
  QR_SCANNED_EXIT_GATE: 'QR escaneado en la pluma',
  EXIT_APPROVED: 'Salida aprobada',
  EXIT_REJECTED: 'Salida rechazada',
  GUARD_NOTIFICATION_RECORDED: 'Notificación al guardia registrada',
  TICKET_CANCELLED: 'Vale cancelado',
}

export const COMMUNICATION_METHODS = [
  { value: 'RADIO', label: 'Radio' },
  { value: 'PHONE', label: 'Teléfono' },
  { value: 'IN_PERSON', label: 'En persona' },
  { value: 'OTHER', label: 'Otro' },
]

export function buildReadiness(setup) {
  const activeSites = (setup.sites ?? []).filter((item) => item.enabled)
  const activeStations = (setup.stations ?? []).filter((item) => item.enabled)
  const activeMaterials = (setup.materials ?? []).filter((item) => item.enabled)
  const activeAssignments = (setup.assignments ?? []).filter((item) => item.enabled)
  const activeSeries = (setup.series ?? []).filter((item) => item.enabled)

  return [
    { key: 'site', label: 'Sitio operativo', ready: activeSites.length > 0, resource: 'sites', intent: 'create', icon: Building2 },
    { key: 'sales', label: 'Punto de venta', ready: activeStations.some((item) => item.station_type === 'SALES'), resource: 'stations', intent: 'SALES', icon: Container },
    { key: 'scale', label: 'Estación de báscula', ready: activeStations.some((item) => item.station_type === 'SCALE'), resource: 'stations', intent: 'SCALE', icon: Scale },
    { key: 'material', label: 'Material despachable', ready: activeMaterials.length > 0, resource: 'materials', intent: 'create', icon: PackageOpen },
    { key: 'operator', label: 'Operadora responsable', ready: activeAssignments.some((item) => item.assignment_type !== 'GUARD'), resource: 'assignments', intent: 'create', icon: ShieldCheck },
    { key: 'scaleSeries', label: 'Folios con báscula', ready: activeSeries.some((item) => item.voucher_type === 'SCALE'), resource: 'series', intent: 'SCALE', icon: Hash },
    { key: 'volumeSeries', label: 'Folios por volumen', ready: activeSeries.some((item) => item.voucher_type === 'VOLUME'), resource: 'series', intent: 'VOLUME', icon: Hash },
  ]
}
