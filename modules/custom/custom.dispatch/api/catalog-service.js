import { DispatchServiceError } from './service-helpers.js'

const MODULE_KEY = 'custom.dispatch'

export function createCatalogService({ prisma }) {
  function normalizeCode(value) {
    return value.trim().toUpperCase().replace(/\s+/g, '-')
  }

  function normalizePrefix(value) {
    return value.trim().toUpperCase().replace(/\s+/g, '')
  }

  async function writeAudit({ actorId, entityType, entityId, action, before, after }) {
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: MODULE_KEY,
        entityType,
        entityId,
        action,
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null,
        metadata: null,
      },
    })
  }

  async function listSites({ companyId }) {
    return prisma.$queryRaw`
      SELECT id, code, name, timezone, address_text, enabled, created_at, updated_at
      FROM dispatch_site
      WHERE company_id = ${companyId}::uuid
      ORDER BY enabled DESC, name ASC
    `
  }

  async function listStations({ companyId }) {
    return prisma.$queryRaw`
      SELECT station.id, station.site_id, station.code, station.name, station.station_type,
             station.location_note, station.enabled, station.created_at, station.updated_at,
             site.name AS site_name
      FROM dispatch_station station
      INNER JOIN dispatch_site site
        ON site.id = station.site_id AND site.company_id = station.company_id
      WHERE station.company_id = ${companyId}::uuid
      ORDER BY station.enabled DESC, site.name ASC, station.name ASC
    `
  }

  async function listAssignments({ companyId }) {
    const [rows, users] = await Promise.all([
      prisma.$queryRaw`
        SELECT assignment.id, assignment.station_id, assignment.user_id,
               assignment.assignment_type, assignment.receives_exit_alerts,
               assignment.enabled, assignment.created_at, assignment.updated_at,
               station.name AS station_name, site.name AS site_name
        FROM dispatch_station_assignment assignment
        INNER JOIN dispatch_station station
          ON station.id = assignment.station_id AND station.company_id = assignment.company_id
        INNER JOIN dispatch_site site
          ON site.id = station.site_id AND site.company_id = station.company_id
        WHERE assignment.company_id = ${companyId}::uuid
        ORDER BY assignment.enabled DESC, site.name ASC, station.name ASC
      `,
      listUsers({ companyId }),
    ])

    const usersById = new Map(users.map((user) => [user.id, user]))
    return rows.map((row) => ({
      ...row,
      user_name: usersById.get(row.user_id)?.display_name ?? 'Usuario no disponible',
      user_email: usersById.get(row.user_id)?.email ?? null,
    }))
  }

  async function listMaterials({ companyId }) {
    return prisma.$queryRaw`
      SELECT material.id, material.site_id, material.catalog_product_id, material.code,
             material.name, material.allowed_modes, material.density_kg_m3,
             material.enabled, material.created_at, material.updated_at,
             site.name AS site_name
      FROM dispatch_material_profile material
      INNER JOIN dispatch_site site
        ON site.id = material.site_id AND site.company_id = material.company_id
      WHERE material.company_id = ${companyId}::uuid
      ORDER BY material.enabled DESC, site.name ASC, material.name ASC
    `
  }

  async function listSeries({ companyId }) {
    return prisma.$queryRaw`
      SELECT series.id, series.site_id, series.voucher_type, series.prefix,
             series.next_number, series.padding, series.enabled,
             series.created_at, series.updated_at, site.name AS site_name
      FROM dispatch_folio_series series
      INNER JOIN dispatch_site site
        ON site.id = series.site_id AND site.company_id = series.company_id
      WHERE series.company_id = ${companyId}::uuid
      ORDER BY series.enabled DESC, site.name ASC, series.voucher_type ASC
    `
  }

  async function listUsers({ companyId }) {
    const memberships = await prisma.membership.findMany({
      where: { companyId, enabled: true, user: { enabled: true } },
      orderBy: { user: { displayName: 'asc' } },
      select: { user: { select: { id: true, displayName: true, email: true } } },
    })
    return memberships.map(({ user }) => ({
      id: user.id,
      display_name: user.displayName,
      email: user.email,
    }))
  }

  async function getSetup({ companyId }) {
    const [sites, stations, assignments, materials, series, users] = await Promise.all([
      listSites({ companyId }),
      listStations({ companyId }),
      listAssignments({ companyId }),
      listMaterials({ companyId }),
      listSeries({ companyId }),
      listUsers({ companyId }),
    ])
    return { sites, stations, assignments, materials, series, users }
  }

  async function getSite({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM dispatch_site WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Sitio no encontrado.', 404, 'SITE_NOT_FOUND')
    return rows[0]
  }

  async function getStation({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM dispatch_station WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Estación no encontrada.', 404, 'STATION_NOT_FOUND')
    return rows[0]
  }

  async function getAssignment({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM dispatch_station_assignment
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Asignación no encontrada.', 404, 'ASSIGNMENT_NOT_FOUND')
    return rows[0]
  }

  async function getMaterial({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM dispatch_material_profile
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Material no encontrado.', 404, 'MATERIAL_NOT_FOUND')
    return rows[0]
  }

  async function getSeries({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM dispatch_folio_series
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Serie no encontrada.', 404, 'SERIES_NOT_FOUND')
    return rows[0]
  }

  async function assertEnabledSite({ companyId, id }) {
    const site = await getSite({ companyId, id })
    if (!site.enabled) throw new DispatchServiceError('El sitio seleccionado está inactivo.', 409, 'SITE_DISABLED')
  }

  async function assertEnabledStation({ companyId, id }) {
    const station = await getStation({ companyId, id })
    if (!station.enabled) {
      throw new DispatchServiceError('La estación seleccionada está inactiva.', 409, 'STATION_DISABLED')
    }
  }

  async function assertCompanyUser({ companyId, id }) {
    const membership = await prisma.membership.findFirst({
      where: { companyId, userId: id, enabled: true, user: { enabled: true } },
      select: { id: true },
    })
    if (!membership) {
      throw new DispatchServiceError('El usuario no pertenece a la empresa activa.', 422, 'USER_NOT_AVAILABLE')
    }
  }

  async function createSite({ companyId, data, actorId }) {
    const rows = await prisma.$queryRaw`
      INSERT INTO dispatch_site
        (company_id, code, name, timezone, address_text, enabled, created_at, updated_at)
      VALUES
        (${companyId}::uuid, ${normalizeCode(data.code)}, ${data.name.trim()},
         ${data.timezone.trim()}, ${data.address_text ?? null}, true, NOW(), NOW())
      RETURNING *
    `
    const created = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.site', entityId: created.id, action: 'site.create', after: created })
    return created
  }

  async function updateSite({ companyId, id, data, actorId }) {
    const before = await getSite({ companyId, id })
    const rows = await prisma.$queryRaw`
      UPDATE dispatch_site SET
        code = CASE WHEN ${data.code !== undefined} THEN ${data.code ? normalizeCode(data.code) : null} ELSE code END,
        name = CASE WHEN ${data.name !== undefined} THEN ${data.name?.trim() ?? null} ELSE name END,
        timezone = CASE WHEN ${data.timezone !== undefined} THEN ${data.timezone?.trim() ?? null} ELSE timezone END,
        address_text = CASE WHEN ${data.address_text !== undefined} THEN ${data.address_text ?? null} ELSE address_text END,
        updated_at = NOW()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const updated = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.site', entityId: id, action: 'site.update', before, after: updated })
    return updated
  }

  async function createStation({ companyId, data, actorId }) {
    await assertEnabledSite({ companyId, id: data.site_id })
    const rows = await prisma.$queryRaw`
      INSERT INTO dispatch_station
        (company_id, site_id, code, name, station_type, location_note, enabled, created_at, updated_at)
      VALUES
        (${companyId}::uuid, ${data.site_id}::uuid, ${normalizeCode(data.code)}, ${data.name.trim()},
         ${data.station_type}, ${data.location_note ?? null}, true, NOW(), NOW())
      RETURNING *
    `
    const created = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.station', entityId: created.id, action: 'station.create', after: created })
    return created
  }

  async function updateStation({ companyId, id, data, actorId }) {
    const before = await getStation({ companyId, id })
    if (data.site_id) await assertEnabledSite({ companyId, id: data.site_id })
    const rows = await prisma.$queryRaw`
      UPDATE dispatch_station SET
        site_id = CASE WHEN ${data.site_id !== undefined} THEN ${data.site_id ?? null}::uuid ELSE site_id END,
        code = CASE WHEN ${data.code !== undefined} THEN ${data.code ? normalizeCode(data.code) : null} ELSE code END,
        name = CASE WHEN ${data.name !== undefined} THEN ${data.name?.trim() ?? null} ELSE name END,
        station_type = CASE WHEN ${data.station_type !== undefined} THEN ${data.station_type ?? null} ELSE station_type END,
        location_note = CASE WHEN ${data.location_note !== undefined} THEN ${data.location_note ?? null} ELSE location_note END,
        updated_at = NOW()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const updated = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.station', entityId: id, action: 'station.update', before, after: updated })
    return updated
  }

  async function createAssignment({ companyId, data, actorId }) {
    await Promise.all([
      assertEnabledStation({ companyId, id: data.station_id }),
      assertCompanyUser({ companyId, id: data.user_id }),
    ])
    const rows = await prisma.$queryRaw`
      INSERT INTO dispatch_station_assignment
        (company_id, station_id, user_id, assignment_type, receives_exit_alerts, enabled, created_at, updated_at)
      VALUES
        (${companyId}::uuid, ${data.station_id}::uuid, ${data.user_id}::uuid,
         ${data.assignment_type}, ${Boolean(data.receives_exit_alerts)}, true, NOW(), NOW())
      RETURNING *
    `
    const created = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.station_assignment', entityId: created.id, action: 'station_assignment.create', after: created })
    return created
  }

  async function updateAssignment({ companyId, id, data, actorId }) {
    const before = await getAssignment({ companyId, id })
    if (data.station_id) await assertEnabledStation({ companyId, id: data.station_id })
    if (data.user_id) await assertCompanyUser({ companyId, id: data.user_id })
    const rows = await prisma.$queryRaw`
      UPDATE dispatch_station_assignment SET
        station_id = CASE WHEN ${data.station_id !== undefined} THEN ${data.station_id ?? null}::uuid ELSE station_id END,
        user_id = CASE WHEN ${data.user_id !== undefined} THEN ${data.user_id ?? null}::uuid ELSE user_id END,
        assignment_type = CASE WHEN ${data.assignment_type !== undefined} THEN ${data.assignment_type ?? null} ELSE assignment_type END,
        receives_exit_alerts = CASE WHEN ${data.receives_exit_alerts !== undefined} THEN ${Boolean(data.receives_exit_alerts)} ELSE receives_exit_alerts END,
        updated_at = NOW()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const updated = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.station_assignment', entityId: id, action: 'station_assignment.update', before, after: updated })
    return updated
  }

  async function createMaterial({ companyId, data, actorId }) {
    await assertEnabledSite({ companyId, id: data.site_id })
    const rows = await prisma.$queryRaw`
      INSERT INTO dispatch_material_profile
        (company_id, site_id, catalog_product_id, code, name, allowed_modes,
         density_kg_m3, enabled, created_at, updated_at)
      VALUES
        (${companyId}::uuid, ${data.site_id}::uuid, ${data.catalog_product_id ?? null}::uuid,
         ${normalizeCode(data.code)}, ${data.name.trim()}, ${data.allowed_modes}::text[],
         ${data.density_kg_m3 ?? null}, true, NOW(), NOW())
      RETURNING *
    `
    const created = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.material_profile', entityId: created.id, action: 'material_profile.create', after: created })
    return created
  }

  async function updateMaterial({ companyId, id, data, actorId }) {
    const before = await getMaterial({ companyId, id })
    if (data.site_id) await assertEnabledSite({ companyId, id: data.site_id })
    const rows = await prisma.$queryRaw`
      UPDATE dispatch_material_profile SET
        site_id = CASE WHEN ${data.site_id !== undefined} THEN ${data.site_id ?? null}::uuid ELSE site_id END,
        catalog_product_id = CASE WHEN ${data.catalog_product_id !== undefined} THEN ${data.catalog_product_id ?? null}::uuid ELSE catalog_product_id END,
        code = CASE WHEN ${data.code !== undefined} THEN ${data.code ? normalizeCode(data.code) : null} ELSE code END,
        name = CASE WHEN ${data.name !== undefined} THEN ${data.name?.trim() ?? null} ELSE name END,
        allowed_modes = CASE WHEN ${data.allowed_modes !== undefined} THEN ${data.allowed_modes ?? []}::text[] ELSE allowed_modes END,
        density_kg_m3 = CASE WHEN ${data.density_kg_m3 !== undefined} THEN ${data.density_kg_m3 ?? null} ELSE density_kg_m3 END,
        updated_at = NOW()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const updated = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.material_profile', entityId: id, action: 'material_profile.update', before, after: updated })
    return updated
  }

  async function createSeries({ companyId, data, actorId }) {
    await assertEnabledSite({ companyId, id: data.site_id })
    const rows = await prisma.$queryRaw`
      INSERT INTO dispatch_folio_series
        (company_id, site_id, voucher_type, prefix, next_number, padding, enabled, created_at, updated_at)
      VALUES
        (${companyId}::uuid, ${data.site_id}::uuid, ${data.voucher_type}, ${normalizePrefix(data.prefix)},
         ${data.next_number}, ${data.padding}, true, NOW(), NOW())
      RETURNING *
    `
    const created = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.folio_series', entityId: created.id, action: 'folio_series.create', after: created })
    return created
  }

  async function updateSeries({ companyId, id, data, actorId }) {
    const before = await getSeries({ companyId, id })
    if (data.site_id) await assertEnabledSite({ companyId, id: data.site_id })
    const rows = await prisma.$queryRaw`
      UPDATE dispatch_folio_series SET
        site_id = CASE WHEN ${data.site_id !== undefined} THEN ${data.site_id ?? null}::uuid ELSE site_id END,
        voucher_type = CASE WHEN ${data.voucher_type !== undefined} THEN ${data.voucher_type ?? null} ELSE voucher_type END,
        prefix = CASE WHEN ${data.prefix !== undefined} THEN ${data.prefix ? normalizePrefix(data.prefix) : null} ELSE prefix END,
        next_number = CASE WHEN ${data.next_number !== undefined} THEN ${data.next_number ?? null} ELSE next_number END,
        padding = CASE WHEN ${data.padding !== undefined} THEN ${data.padding ?? null} ELSE padding END,
        updated_at = NOW()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const updated = rows[0]
    await writeAudit({ actorId, entityType: 'dispatch.folio_series', entityId: id, action: 'folio_series.update', before, after: updated })
    return updated
  }

  async function setEnabled({ companyId, resource, id, enabled, actorId }) {
    const config = {
      sites: { table: 'dispatch_site', entity: 'dispatch.site', action: 'site', get: getSite },
      stations: { table: 'dispatch_station', entity: 'dispatch.station', action: 'station', get: getStation },
      assignments: { table: 'dispatch_station_assignment', entity: 'dispatch.station_assignment', action: 'station_assignment', get: getAssignment },
      materials: { table: 'dispatch_material_profile', entity: 'dispatch.material_profile', action: 'material_profile', get: getMaterial },
      series: { table: 'dispatch_folio_series', entity: 'dispatch.folio_series', action: 'folio_series', get: getSeries },
    }[resource]
    if (!config) throw new DispatchServiceError('Catálogo no reconocido.', 404, 'RESOURCE_NOT_FOUND')

    const before = await config.get({ companyId, id })
    if (resource === 'sites' && !enabled) {
      const dependencies = await prisma.$queryRaw`
        SELECT
          (SELECT COUNT(*) FROM dispatch_station WHERE company_id = ${companyId}::uuid AND site_id = ${id}::uuid AND enabled = true) +
          (SELECT COUNT(*) FROM dispatch_material_profile WHERE company_id = ${companyId}::uuid AND site_id = ${id}::uuid AND enabled = true) +
          (SELECT COUNT(*) FROM dispatch_folio_series WHERE company_id = ${companyId}::uuid AND site_id = ${id}::uuid AND enabled = true)
          AS total
      `
      if (Number(dependencies[0]?.total ?? 0) > 0) {
        throw new DispatchServiceError('Desactiva primero las estaciones, materiales y series de este sitio.', 409, 'SITE_HAS_DEPENDENCIES')
      }
    }
    if (resource === 'stations' && !enabled) {
      const dependencies = await prisma.$queryRaw`
        SELECT COUNT(*) AS total FROM dispatch_station_assignment
        WHERE company_id = ${companyId}::uuid AND station_id = ${id}::uuid AND enabled = true
      `
      if (Number(dependencies[0]?.total ?? 0) > 0) {
        throw new DispatchServiceError('Desactiva primero las asignaciones de esta estación.', 409, 'STATION_HAS_DEPENDENCIES')
      }
    }

    let rows
    if (resource === 'sites') rows = await prisma.$queryRaw`UPDATE dispatch_site SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid RETURNING *`
    if (resource === 'stations') rows = await prisma.$queryRaw`UPDATE dispatch_station SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid RETURNING *`
    if (resource === 'assignments') rows = await prisma.$queryRaw`UPDATE dispatch_station_assignment SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid RETURNING *`
    if (resource === 'materials') rows = await prisma.$queryRaw`UPDATE dispatch_material_profile SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid RETURNING *`
    if (resource === 'series') rows = await prisma.$queryRaw`UPDATE dispatch_folio_series SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid RETURNING *`

    const updated = rows[0]
    await writeAudit({
      actorId,
      entityType: config.entity,
      entityId: id,
      action: `${config.action}.${enabled ? 'enable' : 'disable'}`,
      before,
      after: updated,
    })
    return updated
  }

  async function create({ companyId, resource, data, actorId }) {
    if (resource === 'sites') return createSite({ companyId, data, actorId })
    if (resource === 'stations') return createStation({ companyId, data, actorId })
    if (resource === 'assignments') return createAssignment({ companyId, data, actorId })
    if (resource === 'materials') return createMaterial({ companyId, data, actorId })
    if (resource === 'series') return createSeries({ companyId, data, actorId })
    throw new DispatchServiceError('Catálogo no reconocido.', 404, 'RESOURCE_NOT_FOUND')
  }

  async function update({ companyId, resource, id, data, actorId }) {
    if (resource === 'sites') return updateSite({ companyId, id, data, actorId })
    if (resource === 'stations') return updateStation({ companyId, id, data, actorId })
    if (resource === 'assignments') return updateAssignment({ companyId, id, data, actorId })
    if (resource === 'materials') return updateMaterial({ companyId, id, data, actorId })
    if (resource === 'series') return updateSeries({ companyId, id, data, actorId })
    throw new DispatchServiceError('Catálogo no reconocido.', 404, 'RESOURCE_NOT_FOUND')
  }

  return { getSetup, create, update, setEnabled }
}
