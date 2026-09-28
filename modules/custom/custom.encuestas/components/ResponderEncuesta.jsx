import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Button, TextField, TextareaField,
  Badge, EmptyState, ErrorState, Skeleton, buildApiHeaders,
} from '@runly/ui'
import { toast } from 'sonner'
import { Check, Package, Send, UserRound } from 'lucide-react'
import { apiRequest, questionTypeLabel } from './api.js'

function QuestionInput({ question, value, onChange }) {
  if (question.tipo === 'texto_largo') {
    return <TextareaField value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Escribe tu respuesta" />
  }
  if (question.tipo === 'texto_corto') {
    return <TextField value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Escribe tu respuesta" />
  }
  if (question.tipo === 'numero') {
    return <TextField value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Escribe un número" />
  }
  if (question.tipo === 'si_no') {
    return <div className="flex gap-2">{[['Sí', true], ['No', false]].map(([label, option]) => <Button key={label} type="button" variant={value === option ? 'default' : 'outline'} onClick={() => onChange(option)}>{label}</Button>)}</div>
  }
  if (question.tipo === 'calificacion') {
    return <div className="flex flex-wrap gap-2">{[1,2,3,4,5].map((score) => <Button key={score} type="button" variant={value === score ? 'default' : 'outline'} onClick={() => onChange(score)}>{score}</Button>)}</div>
  }
  if (question.tipo === 'opcion_multiple') {
    const selected = Array.isArray(value) ? value : []
    return <div className="flex flex-wrap gap-2">{(question.opciones ?? []).map((option) => {
      const active = selected.includes(option)
      return <Button key={option} type="button" variant={active ? 'default' : 'outline'} onClick={() => onChange(active ? selected.filter((x) => x !== option) : [...selected, option])}>{active && <Check className="mr-2 h-4 w-4" />}{option}</Button>
    })}</div>
  }
  return <div className="flex flex-wrap gap-2">{(question.opciones ?? []).map((option) => <Button key={option} type="button" variant={value === option ? 'default' : 'outline'} onClick={() => onChange(option)}>{option}</Button>)}</div>
}

