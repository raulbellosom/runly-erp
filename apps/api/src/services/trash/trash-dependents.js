// What references a deactivated record (spec 2026-10-04-trash-retention-conflicts §6).
// Reads the database's own foreign keys, so it covers core tables, Builder
// relations and Connections alike:
//   cascade     rows deleted together with the record (ON DELETE CASCADE)
//   setNull     references the database clears by itself (ON DELETE SET NULL)
//   unlinkable  nullable references with restrict/no action: Runly may clear them
//   blocking    required references, or a Connections "Impedir la eliminación" lock
const IDENT = /^[a-z_][a-z0-9_]*$/
const CONNECTION_PREFIX = 'conn_'

const CORE_LABELS = {
  inv_item: 'Artículos de inventario', inv_assignment: 'Asignaciones de inventario', contact: 'Contactos',
  hr_employee: 'Colaboradores', calendar_event: 'Eventos', fleet_vehicle: 'Vehículos', fleet_driver: 'Conductores',
  document_template: 'Plantillas', generated_document: 'Documentos generados', file_asset: 'Archivos',
  project: 'Proyectos', task: 'Tareas', canvas_board: 'Tableros', purchase_order: 'Órdenes de compra',
  canvas_page: 'Páginas del Board', canvas_object: 'Elementos del Board', canvas_hotspot: 'Hotspots', canvas_collaborator: 'Personas con acceso al Board',
  entity_comment: 'Comentarios', calendar_attendee: 'Invitados', inv_item_file: 'Archivos del artículo', connection_record: 'Índice de Conexiones',
}

export function classifyForeignKey({ name, action, nullable }) {
  if (action === 'c') return 'cascade'
  if (action === 'n' || action === 'd') return 'setNull'
  if (String(name).startsWith(CONNECTION_PREFIX)) return 'blocking'
  return nullable ? 'unlinkable' : 'blocking'
}

export async function findDependents(db, { table, id }) {
  const groups = { cascade: [], setNull: [], unlinkable: [], blocking: [] }
  if (!IDENT.test(table ?? '')) return groups
  const fks = await db.$queryRawUnsafe(
    `SELECT con.conname::text AS name, src.relname::text AS "table", att.attname::text AS "column", NOT att.attnotnull AS nullable, con.confdeltype::text AS action
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN pg_namespace ns ON ns.oid = tgt.relnamespace
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND ns.nspname = 'public' AND tgt.relname = $1 AND array_length(con.conkey, 1) = 1`,
    table,
  )
  const labels = await labelsFor(db, fks.map((fk) => fk.table))
  for (const fk of fks) {
    if (!IDENT.test(fk.table) || !IDENT.test(fk.column)) continue
    const [{ count }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${fk.table}" WHERE "${fk.column}"::text = $1`, String(id))
    if (!count) continue
    // ::text casts above: the Prisma pg adapter cannot read Postgres' internal "char"/name types.
    const action = String(fk.action)
    groups[classifyForeignKey({ name: fk.name, action, nullable: fk.nullable })].push({
      table: fk.table, column: fk.column, count, constraint: fk.name, label: labels.get(fk.table) ?? fk.table,
      connection: String(fk.name).startsWith(CONNECTION_PREFIX),
    })
  }
  return groups
}

async function labelsFor(db, tables) {
  const map = new Map(Object.entries(CORE_LABELS))
  const wanted = [...new Set(tables)].filter((table) => !map.has(table))
  if (wanted.length && db.runlyModel?.findMany) {
    const rows = await db.runlyModel.findMany({ where: { tableName: { in: wanted } }, select: { tableName: true, label: true, pluralLabel: true, moduleKey: true } }).catch(() => [])
    const modules = rows.length && db.runlyModule?.findMany
      ? new Map((await db.runlyModule.findMany({ where: { key: { in: rows.map((row) => row.moduleKey) } }, select: { key: true, name: true } }).catch(() => [])).map((mod) => [mod.key, mod.name]))
      : new Map()
    for (const row of rows) map.set(row.tableName, `${row.pluralLabel ?? row.label}${modules.get(row.moduleKey) ? ` (${modules.get(row.moduleKey)})` : ''}`)
  }
  return map
}

// Clears the unlinkable references (same transaction as the delete).
export async function unlinkDependents(db, { dependents, id }) {
  let cleared = 0
  for (const dep of dependents.unlinkable) {
    if (!IDENT.test(dep.table) || !IDENT.test(dep.column)) continue
    cleared += Number(await db.$executeRawUnsafe(`UPDATE "${dep.table}" SET "${dep.column}" = NULL WHERE "${dep.column}"::text = $1`, String(id)))
  }
  return cleared
}

export function describeBlocking(dependents) {
  return dependents.blocking.map((dep) => `${dep.count} en ${dep.label}${dep.connection ? ' (Impedir la eliminación)' : ''}`).join(', ')
}
