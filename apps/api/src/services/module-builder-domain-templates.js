// Domain starter templates for "Crear módulo" (spec
// 2026-10-03-rme3-module-platform-v2 §5 goal 9, plan Task 5.1): ready-to-publish
// definitions with relations to system entities, a Kanban by status and a
// dashboard, so a user can start from something real instead of a blank
// entity. Same shape as module-builder-templates.js factories.

const opt = (value, label) => ({ value, label })

function kanban(slug, entity, title, card) {
  return { key: `${slug}.${entity}.kanban`, kind: 'KANBAN', entity, title, groupBy: 'estado', card }
}

function dashboard(slug, title, entity, plural) {
  return {
    key: `${slug}.dashboard`,
    kind: 'DASHBOARD',
    title,
    widgets: [
      { key: 'total', type: 'stat', title: `Total de ${plural}`, source: { entity, aggregate: 'count' } },
      { key: 'por_estado', type: 'chart', chart: 'bar', title: 'Por estado', source: { entity, aggregate: 'count', groupBy: 'estado' } },
    ],
  }
}

export function visitsTemplate(meta, base) {
  const slug = meta.moduleKey.split('.').pop()
  return {
    ...base({ ...meta, icon: meta.icon ?? 'MapPin' }),
    entities: [{
      key: 'visita', label: 'Visita', pluralLabel: 'Visitas', companyScoped: true, softDelete: true,
      fields: [
        { key: 'cliente', label: 'Cliente', type: 'relation', targetExternal: 'contact', required: true },
        { key: 'responsable', label: 'Responsable', type: 'relation', targetExternal: 'hr_employee' },
        { key: 'fecha', label: 'Fecha y hora', type: 'datetime', required: true },
        { key: 'motivo', label: 'Motivo', type: 'text', required: true },
        { key: 'estado', label: 'Estado', type: 'select', options: [opt('programada', 'Programada'), opt('realizada', 'Realizada'), opt('cancelada', 'Cancelada')], default: 'programada' },
        { key: 'resultado', label: 'Resultado', type: 'textarea' },
      ],
    }],
    views: [
      kanban(slug, 'visita', 'Visitas por estado', { titleField: 'motivo' }),
      dashboard(slug, meta.name, 'visita', 'visitas'),
    ],
  }
}

export function toolLoansTemplate(meta, base) {
  const slug = meta.moduleKey.split('.').pop()
  return {
    ...base({ ...meta, icon: meta.icon ?? 'Wrench' }),
    entities: [{
      key: 'prestamo', label: 'Préstamo', pluralLabel: 'Préstamos', companyScoped: true, softDelete: true,
      fields: [
        { key: 'herramienta', label: 'Herramienta', type: 'relation', targetExternal: 'inventory_item', required: true },
        { key: 'persona', label: 'Prestado a', type: 'relation', targetExternal: 'hr_employee', required: true },
        { key: 'fecha_salida', label: 'Fecha de salida', type: 'date', required: true },
        { key: 'fecha_devolucion', label: 'Devolución esperada', type: 'date' },
        { key: 'estado', label: 'Estado', type: 'select', options: [opt('prestado', 'Prestado'), opt('devuelto', 'Devuelto'), opt('perdido', 'Perdido')], default: 'prestado' },
        { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
      ],
    }],
    views: [
      kanban(slug, 'prestamo', 'Préstamos por estado', { titleField: 'observaciones' }),
      dashboard(slug, meta.name, 'prestamo', 'préstamos'),
    ],
    // Shows the loans inside each inventory item (Inventario > Conexiones to activate).
    connections: [{
      key: 'prestamo_herramienta', target: 'inventory_item', kind: 'related', entity: 'prestamo', targetField: 'herramienta',
      label: 'Préstamos', onTargetDelete: 'restrict',
      fields: [{ field: 'fecha_salida', detail: true }, { field: 'estado', detail: true }, { field: 'observaciones', detail: true, search: true }],
    }],
  }
}

export function maintenanceTemplate(meta, base) {
  const slug = meta.moduleKey.split('.').pop()
  return {
    ...base({ ...meta, icon: meta.icon ?? 'Settings' }),
    entities: [{
      key: 'orden', label: 'Orden de mantenimiento', pluralLabel: 'Órdenes de mantenimiento', companyScoped: true, softDelete: true,
      fields: [
        { key: 'titulo', label: 'Título', type: 'text', required: true },
        { key: 'equipo', label: 'Equipo', type: 'relation', targetExternal: 'inventory_item' },
        { key: 'tipo', label: 'Tipo', type: 'select', options: [opt('preventivo', 'Preventivo'), opt('correctivo', 'Correctivo')], default: 'preventivo' },
        { key: 'estado', label: 'Estado', type: 'select', options: [opt('abierta', 'Abierta'), opt('en_proceso', 'En proceso'), opt('cerrada', 'Cerrada')], default: 'abierta' },
        { key: 'fecha_programada', label: 'Fecha programada', type: 'date' },
        { key: 'costo', label: 'Costo', type: 'decimal' },
        { key: 'descripcion', label: 'Descripción', type: 'textarea' },
      ],
    }],
    views: [
      kanban(slug, 'orden', 'Órdenes por estado', { titleField: 'titulo', badgeField: 'tipo' }),
      dashboard(slug, meta.name, 'orden', 'órdenes'),
    ],
  }
}

export function requestsTemplate(meta, base) {
  const slug = meta.moduleKey.split('.').pop()
  return {
    ...base({ ...meta, icon: meta.icon ?? 'ClipboardList' }),
    entities: [{
      key: 'solicitud', label: 'Solicitud', pluralLabel: 'Solicitudes', companyScoped: true, softDelete: true,
      fields: [
        { key: 'titulo', label: 'Título', type: 'text', required: true },
        { key: 'solicitante', label: 'Solicitante', type: 'relation', targetExternal: 'hr_employee' },
        { key: 'prioridad', label: 'Prioridad', type: 'select', options: [opt('baja', 'Baja'), opt('media', 'Media'), opt('alta', 'Alta')], default: 'media' },
        { key: 'estado', label: 'Estado', type: 'select', options: [opt('nueva', 'Nueva'), opt('en_revision', 'En revisión'), opt('aprobada', 'Aprobada'), opt('rechazada', 'Rechazada')], default: 'nueva' },
        { key: 'detalle', label: 'Detalle', type: 'markdown' },
      ],
    }],
    views: [
      kanban(slug, 'solicitud', 'Solicitudes por estado', { titleField: 'titulo', badgeField: 'prioridad' }),
      dashboard(slug, meta.name, 'solicitud', 'solicitudes'),
    ],
  }
}
