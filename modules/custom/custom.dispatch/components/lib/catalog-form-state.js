export function createInitialForm(resource, record, defaults = {}) {
  if (record) {
    return {
      ...record,
      allowed_modes: Array.isArray(record.allowed_modes) ? record.allowed_modes : ['M3'],
      density_kg_m3: record.density_kg_m3 ?? '',
    }
  }
  if (resource === 'sites') return { code: '', name: '', timezone: 'America/Mexico_City', address_text: '', ...defaults }
  if (resource === 'stations') return { site_id: '', code: '', name: '', station_type: 'SALES', location_note: '', ...defaults }
  if (resource === 'assignments') return { station_id: '', user_id: '', assignment_type: 'OPERATOR', receives_exit_alerts: false, ...defaults }
  if (resource === 'materials') return { site_id: '', code: '', name: '', allowed_modes: ['M3'], density_kg_m3: '', ...defaults }
  return { site_id: '', voucher_type: 'SCALE', prefix: '', next_number: 1, padding: 6, ...defaults }
}
