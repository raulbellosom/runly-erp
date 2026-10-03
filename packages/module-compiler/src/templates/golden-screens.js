// Reference ("golden") screens shipped in the Builder ZIP download under
// docs/ejemplos/ (spec 2026-10-03-rme3-module-platform-v2 §5.2): complete,
// good-looking screens for the module's first entity, written with the module
// kit, for people and AIs to copy into components/. Never part of the
// installed package (ignored on upload, like docs/*.md).
export const EXAMPLES_DIR = 'docs/ejemplos'

const s = (value) => JSON.stringify(String(value ?? ''))

const pascal = (value) => String(value).split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('') || 'Registro'

function fieldControl(field) {
  const key = field.key
  const label = s(field.label || key)
  const required = field.required ? ' required' : ''
  const value = `form.${key} ?? ''`
  switch (field.type) {
    case 'textarea':
    case 'markdown':
      return `<TextareaField label={${label}}${required} className="md:col-span-2" value={${value}} onChange={(e) => set(${s(key)}, e.target.value)} />`
    case 'number':
    case 'integer':
    case 'decimal':
      return `<TextField label={${label}}${required} type="number" value={${value}} onChange={(e) => set(${s(key)}, e.target.value)} />`
    case 'email':
      return `<TextField label={${label}}${required} type="email" icon={Mail} value={${value}} onChange={(e) => set(${s(key)}, e.target.value)} />`
    case 'phone':
      return `<PhoneField label={${label}}${required} value={${value}} onChange={(e) => set(${s(key)}, e.target.value)} />`
    case 'date':
      return `<DatePickerField label={${label}}${required} value={form.${key} ?? undefined} onChange={(v) => set(${s(key)}, v ?? null)} />`
    case 'boolean':
      return `<SwitchField label={${label}} checked={Boolean(form.${key})} onChange={(v) => set(${s(key)}, v)} />`
    case 'select':
      return `<SelectField label={${label}}${required} options={${JSON.stringify((field.options ?? []).map((o) => ({ value: o.value ?? o, label: o.label ?? o.value ?? o })))}} value={form.${key} ?? undefined} onValueChange={(v) => set(${s(key)}, v)} />`
    default:
      return `<TextField label={${label}}${required} value={${value}} onChange={(e) => set(${s(key)}, e.target.value)} />`
  }
}

// Field types the simple form example edits directly; relations, files and
// json stay in EntityForm (the Builder form) where their pickers live.
const SIMPLE_TYPES = new Set(['text', 'textarea', 'markdown', 'number', 'integer', 'decimal', 'email', 'phone', 'date', 'boolean', 'select'])

function listado(entity) {
  const plural = entity.pluralLabel || `${entity.label}s`
  return `import { useState } from 'react'
import { Button, EntityForm, EntityTable, ModulePage, Sheet, SheetContent, SheetHeader, SheetTitle } from '@runly/ui'
import { LayoutList, Plus } from 'lucide-react'

// Listado con búsqueda, filtros y paginación (la vista TABLE del Constructor)
// y alta/edición en un panel lateral (la vista FORM del Constructor).
export default function Listado${pascal(entity.key)}() {
  const [editing, setEditing] = useState(null) // null = cerrado, 'new' = crear, id = editar

  return (
    <ModulePage
      title={${s(plural)}}
      icon={LayoutList}
      description={${s(`Consulta y administra ${plural.toLowerCase()}.`)}}
      actions={<Button onClick={() => setEditing('new')}><Plus /> {${s(`Nuevo registro`)}}</Button>}
    >
      <EntityTable entity=${s(entity.key)} onCreate={() => setEditing('new')} onEdit={(row) => setEditing(row.id)} />

      <Sheet open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{editing === 'new' ? ${s(`Nuevo: ${entity.label}`)} : ${s(`Editar: ${entity.label}`)}}</SheetTitle>
          </SheetHeader>
          {editing && (
            <EntityForm
              entity=${s(entity.key)}
              recordId={editing === 'new' ? undefined : editing}
              onSaved={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </ModulePage>
  )
}
`
}

