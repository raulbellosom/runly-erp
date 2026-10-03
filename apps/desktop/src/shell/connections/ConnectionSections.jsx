import { useQuery } from '@tanstack/react-query'
import { Badge, Card, CardContent, CardHeader, CardTitle, IconGlyph } from '@runly/ui'
import { Plug } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'
import { displayValue } from './connectionFormat.js'

// Read-only connection sections on a core record's detail (spec
// 2026-10-03-rme3-module-platform-v2 §8.2): `fields` as a two-column grid,
// `related` as a compact list with the total.

const kebab = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase()

function SectionTitle({ section }) {
  return (
    <CardTitle className="flex items-center gap-2 text-base">
      {section.icon ? <IconGlyph name={kebab(section.icon)} className="h-4 w-4 text-primary" /> : <Plug className="h-4 w-4 text-primary" />}
      {section.label}
      <span className="text-xs font-normal text-muted-foreground">· {section.moduleName}</span>
    </CardTitle>
  )
}

function FieldsGrid({ fields, values }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
      {fields.map((field) => (
        <div key={field.name} className="min-w-0 space-y-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
          <dd className="break-words text-sm text-foreground">{displayValue(field, values?.[field.name])}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ConnectionSections({ targetType, targetId }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  const { data: sections = [] } = useQuery({
    queryKey: ['connections', 'records', targetType, targetId, 'detail', activeCompanyId],
    queryFn: async () => (await runly.connections.records(targetType, targetId, 'detail', token))?.data ?? [],
    enabled: Boolean(token && targetType && targetId),
    // Connected data changes from other modules, which cannot invalidate
    // this cache: always refetch when the screen opens.
    staleTime: 0,
    refetchOnMount: 'always',
  })
  if (!sections.length) return null

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <Card key={section.connectionId}>
          <CardHeader className="pb-3"><SectionTitle section={section} /></CardHeader>
          <CardContent>
            {section.kind === 'fields' ? (
              section.record
                ? <FieldsGrid fields={section.fields} values={section.record.values} />
                : <p className="text-sm text-muted-foreground">Sin datos registrados.</p>
            ) : (
              <div className="space-y-2">
                {section.records.length ? section.records.map((record) => (
                  <div key={record.id} className="rounded-xl border border-border p-3">
                    <FieldsGrid fields={section.fields} values={record.values} />
                  </div>
                )) : <p className="text-sm text-muted-foreground">Sin registros.</p>}
                {section.total > section.records.length && (
                  <Badge variant="secondary">{section.total - section.records.length} más en {section.moduleName}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
