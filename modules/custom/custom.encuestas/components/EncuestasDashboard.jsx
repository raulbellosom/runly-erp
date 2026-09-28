import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Button, Badge, EmptyState, ErrorState, Skeleton } from '@runly/ui'
import { BarChart3, ClipboardList, FilePenLine, MessageSquareText, Plus } from 'lucide-react'
import { apiRequest, statusLabel } from './api.js'

export default function EncuestasDashboard({ token, companyId, apiBaseUrl, navigate }) {
  const query = useQuery({
    queryKey: ['custom.encuestas', 'dashboard', companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: '/encuestas/dashboard' }),
  })

  const data = query.data?.data
  const stats = [
    { label: 'Encuestas', value: data?.surveys?.total ?? 0, icon: ClipboardList },
    { label: 'Publicadas', value: data?.surveys?.publicadas ?? 0, icon: BarChart3 },
    { label: 'Borradores', value: data?.surveys?.borradores ?? 0, icon: FilePenLine },
    { label: 'Respuestas', value: data?.responses?.total ?? 0, icon: MessageSquareText },
  ]

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Encuestas"
        description="Crea, publica y analiza encuestas desde Runly."
        actions={<Button onClick={() => navigate('/app/m/custom.encuestas/constructor')}><Plus className="mr-2 h-4 w-4" />Crear encuesta</Button>}
      />

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">{[0,1,2,3].map((x) => <Skeleton key={x} className="h-28 w-full" />)}</div>
      ) : query.error ? (
        <ErrorState title="No se pudo cargar el panel" description={query.error.message} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="flex items-center justify-between p-5">
                  <div><p className="text-sm text-[hsl(var(--muted-foreground))]">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p></div>
                  <div className="rounded-lg bg-[hsl(var(--muted))] p-3"><Icon className="h-5 w-5" /></div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Actividad reciente</CardTitle><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Tus encuestas modificadas recientemente.</p></div>
              <Button variant="outline" onClick={() => navigate('/app/m/custom.encuestas/constructor')}>Administrar</Button>
            </CardHeader>
            <CardContent>
              {!data?.recent?.length ? (
                <EmptyState title="Todavía no hay encuestas" description="Crea la primera encuesta para comenzar a recopilar respuestas." />
              ) : (
                <div className="space-y-3">
                  {data.recent.map((survey) => (
                    <Button
                      type="button"
                      variant="ghost"
                      key={survey.id}
                      onClick={() => navigate('/app/m/custom.encuestas/constructor')}
                      className="flex w-full items-center justify-between rounded-lg border border-[hsl(var(--border))] p-4 text-left transition hover:bg-[hsl(var(--muted))]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{survey.titulo}</p>
                        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{survey.preguntas_total ?? 0} preguntas · {survey.respuestas_total ?? 0} respuestas</p>
                      </div>
                      <Badge>{statusLabel(survey.estado)}</Badge>
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
