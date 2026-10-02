import { CanvasServiceError, validateCanvasObject } from './canvas-service.js'
import { canvasFileWhere } from './canvas-files.js'

const SCOPES = new Set(['PERSONAL', 'COMPANY'])
const SOURCES = new Set(['custom', 'excalidraw', 'svg', 'mixed'])
const ITEM_KINDS = new Set(['objects', 'image'])
const MAX_ITEMS_PER_LIBRARY = 500
const MAX_OBJECTS_PER_ITEM = 300
const MAX_PAYLOAD_BYTES = 1024 * 1024

function cleanText(value, max = 300) {
  if (value == null) return null
  const text = String(value).trim().slice(0, max)
  return text || null
}

function jsonValue(value) {
  if (value == null) return null
  return JSON.parse(JSON.stringify(value))
}

// Personal/company libraries of reusable Canvas elements (spec:
// docs/superpowers/specs/2026-10-02-canvas-libraries-design.md). Mirrors the
// access and audit conventions of canvas-service.js, kept in its own file so
// neither module grows past the 800-line soft limit.
export function createCanvasLibrariesService({ prisma }) {
  async function audit(db, { companyId, actorId, action, entityType, entityId, before = null, after = null, metadata = null }) {
    return db.auditLog.create({ data: { companyId, actorId, moduleKey: 'runly.canvas', action, entityType, entityId, before: jsonValue(before), after: jsonValue(after), metadata: jsonValue(metadata) } })
  }

  // A personal library of another user is reported as not found (never
  // "forbidden") so its existence is not leaked across accounts.
  async function loadLibrary(companyId, actorId, libraryId, db = prisma) {
    if (!companyId || !actorId || !libraryId) throw new CanvasServiceError('Biblioteca no encontrada.', 404)
    const library = await db.canvasLibrary.findFirst({ where: { id: libraryId, companyId } })
    if (!library) throw new CanvasServiceError('Biblioteca no encontrada.', 404)
    if (library.scope === 'PERSONAL' && library.ownerId !== actorId) throw new CanvasServiceError('Biblioteca no encontrada.', 404)
    return library
  }

  function canEditLibrary(library, actorId, canManage) {
    return library.scope === 'COMPANY' ? Boolean(canManage) : library.ownerId === actorId
  }

  function assertCanEdit(library, actorId, canManage) {
    if (!canEditLibrary(library, actorId, canManage)) throw new CanvasServiceError('No tienes permisos para editar esta biblioteca.', 403)
  }

  function validateScope(scope, canManage, message) {
    if (!SCOPES.has(scope)) throw new CanvasServiceError('Alcance de biblioteca no soportado.', 400)
    if (scope === 'COMPANY' && !canManage) throw new CanvasServiceError(message, 403)
  }

  // Personal-owned libraries of the caller plus every company library (the
  // UI badges each row Empresa/Personal and gates its menu with `canEdit`).
  async function list(companyId, actorId, { canManage = false } = {}) {
    const rows = await prisma.canvasLibrary.findMany({
      where: { companyId, OR: [{ scope: 'COMPANY' }, { scope: 'PERSONAL', ownerId: actorId }] },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(({ _count, ...library }) => ({ ...library, itemCount: _count.items, canEdit: canEditLibrary(library, actorId, canManage) }))
  }

  async function items(companyId, actorId, libraryId) {
    await loadLibrary(companyId, actorId, libraryId)
    return prisma.canvasLibraryItem.findMany({ where: { libraryId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
  }

  async function create(companyId, actorId, data, { canManage = false } = {}) {
    const name = cleanText(data?.name, 200)
    if (!name) throw new CanvasServiceError('El nombre de la biblioteca es requerido.', 400)
    const scope = data?.scope ?? 'PERSONAL'
    validateScope(scope, canManage, 'No tienes permisos para crear bibliotecas de empresa.')
    const source = SOURCES.has(data?.source) ? data.source : 'custom'
    const library = await prisma.canvasLibrary.create({ data: { companyId, ownerId: actorId, name, scope, source } })
    await audit(prisma, { companyId, actorId, action: 'LIBRARY_CREATED', entityType: 'CanvasLibrary', entityId: library.id, after: library })
    return library
  }

  async function update(companyId, actorId, libraryId, data, { canManage = false } = {}) {
    const library = await loadLibrary(companyId, actorId, libraryId)
    assertCanEdit(library, actorId, canManage)
    const patch = {}
    if (data.name !== undefined) {
      patch.name = cleanText(data.name, 200)
      if (!patch.name) throw new CanvasServiceError('El nombre de la biblioteca es requerido.', 400)
    }
    if (data.scope !== undefined) {
      validateScope(data.scope, canManage, 'No tienes permisos para mover esta biblioteca a la empresa.')
      patch.scope = data.scope
    }
    const updated = await prisma.canvasLibrary.update({ where: { id: libraryId }, data: patch })
    await audit(prisma, { companyId, actorId, action: 'LIBRARY_UPDATED', entityType: 'CanvasLibrary', entityId: libraryId, before: library, after: updated })
    return updated
  }

  async function remove(companyId, actorId, libraryId, { canManage = false } = {}) {
    const library = await loadLibrary(companyId, actorId, libraryId)
    assertCanEdit(library, actorId, canManage)
    return prisma.$transaction(async (tx) => {
      const imageItems = await tx.canvasLibraryItem.findMany({ where: { libraryId, kind: 'image', fileAssetId: { not: null } }, select: { fileAssetId: true } })
      await tx.canvasLibrary.delete({ where: { id: libraryId } })
      const fileIds = imageItems.map((item) => item.fileAssetId)
      if (fileIds.length) await tx.fileAsset.updateMany({ where: { id: { in: fileIds } }, data: { enabled: false } })
      await audit(tx, { companyId, actorId, action: 'LIBRARY_DELETED', entityType: 'CanvasLibrary', entityId: libraryId, before: library })
    })
  }

  async function buildItemData(companyId, libraryId, actorId, item) {
    const name = cleanText(item?.name, 200) ?? 'Elemento'
    const kind = item?.kind
    if (!ITEM_KINDS.has(kind)) throw new CanvasServiceError('Tipo de elemento no soportado.', 400)
    const data = { libraryId, name, kind, createdById: actorId, width: item?.width ?? null, height: item?.height ?? null }
    if (kind === 'objects') {
      const objects = item?.payload?.objects
      if (!Array.isArray(objects) || objects.length < 1 || objects.length > MAX_OBJECTS_PER_ITEM) {
        throw new CanvasServiceError('El elemento debe tener entre 1 y 300 objetos.', 400)
      }
      for (const object of objects) validateCanvasObject(object)
      const payload = jsonValue({ objects, width: item.payload.width ?? null, height: item.payload.height ?? null })
      if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) throw new CanvasServiceError('El elemento supera el tamaño máximo permitido.', 400)
      data.payload = payload
    } else {
      const fileAssetId = item?.fileAssetId
      if (!fileAssetId) throw new CanvasServiceError('El elemento de imagen requiere un archivo.', 400)
      // Only an enabled file uploaded for this exact library (Files keeps the
      // library id in metadata.sourceEntityId; entityId is the company).
      const file = await prisma.fileAsset.findFirst({ where: { id: fileAssetId, ...canvasFileWhere(companyId, 'CanvasLibrary', libraryId) }, select: { id: true } })
      if (!file) throw new CanvasServiceError('Archivo no encontrado para esta biblioteca.', 400)
      data.fileAssetId = fileAssetId
    }
    return data
  }

  async function addItems(companyId, actorId, libraryId, inputItems, { canManage = false } = {}) {
    const library = await loadLibrary(companyId, actorId, libraryId)
    assertCanEdit(library, actorId, canManage)
    if (!Array.isArray(inputItems) || inputItems.length < 1 || inputItems.length > MAX_ITEMS_PER_LIBRARY) {
      throw new CanvasServiceError('Se admiten entre 1 y 500 elementos por petición.', 400)
    }
    const existingCount = await prisma.canvasLibraryItem.count({ where: { libraryId } })
    if (existingCount + inputItems.length > MAX_ITEMS_PER_LIBRARY) throw new CanvasServiceError('La biblioteca no puede superar 500 elementos.', 400)
    const rows = []
    for (const item of inputItems) rows.push(await buildItemData(companyId, libraryId, actorId, item))
    return prisma.$transaction(async (tx) => {
      const created = []
      for (let index = 0; index < rows.length; index += 1) {
        created.push(await tx.canvasLibraryItem.create({ data: { ...rows[index], position: existingCount + index } }))
      }
      await audit(tx, { companyId, actorId, action: 'LIBRARY_ITEMS_ADDED', entityType: 'CanvasLibrary', entityId: libraryId, metadata: { count: created.length } })
      return created
    })
  }

  async function renameItem(companyId, actorId, libraryId, itemId, data, { canManage = false } = {}) {
    const library = await loadLibrary(companyId, actorId, libraryId)
    assertCanEdit(library, actorId, canManage)
    const name = cleanText(data?.name, 200)
    if (!name) throw new CanvasServiceError('El nombre del elemento es requerido.', 400)
    const item = await prisma.canvasLibraryItem.findFirst({ where: { id: itemId, libraryId } })
    if (!item) throw new CanvasServiceError('Elemento no encontrado.', 404)
    return prisma.canvasLibraryItem.update({ where: { id: itemId }, data: { name } })
  }

  async function removeItem(companyId, actorId, libraryId, itemId, { canManage = false } = {}) {
    const library = await loadLibrary(companyId, actorId, libraryId)
    assertCanEdit(library, actorId, canManage)
    const item = await prisma.canvasLibraryItem.findFirst({ where: { id: itemId, libraryId } })
    if (!item) throw new CanvasServiceError('Elemento no encontrado.', 404)
    await prisma.canvasLibraryItem.delete({ where: { id: itemId } })
    if (item.kind === 'image' && item.fileAssetId) await prisma.fileAsset.updateMany({ where: { id: item.fileAssetId }, data: { enabled: false } })
  }

  return { list, items, create, update, remove, addItems, renameItem, removeItem }
}