async function resolveTargets({ apiBaseUrl, token, companyId, type, ids }) {
  if (!ids?.length) return []
  const response = await fetch(`${apiBaseUrl}/relation-targets/${type}/resolve`, {
    method: 'POST',
    headers: buildApiHeaders(token, companyId, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ids: ids.slice(0, 100) }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error ?? 'No se pudieron resolver los registros relacionados.')
  return payload.data ?? []
}

export default function ResponderEncuesta({ token, companyId, apiBaseUrl }) {
  const [surveyId, setSurveyId] = useState(null)
  const [answers, setAnswers] = useState({})
  const [contact, setContact] = useState({ nombre: '', correo: '' })
  const [completed, setCompleted] = useState(false)

  const surveysQuery = useQuery({
    queryKey: ['custom.encuestas', 'published', companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: '/encuestas/surveys?pageSize=100&estado=publicada' }),
  })

  const activeSurvey = useMemo(() => surveysQuery.data?.data?.find((survey) => survey.id === surveyId) ?? null, [surveysQuery.data, surveyId])

  const questionsQuery = useQuery({
    queryKey: ['custom.encuestas', 'respond', surveyId, companyId],
    enabled: Boolean(surveyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${surveyId}/questions` }),
  })

  const contextQuery = useQuery({
    queryKey: ['custom.encuestas', 'respondent-context', companyId],
    enabled: Boolean(activeSurvey?.capturar_contexto_inventario && token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: '/encuestas/respondent-context' }),
  })

  const employeeResolvedQuery = useQuery({
    queryKey: ['custom.encuestas', 'employee-resolved', contextQuery.data?.data?.employeeId],
    enabled: Boolean(contextQuery.data?.data?.employeeId),
    queryFn: () => resolveTargets({ apiBaseUrl, token, companyId, type: 'hr_employee', ids: [contextQuery.data.data.employeeId] }),
  })

  const itemsResolvedQuery = useQuery({
    queryKey: ['custom.encuestas', 'items-resolved', contextQuery.data?.data?.assignedItemIds],
    enabled: Boolean(contextQuery.data?.data?.assignedItemIds?.length),
    queryFn: () => resolveTargets({ apiBaseUrl, token, companyId, type: 'inventory_item', ids: contextQuery.data.data.assignedItemIds }),
  })

  const submit = useMutation({
    mutationFn: () => apiRequest({
      apiBaseUrl, token, companyId, path: `/encuestas/surveys/${surveyId}/responses`, method: 'POST',
      body: { respondente_nombre: contact.nombre || null, respondente_correo: contact.correo || null, respuestas: answers },
    }),
    onSuccess: () => { setCompleted(true); toast.success('Respuesta enviada.') },
    onError: (error) => toast.error(error.message),
  })

  const selectSurvey = (id) => {
    setSurveyId(id)
    setAnswers({})
    setContact({ nombre: '', correo: '' })
    setCompleted(false)
  }

  const context = contextQuery.data?.data
  const employee = employeeResolvedQuery.data?.[0]
  const resolvedItems = itemsResolvedQuery.data ?? []

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader title="Responder encuesta" description="Contesta encuestas publicadas con tu sesión activa de Runly." />

      {surveysQuery.isLoading ? <Skeleton className="h-72 w-full" /> : surveysQuery.error ? (
        <ErrorState title="No se pudieron cargar las encuestas" description={surveysQuery.error.message} />
      ) : !surveysQuery.data?.data?.length ? (
        <EmptyState title="No hay encuestas publicadas" description="Publica una encuesta desde el constructor para habilitar respuestas." />
      ) : !activeSurvey ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {surveysQuery.data.data.map((survey) => (
            <Card key={survey.id} className="cursor-pointer" onClick={() => selectSurvey(survey.id)}>
              <CardHeader><div className="flex items-start justify-between gap-2"><CardTitle>{survey.titulo}</CardTitle><Badge>Publicada</Badge></div></CardHeader>
              <CardContent>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{survey.descripcion || 'Sin descripción.'}</p>
                <p className="mt-4 text-sm">{survey.preguntas_total ?? 0} preguntas</p>
                {survey.capturar_contexto_inventario && <Badge className="mt-3" variant="outline">Incluye identidad e inventario asignado</Badge>}
                <Button className="mt-4 w-full" onClick={() => selectSurvey(survey.id)}>Responder</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : completed ? (
        <Card><CardContent className="p-8"><EmptyState title="Respuesta registrada" description={activeSurvey.mensaje_final || 'Gracias por participar.'} /><div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => selectSurvey(null)}>Responder otra encuesta</Button></div></CardContent></Card>
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          <Card><CardHeader><CardTitle>{activeSurvey.titulo}</CardTitle></CardHeader><CardContent><p className="text-[hsl(var(--muted-foreground))]">{activeSurvey.descripcion || 'Completa las siguientes preguntas.'}</p></CardContent></Card>

          {activeSurvey.capturar_contexto_inventario && (
            contextQuery.isLoading ? <Skeleton className="h-44 w-full" /> : contextQuery.error ? (
              <ErrorState title="No se pudo cargar tu contexto" description={`${contextQuery.error.message} Verifica permisos de RR. HH. e Inventario.`} />
            ) : (
              <Card>
                <CardHeader><CardTitle>Tu identidad e inventario asignado</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-4">
                    <UserRound className="mt-0.5 h-5 w-5" />
                    <div><p className="font-medium">{employee?.title || context?.employeeName || 'Usuario sin colaborador vinculado'}</p><p className="text-sm text-[hsl(var(--muted-foreground))]">{employee?.subtitle || context?.employeeCode || 'La sesión se registrará con tu usuario de Identity.'}</p></div>
                  </div>
                  {!context?.employeeId ? (
                    <EmptyState title="Sin colaborador vinculado" description="Tu cuenta de Identity no está vinculada a un colaborador de RR. HH.; no se encontraron artículos asignados." />
                  ) : context.assignedItemIds?.length === 0 ? (
                    <EmptyState title="Sin artículos asignados" description="Inventario no tiene artículos activos asignados a este colaborador." />
                  ) : itemsResolvedQuery.isLoading ? <Skeleton className="h-28 w-full" /> : itemsResolvedQuery.error ? (
                    <ErrorState title="No se pudieron resolver los artículos" description={itemsResolvedQuery.error.message} />
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2"><Package className="h-4 w-4" /><p className="font-medium">{resolvedItems.length} artículo(s) asignado(s)</p></div>
                      {resolvedItems.map((item) => <div key={item.id} className="rounded-lg border border-[hsl(var(--border))] p-3"><p className="font-medium">{item.title}</p>{item.subtitle && <p className="text-sm text-[hsl(var(--muted-foreground))]">{item.subtitle}</p>}</div>)}
                    </div>
                  )}
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">Sesión: {context?.userName || context?.userEmail || context?.userProfileId}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Esta información se obtiene de Identity/RR. HH. e Inventario y se guarda como una fotografía junto con tu respuesta.</p>
                </CardContent>
              </Card>
            )
          )}

          {activeSurvey.solicitar_contacto && <Card><CardHeader><CardTitle>Datos de contacto</CardTitle></CardHeader><CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2"><TextField label="Nombre" value={contact.nombre} onChange={(e) => setContact((x) => ({ ...x, nombre: e.target.value }))} /><TextField label="Correo electrónico" value={contact.correo} onChange={(e) => setContact((x) => ({ ...x, correo: e.target.value }))} /></CardContent></Card>}

          {questionsQuery.isLoading ? <Skeleton className="h-80 w-full" /> : questionsQuery.error ? (
            <ErrorState title="No se pudieron cargar las preguntas" description={questionsQuery.error.message} />
          ) : (questionsQuery.data?.data ?? []).map((question, index) => (
            <Card key={question.id}><CardContent className="space-y-3 p-5"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{index + 1}. {question.texto}</p>{question.obligatoria && <Badge>Obligatoria</Badge>}</div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{question.ayuda || questionTypeLabel(question.tipo)}</p></div><QuestionInput question={question} value={answers[question.id]} onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))} /></CardContent></Card>
          ))}

          <div className="flex flex-wrap gap-2"><Button onClick={() => submit.mutate()} disabled={submit.isPending || (activeSurvey.capturar_contexto_inventario && contextQuery.isLoading)}><Send className="mr-2 h-4 w-4" />Enviar respuestas</Button><Button variant="outline" onClick={() => selectSurvey(null)}>Cambiar encuesta</Button></div>
        </div>
      )}
    </div>
  )
}
