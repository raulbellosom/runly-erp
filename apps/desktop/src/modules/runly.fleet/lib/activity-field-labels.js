// Maps the flat field keys fleet-service.js's updateVehicle() puts in its
// before/after audit snapshots (see toFleetVehicleSnapshot there) to a
// display label and value type, so ActivityTimeline's expandable diff rows
// read like the rest of the UI instead of raw field keys/values. Mirrors
// apps/desktop/src/modules/runly.inventory/lib/activity-field-labels.js.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Activo' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'maintenance', label: 'En mantenimiento' },
  { value: 'retired', label: 'Retirado' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'disabled', label: 'Desactivado' },
]

export const FLEET_VEHICLE_ACTIVITY_FIELD_LABELS = {
  plate: { label: 'Matrícula', type: 'text' },
  vehicle_brand_name: { label: 'Marca', type: 'text' },
  vehicle_model_name: { label: 'Modelo', type: 'text' },
  vehicle_type_name: { label: 'Tipo', type: 'text' },
  year: { label: 'Año', type: 'text' },
  color: { label: 'Color', type: 'text' },
  status: { label: 'Estado', type: 'select', options: STATUS_OPTIONS },
  driver_name: { label: 'Conductor asignado', type: 'text' },
  economic_group_number: { label: 'Número económico (grupo)', type: 'text' },
  economic_individual_number: { label: 'Número económico (individual)', type: 'text' },
  notes: { label: 'Observaciones', type: 'markdown' },
  is_financed: { label: 'Financiado', type: 'text' },
  financing_institution: { label: 'Institución financiera', type: 'text' },
  financing_contract_number: { label: 'Número de contrato', type: 'text' },
  financing_start_date: { label: 'Inicio de financiamiento', type: 'date' },
  financing_end_date: { label: 'Fin de financiamiento', type: 'date' },
  financing_monthly_payment: { label: 'Pago mensual', type: 'currency' },
  financing_notes: { label: 'Notas de financiamiento', type: 'markdown' },
}
