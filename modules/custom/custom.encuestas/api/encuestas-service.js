import {
  EncuestasServiceError, toScopedCompanyUuid, normalizeRecordId, normalizePagination,
  normalizeSearch, firstRow, toCount, parseJson, jsonText, withDbErrorMapping,
} from './service-helpers.js'

const MODULE_KEY = 'custom.encuestas'

function mapPregunta(row) {
  if (!row) return row
  return { ...row, opciones: parseJson(row.opciones_json, []) }
}

function mapRespuesta(row) {
  if (!row) return row
  return { ...row, respuestas: parseJson(row.respuestas_json, {}), items_asignados: parseJson(row.items_asignados_json, []) }
}

async function audit(prisma, { actorId, entityType, entityId, action, before = null, after = null }) {
  await prisma.auditLog.create({
    data: { actorId: actorId ?? null, moduleKey: MODULE_KEY, entityType, entityId: entityId ?? null, action, before, after },
  })
}

export function createEncuestasService({ prisma }) {
  async function listEncuestas({ companyId, page, pageSize, search, estado }) {
    const cid = toScopedCompanyUuid(companyId)
    const p = normalizePagination({ page, pageSize })
    const q = normalizeSearch(search)
    const like = q ? `%${q}%` : null
    const safeEstado = typeof estado === 'string' && estado.trim() ? estado.trim() : null
    return withDbErrorMapping(async () => {
      const rows = await prisma.$queryRaw`
        SELECT e.*,
          (SELECT COUNT(*)::int FROM encuestas_preguntas p
            WHERE p.company_id = e.company_id AND p.encuesta_id = e.id::text AND p.enabled = true) AS preguntas_total,
          (SELECT COUNT(*)::int FROM encuestas_respuestas r
            WHERE r.company_id = e.company_id AND r.encuesta_id = e.id::text AND r.enabled = true) AS respuestas_total
        FROM encuestas_encuestas e
        WHERE e.company_id = ${cid}
          AND e.enabled = true
          AND (${safeEstado}::text IS NULL OR e.estado = ${safeEstado})
          AND (${like}::text IS NULL OR e.titulo ILIKE ${like} OR COALESCE(e.descripcion, '') ILIKE ${like})
        ORDER BY e.updated_at DESC
        LIMIT ${p.pageSize} OFFSET ${p.offset}
      `
      const totals = await prisma.$queryRaw`
        SELECT COUNT(*)::bigint AS total
        FROM encuestas_encuestas e
        WHERE e.company_id = ${cid}
          AND e.enabled = true
          AND (${safeEstado}::text IS NULL OR e.estado = ${safeEstado})
          AND (${like}::text IS NULL OR e.titulo ILIKE ${like} OR COALESCE(e.descripcion, '') ILIKE ${like})
      `
      return { data: rows, pagination: { page: p.page, pageSize: p.pageSize, total: toCount(firstRow(totals)?.total) } }
    })
  }

  async function getEncuesta({ companyId, id }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(id, 'Encuesta no encontrada.')
    const row = await withDbErrorMapping(async () => firstRow(await prisma.$queryRaw`
      SELECT e.*,
        (SELECT COUNT(*)::int FROM encuestas_preguntas p WHERE p.company_id=e.company_id AND p.encuesta_id=e.id::text AND p.enabled=true) AS preguntas_total,
        (SELECT COUNT(*)::int FROM encuestas_respuestas r WHERE r.company_id=e.company_id AND r.encuesta_id=e.id::text AND r.enabled=true) AS respuestas_total
      FROM encuestas_encuestas e
      WHERE e.id=${sid} AND e.company_id=${cid} AND e.enabled=true
      LIMIT 1
    `))
    if (!row) throw new EncuestasServiceError('Encuesta no encontrada.', 404)
    return row
  }

  async function createEncuesta({ companyId, data, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    const row = await withDbErrorMapping(async () => firstRow(await prisma.$queryRaw`
      INSERT INTO encuestas_encuestas
        (company_id, titulo, descripcion, estado, anonima, solicitar_contacto, capturar_contexto_inventario, fecha_inicio, fecha_cierre, mensaje_final)
      VALUES
        (${cid}, ${data.titulo}, ${data.descripcion ?? null}, ${data.estado ?? 'borrador'}, ${Boolean(data.anonima)},
         ${Boolean(data.solicitar_contacto)}, ${Boolean(data.capturar_contexto_inventario)}, ${data.fecha_inicio ?? null}, ${data.fecha_cierre ?? null},
         ${data.mensaje_final ?? 'Gracias por responder esta encuesta.'})
      RETURNING *
    `))
    await audit(prisma, { actorId, entityType: 'Encuesta', entityId: row.id, action: 'encuesta.create', after: row })
    return row
  }

  async function updateEncuesta({ companyId, id, data, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(id, 'Encuesta no encontrada.')
    const before = await getEncuesta({ companyId: cid, id: sid })
    const next = {
      titulo: data.titulo ?? before.titulo,
      descripcion: data.descripcion !== undefined ? data.descripcion : before.descripcion,
      estado: data.estado ?? before.estado,
      anonima: data.anonima !== undefined ? data.anonima : before.anonima,
      solicitar_contacto: data.solicitar_contacto !== undefined ? data.solicitar_contacto : before.solicitar_contacto,
      capturar_contexto_inventario: data.capturar_contexto_inventario !== undefined ? data.capturar_contexto_inventario : before.capturar_contexto_inventario,
      fecha_inicio: data.fecha_inicio !== undefined ? data.fecha_inicio : before.fecha_inicio,
      fecha_cierre: data.fecha_cierre !== undefined ? data.fecha_cierre : before.fecha_cierre,
      mensaje_final: data.mensaje_final !== undefined ? data.mensaje_final : before.mensaje_final,
    }
    const row = await withDbErrorMapping(async () => firstRow(await prisma.$queryRaw`
      UPDATE encuestas_encuestas SET
        titulo=${next.titulo}, descripcion=${next.descripcion}, estado=${next.estado},
        anonima=${Boolean(next.anonima)}, solicitar_contacto=${Boolean(next.solicitar_contacto)},
        capturar_contexto_inventario=${Boolean(next.capturar_contexto_inventario)},
        fecha_inicio=${next.fecha_inicio}, fecha_cierre=${next.fecha_cierre}, mensaje_final=${next.mensaje_final},
        updated_at=now()
      WHERE id=${sid} AND company_id=${cid} AND enabled=true
      RETURNING *
    `))
    if (!row) throw new EncuestasServiceError('Encuesta no encontrada.', 404)
    await audit(prisma, { actorId, entityType: 'Encuesta', entityId: row.id, action: 'encuesta.update', before, after: row })
    return row
  }

  async function setEncuestaEstado({ companyId, id, estado, actorId }) {
    const before = await getEncuesta({ companyId, id })
    if (estado === 'publicada') {
      const preguntas = await listPreguntas({ companyId, encuestaId: id })
      if (!preguntas.length) throw new EncuestasServiceError('Agrega al menos una pregunta antes de publicar.', 400)
    }
    const row = await updateEncuesta({ companyId, id, data: { estado }, actorId })
    return { ...row, estado_anterior: before.estado }
  }

  async function disableEncuesta({ companyId, id, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(id, 'Encuesta no encontrada.')
    const before = await getEncuesta({ companyId: cid, id: sid })
    const row = firstRow(await prisma.$queryRaw`
      UPDATE encuestas_encuestas SET enabled=false, updated_at=now()
      WHERE id=${sid} AND company_id=${cid} RETURNING *
    `)
    if (!row) throw new EncuestasServiceError('Encuesta no encontrada.', 404)
    await audit(prisma, { actorId, entityType: 'Encuesta', entityId: row.id, action: 'encuesta.disable', before, after: row })
    return row
  }

  async function listPreguntas({ companyId, encuestaId }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(encuestaId, 'Encuesta no encontrada.')
    await getEncuesta({ companyId: cid, id: sid })
    const rows = await withDbErrorMapping(async () => prisma.$queryRaw`
      SELECT * FROM encuestas_preguntas
      WHERE company_id=${cid} AND encuesta_id=${sid} AND enabled=true
      ORDER BY posicion ASC, created_at ASC
    `)
    return rows.map(mapPregunta)
  }

  async function createPregunta({ companyId, encuestaId, data, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(encuestaId, 'Encuesta no encontrada.')
    await getEncuesta({ companyId: cid, id: sid })
    const current = await prisma.$queryRaw`
      SELECT COALESCE(MAX(posicion), 0)::int AS max_pos
      FROM encuestas_preguntas WHERE company_id=${cid} AND encuesta_id=${sid} AND enabled=true
    `
    const position = data.posicion ?? (Number(firstRow(current)?.max_pos ?? 0) + 1)
    const options = ['opcion_unica', 'opcion_multiple'].includes(data.tipo) ? (data.opciones ?? []) : []
    const row = mapPregunta(firstRow(await prisma.$queryRaw`
      INSERT INTO encuestas_preguntas
        (company_id, encuesta_id, texto, tipo, obligatoria, opciones_json, posicion, ayuda)
      VALUES
        (${cid}, ${sid}, ${data.texto}, ${data.tipo}, ${Boolean(data.obligatoria)}, ${jsonText(options)}, ${position}, ${data.ayuda ?? null})
      RETURNING *
    `))
    await audit(prisma, { actorId, entityType: 'Pregunta', entityId: row.id, action: 'pregunta.create', after: row })
    return row
  }

  async function updatePregunta({ companyId, encuestaId, preguntaId, data, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(encuestaId, 'Encuesta no encontrada.')
    const qid = normalizeRecordId(preguntaId, 'Pregunta no encontrada.')
    const before = mapPregunta(firstRow(await prisma.$queryRaw`
      SELECT * FROM encuestas_preguntas
      WHERE id=${qid} AND company_id=${cid} AND encuesta_id=${sid} AND enabled=true LIMIT 1
    `))
    if (!before) throw new EncuestasServiceError('Pregunta no encontrada.', 404)
    const nextTipo = data.tipo ?? before.tipo
    const nextOptions = ['opcion_unica', 'opcion_multiple'].includes(nextTipo)
      ? (data.opciones ?? before.opciones ?? [])
      : []
    const row = mapPregunta(firstRow(await prisma.$queryRaw`
      UPDATE encuestas_preguntas SET
        texto=${data.texto ?? before.texto},
        tipo=${nextTipo},
        obligatoria=${data.obligatoria !== undefined ? Boolean(data.obligatoria) : Boolean(before.obligatoria)},
        opciones_json=${jsonText(nextOptions)},
        posicion=${data.posicion ?? before.posicion},
        ayuda=${data.ayuda !== undefined ? data.ayuda : before.ayuda},
        updated_at=now()
      WHERE id=${qid} AND company_id=${cid} AND encuesta_id=${sid} AND enabled=true
      RETURNING *
    `))
    await audit(prisma, { actorId, entityType: 'Pregunta', entityId: row.id, action: 'pregunta.update', before, after: row })
    return row
  }

  async function disablePregunta({ companyId, encuestaId, preguntaId, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(encuestaId, 'Encuesta no encontrada.')
    const qid = normalizeRecordId(preguntaId, 'Pregunta no encontrada.')
    const before = firstRow(await prisma.$queryRaw`
      SELECT * FROM encuestas_preguntas WHERE id=${qid} AND company_id=${cid} AND encuesta_id=${sid} AND enabled=true LIMIT 1
    `)
    if (!before) throw new EncuestasServiceError('Pregunta no encontrada.', 404)
    const row = firstRow(await prisma.$queryRaw`
      UPDATE encuestas_preguntas SET enabled=false, updated_at=now()
      WHERE id=${qid} AND company_id=${cid} AND encuesta_id=${sid} RETURNING *
    `)
    await audit(prisma, { actorId, entityType: 'Pregunta', entityId: row.id, action: 'pregunta.disable', before, after: row })
    return row
  }

  async function getRespondentContext({ companyId, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    if (!actorId) throw new EncuestasServiceError('No se pudo identificar al usuario autenticado.', 401)

    const profile = await prisma.userProfile.findUnique({
      where: { id: actorId },
      select: { id: true, displayName: true, firstName: true, lastName: true, email: true },
    })
    const profileName = profile?.displayName || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() || null

    const employee = await prisma.hrEmployee.findFirst({
      where: { companyId: cid, userProfileId: actorId, enabled: true },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, userProfileId: true },
    })

    if (!employee) {
      return {
        userProfileId: actorId,
        userName: profileName,
        userEmail: profile?.email ?? null,
        employeeId: null,
        employeeName: null,
        employeeCode: null,
        assignedItemIds: [],
        assignedItems: [],
      }
    }

    const items = await prisma.invItem.findMany({
      where: { companyId: cid, assignedToId: employee.id, enabled: true },
      select: {
        id: true, assetTag: true, name: true, model: true, serialNumber: true, partNumber: true,
        status: true,
        location: { select: { name: true } },
      },
      orderBy: [{ assetTag: 'asc' }, { name: 'asc' }],
    })

    const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim() || null
    const assignedItems = items.map((item) => ({
      id: item.id,
      assetTag: item.assetTag ?? null,
      name: item.name ?? null,
      model: item.model ?? null,
      serialNumber: item.serialNumber ?? null,
      partNumber: item.partNumber ?? null,
      status: item.status ?? null,
      locationName: item.location?.name ?? null,
    }))

    return {
      userProfileId: actorId,
      userName: profileName,
      userEmail: profile?.email ?? null,
      employeeId: employee.id,
      employeeName,
      employeeCode: employee.employeeCode ?? null,
      assignedItemIds: assignedItems.map((item) => item.id),
      assignedItems,
    }
  }

  async function submitRespuesta({ companyId, encuestaId, data, actorId }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(encuestaId, 'Encuesta no encontrada.')
    const encuesta = await getEncuesta({ companyId: cid, id: sid })
    if (encuesta.estado !== 'publicada') throw new EncuestasServiceError('Esta encuesta no está abierta para respuestas.', 409)
    const preguntas = await listPreguntas({ companyId: cid, encuestaId: sid })
    const answers = data.respuestas ?? {}
    const missing = preguntas.filter((q) => q.obligatoria && (answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === '' || (Array.isArray(answers[q.id]) && answers[q.id].length === 0)))
    if (missing.length) throw new EncuestasServiceError(`Falta responder: ${missing[0].texto}`, 400)
    const context = encuesta.capturar_contexto_inventario
      ? await getRespondentContext({ companyId: cid, actorId })
      : { userProfileId: actorId ?? null, userName: null, userEmail: null, employeeId: null, employeeName: null, assignedItems: [] }
    const row = mapRespuesta(firstRow(await prisma.$queryRaw`
      INSERT INTO encuestas_respuestas
        (company_id, encuesta_id, respondente_nombre, respondente_correo,
         respondente_user_id, respondente_user_nombre, respondente_user_correo,
         respondente_empleado_id, respondente_empleado_nombre, items_asignados_json, items_asignados_total, respuestas_json, enviado_en)
      VALUES
        (${cid}, ${sid}, ${data.respondente_nombre ?? null}, ${data.respondente_correo ?? null},
         ${context.userProfileId ?? null}, ${context.userName ?? null}, ${context.userEmail ?? null},
         ${context.employeeId ?? null}, ${context.employeeName ?? null}, ${jsonText(context.assignedItems ?? [])}, ${context.assignedItems?.length ?? 0},
         ${jsonText(answers)}, ${new Date().toISOString()})
      RETURNING *
    `))
    await audit(prisma, { actorId, entityType: 'Respuesta', entityId: row.id, action: 'respuesta.create', after: { id: row.id, encuesta_id: sid } })
    return row
  }

  async function listRespuestas({ companyId, encuestaId, page, pageSize }) {
    const cid = toScopedCompanyUuid(companyId)
    const sid = normalizeRecordId(encuestaId, 'Encuesta no encontrada.')
    await getEncuesta({ companyId: cid, id: sid })
    const p = normalizePagination({ page, pageSize })
    const [rows, totals] = await withDbErrorMapping(async () => Promise.all([
      prisma.$queryRaw`
        SELECT * FROM encuestas_respuestas
        WHERE company_id=${cid} AND encuesta_id=${sid} AND enabled=true
        ORDER BY created_at DESC LIMIT ${p.pageSize} OFFSET ${p.offset}
      `,
      prisma.$queryRaw`
        SELECT COUNT(*)::bigint AS total FROM encuestas_respuestas
        WHERE company_id=${cid} AND encuesta_id=${sid} AND enabled=true
      `,
    ]))
    return {
      data: rows.map(mapRespuesta),
      pagination: { page: p.page, pageSize: p.pageSize, total: toCount(firstRow(totals)?.total) },
    }
  }

  async function getDashboard({ companyId }) {
    const cid = toScopedCompanyUuid(companyId)
    return withDbErrorMapping(async () => {
      const surveys = firstRow(await prisma.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE enabled=true)::int AS total,
          COUNT(*) FILTER (WHERE enabled=true AND estado='publicada')::int AS publicadas,
          COUNT(*) FILTER (WHERE enabled=true AND estado='borrador')::int AS borradores,
          COUNT(*) FILTER (WHERE enabled=true AND estado='cerrada')::int AS cerradas
        FROM encuestas_encuestas WHERE company_id=${cid}
      `)
      const responses = firstRow(await prisma.$queryRaw`
        SELECT COUNT(*) FILTER (WHERE enabled=true)::int AS total
        FROM encuestas_respuestas WHERE company_id=${cid}
      `)
      const recent = await prisma.$queryRaw`
        SELECT e.id, e.titulo, e.estado,
          (SELECT COUNT(*)::int FROM encuestas_preguntas p WHERE p.company_id=e.company_id AND p.encuesta_id=e.id::text AND p.enabled=true) AS preguntas_total,
          (SELECT COUNT(*)::int FROM encuestas_respuestas r WHERE r.company_id=e.company_id AND r.encuesta_id=e.id::text AND r.enabled=true) AS respuestas_total
        FROM encuestas_encuestas e
        WHERE e.company_id=${cid} AND e.enabled=true
        ORDER BY e.updated_at DESC LIMIT 5
      `
      return { surveys: surveys ?? {}, responses: responses ?? {}, recent }
    })
  }

  return {
    listEncuestas, getEncuesta, createEncuesta, updateEncuesta, setEncuestaEstado, disableEncuesta,
    listPreguntas, createPregunta, updatePregunta, disablePregunta,
    getRespondentContext, submitRespuesta, listRespuestas, getDashboard,
  }
}
