import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Button, TextField, TextareaField,
  Badge, EmptyState, ErrorState, Skeleton,
} from '@runly/ui'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, CirclePlus, Copy, Eye, Plus, Save, Trash2 } from 'lucide-react'
import { apiRequest, questionTypeLabel, statusLabel } from './api.js'

const emptySurvey = {
  titulo: '', descripcion: '', anonima: true, solicitar_contacto: false, capturar_contexto_inventario: false,
  fecha_inicio: '', fecha_cierre: '', mensaje_final: 'Gracias por responder esta encuesta.',
}
const emptyQuestion = { texto: '', tipo: 'texto_corto', obligatoria: false, opcionesTexto: '', ayuda: '' }
const types = ['texto_corto', 'texto_largo', 'opcion_unica', 'opcion_multiple', 'si_no', 'numero', 'calificacion']

export default function EncuestasStudio({ token, companyId, apiBaseUrl, navigate }) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)
  const [surveyForm, setSurveyForm] = useState(emptySurvey)
  const [creating, setCreating] = useState(false)
  const [questionForm, setQuestionForm] = useState(emptyQuestion)
  const [editingQuestionId, setEditingQuestionId] = useState(null)

  const surveysQuery = useQuery({
    queryKey: ['custom.encuestas', 'surveys', companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: '/encuestas/surveys?pageSize=100' }),
  })

  useEffect(() => {
    if (!selectedId && surveysQuery.data?.data?.length) setSelectedId(surveysQuery.data.data[0].id)
  }, [selectedId, surveysQuery.data])

  const selected = useMemo(
    () => surveysQuery.data?.data?.find((item) => item.id === selectedId) ?? null,
    [surveysQuery.data, selectedId],
  )

  useEffect(() => {
    if (!selected) return
    setSurveyForm({
      titulo: selected.titulo ?? '',
      descripcion: selected.descripcion ?? '',
      anonima: Boolean(selected.anonima),
      solicitar_contacto: Boolean(selected.solicitar_contacto),
      capturar_contexto_inventario: Boolean(selected.capturar_contexto_inventario),
      fecha_inicio: selected.fecha_inicio ?? '',
      fecha_cierre: selected.fecha_cierre ?? '',
      mensaje_final: selected.mensaje_final ?? '',
    })
    setCreating(false)
  }, [selected])

  const questionsQuery = useQuery({
    queryKey: ['custom.encuestas', 'questions', selectedId, companyId],
    enabled: Boolean(selectedId && token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${selectedId}/questions` }),
  })

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['custom.encuestas', 'surveys'] }),
      qc.invalidateQueries({ queryKey: ['custom.encuestas', 'questions'] }),
      qc.invalidateQueries({ queryKey: ['custom.encuestas', 'dashboard'] }),
    ])
  }

  const saveSurvey = useMutation({
    mutationFn: async () => {
      if (!surveyForm.titulo.trim()) throw new Error('Escribe un título para la encuesta.')
      return apiRequest({
        apiBaseUrl, token, companyId,
        path: creating ? '/encuestas/surveys' : `/encuestas/surveys/${selectedId}`,
        method: creating ? 'POST' : 'PATCH',
        body: { ...surveyForm, titulo: surveyForm.titulo.trim() },
      })
    },
    onSuccess: async (payload) => {
      if (creating) setSelectedId(payload.data.id)
      setCreating(false)
      await refresh()
      toast.success('Encuesta guardada.')
    },
    onError: (error) => toast.error(error.message),
  })

  const changeStatus = useMutation({
    mutationFn: (estado) => apiRequest({
      apiBaseUrl, token, companyId, path: `/encuestas/surveys/${selectedId}/status`, method: 'PATCH', body: { estado },
    }),
    onSuccess: async () => { await refresh(); toast.success('Estado actualizado.') },
    onError: (error) => toast.error(error.message),
  })

  const deleteSurvey = useMutation({
    mutationFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${selectedId}`, method: 'DELETE' }),
    onSuccess: async () => {
      setSelectedId(null)
      setSurveyForm(emptySurvey)
      await refresh()
      toast.success('Encuesta eliminada.')
    },
    onError: (error) => toast.error(error.message),
  })

  const saveQuestion = useMutation({
    mutationFn: () => {
      if (!questionForm.texto.trim()) throw new Error('Escribe la pregunta.')
      const opciones = questionForm.opcionesTexto.split('\n').map((x) => x.trim()).filter(Boolean)
      if (['opcion_unica', 'opcion_multiple'].includes(questionForm.tipo) && opciones.length < 2) {
        throw new Error('Agrega al menos dos opciones, una por línea.')
      }
      return apiRequest({
        apiBaseUrl, token, companyId,
        path: editingQuestionId
          ? `/encuestas/surveys/${selectedId}/questions/${editingQuestionId}`
          : `/encuestas/surveys/${selectedId}/questions`,
        method: editingQuestionId ? 'PATCH' : 'POST',
        body: {
          texto: questionForm.texto.trim(), tipo: questionForm.tipo,
          obligatoria: questionForm.obligatoria, opciones, ayuda: questionForm.ayuda || null,
        },
      })
    },
    onSuccess: async () => {
      setQuestionForm(emptyQuestion)
      setEditingQuestionId(null)
      await refresh()
      toast.success('Pregunta guardada.')
    },
    onError: (error) => toast.error(error.message),
  })

  const removeQuestion = useMutation({
    mutationFn: (questionId) => apiRequest({
      apiBaseUrl, token, companyId, path: `/encuestas/surveys/${selectedId}/questions/${questionId}`, method: 'DELETE',
    }),
    onSuccess: async () => { await refresh(); toast.success('Pregunta eliminada.') },
    onError: (error) => toast.error(error.message),
  })

  const reorderQuestion = useMutation({
    mutationFn: ({ id, posicion }) => apiRequest({
      apiBaseUrl, token, companyId, path: `/encuestas/surveys/${selectedId}/questions/${id}`, method: 'PATCH', body: { posicion },
    }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })

  const beginNew = () => {
    setSelectedId(null)
    setCreating(true)
    setSurveyForm(emptySurvey)
    setQuestionForm(emptyQuestion)
    setEditingQuestionId(null)
  }

  const editQuestion = (question) => {
    setEditingQuestionId(question.id)
    setQuestionForm({
      texto: question.texto ?? '',
      tipo: question.tipo ?? 'texto_corto',
      obligatoria: Boolean(question.obligatoria),
      opcionesTexto: (question.opciones ?? []).join('\n'),
      ayuda: question.ayuda ?? '',
    })
  }

  const questions = questionsQuery.data?.data ?? []

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Constructor de encuestas"
        description="Diseña formularios, publica y controla su disponibilidad."
        actions={<Button onClick={beginNew}><Plus className="mr-2 h-4 w-4" />Nueva encuesta</Button>}
      />

      {surveysQuery.isLoading ? <Skeleton className="h-96 w-full" /> : surveysQuery.error ? (
        <ErrorState title="No se pudieron cargar las encuestas" description={surveysQuery.error.message} />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader><CardTitle>Encuestas</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!surveysQuery.data?.data?.length && !creating ? (
                <EmptyState title="Sin encuestas" description="Crea una encuesta para comenzar." />
              ) : surveysQuery.data?.data?.map((survey) => (
                <Button
                  type="button"
                  variant="ghost"
                  key={survey.id}
                  onClick={() => setSelectedId(survey.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${selectedId === survey.id ? 'border-[hsl(var(--brand-primary))] bg-[hsl(var(--muted))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`}
                >
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{survey.titulo}</span><Badge>{statusLabel(survey.estado)}</Badge></div>
                  <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{survey.preguntas_total ?? 0} preguntas · {survey.respuestas_total ?? 0} respuestas</p>
                </Button>
              ))}
            </CardContent>
          </Card>

          {!selected && !creating ? (
            <Card><CardContent className="p-6"><EmptyState title="Selecciona una encuesta" description="Elige una encuesta de la lista o crea una nueva." /></CardContent></Card>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div><CardTitle>{creating ? 'Nueva encuesta' : 'Configuración'}</CardTitle><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Información y comportamiento general.</p></div>
                  {!creating && <Badge>{statusLabel(selected?.estado)}</Badge>}
                </CardHeader>
                <CardContent className="space-y-4">
                  <TextField label="Título" value={surveyForm.titulo} onChange={(e) => setSurveyForm((s) => ({ ...s, titulo: e.target.value }))} placeholder="Ej. Encuesta de satisfacción" />
                  <TextareaField label="Descripción" value={surveyForm.descripcion} onChange={(e) => setSurveyForm((s) => ({ ...s, descripcion: e.target.value }))} placeholder="Explica brevemente el propósito de la encuesta." />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextField label="Inicio" value={surveyForm.fecha_inicio} onChange={(e) => setSurveyForm((s) => ({ ...s, fecha_inicio: e.target.value }))} placeholder="2026-10-01 08:00" />
                    <TextField label="Cierre" value={surveyForm.fecha_cierre} onChange={(e) => setSurveyForm((s) => ({ ...s, fecha_cierre: e.target.value }))} placeholder="2026-10-31 18:00" />
                  </div>
                  <TextareaField label="Mensaje al finalizar" value={surveyForm.mensaje_final} onChange={(e) => setSurveyForm((s) => ({ ...s, mensaje_final: e.target.value }))} />
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Button type="button" variant="outline" onClick={() => setSurveyForm((s) => ({ ...s, anonima: !s.anonima }))} className="rounded-lg border border-[hsl(var(--border))] p-4 text-left">
                      <p className="font-medium">Encuesta anónima</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{surveyForm.anonima ? 'Activada' : 'Desactivada'}</p>
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setSurveyForm((s) => ({ ...s, solicitar_contacto: !s.solicitar_contacto }))} className="rounded-lg border border-[hsl(var(--border))] p-4 text-left">
                      <p className="font-medium">Solicitar contacto</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{surveyForm.solicitar_contacto ? 'Nombre y correo' : 'No solicitar datos'}</p>
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setSurveyForm((s) => ({ ...s, capturar_contexto_inventario: !s.capturar_contexto_inventario }))} className="rounded-lg border border-[hsl(var(--border))] p-4 text-left">
                      <p className="font-medium">Identidad e inventario asignado</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{surveyForm.capturar_contexto_inventario ? 'Capturar al responder' : 'No capturar'}</p>
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => saveSurvey.mutate()} disabled={saveSurvey.isPending}><Save className="mr-2 h-4 w-4" />Guardar</Button>
                    {!creating && selected?.estado !== 'publicada' && <Button variant="outline" onClick={() => changeStatus.mutate('publicada')}>Publicar</Button>}
                    {!creating && selected?.estado === 'publicada' && <Button variant="outline" onClick={() => changeStatus.mutate('cerrada')}>Cerrar respuestas</Button>}
                    {!creating && selected?.estado !== 'borrador' && <Button variant="outline" onClick={() => changeStatus.mutate('borrador')}>Volver a borrador</Button>}
                    {!creating && <Button variant="outline" onClick={() => navigate('/app/m/custom.encuestas/responder')}><Eye className="mr-2 h-4 w-4" />Vista de respuesta</Button>}
                    {!creating && <Button variant="outline" onClick={() => navigate('/app/m/custom.encuestas/resultados')}>Resultados</Button>}
                    {!creating && <Button variant="outline" onClick={() => deleteSurvey.mutate()}><Trash2 className="mr-2 h-4 w-4" />Eliminar</Button>}
                  </div>
                </CardContent>
              </Card>

              {!creating && (
                <>
                  <Card>
                    <CardHeader><CardTitle>Preguntas</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {questionsQuery.isLoading ? <Skeleton className="h-36 w-full" /> : questionsQuery.error ? (
                        <ErrorState title="No se pudieron cargar las preguntas" description={questionsQuery.error.message} />
                      ) : !questions.length ? (
                        <EmptyState title="Sin preguntas" description="Agrega la primera pregunta de esta encuesta." />
                      ) : questions.map((question, index) => (
                        <div key={question.id} className="rounded-lg border border-[hsl(var(--border))] p-4">
                          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{index + 1}. {question.texto}</span>{question.obligatoria && <Badge>Obligatoria</Badge>}</div>
                              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{questionTypeLabel(question.tipo)}{question.opciones?.length ? ` · ${question.opciones.length} opciones` : ''}</p>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="outline" onClick={() => reorderQuestion.mutate({ id: question.id, posicion: Math.max(0, Number(question.posicion ?? index + 1) - 1) })} disabled={index === 0}><ChevronUp className="h-4 w-4" /></Button>
                              <Button variant="outline" onClick={() => reorderQuestion.mutate({ id: question.id, posicion: Number(question.posicion ?? index + 1) + 1 })} disabled={index === questions.length - 1}><ChevronDown className="h-4 w-4" /></Button>
                              <Button variant="outline" onClick={() => editQuestion(question)}>Editar</Button>
                              <Button variant="outline" onClick={() => removeQuestion.mutate(question.id)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle>{editingQuestionId ? 'Editar pregunta' : 'Agregar pregunta'}</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <TextField label="Pregunta" value={questionForm.texto} onChange={(e) => setQuestionForm((s) => ({ ...s, texto: e.target.value }))} placeholder="Escribe la pregunta" />
                      <div>
                        <p className="mb-2 text-sm font-medium">Tipo de respuesta</p>
                        <div className="flex flex-wrap gap-2">{types.map((type) => <Button key={type} type="button" variant={questionForm.tipo === type ? 'default' : 'outline'} onClick={() => setQuestionForm((s) => ({ ...s, tipo: type }))}>{questionTypeLabel(type)}</Button>)}</div>
                      </div>
                      {['opcion_unica', 'opcion_multiple'].includes(questionForm.tipo) && (
                        <TextareaField label="Opciones" description="Una opción por línea." value={questionForm.opcionesTexto} onChange={(e) => setQuestionForm((s) => ({ ...s, opcionesTexto: e.target.value }))} placeholder={'Excelente\nBueno\nRegular\nMalo'} />
                      )}
                      <TextField label="Texto de ayuda" value={questionForm.ayuda} onChange={(e) => setQuestionForm((s) => ({ ...s, ayuda: e.target.value }))} placeholder="Opcional" />
                      <Button type="button" variant="outline" onClick={() => setQuestionForm((s) => ({ ...s, obligatoria: !s.obligatoria }))} className="w-full rounded-lg border border-[hsl(var(--border))] p-4 text-left">
                        <p className="font-medium">Respuesta obligatoria</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{questionForm.obligatoria ? 'Sí' : 'No'}</p>
                      </Button>
                      <div className="flex gap-2">
                        <Button onClick={() => saveQuestion.mutate()} disabled={saveQuestion.isPending}><CirclePlus className="mr-2 h-4 w-4" />{editingQuestionId ? 'Guardar cambios' : 'Agregar pregunta'}</Button>
                        {editingQuestionId && <Button variant="outline" onClick={() => { setEditingQuestionId(null); setQuestionForm(emptyQuestion) }}>Cancelar edición</Button>}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
