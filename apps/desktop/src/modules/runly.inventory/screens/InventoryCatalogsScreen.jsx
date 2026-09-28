import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@runly/ui'
import { useInventoryBrands, useInventoryCategories, useInventoryCustomFields, useInventoryLocations } from '../hooks/useInventoryCatalogs.js'
import { useInventoryModels } from '../hooks/useInventoryModels.js'
import { resolveCatalogKey, catalogByKey } from '../components/catalogs/catalog-config.js'
import { CatalogNav } from '../components/catalogs/CatalogNav.jsx'
import { CatalogImportDialog } from '../components/catalogs/CatalogImportDialog.jsx'
import { TypesPanel } from '../components/catalogs/TypesPanel.jsx'
import { BrandsPanel } from '../components/catalogs/BrandsPanel.jsx'
import { ModelsPanel } from '../components/catalogs/ModelsPanel.jsx'
import { LocationsPanel } from '../components/catalogs/LocationsPanel.jsx'
import { CustomFieldsPanel } from '../components/catalogs/CustomFieldsPanel.jsx'

const PANELS = { types: TypesPanel, brands: BrandsPanel, models: ModelsPanel, locations: LocationsPanel, 'custom-fields': CustomFieldsPanel }
const IMPORTABLE = new Set(['types', 'brands', 'models', 'locations'])
const count = (query) => (query.data?.data ?? query.data ?? []).filter((row) => row.enabled !== false).length

export default function InventoryCatalogsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = resolveCatalogKey(searchParams.get('tab'))
  const [importing, setImporting] = useState(false)
  const counts = {
    types: count(useInventoryCategories()),
    brands: count(useInventoryBrands()),
    models: count(useInventoryModels()),
    locations: count(useInventoryLocations()),
    'custom-fields': count(useInventoryCustomFields('all')),
  }
  const Panel = PANELS[active]

  return (
    <div className="min-h-dvh space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Runly Inventario"
        title="Catálogos"
        description="Tipos, marcas, modelos, ubicaciones y campos personalizados que se usan al registrar activos."
      />
      <div className="grid items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <CatalogNav active={active} counts={counts} onSelect={(key) => setSearchParams({ tab: key }, { replace: true })} />
        <Panel onImport={IMPORTABLE.has(active) ? () => setImporting(true) : undefined} />
      </div>
      {IMPORTABLE.has(active) ? (
        <CatalogImportDialog catalog={active} title={catalogByKey(active).label.toLowerCase()} open={importing} onOpenChange={setImporting} />
      ) : null}
    </div>
  )
}