function detalle(entity, titleField) {
  return `import { useLocation } from 'react-router-dom'
import { Badge, DetailHeader, EmptyState, EntityDetail, ModulePage, Skeleton, findEntityBlueprint, resolveRecordLabel, useEntityRecord, useModuleRuntime } from '@runly/ui'
import { FileText, SearchX } from 'lucide-react'

// Ficha de un registro: encabezado propio + la vista DETAIL del Constructor.
// Se abre con ?id=<uuid> en la URL de la vista.
export default function Detalle${pascal(entity.key)}({ navigate }) {
  const id = new URLSearchParams(useLocation().search).get('id')
  const { data: record, isLoading } = useEntityRecord(${s(entity.key)}, id)
  const { blueprints } = useModuleRuntime()
  // Title from a name/text field of the record — never its id.
  const title = resolveRecordLabel(record, [findEntityBlueprint(blueprints, 'DETAIL', ${s(entity.key)}), findEntityBlueprint(blueprints, 'FORM', ${s(entity.key)})]) ?? ${s(entity.label)}

  if (!id) {
    return (
      <ModulePage title={${s(entity.label)}} icon={FileText}>
        <EmptyState icon={SearchX} title="Sin registro" description="Abre esta pantalla desde el listado." />
      </ModulePage>
    )
  }

  return (
    <ModulePage title={${s(entity.label)}} icon={FileText} onBack={() => navigate(-1)}>
      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <DetailHeader
          icon={FileText}
          title={title}
          subtitle={record?.created_at ? \`Creado el \${String(record.created_at).slice(0, 10)}\` : undefined}
          badges={record?.enabled === false ? <Badge variant="secondary">Inactivo</Badge> : <Badge variant="success">Activo</Badge>}
        />
      )}
      <EntityDetail entity=${s(entity.key)} recordId={id} />
    </ModulePage>
  )
}
`
}

function formulario(entity, fields) {
  const controls = fields.map((field) => `          ${fieldControl(field)}`).join('\n')
  const needsMail = fields.some((f) => f.type === 'email')
  const kit = ['Button', 'FormSection', 'ModulePage', 'useEntityMutations']
  const used = (name) => controls.includes(`<${name} `)
  for (const name of ['TextField', 'TextareaField', 'SelectField', 'DatePickerField', 'SwitchField', 'PhoneField']) if (used(name)) kit.push(name)
  return `import { useState } from 'react'
import { ${kit.sort().join(', ')} } from '@runly/ui'
import { ClipboardList, Save${needsMail ? ', Mail' : ''} } from 'lucide-react'

// Formulario a la medida con secciones y rejilla responsiva. Úsalo cuando
// necesites un diseño distinto al del Constructor; si no, usa <EntityForm>.
export default function Formulario${pascal(entity.key)}({ navigate }) {
  const [form, setForm] = useState({})
  const { create } = useEntityMutations(${s(entity.key)})
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  function submit(event) {
    event.preventDefault()
    create.mutate(form, { onSuccess: () => setForm({}) })
  }

  return (
    <ModulePage title={${s(`Nuevo: ${entity.label}`)}} icon={ClipboardList} onBack={() => navigate(-1)}>
      <form onSubmit={submit} className="space-y-6">
        <FormSection title="Datos generales" icon={ClipboardList} description="Completa la información principal.">
${controls}
        </FormSection>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setForm({})}>Limpiar</Button>
          <Button type="submit" disabled={create.isPending}><Save /> {create.isPending ? 'Guardando...' : 'Guardar'}</Button>
        </div>
      </form>
    </ModulePage>
  )
}
`
}

