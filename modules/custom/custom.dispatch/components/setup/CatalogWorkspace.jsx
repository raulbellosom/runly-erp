import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
} from '@runly/ui'
import { Pencil, Plus, RotateCcw, ToggleLeft } from 'lucide-react'
import {
  ASSIGNMENT_LABEL,
  CATALOGS,
  STATION_LABEL,
  VOUCHER_LABEL,
} from '../lib/catalog-config.js'
import CatalogEditorDialog from './CatalogEditorDialog.jsx'

function StatusBadge({ enabled }) {
  return <Badge variant={enabled ? 'success' : 'secondary'}>{enabled ? 'Activo' : 'Inactivo'}</Badge>
}

function baseColumns(resource) {
  const status = { accessorKey: 'enabled', header: 'Estado', cell: ({ row }) => <StatusBadge enabled={row.original.enabled} /> }
  if (resource === 'sites') return [
    { accessorKey: 'code', header: 'Código' },
    { accessorKey: 'name', header: 'Sitio' },
    { accessorKey: 'timezone', header: 'Zona horaria' },
    status,
  ]
  if (resource === 'stations') return [
    { accessorKey: 'site_name', header: 'Sitio' },
    { accessorKey: 'name', header: 'Estación' },
    { accessorKey: 'station_type', header: 'Tipo', cell: ({ row }) => STATION_LABEL[row.original.station_type] },
    { accessorKey: 'code', header: 'Código' },
    status,
  ]
  if (resource === 'assignments') return [
    { accessorKey: 'user_name', header: 'Responsable' },
    { accessorKey: 'station_name', header: 'Estación' },
    { accessorKey: 'assignment_type', header: 'Función', cell: ({ row }) => ASSIGNMENT_LABEL[row.original.assignment_type] },
    { accessorKey: 'receives_exit_alerts', header: 'Alertas', cell: ({ row }) => row.original.receives_exit_alerts ? 'Sí' : 'No' },
    status,
  ]
  if (resource === 'materials') return [
    { accessorKey: 'code', header: 'Código' },
    { accessorKey: 'name', header: 'Material' },
    { accessorKey: 'site_name', header: 'Sitio' },
    { accessorKey: 'allowed_modes', header: 'Medición', cell: ({ row }) => row.original.allowed_modes?.join(' · ') },
    status,
  ]
  return [
    { accessorKey: 'site_name', header: 'Sitio' },
    { accessorKey: 'voucher_type', header: 'Tipo', cell: ({ row }) => VOUCHER_LABEL[row.original.voucher_type] },
    { accessorKey: 'prefix', header: 'Prefijo' },
    { accessorKey: 'next_number', header: 'Siguiente' },
    status,
  ]
}

function defaultsForIntent(resource, intent) {
  if (resource === 'stations' && ['SALES', 'SCALE', 'GATE'].includes(intent)) {
    return { station_type: intent }
  }
  if (resource === 'series' && ['SCALE', 'VOLUME'].includes(intent)) {
    return { voucher_type: intent }
  }
  return {}
}

export default function CatalogWorkspace({
  setup,
  resource,
  createIntent,
  onCreateIntentHandled,
  onSave,
  onSetEnabled,
  saving,
}) {
  const [editor, setEditor] = useState(null)
  const [disableTarget, setDisableTarget] = useState(null)
  const config = CATALOGS[resource]
  const rows = setup[resource] ?? []
  const activeCount = rows.filter((row) => row.enabled).length

  useEffect(() => {
    if (!createIntent) return
    setEditor({ mode: 'create', defaults: defaultsForIntent(resource, createIntent) })
    onCreateIntentHandled?.()
  }, [createIntent, onCreateIntentHandled, resource])

  const columns = useMemo(() => [
    ...baseColumns(resource),
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Editar ${config.singular}`}
            onClick={() => setEditor({ mode: 'edit', record: row.original })}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={row.original.enabled ? `Desactivar ${config.singular}` : `Reactivar ${config.singular}`}
            onClick={() => row.original.enabled
              ? setDisableTarget(row.original)
              : onSetEnabled(resource, row.original, true)}
          >
            {row.original.enabled ? <ToggleLeft className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          </Button>
        </div>
      ),
    },
  ], [config.singular, onSetEnabled, resource])

  const editingRecord = editor?.mode === 'edit' ? editor.record : null

  return (
    <Card variant="bordered" className="overflow-hidden">
      <CardHeader className="gap-4 border-b border-border p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{config.label}</CardTitle>
              <Badge variant="secondary">{activeCount} activos</Badge>
            </div>
            <CardDescription>{config.description}</CardDescription>
          </div>
          <Button onClick={() => setEditor({ mode: 'create', defaults: {} })}>
            <Plus className="mr-2 h-4 w-4" />
            {config.createLabel}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6">
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder={`Buscar ${config.label.toLowerCase()}...`}
          emptyTitle={config.emptyTitle}
          emptyDescription={config.emptyDescription}
          emptyIcon={config.icon}
          emptyAction={
            <Button onClick={() => setEditor({ mode: 'create', defaults: {} })}>
              <Plus className="mr-2 h-4 w-4" />
              {config.createLabel}
            </Button>
          }
        />
      </CardContent>

      <CatalogEditorDialog
        open={Boolean(editor)}
        onOpenChange={(open) => !open && setEditor(null)}
        resource={resource}
        record={editingRecord}
        initialValues={editor?.defaults}
        setup={setup}
        saving={saving}
        onSave={(data) => onSave(resource, editingRecord, data, () => setEditor(null))}
      />

      <ConfirmDialog
        open={Boolean(disableTarget)}
        onOpenChange={(open) => !open && setDisableTarget(null)}
        title={`Desactivar ${config.singular}`}
        description="El registro dejará de estar disponible para nuevas operaciones. Su historial se conserva."
        detail={disableTarget?.name || disableTarget?.prefix || disableTarget?.user_name}
        confirmLabel="Desactivar"
        loading={saving}
        onConfirm={() => onSetEnabled(resource, disableTarget, false, () => setDisableTarget(null))}
      />
    </Card>
  )
}
