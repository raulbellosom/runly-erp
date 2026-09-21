// count({ prisma, companyId }) receives the real prisma client (dry-run reporting).
// purge({ tx, companyId }) receives a transaction client and must delete children
// before parents to respect the FK constraints declared in the models.
export const dispatchCleanupHandler = {
  async count({ prisma, companyId }) {
    if (!companyId) throw new Error('custom.dispatch handler: companyId is required')
    const [
      siteRows, stationRows, assignmentRows, materialRows, seriesRows,
      ticketRows, weighingRows, exitAttemptRows, eventRows,
    ] = await Promise.all([
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_site WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_station WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_station_assignment WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_material_profile WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_folio_series WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_ticket WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_weighing WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_exit_attempt WHERE company_id = ${companyId}::uuid`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM dispatch_ticket_event WHERE company_id = ${companyId}::uuid`,
    ])

    return [
      { entity: 'Site', rows: siteRows[0].count, companyScoped: true },
      { entity: 'Station', rows: stationRows[0].count, companyScoped: true },
      { entity: 'StationAssignment', rows: assignmentRows[0].count, companyScoped: true },
      { entity: 'MaterialProfile', rows: materialRows[0].count, companyScoped: true },
      { entity: 'FolioSeries', rows: seriesRows[0].count, companyScoped: true },
      { entity: 'Ticket', rows: ticketRows[0].count, companyScoped: true },
      { entity: 'Weighing', rows: weighingRows[0].count, companyScoped: true },
      { entity: 'ExitAttempt', rows: exitAttemptRows[0].count, companyScoped: true },
      { entity: 'TicketEvent', rows: eventRows[0].count, companyScoped: true },
    ]
  },

  async purge({ tx, companyId }) {
    if (!companyId) throw new Error('custom.dispatch handler: companyId is required')
    // Children before parents: ticket_event/exit_attempt/weighing reference ticket;
    // ticket references site/station/material_profile; station_assignment references
    // station; station and material_profile and folio_series reference site.
    const eventsDeleted = await tx.$executeRaw`DELETE FROM dispatch_ticket_event WHERE company_id = ${companyId}::uuid`
    const exitAttemptsDeleted = await tx.$executeRaw`DELETE FROM dispatch_exit_attempt WHERE company_id = ${companyId}::uuid`
    const weighingsDeleted = await tx.$executeRaw`DELETE FROM dispatch_weighing WHERE company_id = ${companyId}::uuid`
    const ticketsDeleted = await tx.$executeRaw`DELETE FROM dispatch_ticket WHERE company_id = ${companyId}::uuid`
    const seriesDeleted = await tx.$executeRaw`DELETE FROM dispatch_folio_series WHERE company_id = ${companyId}::uuid`
    const assignmentsDeleted = await tx.$executeRaw`DELETE FROM dispatch_station_assignment WHERE company_id = ${companyId}::uuid`
    const materialsDeleted = await tx.$executeRaw`DELETE FROM dispatch_material_profile WHERE company_id = ${companyId}::uuid`
    const stationsDeleted = await tx.$executeRaw`DELETE FROM dispatch_station WHERE company_id = ${companyId}::uuid`
    const sitesDeleted = await tx.$executeRaw`DELETE FROM dispatch_site WHERE company_id = ${companyId}::uuid`

    return (
      eventsDeleted + exitAttemptsDeleted + weighingsDeleted + ticketsDeleted +
      seriesDeleted + assignmentsDeleted + materialsDeleted + stationsDeleted + sitesDeleted
    )
  },
}
