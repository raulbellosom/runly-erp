import { useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyCrudView, PageHeader } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

const CATALOG_TABS = [
  { key: 'vehicle-types',  label: 'Tipos de vehiculo' },
  { key: 'vehicle-brands', label: 'Marcas'            },
  { key: 'vehicle-models', label: 'Modelos'           },
]

const CATALOG_BLUEPRINTS = {
  'vehicle-types': {
    table: {
      key: 'fleet.catalogs.vehicle-types.table',
      kind: 'TABLE',
      schema: {
        entity: 'FleetVehicleType',
        apiPath: '/fleet/catalogs/vehicle-types',
        title: 'Tipos de vehiculo',
        columns: [
          { field: 'name',                  label: 'Nombre' },
          { field: 'economic_group_number', label: 'No. economico grupo' },
          { field: 'description',           label: 'Descripcion' },
        ],
        actions: [{ label: 'Agregar tipo' }],
        emptyState: { message: 'No hay tipos de vehiculo registrados.' },
      },
    },
    form: {
      key: 'fleet.catalogs.vehicle-types.form',
      kind: 'FORM',
      schema: {
        entity: 'FleetVehicleType',
        apiPath: '/fleet/catalogs/vehicle-types',
        sections: [{
          title: 'Tipo de vehiculo',
          fields: [
            { name: 'name',                  label: 'Nombre',              type: 'text',     required: true },
            { name: 'description',           label: 'Descripcion',         type: 'textarea' },
            { name: 'economic_group_number', label: 'No. economico grupo', type: 'text' },
          ],
        }],
      },
    },
  },
  'vehicle-brands': {
    table: {
      key: 'fleet.catalogs.vehicle-brands.table',
      kind: 'TABLE',
      schema: {
        entity: 'FleetVehicleBrand',
        apiPath: '/fleet/catalogs/vehicle-brands',
        title: 'Marcas',
        columns: [{ field: 'name', label: 'Nombre' }],
        actions: [{ label: 'Agregar marca' }],
        emptyState: { message: 'No hay marcas registradas.' },
      },
    },
    form: {
      key: 'fleet.catalogs.vehicle-brands.form',
      kind: 'FORM',
      schema: {
        entity: 'FleetVehicleBrand',
        apiPath: '/fleet/catalogs/vehicle-brands',
        sections: [{
          title: 'Marca',
          fields: [{ name: 'name', label: 'Nombre', type: 'text', required: true }],
        }],
      },
    },
  },
  'vehicle-models': {
    table: {
      key: 'fleet.catalogs.vehicle-models.table',
      kind: 'TABLE',
      schema: {
        entity: 'FleetVehicleModel',
        apiPath: '/fleet/catalogs/vehicle-models',
        title: 'Modelos',
        columns: [
          { field: 'name', label: 'Nombre' },
          { field: 'year', label: 'Año',   type: 'number' },
        ],
        actions: [{ label: 'Agregar modelo' }],
        emptyState: { message: 'No hay modelos registrados.' },
      },
    },
    form: {
      key: 'fleet.catalogs.vehicle-models.form',
      kind: 'FORM',
      schema: {
        entity: 'FleetVehicleModel',
        apiPath: '/fleet/catalogs/vehicle-models',
        sections: [{
          title: 'Modelo',
          fields: [
            { name: 'name', label: 'Nombre', type: 'text',   required: true },
            { name: 'year', label: 'Año',    type: 'number', required: true },
          ],
        }],
      },
    },
  },
}

// Exported so VehiclesScreen.jsx can reuse this exact schema as the inline
// "Crear modelo de vehiculo" modal target (see relation.create.viewKey on
// vehicle_model_id) instead of duplicating it or relying on a server-side
// /blueprints registration that doesn't exist for Fleet's catalog screens.
export const FLEET_VEHICLE_MODEL_FORM_BLUEPRINT = CATALOG_BLUEPRINTS['vehicle-models'].form

export default function CatalogsScreen() {
  const { '*': wildcard } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const token = session?.access_token ?? null
  const { activeCompanyId } = useActiveCompany()

  const catalogKey = useMemo(() => {
    const segs = String(wildcard ?? '').replace(/^\/+/, '').split('/')
    const found = segs.find((s) => CATALOG_TABS.some((t) => t.key === s))
    return found ?? 'vehicle-types'
  }, [wildcard])

  const { table: tableBlueprint, form: formBlueprint } = CATALOG_BLUEPRINTS[catalogKey]

  const handleTabChange = useCallback((key) => {
    navigate(`/app/m/runly.fleet/catalogs/${key}`, { replace: true })
  }, [navigate])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader
        eyebrow="Runly Fleet"
        title="Catalogos de Flota"
        description="Tipos de vehiculo, marcas y modelos disponibles."
      />
      <div className="flex gap-2 border-b border-[hsl(var(--border))] pb-0">
        {CATALOG_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              catalogKey === tab.key
                ? 'border-(--module-accent,hsl(var(--primary))) text-[hsl(var(--foreground))]'
                : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <RunlyCrudView
        tableBlueprint={tableBlueprint}
        formBlueprint={formBlueprint}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        initialMode="list"
      />
    </div>
  )
}
