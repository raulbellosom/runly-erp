// Maps the flat field keys hr-service.js's updateEmployee() already sends as
// before/after (a plain prisma.hrEmployee row, no relation resolution needed
// — HrEmployee's editable scalar fields are already human-readable) to a
// display label and value type, so ActivityTimeline's expandable diff rows
// read like the rest of the UI. Mirrors runly.inventory/runly.fleet's own
// activity-field-labels.js. Relation-id fields (departmentId, jobTitleId,
// supervisorEmployeeId, userProfileId, profileImageFileId) are intentionally
// left out — hr-service.js doesn't resolve them to names before logging, so
// diffing them would show raw UUIDs; they fall back to their raw field key
// if ActivityTimeline ever renders one (see the free-text department/jobTitle
// fields below, which cover the common edit case instead).
const STATUS_OPTIONS = [
  { value: 'active', label: 'Activo' },
  { value: 'vacation', label: 'Vacaciones' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'terminated', label: 'Baja' },
]

export const HR_EMPLOYEE_ACTIVITY_FIELD_LABELS = {
  employeeCode: { label: 'Código de colaborador', type: 'text' },
  firstName: { label: 'Nombre', type: 'text' },
  lastName: { label: 'Apellido', type: 'text' },
  workEmail: { label: 'Correo laboral', type: 'text' },
  personalEmail: { label: 'Correo personal', type: 'text' },
  phone: { label: 'Teléfono', type: 'text' },
  emergencyContactName: { label: 'Contacto de emergencia', type: 'text' },
  emergencyContactPhone: { label: 'Teléfono de emergencia', type: 'text' },
  jobTitle: { label: 'Puesto', type: 'text' },
  department: { label: 'Departamento', type: 'text' },
  managerName: { label: 'Jefe directo', type: 'text' },
  employmentType: { label: 'Tipo de contrato', type: 'text' },
  workLocation: { label: 'Ubicación de trabajo', type: 'text' },
  hireDate: { label: 'Fecha de ingreso', type: 'date' },
  terminationDate: { label: 'Fecha de baja', type: 'date' },
  status: { label: 'Estado', type: 'select', options: STATUS_OPTIONS },
  notesMarkdown: { label: 'Notas', type: 'markdown' },
}
