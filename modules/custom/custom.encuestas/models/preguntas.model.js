import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'preguntas',
  name: 'encuestas.pregunta',
  label: 'Pregunta',
  tableName: 'encuestas_preguntas',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'encuesta_id', type: 'text', label: 'Encuesta', required: true },
    { name: 'texto', type: 'text', label: 'Pregunta', required: true },
    { name: 'tipo', type: 'text', label: 'Tipo de respuesta', required: true },
    { name: 'obligatoria', type: 'boolean', label: 'Obligatoria' },
    { name: 'opciones_json', type: 'text', label: 'Opciones' },
    { name: 'posicion', type: 'number', label: 'Posición' },
    { name: 'ayuda', type: 'text', label: 'Texto de ayuda' },
  ],
  indexes: [
    { fields: ['company_id', 'encuesta_id'], unique: false },
    { fields: ['company_id', 'encuesta_id', 'posicion'], unique: false },
  ],
})
