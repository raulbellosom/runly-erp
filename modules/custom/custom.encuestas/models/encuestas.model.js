import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'encuestas',
  name: 'encuestas.encuesta',
  label: 'Encuesta',
  tableName: 'encuestas_encuestas',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'titulo', type: 'text', label: 'Título', required: true },
    { name: 'descripcion', type: 'text', label: 'Descripción' },
    { name: 'estado', type: 'text', label: 'Estado', required: true },
    { name: 'anonima', type: 'boolean', label: 'Encuesta anónima' },
    { name: 'solicitar_contacto', type: 'boolean', label: 'Solicitar datos de contacto' },
    { name: 'capturar_contexto_inventario', type: 'boolean', label: 'Capturar identidad e inventario asignado' },
    { name: 'fecha_inicio', type: 'text', label: 'Fecha de inicio' },
    { name: 'fecha_cierre', type: 'text', label: 'Fecha de cierre' },
    { name: 'mensaje_final', type: 'text', label: 'Mensaje final' },
  ],
  indexes: [
    { fields: ['company_id', 'titulo'], unique: false },
    { fields: ['company_id', 'estado'], unique: false },
  ],
})
