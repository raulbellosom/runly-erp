import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'respuestas',
  name: 'encuestas.respuesta',
  label: 'Respuesta',
  tableName: 'encuestas_respuestas',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'encuesta_id', type: 'text', label: 'Encuesta', required: true },
    { name: 'respondente_nombre', type: 'text', label: 'Nombre' },
    { name: 'respondente_correo', type: 'text', label: 'Correo electrónico' },
    { name: 'respondente_user_id', type: 'text', label: 'Usuario de Identity' },
    { name: 'respondente_user_nombre', type: 'text', label: 'Nombre en Identity' },
    { name: 'respondente_user_correo', type: 'text', label: 'Correo en Identity' },
    { name: 'respondente_empleado_id', type: 'text', label: 'Colaborador de RR. HH.' },
    { name: 'respondente_empleado_nombre', type: 'text', label: 'Nombre del colaborador' },
    { name: 'items_asignados_json', type: 'text', label: 'Inventario asignado al responder' },
    { name: 'items_asignados_total', type: 'number', label: 'Total de artículos asignados' },
    { name: 'respuestas_json', type: 'text', label: 'Respuestas', required: true },
    { name: 'enviado_en', type: 'text', label: 'Enviado en', required: true },
  ],
  indexes: [
    { fields: ['company_id', 'encuesta_id'], unique: false },
  ],
})
