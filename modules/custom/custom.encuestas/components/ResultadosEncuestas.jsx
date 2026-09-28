import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Button, Badge, EmptyState, ErrorState, Skeleton } from '@runly/ui'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest, questionTypeLabel, statusLabel } from './api.js'

function summarize(question, responses) {
  const values = responses.map((r) => r.respuestas?.[question.id]).filter((v) => v !== undefined && v !== null && v !== '')
  if (['opcion_unica', 'si_no', 'calificacion'].includes(question.tipo)) {
    const counts = new Map()
    values.forEach((v) => counts.set(String(v), (counts.get(String(v)) ?? 0) + 1))
    return { kind: 'chart', data: [...counts.entries()].map(([name, total]) => ({ name, total })) }
  }
  if (question.tipo === 'opcion_multiple') {
    const counts = new Map()
    values.flatMap((v) => Array.isArray(v) ? v : []).forEach((v) => counts.set(String(v), (counts.get(String(v)) ?? 0) + 1))
    return { kind: 'chart', data: [...counts.entries()].map(([name, total]) => ({ name, total })) }
  }
  if (question.tipo === 'numero') {
    const nums = values.map(Number).filter(Number.isFinite)
    const average = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
    return { kind: 'number', count: nums.length, average }
  }
  return { kind: 'text', values: values.map(String).slice(0, 8), count: values.length }
}

export default function ResultadosEncuestas({ token, companyId, apiBaseUrl }) {
  const [surveyId, setSurveyId] = useState(null)
  const surveysQuery = useQuery({
    queryKey: ['custom.encuestas', 'results-surveys', companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: '/encuestas/surveys?pageSize=100' }),
  })

  const selected = useMemo(
    () => surveysQuery.data?.data?.find((s) => s.id === surveyId) ?? null,
    [surveysQuery.data, surveyId],
  )

  const questionsQuery = useQuery({
    queryKey: ['custom.encuestas', 'results-questions', surveyId],
    enabled: Boolean(surveyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${surveyId}/questions` }),
  })

  const responsesQuery = useQuery({
    queryKey: ['custom.encuestas', 'responses', surveyId],
    enabled: Boolean(surveyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${surveyId}/responses?pageSize=100` }),
  })

  const responses = responsesQuery.data?.data ?? []
  const questions = questionsQuery.data?.data ?? []

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader title="Resultados de encuestas" description="Consulta respuestas y distribuciones por pregunta." />
      {surveysQuery.isLoading ? <Skeleton className="h-64 w-full" /> : surveysQuery.error ? (
        <ErrorState title="No se pudieron cargar las encuestas" description={surveysQuery.error.message} />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader><CardTitle>Encuestas</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!surveysQuery.data?.data?.length ? <EmptyState title="Sin encuestas" description="Todavía no hay información para analizar." /> : surveysQuery.data.data.map((survey) => (
                <Button type="button" variant="ghost" key={survey.id} onClick={() => setSurveyId(survey.id)} className={`w-full rounded-lg border p-3 text-left ${surveyId === survey.id ? 'border-[hsl(var(--brand-primary))] bg-[hsl(var(--muted))]' : 'border-[hsl(var(--border))]'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{survey.titulo}</span><Badge>{statusLabel(survey.estado)}</Badge></div>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{survey.respuestas_total ?? 0} respuestas</p>
                </Button>
              ))}
            </CardContent>
          </Card>

          {!selected ? (
            <Card><CardContent className="p-6"><EmptyState title="Selecciona una encuesta" description="Elige una encuesta para ver sus resultados." /></CardContent></Card>
          ) : responsesQuery.isLoading || questionsQuery.isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : responsesQuery.error || questionsQuery.error ? (
            <ErrorState title="No se pudieron cargar los resultados" description={(responsesQuery.error || questionsQuery.error)?.message} />
          ) : (
            <div className="space-y-5">
              <Card>
                <CardHeader><CardTitle>{selected.titulo}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div><p className="text-sm text-[hsl(var(--muted-foreground))]">Respuestas</p><p className="text-3xl font-semibold">{responsesQuery.data?.pagination?.total ?? responses.length}</p></div>
                  <div><p className="text-sm text-[hsl(var(--muted-foreground))]">Preguntas</p><p className="text-3xl font-semibold">{questions.length}</p></div>
                  <div><p className="text-sm text-[hsl(var(--muted-foreground))]">Estado</p><p className="mt-2"><Badge>{statusLabel(selected.estado)}</Badge></p></div>
                </CardContent>
              </Card>

              {!responses.length ? <EmptyState title="Aún no hay respuestas" description="Las respuestas aparecerán aquí en cuanto alguien complete la encuesta." /> : questions.map((question, index) => {
                const summary = summarize(question, responses)
                return (
                  <Card key={question.id}>
                    <CardHeader><CardTitle>{index + 1}. {question.texto}</CardTitle><p className="text-sm text-[hsl(var(--muted-foreground))]">{questionTypeLabel(question.tipo)}</p></CardHeader>
                    <CardContent>
                      {summary.kind === 'chart' ? (
                        summary.data.length ? <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="total" /></BarChart></ResponsiveContainer></div> : <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin respuestas para esta pregunta.</p>
                      ) : summary.kind === 'number' ? (
                        <div className="grid grid-cols-2 gap-4"><div><p className="text-sm text-[hsl(var(--muted-foreground))]">Respuestas</p><p className="text-2xl font-semibold">{summary.count}</p></div><div><p className="text-sm text-[hsl(var(--muted-foreground))]">Promedio</p><p className="text-2xl font-semibold">{summary.average.toFixed(2)}</p></div></div>
                      ) : (
                        <div className="space-y-2">{summary.values.length ? summary.values.map((value, i) => <div key={`${value}-${i}`} className="rounded-lg border border-[hsl(var(--border))] p-3 text-sm">{value}</div>) : <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin respuestas para esta pregunta.</p>}</div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}

              {responses.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Respuestas individuales</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {responses.slice(0, 20).map((response, index) => (
                      <div key={response.id} className="rounded-lg border border-[hsl(var(--border))] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Respuesta #{responses.length - index}</p><span className="text-xs text-[hsl(var(--muted-foreground))]">{response.enviado_en || ''}</span></div>
                        {(response.respondente_nombre || response.respondente_correo) && <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{response.respondente_nombre || 'Sin nombre'} · {response.respondente_correo || 'Sin correo'}</p>}
                        {response.respondente_user_id && <p className="mt-2 text-sm">Identity: {response.respondente_user_nombre || response.respondente_user_correo || response.respondente_user_id}</p>}
                        {response.respondente_user_correo && <p className="text-xs text-[hsl(var(--muted-foreground))]">{response.respondente_user_correo}</p>}
                        {response.respondente_empleado_nombre && <p className="mt-1 text-sm font-medium">Colaborador: {response.respondente_empleado_nombre}</p>}
                        {(response.items_asignados ?? []).length > 0 && (
                          <div className="mt-3 space-y-2">
                            <p className="text-sm font-medium">Inventario asignado al momento de responder ({response.items_asignados_total ?? response.items_asignados.length})</p>
                            {(response.items_asignados ?? []).map((item) => (
                              <div key={item.id} className="rounded-md border border-[hsl(var(--border))] p-2 text-sm">
                                <p className="font-medium">{[item.assetTag, item.name].filter(Boolean).join(' · ') || item.id}</p>
                                <p className="text-xs text-[hsl(var(--muted-foreground))]">{[item.model, item.serialNumber ? `SN ${item.serialNumber}` : null, item.locationName].filter(Boolean).join(' · ') || 'Sin detalle adicional'}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
