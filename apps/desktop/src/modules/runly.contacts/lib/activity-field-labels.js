// Contact field labels for the audit trail's diff rows (AuditTrail changeLabels).
export const CONTACT_ACTIVITY_FIELD_LABELS = {
  type: { label: 'Tipo', type: 'select', options: [{ value: 'customer', label: 'Cliente' }, { value: 'supplier', label: 'Proveedor' }, { value: 'person', label: 'Persona' }, { value: 'company', label: 'Empresa' }] },
  name: { label: 'Nombre' },
  legalName: { label: 'Razón social' },
  email: { label: 'Correo' },
  phone: { label: 'Teléfono' },
  taxId: { label: 'RFC' },
  notesMarkdown: { label: 'Notas' },
  website: { label: 'Sitio web' },
  industry: { label: 'Giro' },
  tags: { label: 'Etiquetas' },
  taxRegime: { label: 'Régimen fiscal' },
  fiscalPostalCode: { label: 'Código postal fiscal' },
  cfdiUse: { label: 'Uso de CFDI' },
}