function tablero(entity, titleField, selectField) {
  const plural = entity.pluralLabel || `${entity.label}s`
  const optionCards = (selectField?.options ?? []).slice(0, 3).map((o) => {
    const value = o.value ?? o
    const label = o.label ?? value
    return `        <OptionStat value=${s(value)} label=${s(label)} />`
  }).join('\n')
  return `import { Card, CardContent, CardHeader, CardTitle, DataTable, EmptyState, ErrorState, ModulePage, StatCard, useEntityList } from '@runly/ui'
import { Activity, Inbox, LayoutDashboard, ListChecks } from 'lucide-react'

${selectField ? `function OptionStat({ value, label }) {
  const { data, isLoading } = useEntityList(${s(entity.key)}, { pageSize: 1, filters: { ${selectField.key}: value } })
  return <StatCard label={label} value={data?.pagination?.total ?? 0} icon={ListChecks} loading={isLoading} />
}

` : ''}const columns = [
${titleField ? `  { accessorKey: ${s(titleField)}, header: ${s(entity.fields.find((f) => f.key === titleField)?.label ?? titleField)} },\n` : ''}  { accessorKey: 'created_at', header: 'Creado', cell: ({ row }) => String(row.original.created_at ?? '').slice(0, 10) },
]

// Tablero: indicadores + registros recientes.
export default function Tablero${pascal(entity.key)}() {
  const { data, isLoading, error, refetch } = useEntityList(${s(entity.key)}, { pageSize: 5 })

  return (
    <ModulePage title={${s(`Tablero de ${plural.toLowerCase()}`)}} icon={LayoutDashboard} description="Resumen del módulo.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={${s(`Total de ${plural.toLowerCase()}`)}} value={data?.pagination?.total ?? 0} icon={Activity} loading={isLoading} />
${optionCards}
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Inbox className="h-4 w-4 text-primary" /> Recientes</CardTitle></CardHeader>
        <CardContent>
          {error ? <ErrorState description={error.message} onRetry={refetch} /> : (
            <DataTable
              columns={columns}
              data={data?.data ?? []}
              isLoading={isLoading}
              showToolbar={false}
              showPagination={false}
              emptyTitle="Sin registros"
              emptyIcon={Inbox}
            />
          )}
        </CardContent>
      </Card>
    </ModulePage>
  )
}
`
}

function leeme(entity) {
  return `# Pantallas de ejemplo

Pantallas de referencia para la entidad **${entity.label}** (\`${entity.key}\`), hechas con el kit de \`@runly/ui\` (ver \`docs/componentes.md\`). No se instalan: esta carpeta se ignora al subir el ZIP.

| Archivo | Qué muestra |
|---|---|
| \`Listado.jsx\` | \`ModulePage\` + \`EntityTable\` + alta y edición con \`EntityForm\` en un \`Sheet\` |
| \`Detalle.jsx\` | \`DetailHeader\` + \`EntityDetail\`, abierto con \`?id=\` |
| \`Formulario.jsx\` | Formulario a la medida con \`FormSection\` y \`useEntityMutations\` |
| \`Tablero.jsx\` | Indicadores con \`StatCard\` + recientes con \`useEntityList\` y \`DataTable\` |

Para usar una:

1. Cópiala a \`components/\` y regístrala en \`components/index.js\` con la clave \`<módulo>:<Componente>\`.
2. Crea la vista \`views/<nombre>.custom.js\` (tipo CUSTOM) y agrégala a \`views\` y, si va en el menú, a \`navigation\` del manifiesto.

Receta completa: \`docs/pantallas-react.md\`.
`
}

export function goldenScreenFiles(definition) {
  const entity = definition?.entities?.[0]
  if (!entity) return []
  const fields = (entity.fields ?? []).filter((field) => SIMPLE_TYPES.has(field.type))
  // Text column for the dashboard's recent list; never the id (falls back to
  // the creation date only).
  const titleField = (entity.fields ?? []).find((field) => ['text', 'email', 'phone', 'select'].includes(field.type))?.key ?? null
  const selectField = (entity.fields ?? []).find((field) => field.type === 'select' && field.options?.length)
  return [
    { path: `${EXAMPLES_DIR}/LEEME.md`, content: leeme(entity) },
    { path: `${EXAMPLES_DIR}/Listado.jsx`, content: listado(entity) },
    { path: `${EXAMPLES_DIR}/Detalle.jsx`, content: detalle(entity, titleField) },
    { path: `${EXAMPLES_DIR}/Formulario.jsx`, content: formulario(entity, fields) },
    { path: `${EXAMPLES_DIR}/Tablero.jsx`, content: tablero(entity, titleField, selectField) },
  ]
}
