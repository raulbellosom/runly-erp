var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/api.js
import { buildApiHeaders } from "@runly/ui";
async function apiRequest({ apiBaseUrl, token, companyId, path, method = "GET", body }) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...buildApiHeaders(token, companyId),
      ...body !== void 0 ? { "Content-Type": "application/json" } : {}
    },
    ...body !== void 0 ? { body: JSON.stringify(body) } : {}
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "La operaci\xF3n no pudo completarse.");
  return payload;
}
var statusLabel, questionTypeLabel;
var init_api = __esm({
  "../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/api.js"() {
    statusLabel = (status) => ({
      borrador: "Borrador",
      publicada: "Publicada",
      cerrada: "Cerrada"
    })[status] ?? status;
    questionTypeLabel = (type) => ({
      texto_corto: "Texto corto",
      texto_largo: "Texto largo",
      opcion_unica: "Opci\xF3n \xFAnica",
      opcion_multiple: "Opci\xF3n m\xFAltiple",
      si_no: "S\xED / No",
      numero: "N\xFAmero",
      calificacion: "Calificaci\xF3n 1\u20135"
    })[type] ?? type;
  }
});

// ../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/EncuestasDashboard.jsx
var EncuestasDashboard_exports = {};
__export(EncuestasDashboard_exports, {
  default: () => EncuestasDashboard
});
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Button, Badge, EmptyState, ErrorState, Skeleton } from "@runly/ui";
import { BarChart3, ClipboardList, FilePenLine, MessageSquareText, Plus } from "lucide-react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function EncuestasDashboard({ token, companyId, apiBaseUrl, navigate }) {
  const query = useQuery({
    queryKey: ["custom.encuestas", "dashboard", companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: "/encuestas/dashboard" })
  });
  const data = query.data?.data;
  const stats = [
    { label: "Encuestas", value: data?.surveys?.total ?? 0, icon: ClipboardList },
    { label: "Publicadas", value: data?.surveys?.publicadas ?? 0, icon: BarChart3 },
    { label: "Borradores", value: data?.surveys?.borradores ?? 0, icon: FilePenLine },
    { label: "Respuestas", value: data?.responses?.total ?? 0, icon: MessageSquareText }
  ];
  return /* @__PURE__ */ jsxs("div", { className: "space-y-6 p-4 md:p-6", children: [
    /* @__PURE__ */ jsx(
      PageHeader,
      {
        title: "Encuestas",
        description: "Crea, publica y analiza encuestas desde Runly.",
        actions: /* @__PURE__ */ jsxs(Button, { onClick: () => navigate("/app/m/custom.encuestas/constructor"), children: [
          /* @__PURE__ */ jsx(Plus, { className: "mr-2 h-4 w-4" }),
          "Crear encuesta"
        ] })
      }
    ),
    query.isLoading ? /* @__PURE__ */ jsx("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-4", children: [0, 1, 2, 3].map((x) => /* @__PURE__ */ jsx(Skeleton, { className: "h-28 w-full" }, x)) }) : query.error ? /* @__PURE__ */ jsx(ErrorState, { title: "No se pudo cargar el panel", description: query.error.message }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", children: stats.map(({ label, value, icon: Icon }) => /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(CardContent, { className: "flex items-center justify-between p-5", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: label }),
          /* @__PURE__ */ jsx("p", { className: "mt-1 text-3xl font-semibold", children: value })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "rounded-lg bg-[hsl(var(--muted))] p-3", children: /* @__PURE__ */ jsx(Icon, { className: "h-5 w-5" }) })
      ] }) }, label)) }),
      /* @__PURE__ */ jsxs(Card, { children: [
        /* @__PURE__ */ jsxs(CardHeader, { className: "flex-row items-center justify-between", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx(CardTitle, { children: "Actividad reciente" }),
            /* @__PURE__ */ jsx("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: "Tus encuestas modificadas recientemente." })
          ] }),
          /* @__PURE__ */ jsx(Button, { variant: "outline", onClick: () => navigate("/app/m/custom.encuestas/constructor"), children: "Administrar" })
        ] }),
        /* @__PURE__ */ jsx(CardContent, { children: !data?.recent?.length ? /* @__PURE__ */ jsx(EmptyState, { title: "Todav\xEDa no hay encuestas", description: "Crea la primera encuesta para comenzar a recopilar respuestas." }) : /* @__PURE__ */ jsx("div", { className: "space-y-3", children: data.recent.map((survey) => /* @__PURE__ */ jsxs(
          Button,
          {
            type: "button",
            variant: "ghost",
            onClick: () => navigate("/app/m/custom.encuestas/constructor"),
            className: "flex w-full items-center justify-between rounded-lg border border-[hsl(var(--border))] p-4 text-left transition hover:bg-[hsl(var(--muted))]",
            children: [
              /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
                /* @__PURE__ */ jsx("p", { className: "truncate font-medium", children: survey.titulo }),
                /* @__PURE__ */ jsxs("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: [
                  survey.preguntas_total ?? 0,
                  " preguntas \xB7 ",
                  survey.respuestas_total ?? 0,
                  " respuestas"
                ] })
              ] }),
              /* @__PURE__ */ jsx(Badge, { children: statusLabel(survey.estado) })
            ]
          },
          survey.id
        )) }) })
      ] })
    ] })
  ] });
}
var init_EncuestasDashboard = __esm({
  "../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/EncuestasDashboard.jsx"() {
    init_api();
  }
});

// ../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/EncuestasStudio.jsx
var EncuestasStudio_exports = {};
__export(EncuestasStudio_exports, {
  default: () => EncuestasStudio
});
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery as useQuery2, useQueryClient } from "@tanstack/react-query";
import {
  PageHeader as PageHeader2,
  Card as Card2,
  CardHeader as CardHeader2,
  CardTitle as CardTitle2,
  CardContent as CardContent2,
  Button as Button2,
  TextField,
  TextareaField,
  Badge as Badge2,
  EmptyState as EmptyState2,
  ErrorState as ErrorState2,
  Skeleton as Skeleton2
} from "@runly/ui";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, CirclePlus, Copy, Eye, Plus as Plus2, Save, Trash2 } from "lucide-react";
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function EncuestasStudio({ token, companyId, apiBaseUrl, navigate }) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [surveyForm, setSurveyForm] = useState(emptySurvey);
  const [creating, setCreating] = useState(false);
  const [questionForm, setQuestionForm] = useState(emptyQuestion);
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const surveysQuery = useQuery2({
    queryKey: ["custom.encuestas", "surveys", companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: "/encuestas/surveys?pageSize=100" })
  });
  useEffect(() => {
    if (!selectedId && surveysQuery.data?.data?.length) setSelectedId(surveysQuery.data.data[0].id);
  }, [selectedId, surveysQuery.data]);
  const selected = useMemo(
    () => surveysQuery.data?.data?.find((item) => item.id === selectedId) ?? null,
    [surveysQuery.data, selectedId]
  );
  useEffect(() => {
    if (!selected) return;
    setSurveyForm({
      titulo: selected.titulo ?? "",
      descripcion: selected.descripcion ?? "",
      anonima: Boolean(selected.anonima),
      solicitar_contacto: Boolean(selected.solicitar_contacto),
      capturar_contexto_inventario: Boolean(selected.capturar_contexto_inventario),
      fecha_inicio: selected.fecha_inicio ?? "",
      fecha_cierre: selected.fecha_cierre ?? "",
      mensaje_final: selected.mensaje_final ?? ""
    });
    setCreating(false);
  }, [selected]);
  const questionsQuery = useQuery2({
    queryKey: ["custom.encuestas", "questions", selectedId, companyId],
    enabled: Boolean(selectedId && token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${selectedId}/questions` })
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["custom.encuestas", "surveys"] }),
      qc.invalidateQueries({ queryKey: ["custom.encuestas", "questions"] }),
      qc.invalidateQueries({ queryKey: ["custom.encuestas", "dashboard"] })
    ]);
  };
  const saveSurvey = useMutation({
    mutationFn: async () => {
      if (!surveyForm.titulo.trim()) throw new Error("Escribe un t\xEDtulo para la encuesta.");
      return apiRequest({
        apiBaseUrl,
        token,
        companyId,
        path: creating ? "/encuestas/surveys" : `/encuestas/surveys/${selectedId}`,
        method: creating ? "POST" : "PATCH",
        body: { ...surveyForm, titulo: surveyForm.titulo.trim() }
      });
    },
    onSuccess: async (payload) => {
      if (creating) setSelectedId(payload.data.id);
      setCreating(false);
      await refresh();
      toast.success("Encuesta guardada.");
    },
    onError: (error) => toast.error(error.message)
  });
  const changeStatus = useMutation({
    mutationFn: (estado) => apiRequest({
      apiBaseUrl,
      token,
      companyId,
      path: `/encuestas/surveys/${selectedId}/status`,
      method: "PATCH",
      body: { estado }
    }),
    onSuccess: async () => {
      await refresh();
      toast.success("Estado actualizado.");
    },
    onError: (error) => toast.error(error.message)
  });
  const deleteSurvey = useMutation({
    mutationFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${selectedId}`, method: "DELETE" }),
    onSuccess: async () => {
      setSelectedId(null);
      setSurveyForm(emptySurvey);
      await refresh();
      toast.success("Encuesta eliminada.");
    },
    onError: (error) => toast.error(error.message)
  });
  const saveQuestion = useMutation({
    mutationFn: () => {
      if (!questionForm.texto.trim()) throw new Error("Escribe la pregunta.");
      const opciones = questionForm.opcionesTexto.split("\n").map((x) => x.trim()).filter(Boolean);
      if (["opcion_unica", "opcion_multiple"].includes(questionForm.tipo) && opciones.length < 2) {
        throw new Error("Agrega al menos dos opciones, una por l\xEDnea.");
      }
      return apiRequest({
        apiBaseUrl,
        token,
        companyId,
        path: editingQuestionId ? `/encuestas/surveys/${selectedId}/questions/${editingQuestionId}` : `/encuestas/surveys/${selectedId}/questions`,
        method: editingQuestionId ? "PATCH" : "POST",
        body: {
          texto: questionForm.texto.trim(),
          tipo: questionForm.tipo,
          obligatoria: questionForm.obligatoria,
          opciones,
          ayuda: questionForm.ayuda || null
        }
      });
    },
    onSuccess: async () => {
      setQuestionForm(emptyQuestion);
      setEditingQuestionId(null);
      await refresh();
      toast.success("Pregunta guardada.");
    },
    onError: (error) => toast.error(error.message)
  });
  const removeQuestion = useMutation({
    mutationFn: (questionId) => apiRequest({
      apiBaseUrl,
      token,
      companyId,
      path: `/encuestas/surveys/${selectedId}/questions/${questionId}`,
      method: "DELETE"
    }),
    onSuccess: async () => {
      await refresh();
      toast.success("Pregunta eliminada.");
    },
    onError: (error) => toast.error(error.message)
  });
  const reorderQuestion = useMutation({
    mutationFn: ({ id, posicion }) => apiRequest({
      apiBaseUrl,
      token,
      companyId,
      path: `/encuestas/surveys/${selectedId}/questions/${id}`,
      method: "PATCH",
      body: { posicion }
    }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message)
  });
  const beginNew = () => {
    setSelectedId(null);
    setCreating(true);
    setSurveyForm(emptySurvey);
    setQuestionForm(emptyQuestion);
    setEditingQuestionId(null);
  };
  const editQuestion = (question) => {
    setEditingQuestionId(question.id);
    setQuestionForm({
      texto: question.texto ?? "",
      tipo: question.tipo ?? "texto_corto",
      obligatoria: Boolean(question.obligatoria),
      opcionesTexto: (question.opciones ?? []).join("\n"),
      ayuda: question.ayuda ?? ""
    });
  };
  const questions = questionsQuery.data?.data ?? [];
  return /* @__PURE__ */ jsxs2("div", { className: "space-y-6 p-4 md:p-6", children: [
    /* @__PURE__ */ jsx2(
      PageHeader2,
      {
        title: "Constructor de encuestas",
        description: "Dise\xF1a formularios, publica y controla su disponibilidad.",
        actions: /* @__PURE__ */ jsxs2(Button2, { onClick: beginNew, children: [
          /* @__PURE__ */ jsx2(Plus2, { className: "mr-2 h-4 w-4" }),
          "Nueva encuesta"
        ] })
      }
    ),
    surveysQuery.isLoading ? /* @__PURE__ */ jsx2(Skeleton2, { className: "h-96 w-full" }) : surveysQuery.error ? /* @__PURE__ */ jsx2(ErrorState2, { title: "No se pudieron cargar las encuestas", description: surveysQuery.error.message }) : /* @__PURE__ */ jsxs2("div", { className: "grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]", children: [
      /* @__PURE__ */ jsxs2(Card2, { className: "h-fit", children: [
        /* @__PURE__ */ jsx2(CardHeader2, { children: /* @__PURE__ */ jsx2(CardTitle2, { children: "Encuestas" }) }),
        /* @__PURE__ */ jsx2(CardContent2, { className: "space-y-2", children: !surveysQuery.data?.data?.length && !creating ? /* @__PURE__ */ jsx2(EmptyState2, { title: "Sin encuestas", description: "Crea una encuesta para comenzar." }) : surveysQuery.data?.data?.map((survey) => /* @__PURE__ */ jsxs2(
          Button2,
          {
            type: "button",
            variant: "ghost",
            onClick: () => setSelectedId(survey.id),
            className: `w-full rounded-lg border p-3 text-left transition ${selectedId === survey.id ? "border-[hsl(var(--brand-primary))] bg-[hsl(var(--muted))]" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"}`,
            children: [
              /* @__PURE__ */ jsxs2("div", { className: "flex items-center justify-between gap-2", children: [
                /* @__PURE__ */ jsx2("span", { className: "truncate font-medium", children: survey.titulo }),
                /* @__PURE__ */ jsx2(Badge2, { children: statusLabel(survey.estado) })
              ] }),
              /* @__PURE__ */ jsxs2("p", { className: "mt-2 text-xs text-[hsl(var(--muted-foreground))]", children: [
                survey.preguntas_total ?? 0,
                " preguntas \xB7 ",
                survey.respuestas_total ?? 0,
                " respuestas"
              ] })
            ]
          },
          survey.id
        )) })
      ] }),
      !selected && !creating ? /* @__PURE__ */ jsx2(Card2, { children: /* @__PURE__ */ jsx2(CardContent2, { className: "p-6", children: /* @__PURE__ */ jsx2(EmptyState2, { title: "Selecciona una encuesta", description: "Elige una encuesta de la lista o crea una nueva." }) }) }) : /* @__PURE__ */ jsxs2("div", { className: "space-y-6", children: [
        /* @__PURE__ */ jsxs2(Card2, { children: [
          /* @__PURE__ */ jsxs2(CardHeader2, { className: "flex-row items-start justify-between gap-3", children: [
            /* @__PURE__ */ jsxs2("div", { children: [
              /* @__PURE__ */ jsx2(CardTitle2, { children: creating ? "Nueva encuesta" : "Configuraci\xF3n" }),
              /* @__PURE__ */ jsx2("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: "Informaci\xF3n y comportamiento general." })
            ] }),
            !creating && /* @__PURE__ */ jsx2(Badge2, { children: statusLabel(selected?.estado) })
          ] }),
          /* @__PURE__ */ jsxs2(CardContent2, { className: "space-y-4", children: [
            /* @__PURE__ */ jsx2(TextField, { label: "T\xEDtulo", value: surveyForm.titulo, onChange: (e) => setSurveyForm((s) => ({ ...s, titulo: e.target.value })), placeholder: "Ej. Encuesta de satisfacci\xF3n" }),
            /* @__PURE__ */ jsx2(TextareaField, { label: "Descripci\xF3n", value: surveyForm.descripcion, onChange: (e) => setSurveyForm((s) => ({ ...s, descripcion: e.target.value })), placeholder: "Explica brevemente el prop\xF3sito de la encuesta." }),
            /* @__PURE__ */ jsxs2("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2", children: [
              /* @__PURE__ */ jsx2(TextField, { label: "Inicio", value: surveyForm.fecha_inicio, onChange: (e) => setSurveyForm((s) => ({ ...s, fecha_inicio: e.target.value })), placeholder: "2026-10-01 08:00" }),
              /* @__PURE__ */ jsx2(TextField, { label: "Cierre", value: surveyForm.fecha_cierre, onChange: (e) => setSurveyForm((s) => ({ ...s, fecha_cierre: e.target.value })), placeholder: "2026-10-31 18:00" })
            ] }),
            /* @__PURE__ */ jsx2(TextareaField, { label: "Mensaje al finalizar", value: surveyForm.mensaje_final, onChange: (e) => setSurveyForm((s) => ({ ...s, mensaje_final: e.target.value })) }),
            /* @__PURE__ */ jsxs2("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-2", children: [
              /* @__PURE__ */ jsxs2(Button2, { type: "button", variant: "outline", onClick: () => setSurveyForm((s) => ({ ...s, anonima: !s.anonima })), className: "rounded-lg border border-[hsl(var(--border))] p-4 text-left", children: [
                /* @__PURE__ */ jsx2("p", { className: "font-medium", children: "Encuesta an\xF3nima" }),
                /* @__PURE__ */ jsx2("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: surveyForm.anonima ? "Activada" : "Desactivada" })
              ] }),
              /* @__PURE__ */ jsxs2(Button2, { type: "button", variant: "outline", onClick: () => setSurveyForm((s) => ({ ...s, solicitar_contacto: !s.solicitar_contacto })), className: "rounded-lg border border-[hsl(var(--border))] p-4 text-left", children: [
                /* @__PURE__ */ jsx2("p", { className: "font-medium", children: "Solicitar contacto" }),
                /* @__PURE__ */ jsx2("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: surveyForm.solicitar_contacto ? "Nombre y correo" : "No solicitar datos" })
              ] }),
              /* @__PURE__ */ jsxs2(Button2, { type: "button", variant: "outline", onClick: () => setSurveyForm((s) => ({ ...s, capturar_contexto_inventario: !s.capturar_contexto_inventario })), className: "rounded-lg border border-[hsl(var(--border))] p-4 text-left", children: [
                /* @__PURE__ */ jsx2("p", { className: "font-medium", children: "Identidad e inventario asignado" }),
                /* @__PURE__ */ jsx2("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: surveyForm.capturar_contexto_inventario ? "Capturar al responder" : "No capturar" })
              ] })
            ] }),
            /* @__PURE__ */ jsxs2("div", { className: "flex flex-wrap gap-2", children: [
              /* @__PURE__ */ jsxs2(Button2, { onClick: () => saveSurvey.mutate(), disabled: saveSurvey.isPending, children: [
                /* @__PURE__ */ jsx2(Save, { className: "mr-2 h-4 w-4" }),
                "Guardar"
              ] }),
              !creating && selected?.estado !== "publicada" && /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => changeStatus.mutate("publicada"), children: "Publicar" }),
              !creating && selected?.estado === "publicada" && /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => changeStatus.mutate("cerrada"), children: "Cerrar respuestas" }),
              !creating && selected?.estado !== "borrador" && /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => changeStatus.mutate("borrador"), children: "Volver a borrador" }),
              !creating && /* @__PURE__ */ jsxs2(Button2, { variant: "outline", onClick: () => navigate("/app/m/custom.encuestas/responder"), children: [
                /* @__PURE__ */ jsx2(Eye, { className: "mr-2 h-4 w-4" }),
                "Vista de respuesta"
              ] }),
              !creating && /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => navigate("/app/m/custom.encuestas/resultados"), children: "Resultados" }),
              !creating && /* @__PURE__ */ jsxs2(Button2, { variant: "outline", onClick: () => deleteSurvey.mutate(), children: [
                /* @__PURE__ */ jsx2(Trash2, { className: "mr-2 h-4 w-4" }),
                "Eliminar"
              ] })
            ] })
          ] })
        ] }),
        !creating && /* @__PURE__ */ jsxs2(Fragment2, { children: [
          /* @__PURE__ */ jsxs2(Card2, { children: [
            /* @__PURE__ */ jsx2(CardHeader2, { children: /* @__PURE__ */ jsx2(CardTitle2, { children: "Preguntas" }) }),
            /* @__PURE__ */ jsx2(CardContent2, { className: "space-y-3", children: questionsQuery.isLoading ? /* @__PURE__ */ jsx2(Skeleton2, { className: "h-36 w-full" }) : questionsQuery.error ? /* @__PURE__ */ jsx2(ErrorState2, { title: "No se pudieron cargar las preguntas", description: questionsQuery.error.message }) : !questions.length ? /* @__PURE__ */ jsx2(EmptyState2, { title: "Sin preguntas", description: "Agrega la primera pregunta de esta encuesta." }) : questions.map((question, index) => /* @__PURE__ */ jsx2("div", { className: "rounded-lg border border-[hsl(var(--border))] p-4", children: /* @__PURE__ */ jsxs2("div", { className: "flex flex-col justify-between gap-3 md:flex-row md:items-start", children: [
              /* @__PURE__ */ jsxs2("div", { className: "min-w-0", children: [
                /* @__PURE__ */ jsxs2("div", { className: "flex flex-wrap items-center gap-2", children: [
                  /* @__PURE__ */ jsxs2("span", { className: "font-medium", children: [
                    index + 1,
                    ". ",
                    question.texto
                  ] }),
                  question.obligatoria && /* @__PURE__ */ jsx2(Badge2, { children: "Obligatoria" })
                ] }),
                /* @__PURE__ */ jsxs2("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: [
                  questionTypeLabel(question.tipo),
                  question.opciones?.length ? ` \xB7 ${question.opciones.length} opciones` : ""
                ] })
              ] }),
              /* @__PURE__ */ jsxs2("div", { className: "flex gap-1", children: [
                /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => reorderQuestion.mutate({ id: question.id, posicion: Math.max(0, Number(question.posicion ?? index + 1) - 1) }), disabled: index === 0, children: /* @__PURE__ */ jsx2(ChevronUp, { className: "h-4 w-4" }) }),
                /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => reorderQuestion.mutate({ id: question.id, posicion: Number(question.posicion ?? index + 1) + 1 }), disabled: index === questions.length - 1, children: /* @__PURE__ */ jsx2(ChevronDown, { className: "h-4 w-4" }) }),
                /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => editQuestion(question), children: "Editar" }),
                /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => removeQuestion.mutate(question.id), children: /* @__PURE__ */ jsx2(Trash2, { className: "h-4 w-4" }) })
              ] })
            ] }) }, question.id)) })
          ] }),
          /* @__PURE__ */ jsxs2(Card2, { children: [
            /* @__PURE__ */ jsx2(CardHeader2, { children: /* @__PURE__ */ jsx2(CardTitle2, { children: editingQuestionId ? "Editar pregunta" : "Agregar pregunta" }) }),
            /* @__PURE__ */ jsxs2(CardContent2, { className: "space-y-4", children: [
              /* @__PURE__ */ jsx2(TextField, { label: "Pregunta", value: questionForm.texto, onChange: (e) => setQuestionForm((s) => ({ ...s, texto: e.target.value })), placeholder: "Escribe la pregunta" }),
              /* @__PURE__ */ jsxs2("div", { children: [
                /* @__PURE__ */ jsx2("p", { className: "mb-2 text-sm font-medium", children: "Tipo de respuesta" }),
                /* @__PURE__ */ jsx2("div", { className: "flex flex-wrap gap-2", children: types.map((type) => /* @__PURE__ */ jsx2(Button2, { type: "button", variant: questionForm.tipo === type ? "default" : "outline", onClick: () => setQuestionForm((s) => ({ ...s, tipo: type })), children: questionTypeLabel(type) }, type)) })
              ] }),
              ["opcion_unica", "opcion_multiple"].includes(questionForm.tipo) && /* @__PURE__ */ jsx2(TextareaField, { label: "Opciones", description: "Una opci\xF3n por l\xEDnea.", value: questionForm.opcionesTexto, onChange: (e) => setQuestionForm((s) => ({ ...s, opcionesTexto: e.target.value })), placeholder: "Excelente\nBueno\nRegular\nMalo" }),
              /* @__PURE__ */ jsx2(TextField, { label: "Texto de ayuda", value: questionForm.ayuda, onChange: (e) => setQuestionForm((s) => ({ ...s, ayuda: e.target.value })), placeholder: "Opcional" }),
              /* @__PURE__ */ jsxs2(Button2, { type: "button", variant: "outline", onClick: () => setQuestionForm((s) => ({ ...s, obligatoria: !s.obligatoria })), className: "w-full rounded-lg border border-[hsl(var(--border))] p-4 text-left", children: [
                /* @__PURE__ */ jsx2("p", { className: "font-medium", children: "Respuesta obligatoria" }),
                /* @__PURE__ */ jsx2("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: questionForm.obligatoria ? "S\xED" : "No" })
              ] }),
              /* @__PURE__ */ jsxs2("div", { className: "flex gap-2", children: [
                /* @__PURE__ */ jsxs2(Button2, { onClick: () => saveQuestion.mutate(), disabled: saveQuestion.isPending, children: [
                  /* @__PURE__ */ jsx2(CirclePlus, { className: "mr-2 h-4 w-4" }),
                  editingQuestionId ? "Guardar cambios" : "Agregar pregunta"
                ] }),
                editingQuestionId && /* @__PURE__ */ jsx2(Button2, { variant: "outline", onClick: () => {
                  setEditingQuestionId(null);
                  setQuestionForm(emptyQuestion);
                }, children: "Cancelar edici\xF3n" })
              ] })
            ] })
          ] })
        ] })
      ] })
    ] })
  ] });
}
var emptySurvey, emptyQuestion, types;
var init_EncuestasStudio = __esm({
  "../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/EncuestasStudio.jsx"() {
    init_api();
    emptySurvey = {
      titulo: "",
      descripcion: "",
      anonima: true,
      solicitar_contacto: false,
      capturar_contexto_inventario: false,
      fecha_inicio: "",
      fecha_cierre: "",
      mensaje_final: "Gracias por responder esta encuesta."
    };
    emptyQuestion = { texto: "", tipo: "texto_corto", obligatoria: false, opcionesTexto: "", ayuda: "" };
    types = ["texto_corto", "texto_largo", "opcion_unica", "opcion_multiple", "si_no", "numero", "calificacion"];
  }
});

// ../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/ResponderEncuesta.jsx
var ResponderEncuesta_exports = {};
__export(ResponderEncuesta_exports, {
  default: () => ResponderEncuesta
});
import { useMemo as useMemo2, useState as useState2 } from "react";
import { useMutation as useMutation2, useQuery as useQuery3 } from "@tanstack/react-query";
import {
  PageHeader as PageHeader3,
  Card as Card3,
  CardHeader as CardHeader3,
  CardTitle as CardTitle3,
  CardContent as CardContent3,
  Button as Button3,
  TextField as TextField2,
  TextareaField as TextareaField2,
  Badge as Badge3,
  EmptyState as EmptyState3,
  ErrorState as ErrorState3,
  Skeleton as Skeleton3,
  buildApiHeaders as buildApiHeaders2
} from "@runly/ui";
import { toast as toast2 } from "sonner";
import { Check, Package, Send, UserRound } from "lucide-react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function QuestionInput({ question, value, onChange }) {
  if (question.tipo === "texto_largo") {
    return /* @__PURE__ */ jsx3(TextareaField2, { value: value ?? "", onChange: (e) => onChange(e.target.value), placeholder: "Escribe tu respuesta" });
  }
  if (question.tipo === "texto_corto") {
    return /* @__PURE__ */ jsx3(TextField2, { value: value ?? "", onChange: (e) => onChange(e.target.value), placeholder: "Escribe tu respuesta" });
  }
  if (question.tipo === "numero") {
    return /* @__PURE__ */ jsx3(TextField2, { value: value ?? "", onChange: (e) => onChange(e.target.value === "" ? "" : Number(e.target.value)), placeholder: "Escribe un n\xFAmero" });
  }
  if (question.tipo === "si_no") {
    return /* @__PURE__ */ jsx3("div", { className: "flex gap-2", children: [["S\xED", true], ["No", false]].map(([label, option]) => /* @__PURE__ */ jsx3(Button3, { type: "button", variant: value === option ? "default" : "outline", onClick: () => onChange(option), children: label }, label)) });
  }
  if (question.tipo === "calificacion") {
    return /* @__PURE__ */ jsx3("div", { className: "flex flex-wrap gap-2", children: [1, 2, 3, 4, 5].map((score) => /* @__PURE__ */ jsx3(Button3, { type: "button", variant: value === score ? "default" : "outline", onClick: () => onChange(score), children: score }, score)) });
  }
  if (question.tipo === "opcion_multiple") {
    const selected = Array.isArray(value) ? value : [];
    return /* @__PURE__ */ jsx3("div", { className: "flex flex-wrap gap-2", children: (question.opciones ?? []).map((option) => {
      const active = selected.includes(option);
      return /* @__PURE__ */ jsxs3(Button3, { type: "button", variant: active ? "default" : "outline", onClick: () => onChange(active ? selected.filter((x) => x !== option) : [...selected, option]), children: [
        active && /* @__PURE__ */ jsx3(Check, { className: "mr-2 h-4 w-4" }),
        option
      ] }, option);
    }) });
  }
  return /* @__PURE__ */ jsx3("div", { className: "flex flex-wrap gap-2", children: (question.opciones ?? []).map((option) => /* @__PURE__ */ jsx3(Button3, { type: "button", variant: value === option ? "default" : "outline", onClick: () => onChange(option), children: option }, option)) });
}
async function resolveTargets({ apiBaseUrl, token, companyId, type, ids }) {
  if (!ids?.length) return [];
  const response = await fetch(`${apiBaseUrl}/relation-targets/${type}/resolve`, {
    method: "POST",
    headers: buildApiHeaders2(token, companyId, { "Content-Type": "application/json" }),
    body: JSON.stringify({ ids: ids.slice(0, 100) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "No se pudieron resolver los registros relacionados.");
  return payload.data ?? [];
}
function ResponderEncuesta({ token, companyId, apiBaseUrl }) {
  const [surveyId, setSurveyId] = useState2(null);
  const [answers, setAnswers] = useState2({});
  const [contact, setContact] = useState2({ nombre: "", correo: "" });
  const [completed, setCompleted] = useState2(false);
  const surveysQuery = useQuery3({
    queryKey: ["custom.encuestas", "published", companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: "/encuestas/surveys?pageSize=100&estado=publicada" })
  });
  const activeSurvey = useMemo2(() => surveysQuery.data?.data?.find((survey) => survey.id === surveyId) ?? null, [surveysQuery.data, surveyId]);
  const questionsQuery = useQuery3({
    queryKey: ["custom.encuestas", "respond", surveyId, companyId],
    enabled: Boolean(surveyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${surveyId}/questions` })
  });
  const contextQuery = useQuery3({
    queryKey: ["custom.encuestas", "respondent-context", companyId],
    enabled: Boolean(activeSurvey?.capturar_contexto_inventario && token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: "/encuestas/respondent-context" })
  });
  const employeeResolvedQuery = useQuery3({
    queryKey: ["custom.encuestas", "employee-resolved", contextQuery.data?.data?.employeeId],
    enabled: Boolean(contextQuery.data?.data?.employeeId),
    queryFn: () => resolveTargets({ apiBaseUrl, token, companyId, type: "hr_employee", ids: [contextQuery.data.data.employeeId] })
  });
  const itemsResolvedQuery = useQuery3({
    queryKey: ["custom.encuestas", "items-resolved", contextQuery.data?.data?.assignedItemIds],
    enabled: Boolean(contextQuery.data?.data?.assignedItemIds?.length),
    queryFn: () => resolveTargets({ apiBaseUrl, token, companyId, type: "inventory_item", ids: contextQuery.data.data.assignedItemIds })
  });
  const submit = useMutation2({
    mutationFn: () => apiRequest({
      apiBaseUrl,
      token,
      companyId,
      path: `/encuestas/surveys/${surveyId}/responses`,
      method: "POST",
      body: { respondente_nombre: contact.nombre || null, respondente_correo: contact.correo || null, respuestas: answers }
    }),
    onSuccess: () => {
      setCompleted(true);
      toast2.success("Respuesta enviada.");
    },
    onError: (error) => toast2.error(error.message)
  });
  const selectSurvey = (id) => {
    setSurveyId(id);
    setAnswers({});
    setContact({ nombre: "", correo: "" });
    setCompleted(false);
  };
  const context = contextQuery.data?.data;
  const employee = employeeResolvedQuery.data?.[0];
  const resolvedItems = itemsResolvedQuery.data ?? [];
  return /* @__PURE__ */ jsxs3("div", { className: "space-y-6 p-4 md:p-6", children: [
    /* @__PURE__ */ jsx3(PageHeader3, { title: "Responder encuesta", description: "Contesta encuestas publicadas con tu sesi\xF3n activa de Runly." }),
    surveysQuery.isLoading ? /* @__PURE__ */ jsx3(Skeleton3, { className: "h-72 w-full" }) : surveysQuery.error ? /* @__PURE__ */ jsx3(ErrorState3, { title: "No se pudieron cargar las encuestas", description: surveysQuery.error.message }) : !surveysQuery.data?.data?.length ? /* @__PURE__ */ jsx3(EmptyState3, { title: "No hay encuestas publicadas", description: "Publica una encuesta desde el constructor para habilitar respuestas." }) : !activeSurvey ? /* @__PURE__ */ jsx3("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", children: surveysQuery.data.data.map((survey) => /* @__PURE__ */ jsxs3(Card3, { className: "cursor-pointer", onClick: () => selectSurvey(survey.id), children: [
      /* @__PURE__ */ jsx3(CardHeader3, { children: /* @__PURE__ */ jsxs3("div", { className: "flex items-start justify-between gap-2", children: [
        /* @__PURE__ */ jsx3(CardTitle3, { children: survey.titulo }),
        /* @__PURE__ */ jsx3(Badge3, { children: "Publicada" })
      ] }) }),
      /* @__PURE__ */ jsxs3(CardContent3, { children: [
        /* @__PURE__ */ jsx3("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: survey.descripcion || "Sin descripci\xF3n." }),
        /* @__PURE__ */ jsxs3("p", { className: "mt-4 text-sm", children: [
          survey.preguntas_total ?? 0,
          " preguntas"
        ] }),
        survey.capturar_contexto_inventario && /* @__PURE__ */ jsx3(Badge3, { className: "mt-3", variant: "outline", children: "Incluye identidad e inventario asignado" }),
        /* @__PURE__ */ jsx3(Button3, { className: "mt-4 w-full", onClick: () => selectSurvey(survey.id), children: "Responder" })
      ] })
    ] }, survey.id)) }) : completed ? /* @__PURE__ */ jsx3(Card3, { children: /* @__PURE__ */ jsxs3(CardContent3, { className: "p-8", children: [
      /* @__PURE__ */ jsx3(EmptyState3, { title: "Respuesta registrada", description: activeSurvey.mensaje_final || "Gracias por participar." }),
      /* @__PURE__ */ jsx3("div", { className: "mt-4 flex justify-center", children: /* @__PURE__ */ jsx3(Button3, { variant: "outline", onClick: () => selectSurvey(null), children: "Responder otra encuesta" }) })
    ] }) }) : /* @__PURE__ */ jsxs3("div", { className: "mx-auto max-w-3xl space-y-5", children: [
      /* @__PURE__ */ jsxs3(Card3, { children: [
        /* @__PURE__ */ jsx3(CardHeader3, { children: /* @__PURE__ */ jsx3(CardTitle3, { children: activeSurvey.titulo }) }),
        /* @__PURE__ */ jsx3(CardContent3, { children: /* @__PURE__ */ jsx3("p", { className: "text-[hsl(var(--muted-foreground))]", children: activeSurvey.descripcion || "Completa las siguientes preguntas." }) })
      ] }),
      activeSurvey.capturar_contexto_inventario && (contextQuery.isLoading ? /* @__PURE__ */ jsx3(Skeleton3, { className: "h-44 w-full" }) : contextQuery.error ? /* @__PURE__ */ jsx3(ErrorState3, { title: "No se pudo cargar tu contexto", description: `${contextQuery.error.message} Verifica permisos de RR. HH. e Inventario.` }) : /* @__PURE__ */ jsxs3(Card3, { children: [
        /* @__PURE__ */ jsx3(CardHeader3, { children: /* @__PURE__ */ jsx3(CardTitle3, { children: "Tu identidad e inventario asignado" }) }),
        /* @__PURE__ */ jsxs3(CardContent3, { className: "space-y-4", children: [
          /* @__PURE__ */ jsxs3("div", { className: "flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-4", children: [
            /* @__PURE__ */ jsx3(UserRound, { className: "mt-0.5 h-5 w-5" }),
            /* @__PURE__ */ jsxs3("div", { children: [
              /* @__PURE__ */ jsx3("p", { className: "font-medium", children: employee?.title || context?.employeeName || "Usuario sin colaborador vinculado" }),
              /* @__PURE__ */ jsx3("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: employee?.subtitle || context?.employeeCode || "La sesi\xF3n se registrar\xE1 con tu usuario de Identity." })
            ] })
          ] }),
          !context?.employeeId ? /* @__PURE__ */ jsx3(EmptyState3, { title: "Sin colaborador vinculado", description: "Tu cuenta de Identity no est\xE1 vinculada a un colaborador de RR. HH.; no se encontraron art\xEDculos asignados." }) : context.assignedItemIds?.length === 0 ? /* @__PURE__ */ jsx3(EmptyState3, { title: "Sin art\xEDculos asignados", description: "Inventario no tiene art\xEDculos activos asignados a este colaborador." }) : itemsResolvedQuery.isLoading ? /* @__PURE__ */ jsx3(Skeleton3, { className: "h-28 w-full" }) : itemsResolvedQuery.error ? /* @__PURE__ */ jsx3(ErrorState3, { title: "No se pudieron resolver los art\xEDculos", description: itemsResolvedQuery.error.message }) : /* @__PURE__ */ jsxs3("div", { className: "space-y-2", children: [
            /* @__PURE__ */ jsxs3("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx3(Package, { className: "h-4 w-4" }),
              /* @__PURE__ */ jsxs3("p", { className: "font-medium", children: [
                resolvedItems.length,
                " art\xEDculo(s) asignado(s)"
              ] })
            ] }),
            resolvedItems.map((item) => /* @__PURE__ */ jsxs3("div", { className: "rounded-lg border border-[hsl(var(--border))] p-3", children: [
              /* @__PURE__ */ jsx3("p", { className: "font-medium", children: item.title }),
              item.subtitle && /* @__PURE__ */ jsx3("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: item.subtitle })
            ] }, item.id))
          ] }),
          /* @__PURE__ */ jsxs3("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: [
            "Sesi\xF3n: ",
            context?.userName || context?.userEmail || context?.userProfileId
          ] }),
          /* @__PURE__ */ jsx3("p", { className: "text-xs text-[hsl(var(--muted-foreground))]", children: "Esta informaci\xF3n se obtiene de Identity/RR. HH. e Inventario y se guarda como una fotograf\xEDa junto con tu respuesta." })
        ] })
      ] })),
      activeSurvey.solicitar_contacto && /* @__PURE__ */ jsxs3(Card3, { children: [
        /* @__PURE__ */ jsx3(CardHeader3, { children: /* @__PURE__ */ jsx3(CardTitle3, { children: "Datos de contacto" }) }),
        /* @__PURE__ */ jsxs3(CardContent3, { className: "grid grid-cols-1 gap-4 md:grid-cols-2", children: [
          /* @__PURE__ */ jsx3(TextField2, { label: "Nombre", value: contact.nombre, onChange: (e) => setContact((x) => ({ ...x, nombre: e.target.value })) }),
          /* @__PURE__ */ jsx3(TextField2, { label: "Correo electr\xF3nico", value: contact.correo, onChange: (e) => setContact((x) => ({ ...x, correo: e.target.value })) })
        ] })
      ] }),
      questionsQuery.isLoading ? /* @__PURE__ */ jsx3(Skeleton3, { className: "h-80 w-full" }) : questionsQuery.error ? /* @__PURE__ */ jsx3(ErrorState3, { title: "No se pudieron cargar las preguntas", description: questionsQuery.error.message }) : (questionsQuery.data?.data ?? []).map((question, index) => /* @__PURE__ */ jsx3(Card3, { children: /* @__PURE__ */ jsxs3(CardContent3, { className: "space-y-3 p-5", children: [
        /* @__PURE__ */ jsxs3("div", { children: [
          /* @__PURE__ */ jsxs3("div", { className: "flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ jsxs3("p", { className: "font-medium", children: [
              index + 1,
              ". ",
              question.texto
            ] }),
            question.obligatoria && /* @__PURE__ */ jsx3(Badge3, { children: "Obligatoria" })
          ] }),
          /* @__PURE__ */ jsx3("p", { className: "mt-1 text-xs text-[hsl(var(--muted-foreground))]", children: question.ayuda || questionTypeLabel(question.tipo) })
        ] }),
        /* @__PURE__ */ jsx3(QuestionInput, { question, value: answers[question.id], onChange: (value) => setAnswers((current) => ({ ...current, [question.id]: value })) })
      ] }) }, question.id)),
      /* @__PURE__ */ jsxs3("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ jsxs3(Button3, { onClick: () => submit.mutate(), disabled: submit.isPending || activeSurvey.capturar_contexto_inventario && contextQuery.isLoading, children: [
          /* @__PURE__ */ jsx3(Send, { className: "mr-2 h-4 w-4" }),
          "Enviar respuestas"
        ] }),
        /* @__PURE__ */ jsx3(Button3, { variant: "outline", onClick: () => selectSurvey(null), children: "Cambiar encuesta" })
      ] })
    ] })
  ] });
}
var init_ResponderEncuesta = __esm({
  "../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/ResponderEncuesta.jsx"() {
    init_api();
  }
});

// ../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/ResultadosEncuestas.jsx
var ResultadosEncuestas_exports = {};
__export(ResultadosEncuestas_exports, {
  default: () => ResultadosEncuestas
});
import { useMemo as useMemo3, useState as useState3 } from "react";
import { useQuery as useQuery4 } from "@tanstack/react-query";
import { PageHeader as PageHeader4, Card as Card4, CardHeader as CardHeader4, CardTitle as CardTitle4, CardContent as CardContent4, Button as Button4, Badge as Badge4, EmptyState as EmptyState4, ErrorState as ErrorState4, Skeleton as Skeleton4 } from "@runly/ui";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function summarize(question, responses) {
  const values = responses.map((r) => r.respuestas?.[question.id]).filter((v) => v !== void 0 && v !== null && v !== "");
  if (["opcion_unica", "si_no", "calificacion"].includes(question.tipo)) {
    const counts = /* @__PURE__ */ new Map();
    values.forEach((v) => counts.set(String(v), (counts.get(String(v)) ?? 0) + 1));
    return { kind: "chart", data: [...counts.entries()].map(([name, total]) => ({ name, total })) };
  }
  if (question.tipo === "opcion_multiple") {
    const counts = /* @__PURE__ */ new Map();
    values.flatMap((v) => Array.isArray(v) ? v : []).forEach((v) => counts.set(String(v), (counts.get(String(v)) ?? 0) + 1));
    return { kind: "chart", data: [...counts.entries()].map(([name, total]) => ({ name, total })) };
  }
  if (question.tipo === "numero") {
    const nums = values.map(Number).filter(Number.isFinite);
    const average = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    return { kind: "number", count: nums.length, average };
  }
  return { kind: "text", values: values.map(String).slice(0, 8), count: values.length };
}
function ResultadosEncuestas({ token, companyId, apiBaseUrl }) {
  const [surveyId, setSurveyId] = useState3(null);
  const surveysQuery = useQuery4({
    queryKey: ["custom.encuestas", "results-surveys", companyId],
    enabled: Boolean(token && companyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: "/encuestas/surveys?pageSize=100" })
  });
  const selected = useMemo3(
    () => surveysQuery.data?.data?.find((s) => s.id === surveyId) ?? null,
    [surveysQuery.data, surveyId]
  );
  const questionsQuery = useQuery4({
    queryKey: ["custom.encuestas", "results-questions", surveyId],
    enabled: Boolean(surveyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${surveyId}/questions` })
  });
  const responsesQuery = useQuery4({
    queryKey: ["custom.encuestas", "responses", surveyId],
    enabled: Boolean(surveyId),
    queryFn: () => apiRequest({ apiBaseUrl, token, companyId, path: `/encuestas/surveys/${surveyId}/responses?pageSize=100` })
  });
  const responses = responsesQuery.data?.data ?? [];
  const questions = questionsQuery.data?.data ?? [];
  return /* @__PURE__ */ jsxs4("div", { className: "space-y-6 p-4 md:p-6", children: [
    /* @__PURE__ */ jsx4(PageHeader4, { title: "Resultados de encuestas", description: "Consulta respuestas y distribuciones por pregunta." }),
    surveysQuery.isLoading ? /* @__PURE__ */ jsx4(Skeleton4, { className: "h-64 w-full" }) : surveysQuery.error ? /* @__PURE__ */ jsx4(ErrorState4, { title: "No se pudieron cargar las encuestas", description: surveysQuery.error.message }) : /* @__PURE__ */ jsxs4("div", { className: "grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]", children: [
      /* @__PURE__ */ jsxs4(Card4, { className: "h-fit", children: [
        /* @__PURE__ */ jsx4(CardHeader4, { children: /* @__PURE__ */ jsx4(CardTitle4, { children: "Encuestas" }) }),
        /* @__PURE__ */ jsx4(CardContent4, { className: "space-y-2", children: !surveysQuery.data?.data?.length ? /* @__PURE__ */ jsx4(EmptyState4, { title: "Sin encuestas", description: "Todav\xEDa no hay informaci\xF3n para analizar." }) : surveysQuery.data.data.map((survey) => /* @__PURE__ */ jsxs4(Button4, { type: "button", variant: "ghost", onClick: () => setSurveyId(survey.id), className: `w-full rounded-lg border p-3 text-left ${surveyId === survey.id ? "border-[hsl(var(--brand-primary))] bg-[hsl(var(--muted))]" : "border-[hsl(var(--border))]"}`, children: [
          /* @__PURE__ */ jsxs4("div", { className: "flex items-center justify-between gap-2", children: [
            /* @__PURE__ */ jsx4("span", { className: "truncate font-medium", children: survey.titulo }),
            /* @__PURE__ */ jsx4(Badge4, { children: statusLabel(survey.estado) })
          ] }),
          /* @__PURE__ */ jsxs4("p", { className: "mt-1 text-xs text-[hsl(var(--muted-foreground))]", children: [
            survey.respuestas_total ?? 0,
            " respuestas"
          ] })
        ] }, survey.id)) })
      ] }),
      !selected ? /* @__PURE__ */ jsx4(Card4, { children: /* @__PURE__ */ jsx4(CardContent4, { className: "p-6", children: /* @__PURE__ */ jsx4(EmptyState4, { title: "Selecciona una encuesta", description: "Elige una encuesta para ver sus resultados." }) }) }) : responsesQuery.isLoading || questionsQuery.isLoading ? /* @__PURE__ */ jsx4(Skeleton4, { className: "h-96 w-full" }) : responsesQuery.error || questionsQuery.error ? /* @__PURE__ */ jsx4(ErrorState4, { title: "No se pudieron cargar los resultados", description: (responsesQuery.error || questionsQuery.error)?.message }) : /* @__PURE__ */ jsxs4("div", { className: "space-y-5", children: [
        /* @__PURE__ */ jsxs4(Card4, { children: [
          /* @__PURE__ */ jsx4(CardHeader4, { children: /* @__PURE__ */ jsx4(CardTitle4, { children: selected.titulo }) }),
          /* @__PURE__ */ jsxs4(CardContent4, { className: "grid grid-cols-2 gap-4 md:grid-cols-3", children: [
            /* @__PURE__ */ jsxs4("div", { children: [
              /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: "Respuestas" }),
              /* @__PURE__ */ jsx4("p", { className: "text-3xl font-semibold", children: responsesQuery.data?.pagination?.total ?? responses.length })
            ] }),
            /* @__PURE__ */ jsxs4("div", { children: [
              /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: "Preguntas" }),
              /* @__PURE__ */ jsx4("p", { className: "text-3xl font-semibold", children: questions.length })
            ] }),
            /* @__PURE__ */ jsxs4("div", { children: [
              /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: "Estado" }),
              /* @__PURE__ */ jsx4("p", { className: "mt-2", children: /* @__PURE__ */ jsx4(Badge4, { children: statusLabel(selected.estado) }) })
            ] })
          ] })
        ] }),
        !responses.length ? /* @__PURE__ */ jsx4(EmptyState4, { title: "A\xFAn no hay respuestas", description: "Las respuestas aparecer\xE1n aqu\xED en cuanto alguien complete la encuesta." }) : questions.map((question, index) => {
          const summary = summarize(question, responses);
          return /* @__PURE__ */ jsxs4(Card4, { children: [
            /* @__PURE__ */ jsxs4(CardHeader4, { children: [
              /* @__PURE__ */ jsxs4(CardTitle4, { children: [
                index + 1,
                ". ",
                question.texto
              ] }),
              /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: questionTypeLabel(question.tipo) })
            ] }),
            /* @__PURE__ */ jsx4(CardContent4, { children: summary.kind === "chart" ? summary.data.length ? /* @__PURE__ */ jsx4("div", { className: "h-64 w-full", children: /* @__PURE__ */ jsx4(ResponsiveContainer, { width: "100%", height: "100%", children: /* @__PURE__ */ jsxs4(BarChart, { data: summary.data, children: [
              /* @__PURE__ */ jsx4(CartesianGrid, { strokeDasharray: "3 3" }),
              /* @__PURE__ */ jsx4(XAxis, { dataKey: "name" }),
              /* @__PURE__ */ jsx4(YAxis, { allowDecimals: false }),
              /* @__PURE__ */ jsx4(Tooltip, {}),
              /* @__PURE__ */ jsx4(Bar, { dataKey: "total" })
            ] }) }) }) : /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: "Sin respuestas para esta pregunta." }) : summary.kind === "number" ? /* @__PURE__ */ jsxs4("div", { className: "grid grid-cols-2 gap-4", children: [
              /* @__PURE__ */ jsxs4("div", { children: [
                /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: "Respuestas" }),
                /* @__PURE__ */ jsx4("p", { className: "text-2xl font-semibold", children: summary.count })
              ] }),
              /* @__PURE__ */ jsxs4("div", { children: [
                /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: "Promedio" }),
                /* @__PURE__ */ jsx4("p", { className: "text-2xl font-semibold", children: summary.average.toFixed(2) })
              ] })
            ] }) : /* @__PURE__ */ jsx4("div", { className: "space-y-2", children: summary.values.length ? summary.values.map((value, i) => /* @__PURE__ */ jsx4("div", { className: "rounded-lg border border-[hsl(var(--border))] p-3 text-sm", children: value }, `${value}-${i}`)) : /* @__PURE__ */ jsx4("p", { className: "text-sm text-[hsl(var(--muted-foreground))]", children: "Sin respuestas para esta pregunta." }) }) })
          ] }, question.id);
        }),
        responses.length > 0 && /* @__PURE__ */ jsxs4(Card4, { children: [
          /* @__PURE__ */ jsx4(CardHeader4, { children: /* @__PURE__ */ jsx4(CardTitle4, { children: "Respuestas individuales" }) }),
          /* @__PURE__ */ jsx4(CardContent4, { className: "space-y-3", children: responses.slice(0, 20).map((response, index) => /* @__PURE__ */ jsxs4("div", { className: "rounded-lg border border-[hsl(var(--border))] p-4", children: [
            /* @__PURE__ */ jsxs4("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [
              /* @__PURE__ */ jsxs4("p", { className: "font-medium", children: [
                "Respuesta #",
                responses.length - index
              ] }),
              /* @__PURE__ */ jsx4("span", { className: "text-xs text-[hsl(var(--muted-foreground))]", children: response.enviado_en || "" })
            ] }),
            (response.respondente_nombre || response.respondente_correo) && /* @__PURE__ */ jsxs4("p", { className: "mt-1 text-sm text-[hsl(var(--muted-foreground))]", children: [
              response.respondente_nombre || "Sin nombre",
              " \xB7 ",
              response.respondente_correo || "Sin correo"
            ] }),
            response.respondente_user_id && /* @__PURE__ */ jsxs4("p", { className: "mt-2 text-sm", children: [
              "Identity: ",
              response.respondente_user_nombre || response.respondente_user_correo || response.respondente_user_id
            ] }),
            response.respondente_user_correo && /* @__PURE__ */ jsx4("p", { className: "text-xs text-[hsl(var(--muted-foreground))]", children: response.respondente_user_correo }),
            response.respondente_empleado_nombre && /* @__PURE__ */ jsxs4("p", { className: "mt-1 text-sm font-medium", children: [
              "Colaborador: ",
              response.respondente_empleado_nombre
            ] }),
            (response.items_asignados ?? []).length > 0 && /* @__PURE__ */ jsxs4("div", { className: "mt-3 space-y-2", children: [
              /* @__PURE__ */ jsxs4("p", { className: "text-sm font-medium", children: [
                "Inventario asignado al momento de responder (",
                response.items_asignados_total ?? response.items_asignados.length,
                ")"
              ] }),
              (response.items_asignados ?? []).map((item) => /* @__PURE__ */ jsxs4("div", { className: "rounded-md border border-[hsl(var(--border))] p-2 text-sm", children: [
                /* @__PURE__ */ jsx4("p", { className: "font-medium", children: [item.assetTag, item.name].filter(Boolean).join(" \xB7 ") || item.id }),
                /* @__PURE__ */ jsx4("p", { className: "text-xs text-[hsl(var(--muted-foreground))]", children: [item.model, item.serialNumber ? `SN ${item.serialNumber}` : null, item.locationName].filter(Boolean).join(" \xB7 ") || "Sin detalle adicional" })
              ] }, item.id))
            ] })
          ] }, response.id)) })
        ] })
      ] })
    ] })
  ] });
}
var init_ResultadosEncuestas = __esm({
  "../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/ResultadosEncuestas.jsx"() {
    init_api();
  }
});

// ../../modules/custom/.staging/a58bd133-0490-4479-92fe-7e1bf984db88/package/components/index.js
async function register(registry) {
  if (typeof window === "undefined") return;
  const [
    { default: EncuestasDashboard2 },
    { default: EncuestasStudio2 },
    { default: ResponderEncuesta2 },
    { default: ResultadosEncuestas2 }
  ] = await Promise.all([
    Promise.resolve().then(() => (init_EncuestasDashboard(), EncuestasDashboard_exports)),
    Promise.resolve().then(() => (init_EncuestasStudio(), EncuestasStudio_exports)),
    Promise.resolve().then(() => (init_ResponderEncuesta(), ResponderEncuesta_exports)),
    Promise.resolve().then(() => (init_ResultadosEncuestas(), ResultadosEncuestas_exports))
  ]);
  registry.register("custom.encuestas:EncuestasDashboard", EncuestasDashboard2);
  registry.register("custom.encuestas:EncuestasStudio", EncuestasStudio2);
  registry.register("custom.encuestas:ResponderEncuesta", ResponderEncuesta2);
  registry.register("custom.encuestas:ResultadosEncuestas", ResultadosEncuestas2);
}
export {
  register
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLnN0YWdpbmcvYTU4YmQxMzMtMDQ5MC00NDc5LTkyZmUtN2UxYmY5ODRkYjg4L3BhY2thZ2UvY29tcG9uZW50cy9hcGkuanMiLCAiLi4vLi4vLi4vLnN0YWdpbmcvYTU4YmQxMzMtMDQ5MC00NDc5LTkyZmUtN2UxYmY5ODRkYjg4L3BhY2thZ2UvY29tcG9uZW50cy9FbmN1ZXN0YXNEYXNoYm9hcmQuanN4IiwgIi4uLy4uLy4uLy5zdGFnaW5nL2E1OGJkMTMzLTA0OTAtNDQ3OS05MmZlLTdlMWJmOTg0ZGI4OC9wYWNrYWdlL2NvbXBvbmVudHMvRW5jdWVzdGFzU3R1ZGlvLmpzeCIsICIuLi8uLi8uLi8uc3RhZ2luZy9hNThiZDEzMy0wNDkwLTQ0NzktOTJmZS03ZTFiZjk4NGRiODgvcGFja2FnZS9jb21wb25lbnRzL1Jlc3BvbmRlckVuY3Vlc3RhLmpzeCIsICIuLi8uLi8uLi8uc3RhZ2luZy9hNThiZDEzMy0wNDkwLTQ0NzktOTJmZS03ZTFiZjk4NGRiODgvcGFja2FnZS9jb21wb25lbnRzL1Jlc3VsdGFkb3NFbmN1ZXN0YXMuanN4IiwgIi4uLy4uLy4uLy5zdGFnaW5nL2E1OGJkMTMzLTA0OTAtNDQ3OS05MmZlLTdlMWJmOTg0ZGI4OC9wYWNrYWdlL2NvbXBvbmVudHMvaW5kZXguanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGJ1aWxkQXBpSGVhZGVycyB9IGZyb20gJ0BydW5seS91aSdcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwaVJlcXVlc3QoeyBhcGlCYXNlVXJsLCB0b2tlbiwgY29tcGFueUlkLCBwYXRoLCBtZXRob2QgPSAnR0VUJywgYm9keSB9KSB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYCR7YXBpQmFzZVVybH0ke3BhdGh9YCwge1xuICAgIG1ldGhvZCxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAuLi5idWlsZEFwaUhlYWRlcnModG9rZW4sIGNvbXBhbnlJZCksXG4gICAgICAuLi4oYm9keSAhPT0gdW5kZWZpbmVkID8geyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0gOiB7fSksXG4gICAgfSxcbiAgICAuLi4oYm9keSAhPT0gdW5kZWZpbmVkID8geyBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSB9IDoge30pLFxuICB9KVxuICBjb25zdCBwYXlsb2FkID0gYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpXG4gIGlmICghcmVzcG9uc2Uub2spIHRocm93IG5ldyBFcnJvcihwYXlsb2FkPy5lcnJvciA/PyAnTGEgb3BlcmFjaVx1MDBGM24gbm8gcHVkbyBjb21wbGV0YXJzZS4nKVxuICByZXR1cm4gcGF5bG9hZFxufVxuXG5leHBvcnQgY29uc3Qgc3RhdHVzTGFiZWwgPSAoc3RhdHVzKSA9PiAoe1xuICBib3JyYWRvcjogJ0JvcnJhZG9yJyxcbiAgcHVibGljYWRhOiAnUHVibGljYWRhJyxcbiAgY2VycmFkYTogJ0NlcnJhZGEnLFxufVtzdGF0dXNdID8/IHN0YXR1cylcblxuZXhwb3J0IGNvbnN0IHF1ZXN0aW9uVHlwZUxhYmVsID0gKHR5cGUpID0+ICh7XG4gIHRleHRvX2NvcnRvOiAnVGV4dG8gY29ydG8nLFxuICB0ZXh0b19sYXJnbzogJ1RleHRvIGxhcmdvJyxcbiAgb3BjaW9uX3VuaWNhOiAnT3BjaVx1MDBGM24gXHUwMEZBbmljYScsXG4gIG9wY2lvbl9tdWx0aXBsZTogJ09wY2lcdTAwRjNuIG1cdTAwRkFsdGlwbGUnLFxuICBzaV9ubzogJ1NcdTAwRUQgLyBObycsXG4gIG51bWVybzogJ05cdTAwRkFtZXJvJyxcbiAgY2FsaWZpY2FjaW9uOiAnQ2FsaWZpY2FjaVx1MDBGM24gMVx1MjAxMzUnLFxufVt0eXBlXSA/PyB0eXBlKVxuIiwgImltcG9ydCB7IHVzZVF1ZXJ5IH0gZnJvbSAnQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5J1xuaW1wb3J0IHsgUGFnZUhlYWRlciwgQ2FyZCwgQ2FyZEhlYWRlciwgQ2FyZFRpdGxlLCBDYXJkQ29udGVudCwgQnV0dG9uLCBCYWRnZSwgRW1wdHlTdGF0ZSwgRXJyb3JTdGF0ZSwgU2tlbGV0b24gfSBmcm9tICdAcnVubHkvdWknXG5pbXBvcnQgeyBCYXJDaGFydDMsIENsaXBib2FyZExpc3QsIEZpbGVQZW5MaW5lLCBNZXNzYWdlU3F1YXJlVGV4dCwgUGx1cyB9IGZyb20gJ2x1Y2lkZS1yZWFjdCdcbmltcG9ydCB7IGFwaVJlcXVlc3QsIHN0YXR1c0xhYmVsIH0gZnJvbSAnLi9hcGkuanMnXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEVuY3Vlc3Rhc0Rhc2hib2FyZCh7IHRva2VuLCBjb21wYW55SWQsIGFwaUJhc2VVcmwsIG5hdmlnYXRlIH0pIHtcbiAgY29uc3QgcXVlcnkgPSB1c2VRdWVyeSh7XG4gICAgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdkYXNoYm9hcmQnLCBjb21wYW55SWRdLFxuICAgIGVuYWJsZWQ6IEJvb2xlYW4odG9rZW4gJiYgY29tcGFueUlkKSxcbiAgICBxdWVyeUZuOiAoKSA9PiBhcGlSZXF1ZXN0KHsgYXBpQmFzZVVybCwgdG9rZW4sIGNvbXBhbnlJZCwgcGF0aDogJy9lbmN1ZXN0YXMvZGFzaGJvYXJkJyB9KSxcbiAgfSlcblxuICBjb25zdCBkYXRhID0gcXVlcnkuZGF0YT8uZGF0YVxuICBjb25zdCBzdGF0cyA9IFtcbiAgICB7IGxhYmVsOiAnRW5jdWVzdGFzJywgdmFsdWU6IGRhdGE/LnN1cnZleXM/LnRvdGFsID8/IDAsIGljb246IENsaXBib2FyZExpc3QgfSxcbiAgICB7IGxhYmVsOiAnUHVibGljYWRhcycsIHZhbHVlOiBkYXRhPy5zdXJ2ZXlzPy5wdWJsaWNhZGFzID8/IDAsIGljb246IEJhckNoYXJ0MyB9LFxuICAgIHsgbGFiZWw6ICdCb3JyYWRvcmVzJywgdmFsdWU6IGRhdGE/LnN1cnZleXM/LmJvcnJhZG9yZXMgPz8gMCwgaWNvbjogRmlsZVBlbkxpbmUgfSxcbiAgICB7IGxhYmVsOiAnUmVzcHVlc3RhcycsIHZhbHVlOiBkYXRhPy5yZXNwb25zZXM/LnRvdGFsID8/IDAsIGljb246IE1lc3NhZ2VTcXVhcmVUZXh0IH0sXG4gIF1cblxuICByZXR1cm4gKFxuICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS02IHAtNCBtZDpwLTZcIj5cbiAgICAgIDxQYWdlSGVhZGVyXG4gICAgICAgIHRpdGxlPVwiRW5jdWVzdGFzXCJcbiAgICAgICAgZGVzY3JpcHRpb249XCJDcmVhLCBwdWJsaWNhIHkgYW5hbGl6YSBlbmN1ZXN0YXMgZGVzZGUgUnVubHkuXCJcbiAgICAgICAgYWN0aW9ucz17PEJ1dHRvbiBvbkNsaWNrPXsoKSA9PiBuYXZpZ2F0ZSgnL2FwcC9tL2N1c3RvbS5lbmN1ZXN0YXMvY29uc3RydWN0b3InKX0+PFBsdXMgY2xhc3NOYW1lPVwibXItMiBoLTQgdy00XCIgLz5DcmVhciBlbmN1ZXN0YTwvQnV0dG9uPn1cbiAgICAgIC8+XG5cbiAgICAgIHtxdWVyeS5pc0xvYWRpbmcgPyAoXG4gICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiZ3JpZCBncmlkLWNvbHMtMSBnYXAtNCBtZDpncmlkLWNvbHMtNFwiPntbMCwxLDIsM10ubWFwKCh4KSA9PiA8U2tlbGV0b24ga2V5PXt4fSBjbGFzc05hbWU9XCJoLTI4IHctZnVsbFwiIC8+KX08L2Rpdj5cbiAgICAgICkgOiBxdWVyeS5lcnJvciA/IChcbiAgICAgICAgPEVycm9yU3RhdGUgdGl0bGU9XCJObyBzZSBwdWRvIGNhcmdhciBlbCBwYW5lbFwiIGRlc2NyaXB0aW9uPXtxdWVyeS5lcnJvci5tZXNzYWdlfSAvPlxuICAgICAgKSA6IChcbiAgICAgICAgPD5cbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImdyaWQgZ3JpZC1jb2xzLTEgZ2FwLTQgc206Z3JpZC1jb2xzLTIgeGw6Z3JpZC1jb2xzLTRcIj5cbiAgICAgICAgICAgIHtzdGF0cy5tYXAoKHsgbGFiZWwsIHZhbHVlLCBpY29uOiBJY29uIH0pID0+IChcbiAgICAgICAgICAgICAgPENhcmQga2V5PXtsYWJlbH0+XG4gICAgICAgICAgICAgICAgPENhcmRDb250ZW50IGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlbiBwLTVcIj5cbiAgICAgICAgICAgICAgICAgIDxkaXY+PHAgY2xhc3NOYW1lPVwidGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntsYWJlbH08L3A+PHAgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LTN4bCBmb250LXNlbWlib2xkXCI+e3ZhbHVlfTwvcD48L2Rpdj5cbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwicm91bmRlZC1sZyBiZy1baHNsKHZhcigtLW11dGVkKSldIHAtM1wiPjxJY29uIGNsYXNzTmFtZT1cImgtNSB3LTVcIiAvPjwvZGl2PlxuICAgICAgICAgICAgICAgIDwvQ2FyZENvbnRlbnQ+XG4gICAgICAgICAgICAgIDwvQ2FyZD5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgIDwvZGl2PlxuXG4gICAgICAgICAgPENhcmQ+XG4gICAgICAgICAgICA8Q2FyZEhlYWRlciBjbGFzc05hbWU9XCJmbGV4LXJvdyBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuXCI+XG4gICAgICAgICAgICAgIDxkaXY+PENhcmRUaXRsZT5BY3RpdmlkYWQgcmVjaWVudGU8L0NhcmRUaXRsZT48cCBjbGFzc05hbWU9XCJtdC0xIHRleHQtc20gdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj5UdXMgZW5jdWVzdGFzIG1vZGlmaWNhZGFzIHJlY2llbnRlbWVudGUuPC9wPjwvZGl2PlxuICAgICAgICAgICAgICA8QnV0dG9uIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gbmF2aWdhdGUoJy9hcHAvbS9jdXN0b20uZW5jdWVzdGFzL2NvbnN0cnVjdG9yJyl9PkFkbWluaXN0cmFyPC9CdXR0b24+XG4gICAgICAgICAgICA8L0NhcmRIZWFkZXI+XG4gICAgICAgICAgICA8Q2FyZENvbnRlbnQ+XG4gICAgICAgICAgICAgIHshZGF0YT8ucmVjZW50Py5sZW5ndGggPyAoXG4gICAgICAgICAgICAgICAgPEVtcHR5U3RhdGUgdGl0bGU9XCJUb2Rhdlx1MDBFRGEgbm8gaGF5IGVuY3Vlc3Rhc1wiIGRlc2NyaXB0aW9uPVwiQ3JlYSBsYSBwcmltZXJhIGVuY3Vlc3RhIHBhcmEgY29tZW56YXIgYSByZWNvcGlsYXIgcmVzcHVlc3Rhcy5cIiAvPlxuICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS0zXCI+XG4gICAgICAgICAgICAgICAgICB7ZGF0YS5yZWNlbnQubWFwKChzdXJ2ZXkpID0+IChcbiAgICAgICAgICAgICAgICAgICAgPEJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgIHR5cGU9XCJidXR0b25cIlxuICAgICAgICAgICAgICAgICAgICAgIHZhcmlhbnQ9XCJnaG9zdFwiXG4gICAgICAgICAgICAgICAgICAgICAga2V5PXtzdXJ2ZXkuaWR9XG4gICAgICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gbmF2aWdhdGUoJy9hcHAvbS9jdXN0b20uZW5jdWVzdGFzL2NvbnN0cnVjdG9yJyl9XG4gICAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPVwiZmxleCB3LWZ1bGwgaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlbiByb3VuZGVkLWxnIGJvcmRlciBib3JkZXItW2hzbCh2YXIoLS1ib3JkZXIpKV0gcC00IHRleHQtbGVmdCB0cmFuc2l0aW9uIGhvdmVyOmJnLVtoc2wodmFyKC0tbXV0ZWQpKV1cIlxuICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtaW4tdy0wXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0cnVuY2F0ZSBmb250LW1lZGl1bVwiPntzdXJ2ZXkudGl0dWxvfTwvcD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cIm10LTEgdGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntzdXJ2ZXkucHJlZ3VudGFzX3RvdGFsID8/IDB9IHByZWd1bnRhcyBcdTAwQjcge3N1cnZleS5yZXNwdWVzdGFzX3RvdGFsID8/IDB9IHJlc3B1ZXN0YXM8L3A+XG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgPEJhZGdlPntzdGF0dXNMYWJlbChzdXJ2ZXkuZXN0YWRvKX08L0JhZGdlPlxuICAgICAgICAgICAgICAgICAgICA8L0J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgPC9DYXJkQ29udGVudD5cbiAgICAgICAgICA8L0NhcmQ+XG4gICAgICAgIDwvPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKVxufVxuIiwgImltcG9ydCB7IHVzZUVmZmVjdCwgdXNlTWVtbywgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCdcbmltcG9ydCB7IHVzZU11dGF0aW9uLCB1c2VRdWVyeSwgdXNlUXVlcnlDbGllbnQgfSBmcm9tICdAdGFuc3RhY2svcmVhY3QtcXVlcnknXG5pbXBvcnQge1xuICBQYWdlSGVhZGVyLCBDYXJkLCBDYXJkSGVhZGVyLCBDYXJkVGl0bGUsIENhcmRDb250ZW50LCBCdXR0b24sIFRleHRGaWVsZCwgVGV4dGFyZWFGaWVsZCxcbiAgQmFkZ2UsIEVtcHR5U3RhdGUsIEVycm9yU3RhdGUsIFNrZWxldG9uLFxufSBmcm9tICdAcnVubHkvdWknXG5pbXBvcnQgeyB0b2FzdCB9IGZyb20gJ3Nvbm5lcidcbmltcG9ydCB7IENoZXZyb25Eb3duLCBDaGV2cm9uVXAsIENpcmNsZVBsdXMsIENvcHksIEV5ZSwgUGx1cywgU2F2ZSwgVHJhc2gyIH0gZnJvbSAnbHVjaWRlLXJlYWN0J1xuaW1wb3J0IHsgYXBpUmVxdWVzdCwgcXVlc3Rpb25UeXBlTGFiZWwsIHN0YXR1c0xhYmVsIH0gZnJvbSAnLi9hcGkuanMnXG5cbmNvbnN0IGVtcHR5U3VydmV5ID0ge1xuICB0aXR1bG86ICcnLCBkZXNjcmlwY2lvbjogJycsIGFub25pbWE6IHRydWUsIHNvbGljaXRhcl9jb250YWN0bzogZmFsc2UsIGNhcHR1cmFyX2NvbnRleHRvX2ludmVudGFyaW86IGZhbHNlLFxuICBmZWNoYV9pbmljaW86ICcnLCBmZWNoYV9jaWVycmU6ICcnLCBtZW5zYWplX2ZpbmFsOiAnR3JhY2lhcyBwb3IgcmVzcG9uZGVyIGVzdGEgZW5jdWVzdGEuJyxcbn1cbmNvbnN0IGVtcHR5UXVlc3Rpb24gPSB7IHRleHRvOiAnJywgdGlwbzogJ3RleHRvX2NvcnRvJywgb2JsaWdhdG9yaWE6IGZhbHNlLCBvcGNpb25lc1RleHRvOiAnJywgYXl1ZGE6ICcnIH1cbmNvbnN0IHR5cGVzID0gWyd0ZXh0b19jb3J0bycsICd0ZXh0b19sYXJnbycsICdvcGNpb25fdW5pY2EnLCAnb3BjaW9uX211bHRpcGxlJywgJ3NpX25vJywgJ251bWVybycsICdjYWxpZmljYWNpb24nXVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBFbmN1ZXN0YXNTdHVkaW8oeyB0b2tlbiwgY29tcGFueUlkLCBhcGlCYXNlVXJsLCBuYXZpZ2F0ZSB9KSB7XG4gIGNvbnN0IHFjID0gdXNlUXVlcnlDbGllbnQoKVxuICBjb25zdCBbc2VsZWN0ZWRJZCwgc2V0U2VsZWN0ZWRJZF0gPSB1c2VTdGF0ZShudWxsKVxuICBjb25zdCBbc3VydmV5Rm9ybSwgc2V0U3VydmV5Rm9ybV0gPSB1c2VTdGF0ZShlbXB0eVN1cnZleSlcbiAgY29uc3QgW2NyZWF0aW5nLCBzZXRDcmVhdGluZ10gPSB1c2VTdGF0ZShmYWxzZSlcbiAgY29uc3QgW3F1ZXN0aW9uRm9ybSwgc2V0UXVlc3Rpb25Gb3JtXSA9IHVzZVN0YXRlKGVtcHR5UXVlc3Rpb24pXG4gIGNvbnN0IFtlZGl0aW5nUXVlc3Rpb25JZCwgc2V0RWRpdGluZ1F1ZXN0aW9uSWRdID0gdXNlU3RhdGUobnVsbClcblxuICBjb25zdCBzdXJ2ZXlzUXVlcnkgPSB1c2VRdWVyeSh7XG4gICAgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdzdXJ2ZXlzJywgY29tcGFueUlkXSxcbiAgICBlbmFibGVkOiBCb29sZWFuKHRva2VuICYmIGNvbXBhbnlJZCksXG4gICAgcXVlcnlGbjogKCkgPT4gYXBpUmVxdWVzdCh7IGFwaUJhc2VVcmwsIHRva2VuLCBjb21wYW55SWQsIHBhdGg6ICcvZW5jdWVzdGFzL3N1cnZleXM/cGFnZVNpemU9MTAwJyB9KSxcbiAgfSlcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmICghc2VsZWN0ZWRJZCAmJiBzdXJ2ZXlzUXVlcnkuZGF0YT8uZGF0YT8ubGVuZ3RoKSBzZXRTZWxlY3RlZElkKHN1cnZleXNRdWVyeS5kYXRhLmRhdGFbMF0uaWQpXG4gIH0sIFtzZWxlY3RlZElkLCBzdXJ2ZXlzUXVlcnkuZGF0YV0pXG5cbiAgY29uc3Qgc2VsZWN0ZWQgPSB1c2VNZW1vKFxuICAgICgpID0+IHN1cnZleXNRdWVyeS5kYXRhPy5kYXRhPy5maW5kKChpdGVtKSA9PiBpdGVtLmlkID09PSBzZWxlY3RlZElkKSA/PyBudWxsLFxuICAgIFtzdXJ2ZXlzUXVlcnkuZGF0YSwgc2VsZWN0ZWRJZF0sXG4gIClcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmICghc2VsZWN0ZWQpIHJldHVyblxuICAgIHNldFN1cnZleUZvcm0oe1xuICAgICAgdGl0dWxvOiBzZWxlY3RlZC50aXR1bG8gPz8gJycsXG4gICAgICBkZXNjcmlwY2lvbjogc2VsZWN0ZWQuZGVzY3JpcGNpb24gPz8gJycsXG4gICAgICBhbm9uaW1hOiBCb29sZWFuKHNlbGVjdGVkLmFub25pbWEpLFxuICAgICAgc29saWNpdGFyX2NvbnRhY3RvOiBCb29sZWFuKHNlbGVjdGVkLnNvbGljaXRhcl9jb250YWN0byksXG4gICAgICBjYXB0dXJhcl9jb250ZXh0b19pbnZlbnRhcmlvOiBCb29sZWFuKHNlbGVjdGVkLmNhcHR1cmFyX2NvbnRleHRvX2ludmVudGFyaW8pLFxuICAgICAgZmVjaGFfaW5pY2lvOiBzZWxlY3RlZC5mZWNoYV9pbmljaW8gPz8gJycsXG4gICAgICBmZWNoYV9jaWVycmU6IHNlbGVjdGVkLmZlY2hhX2NpZXJyZSA/PyAnJyxcbiAgICAgIG1lbnNhamVfZmluYWw6IHNlbGVjdGVkLm1lbnNhamVfZmluYWwgPz8gJycsXG4gICAgfSlcbiAgICBzZXRDcmVhdGluZyhmYWxzZSlcbiAgfSwgW3NlbGVjdGVkXSlcblxuICBjb25zdCBxdWVzdGlvbnNRdWVyeSA9IHVzZVF1ZXJ5KHtcbiAgICBxdWVyeUtleTogWydjdXN0b20uZW5jdWVzdGFzJywgJ3F1ZXN0aW9ucycsIHNlbGVjdGVkSWQsIGNvbXBhbnlJZF0sXG4gICAgZW5hYmxlZDogQm9vbGVhbihzZWxlY3RlZElkICYmIHRva2VuICYmIGNvbXBhbnlJZCksXG4gICAgcXVlcnlGbjogKCkgPT4gYXBpUmVxdWVzdCh7IGFwaUJhc2VVcmwsIHRva2VuLCBjb21wYW55SWQsIHBhdGg6IGAvZW5jdWVzdGFzL3N1cnZleXMvJHtzZWxlY3RlZElkfS9xdWVzdGlvbnNgIH0pLFxuICB9KVxuXG4gIGNvbnN0IHJlZnJlc2ggPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgcWMuaW52YWxpZGF0ZVF1ZXJpZXMoeyBxdWVyeUtleTogWydjdXN0b20uZW5jdWVzdGFzJywgJ3N1cnZleXMnXSB9KSxcbiAgICAgIHFjLmludmFsaWRhdGVRdWVyaWVzKHsgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdxdWVzdGlvbnMnXSB9KSxcbiAgICAgIHFjLmludmFsaWRhdGVRdWVyaWVzKHsgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdkYXNoYm9hcmQnXSB9KSxcbiAgICBdKVxuICB9XG5cbiAgY29uc3Qgc2F2ZVN1cnZleSA9IHVzZU11dGF0aW9uKHtcbiAgICBtdXRhdGlvbkZuOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXN1cnZleUZvcm0udGl0dWxvLnRyaW0oKSkgdGhyb3cgbmV3IEVycm9yKCdFc2NyaWJlIHVuIHRcdTAwRUR0dWxvIHBhcmEgbGEgZW5jdWVzdGEuJylcbiAgICAgIHJldHVybiBhcGlSZXF1ZXN0KHtcbiAgICAgICAgYXBpQmFzZVVybCwgdG9rZW4sIGNvbXBhbnlJZCxcbiAgICAgICAgcGF0aDogY3JlYXRpbmcgPyAnL2VuY3Vlc3Rhcy9zdXJ2ZXlzJyA6IGAvZW5jdWVzdGFzL3N1cnZleXMvJHtzZWxlY3RlZElkfWAsXG4gICAgICAgIG1ldGhvZDogY3JlYXRpbmcgPyAnUE9TVCcgOiAnUEFUQ0gnLFxuICAgICAgICBib2R5OiB7IC4uLnN1cnZleUZvcm0sIHRpdHVsbzogc3VydmV5Rm9ybS50aXR1bG8udHJpbSgpIH0sXG4gICAgICB9KVxuICAgIH0sXG4gICAgb25TdWNjZXNzOiBhc3luYyAocGF5bG9hZCkgPT4ge1xuICAgICAgaWYgKGNyZWF0aW5nKSBzZXRTZWxlY3RlZElkKHBheWxvYWQuZGF0YS5pZClcbiAgICAgIHNldENyZWF0aW5nKGZhbHNlKVxuICAgICAgYXdhaXQgcmVmcmVzaCgpXG4gICAgICB0b2FzdC5zdWNjZXNzKCdFbmN1ZXN0YSBndWFyZGFkYS4nKVxuICAgIH0sXG4gICAgb25FcnJvcjogKGVycm9yKSA9PiB0b2FzdC5lcnJvcihlcnJvci5tZXNzYWdlKSxcbiAgfSlcblxuICBjb25zdCBjaGFuZ2VTdGF0dXMgPSB1c2VNdXRhdGlvbih7XG4gICAgbXV0YXRpb25GbjogKGVzdGFkbykgPT4gYXBpUmVxdWVzdCh7XG4gICAgICBhcGlCYXNlVXJsLCB0b2tlbiwgY29tcGFueUlkLCBwYXRoOiBgL2VuY3Vlc3Rhcy9zdXJ2ZXlzLyR7c2VsZWN0ZWRJZH0vc3RhdHVzYCwgbWV0aG9kOiAnUEFUQ0gnLCBib2R5OiB7IGVzdGFkbyB9LFxuICAgIH0pLFxuICAgIG9uU3VjY2VzczogYXN5bmMgKCkgPT4geyBhd2FpdCByZWZyZXNoKCk7IHRvYXN0LnN1Y2Nlc3MoJ0VzdGFkbyBhY3R1YWxpemFkby4nKSB9LFxuICAgIG9uRXJyb3I6IChlcnJvcikgPT4gdG9hc3QuZXJyb3IoZXJyb3IubWVzc2FnZSksXG4gIH0pXG5cbiAgY29uc3QgZGVsZXRlU3VydmV5ID0gdXNlTXV0YXRpb24oe1xuICAgIG11dGF0aW9uRm46ICgpID0+IGFwaVJlcXVlc3QoeyBhcGlCYXNlVXJsLCB0b2tlbiwgY29tcGFueUlkLCBwYXRoOiBgL2VuY3Vlc3Rhcy9zdXJ2ZXlzLyR7c2VsZWN0ZWRJZH1gLCBtZXRob2Q6ICdERUxFVEUnIH0pLFxuICAgIG9uU3VjY2VzczogYXN5bmMgKCkgPT4ge1xuICAgICAgc2V0U2VsZWN0ZWRJZChudWxsKVxuICAgICAgc2V0U3VydmV5Rm9ybShlbXB0eVN1cnZleSlcbiAgICAgIGF3YWl0IHJlZnJlc2goKVxuICAgICAgdG9hc3Quc3VjY2VzcygnRW5jdWVzdGEgZWxpbWluYWRhLicpXG4gICAgfSxcbiAgICBvbkVycm9yOiAoZXJyb3IpID0+IHRvYXN0LmVycm9yKGVycm9yLm1lc3NhZ2UpLFxuICB9KVxuXG4gIGNvbnN0IHNhdmVRdWVzdGlvbiA9IHVzZU11dGF0aW9uKHtcbiAgICBtdXRhdGlvbkZuOiAoKSA9PiB7XG4gICAgICBpZiAoIXF1ZXN0aW9uRm9ybS50ZXh0by50cmltKCkpIHRocm93IG5ldyBFcnJvcignRXNjcmliZSBsYSBwcmVndW50YS4nKVxuICAgICAgY29uc3Qgb3BjaW9uZXMgPSBxdWVzdGlvbkZvcm0ub3BjaW9uZXNUZXh0by5zcGxpdCgnXFxuJykubWFwKCh4KSA9PiB4LnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pXG4gICAgICBpZiAoWydvcGNpb25fdW5pY2EnLCAnb3BjaW9uX211bHRpcGxlJ10uaW5jbHVkZXMocXVlc3Rpb25Gb3JtLnRpcG8pICYmIG9wY2lvbmVzLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBZ3JlZ2EgYWwgbWVub3MgZG9zIG9wY2lvbmVzLCB1bmEgcG9yIGxcdTAwRURuZWEuJylcbiAgICAgIH1cbiAgICAgIHJldHVybiBhcGlSZXF1ZXN0KHtcbiAgICAgICAgYXBpQmFzZVVybCwgdG9rZW4sIGNvbXBhbnlJZCxcbiAgICAgICAgcGF0aDogZWRpdGluZ1F1ZXN0aW9uSWRcbiAgICAgICAgICA/IGAvZW5jdWVzdGFzL3N1cnZleXMvJHtzZWxlY3RlZElkfS9xdWVzdGlvbnMvJHtlZGl0aW5nUXVlc3Rpb25JZH1gXG4gICAgICAgICAgOiBgL2VuY3Vlc3Rhcy9zdXJ2ZXlzLyR7c2VsZWN0ZWRJZH0vcXVlc3Rpb25zYCxcbiAgICAgICAgbWV0aG9kOiBlZGl0aW5nUXVlc3Rpb25JZCA/ICdQQVRDSCcgOiAnUE9TVCcsXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB0ZXh0bzogcXVlc3Rpb25Gb3JtLnRleHRvLnRyaW0oKSwgdGlwbzogcXVlc3Rpb25Gb3JtLnRpcG8sXG4gICAgICAgICAgb2JsaWdhdG9yaWE6IHF1ZXN0aW9uRm9ybS5vYmxpZ2F0b3JpYSwgb3BjaW9uZXMsIGF5dWRhOiBxdWVzdGlvbkZvcm0uYXl1ZGEgfHwgbnVsbCxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgfSxcbiAgICBvblN1Y2Nlc3M6IGFzeW5jICgpID0+IHtcbiAgICAgIHNldFF1ZXN0aW9uRm9ybShlbXB0eVF1ZXN0aW9uKVxuICAgICAgc2V0RWRpdGluZ1F1ZXN0aW9uSWQobnVsbClcbiAgICAgIGF3YWl0IHJlZnJlc2goKVxuICAgICAgdG9hc3Quc3VjY2VzcygnUHJlZ3VudGEgZ3VhcmRhZGEuJylcbiAgICB9LFxuICAgIG9uRXJyb3I6IChlcnJvcikgPT4gdG9hc3QuZXJyb3IoZXJyb3IubWVzc2FnZSksXG4gIH0pXG5cbiAgY29uc3QgcmVtb3ZlUXVlc3Rpb24gPSB1c2VNdXRhdGlvbih7XG4gICAgbXV0YXRpb25GbjogKHF1ZXN0aW9uSWQpID0+IGFwaVJlcXVlc3Qoe1xuICAgICAgYXBpQmFzZVVybCwgdG9rZW4sIGNvbXBhbnlJZCwgcGF0aDogYC9lbmN1ZXN0YXMvc3VydmV5cy8ke3NlbGVjdGVkSWR9L3F1ZXN0aW9ucy8ke3F1ZXN0aW9uSWR9YCwgbWV0aG9kOiAnREVMRVRFJyxcbiAgICB9KSxcbiAgICBvblN1Y2Nlc3M6IGFzeW5jICgpID0+IHsgYXdhaXQgcmVmcmVzaCgpOyB0b2FzdC5zdWNjZXNzKCdQcmVndW50YSBlbGltaW5hZGEuJykgfSxcbiAgICBvbkVycm9yOiAoZXJyb3IpID0+IHRvYXN0LmVycm9yKGVycm9yLm1lc3NhZ2UpLFxuICB9KVxuXG4gIGNvbnN0IHJlb3JkZXJRdWVzdGlvbiA9IHVzZU11dGF0aW9uKHtcbiAgICBtdXRhdGlvbkZuOiAoeyBpZCwgcG9zaWNpb24gfSkgPT4gYXBpUmVxdWVzdCh7XG4gICAgICBhcGlCYXNlVXJsLCB0b2tlbiwgY29tcGFueUlkLCBwYXRoOiBgL2VuY3Vlc3Rhcy9zdXJ2ZXlzLyR7c2VsZWN0ZWRJZH0vcXVlc3Rpb25zLyR7aWR9YCwgbWV0aG9kOiAnUEFUQ0gnLCBib2R5OiB7IHBvc2ljaW9uIH0sXG4gICAgfSksXG4gICAgb25TdWNjZXNzOiByZWZyZXNoLFxuICAgIG9uRXJyb3I6IChlcnJvcikgPT4gdG9hc3QuZXJyb3IoZXJyb3IubWVzc2FnZSksXG4gIH0pXG5cbiAgY29uc3QgYmVnaW5OZXcgPSAoKSA9PiB7XG4gICAgc2V0U2VsZWN0ZWRJZChudWxsKVxuICAgIHNldENyZWF0aW5nKHRydWUpXG4gICAgc2V0U3VydmV5Rm9ybShlbXB0eVN1cnZleSlcbiAgICBzZXRRdWVzdGlvbkZvcm0oZW1wdHlRdWVzdGlvbilcbiAgICBzZXRFZGl0aW5nUXVlc3Rpb25JZChudWxsKVxuICB9XG5cbiAgY29uc3QgZWRpdFF1ZXN0aW9uID0gKHF1ZXN0aW9uKSA9PiB7XG4gICAgc2V0RWRpdGluZ1F1ZXN0aW9uSWQocXVlc3Rpb24uaWQpXG4gICAgc2V0UXVlc3Rpb25Gb3JtKHtcbiAgICAgIHRleHRvOiBxdWVzdGlvbi50ZXh0byA/PyAnJyxcbiAgICAgIHRpcG86IHF1ZXN0aW9uLnRpcG8gPz8gJ3RleHRvX2NvcnRvJyxcbiAgICAgIG9ibGlnYXRvcmlhOiBCb29sZWFuKHF1ZXN0aW9uLm9ibGlnYXRvcmlhKSxcbiAgICAgIG9wY2lvbmVzVGV4dG86IChxdWVzdGlvbi5vcGNpb25lcyA/PyBbXSkuam9pbignXFxuJyksXG4gICAgICBheXVkYTogcXVlc3Rpb24uYXl1ZGEgPz8gJycsXG4gICAgfSlcbiAgfVxuXG4gIGNvbnN0IHF1ZXN0aW9ucyA9IHF1ZXN0aW9uc1F1ZXJ5LmRhdGE/LmRhdGEgPz8gW11cblxuICByZXR1cm4gKFxuICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS02IHAtNCBtZDpwLTZcIj5cbiAgICAgIDxQYWdlSGVhZGVyXG4gICAgICAgIHRpdGxlPVwiQ29uc3RydWN0b3IgZGUgZW5jdWVzdGFzXCJcbiAgICAgICAgZGVzY3JpcHRpb249XCJEaXNlXHUwMEYxYSBmb3JtdWxhcmlvcywgcHVibGljYSB5IGNvbnRyb2xhIHN1IGRpc3BvbmliaWxpZGFkLlwiXG4gICAgICAgIGFjdGlvbnM9ezxCdXR0b24gb25DbGljaz17YmVnaW5OZXd9PjxQbHVzIGNsYXNzTmFtZT1cIm1yLTIgaC00IHctNFwiIC8+TnVldmEgZW5jdWVzdGE8L0J1dHRvbj59XG4gICAgICAvPlxuXG4gICAgICB7c3VydmV5c1F1ZXJ5LmlzTG9hZGluZyA/IDxTa2VsZXRvbiBjbGFzc05hbWU9XCJoLTk2IHctZnVsbFwiIC8+IDogc3VydmV5c1F1ZXJ5LmVycm9yID8gKFxuICAgICAgICA8RXJyb3JTdGF0ZSB0aXRsZT1cIk5vIHNlIHB1ZGllcm9uIGNhcmdhciBsYXMgZW5jdWVzdGFzXCIgZGVzY3JpcHRpb249e3N1cnZleXNRdWVyeS5lcnJvci5tZXNzYWdlfSAvPlxuICAgICAgKSA6IChcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0xIGdhcC02IHhsOmdyaWQtY29scy1bMzIwcHhfbWlubWF4KDAsMWZyKV1cIj5cbiAgICAgICAgICA8Q2FyZCBjbGFzc05hbWU9XCJoLWZpdFwiPlxuICAgICAgICAgICAgPENhcmRIZWFkZXI+PENhcmRUaXRsZT5FbmN1ZXN0YXM8L0NhcmRUaXRsZT48L0NhcmRIZWFkZXI+XG4gICAgICAgICAgICA8Q2FyZENvbnRlbnQgY2xhc3NOYW1lPVwic3BhY2UteS0yXCI+XG4gICAgICAgICAgICAgIHshc3VydmV5c1F1ZXJ5LmRhdGE/LmRhdGE/Lmxlbmd0aCAmJiAhY3JlYXRpbmcgPyAoXG4gICAgICAgICAgICAgICAgPEVtcHR5U3RhdGUgdGl0bGU9XCJTaW4gZW5jdWVzdGFzXCIgZGVzY3JpcHRpb249XCJDcmVhIHVuYSBlbmN1ZXN0YSBwYXJhIGNvbWVuemFyLlwiIC8+XG4gICAgICAgICAgICAgICkgOiBzdXJ2ZXlzUXVlcnkuZGF0YT8uZGF0YT8ubWFwKChzdXJ2ZXkpID0+IChcbiAgICAgICAgICAgICAgICA8QnV0dG9uXG4gICAgICAgICAgICAgICAgICB0eXBlPVwiYnV0dG9uXCJcbiAgICAgICAgICAgICAgICAgIHZhcmlhbnQ9XCJnaG9zdFwiXG4gICAgICAgICAgICAgICAgICBrZXk9e3N1cnZleS5pZH1cbiAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldFNlbGVjdGVkSWQoc3VydmV5LmlkKX1cbiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT17YHctZnVsbCByb3VuZGVkLWxnIGJvcmRlciBwLTMgdGV4dC1sZWZ0IHRyYW5zaXRpb24gJHtzZWxlY3RlZElkID09PSBzdXJ2ZXkuaWQgPyAnYm9yZGVyLVtoc2wodmFyKC0tYnJhbmQtcHJpbWFyeSkpXSBiZy1baHNsKHZhcigtLW11dGVkKSldJyA6ICdib3JkZXItW2hzbCh2YXIoLS1ib3JkZXIpKV0gaG92ZXI6YmctW2hzbCh2YXIoLS1tdXRlZCkpXSd9YH1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlbiBnYXAtMlwiPjxzcGFuIGNsYXNzTmFtZT1cInRydW5jYXRlIGZvbnQtbWVkaXVtXCI+e3N1cnZleS50aXR1bG99PC9zcGFuPjxCYWRnZT57c3RhdHVzTGFiZWwoc3VydmV5LmVzdGFkbyl9PC9CYWRnZT48L2Rpdj5cbiAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cIm10LTIgdGV4dC14cyB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntzdXJ2ZXkucHJlZ3VudGFzX3RvdGFsID8/IDB9IHByZWd1bnRhcyBcdTAwQjcge3N1cnZleS5yZXNwdWVzdGFzX3RvdGFsID8/IDB9IHJlc3B1ZXN0YXM8L3A+XG4gICAgICAgICAgICAgICAgPC9CdXR0b24+XG4gICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgPC9DYXJkQ29udGVudD5cbiAgICAgICAgICA8L0NhcmQ+XG5cbiAgICAgICAgICB7IXNlbGVjdGVkICYmICFjcmVhdGluZyA/IChcbiAgICAgICAgICAgIDxDYXJkPjxDYXJkQ29udGVudCBjbGFzc05hbWU9XCJwLTZcIj48RW1wdHlTdGF0ZSB0aXRsZT1cIlNlbGVjY2lvbmEgdW5hIGVuY3Vlc3RhXCIgZGVzY3JpcHRpb249XCJFbGlnZSB1bmEgZW5jdWVzdGEgZGUgbGEgbGlzdGEgbyBjcmVhIHVuYSBudWV2YS5cIiAvPjwvQ2FyZENvbnRlbnQ+PC9DYXJkPlxuICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInNwYWNlLXktNlwiPlxuICAgICAgICAgICAgICA8Q2FyZD5cbiAgICAgICAgICAgICAgICA8Q2FyZEhlYWRlciBjbGFzc05hbWU9XCJmbGV4LXJvdyBpdGVtcy1zdGFydCBqdXN0aWZ5LWJldHdlZW4gZ2FwLTNcIj5cbiAgICAgICAgICAgICAgICAgIDxkaXY+PENhcmRUaXRsZT57Y3JlYXRpbmcgPyAnTnVldmEgZW5jdWVzdGEnIDogJ0NvbmZpZ3VyYWNpXHUwMEYzbid9PC9DYXJkVGl0bGU+PHAgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+SW5mb3JtYWNpXHUwMEYzbiB5IGNvbXBvcnRhbWllbnRvIGdlbmVyYWwuPC9wPjwvZGl2PlxuICAgICAgICAgICAgICAgICAgeyFjcmVhdGluZyAmJiA8QmFkZ2U+e3N0YXR1c0xhYmVsKHNlbGVjdGVkPy5lc3RhZG8pfTwvQmFkZ2U+fVxuICAgICAgICAgICAgICAgIDwvQ2FyZEhlYWRlcj5cbiAgICAgICAgICAgICAgICA8Q2FyZENvbnRlbnQgY2xhc3NOYW1lPVwic3BhY2UteS00XCI+XG4gICAgICAgICAgICAgICAgICA8VGV4dEZpZWxkIGxhYmVsPVwiVFx1MDBFRHR1bG9cIiB2YWx1ZT17c3VydmV5Rm9ybS50aXR1bG99IG9uQ2hhbmdlPXsoZSkgPT4gc2V0U3VydmV5Rm9ybSgocykgPT4gKHsgLi4ucywgdGl0dWxvOiBlLnRhcmdldC52YWx1ZSB9KSl9IHBsYWNlaG9sZGVyPVwiRWouIEVuY3Vlc3RhIGRlIHNhdGlzZmFjY2lcdTAwRjNuXCIgLz5cbiAgICAgICAgICAgICAgICAgIDxUZXh0YXJlYUZpZWxkIGxhYmVsPVwiRGVzY3JpcGNpXHUwMEYzblwiIHZhbHVlPXtzdXJ2ZXlGb3JtLmRlc2NyaXBjaW9ufSBvbkNoYW5nZT17KGUpID0+IHNldFN1cnZleUZvcm0oKHMpID0+ICh7IC4uLnMsIGRlc2NyaXBjaW9uOiBlLnRhcmdldC52YWx1ZSB9KSl9IHBsYWNlaG9sZGVyPVwiRXhwbGljYSBicmV2ZW1lbnRlIGVsIHByb3BcdTAwRjNzaXRvIGRlIGxhIGVuY3Vlc3RhLlwiIC8+XG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImdyaWQgZ3JpZC1jb2xzLTEgZ2FwLTQgbWQ6Z3JpZC1jb2xzLTJcIj5cbiAgICAgICAgICAgICAgICAgICAgPFRleHRGaWVsZCBsYWJlbD1cIkluaWNpb1wiIHZhbHVlPXtzdXJ2ZXlGb3JtLmZlY2hhX2luaWNpb30gb25DaGFuZ2U9eyhlKSA9PiBzZXRTdXJ2ZXlGb3JtKChzKSA9PiAoeyAuLi5zLCBmZWNoYV9pbmljaW86IGUudGFyZ2V0LnZhbHVlIH0pKX0gcGxhY2Vob2xkZXI9XCIyMDI2LTEwLTAxIDA4OjAwXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPFRleHRGaWVsZCBsYWJlbD1cIkNpZXJyZVwiIHZhbHVlPXtzdXJ2ZXlGb3JtLmZlY2hhX2NpZXJyZX0gb25DaGFuZ2U9eyhlKSA9PiBzZXRTdXJ2ZXlGb3JtKChzKSA9PiAoeyAuLi5zLCBmZWNoYV9jaWVycmU6IGUudGFyZ2V0LnZhbHVlIH0pKX0gcGxhY2Vob2xkZXI9XCIyMDI2LTEwLTMxIDE4OjAwXCIgLz5cbiAgICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgICAgPFRleHRhcmVhRmllbGQgbGFiZWw9XCJNZW5zYWplIGFsIGZpbmFsaXphclwiIHZhbHVlPXtzdXJ2ZXlGb3JtLm1lbnNhamVfZmluYWx9IG9uQ2hhbmdlPXsoZSkgPT4gc2V0U3VydmV5Rm9ybSgocykgPT4gKHsgLi4ucywgbWVuc2FqZV9maW5hbDogZS50YXJnZXQudmFsdWUgfSkpfSAvPlxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0xIGdhcC0zIG1kOmdyaWQtY29scy0yXCI+XG4gICAgICAgICAgICAgICAgICAgIDxCdXR0b24gdHlwZT1cImJ1dHRvblwiIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gc2V0U3VydmV5Rm9ybSgocykgPT4gKHsgLi4ucywgYW5vbmltYTogIXMuYW5vbmltYSB9KSl9IGNsYXNzTmFtZT1cInJvdW5kZWQtbGcgYm9yZGVyIGJvcmRlci1baHNsKHZhcigtLWJvcmRlcikpXSBwLTQgdGV4dC1sZWZ0XCI+XG4gICAgICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwiZm9udC1tZWRpdW1cIj5FbmN1ZXN0YSBhblx1MDBGM25pbWE8L3A+PHAgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+e3N1cnZleUZvcm0uYW5vbmltYSA/ICdBY3RpdmFkYScgOiAnRGVzYWN0aXZhZGEnfTwvcD5cbiAgICAgICAgICAgICAgICAgICAgPC9CdXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDxCdXR0b24gdHlwZT1cImJ1dHRvblwiIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gc2V0U3VydmV5Rm9ybSgocykgPT4gKHsgLi4ucywgc29saWNpdGFyX2NvbnRhY3RvOiAhcy5zb2xpY2l0YXJfY29udGFjdG8gfSkpfSBjbGFzc05hbWU9XCJyb3VuZGVkLWxnIGJvcmRlciBib3JkZXItW2hzbCh2YXIoLS1ib3JkZXIpKV0gcC00IHRleHQtbGVmdFwiPlxuICAgICAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cImZvbnQtbWVkaXVtXCI+U29saWNpdGFyIGNvbnRhY3RvPC9wPjxwIGNsYXNzTmFtZT1cIm10LTEgdGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntzdXJ2ZXlGb3JtLnNvbGljaXRhcl9jb250YWN0byA/ICdOb21icmUgeSBjb3JyZW8nIDogJ05vIHNvbGljaXRhciBkYXRvcyd9PC9wPlxuICAgICAgICAgICAgICAgICAgICA8L0J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgPEJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgdmFyaWFudD1cIm91dGxpbmVcIiBvbkNsaWNrPXsoKSA9PiBzZXRTdXJ2ZXlGb3JtKChzKSA9PiAoeyAuLi5zLCBjYXB0dXJhcl9jb250ZXh0b19pbnZlbnRhcmlvOiAhcy5jYXB0dXJhcl9jb250ZXh0b19pbnZlbnRhcmlvIH0pKX0gY2xhc3NOYW1lPVwicm91bmRlZC1sZyBib3JkZXIgYm9yZGVyLVtoc2wodmFyKC0tYm9yZGVyKSldIHAtNCB0ZXh0LWxlZnRcIj5cbiAgICAgICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJmb250LW1lZGl1bVwiPklkZW50aWRhZCBlIGludmVudGFyaW8gYXNpZ25hZG88L3A+PHAgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+e3N1cnZleUZvcm0uY2FwdHVyYXJfY29udGV4dG9faW52ZW50YXJpbyA/ICdDYXB0dXJhciBhbCByZXNwb25kZXInIDogJ05vIGNhcHR1cmFyJ308L3A+XG4gICAgICAgICAgICAgICAgICAgIDwvQnV0dG9uPlxuICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXggZmxleC13cmFwIGdhcC0yXCI+XG4gICAgICAgICAgICAgICAgICAgIDxCdXR0b24gb25DbGljaz17KCkgPT4gc2F2ZVN1cnZleS5tdXRhdGUoKX0gZGlzYWJsZWQ9e3NhdmVTdXJ2ZXkuaXNQZW5kaW5nfT48U2F2ZSBjbGFzc05hbWU9XCJtci0yIGgtNCB3LTRcIiAvPkd1YXJkYXI8L0J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgeyFjcmVhdGluZyAmJiBzZWxlY3RlZD8uZXN0YWRvICE9PSAncHVibGljYWRhJyAmJiA8QnV0dG9uIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gY2hhbmdlU3RhdHVzLm11dGF0ZSgncHVibGljYWRhJyl9PlB1YmxpY2FyPC9CdXR0b24+fVxuICAgICAgICAgICAgICAgICAgICB7IWNyZWF0aW5nICYmIHNlbGVjdGVkPy5lc3RhZG8gPT09ICdwdWJsaWNhZGEnICYmIDxCdXR0b24gdmFyaWFudD1cIm91dGxpbmVcIiBvbkNsaWNrPXsoKSA9PiBjaGFuZ2VTdGF0dXMubXV0YXRlKCdjZXJyYWRhJyl9PkNlcnJhciByZXNwdWVzdGFzPC9CdXR0b24+fVxuICAgICAgICAgICAgICAgICAgICB7IWNyZWF0aW5nICYmIHNlbGVjdGVkPy5lc3RhZG8gIT09ICdib3JyYWRvcicgJiYgPEJ1dHRvbiB2YXJpYW50PVwib3V0bGluZVwiIG9uQ2xpY2s9eygpID0+IGNoYW5nZVN0YXR1cy5tdXRhdGUoJ2JvcnJhZG9yJyl9PlZvbHZlciBhIGJvcnJhZG9yPC9CdXR0b24+fVxuICAgICAgICAgICAgICAgICAgICB7IWNyZWF0aW5nICYmIDxCdXR0b24gdmFyaWFudD1cIm91dGxpbmVcIiBvbkNsaWNrPXsoKSA9PiBuYXZpZ2F0ZSgnL2FwcC9tL2N1c3RvbS5lbmN1ZXN0YXMvcmVzcG9uZGVyJyl9PjxFeWUgY2xhc3NOYW1lPVwibXItMiBoLTQgdy00XCIgLz5WaXN0YSBkZSByZXNwdWVzdGE8L0J1dHRvbj59XG4gICAgICAgICAgICAgICAgICAgIHshY3JlYXRpbmcgJiYgPEJ1dHRvbiB2YXJpYW50PVwib3V0bGluZVwiIG9uQ2xpY2s9eygpID0+IG5hdmlnYXRlKCcvYXBwL20vY3VzdG9tLmVuY3Vlc3Rhcy9yZXN1bHRhZG9zJyl9PlJlc3VsdGFkb3M8L0J1dHRvbj59XG4gICAgICAgICAgICAgICAgICAgIHshY3JlYXRpbmcgJiYgPEJ1dHRvbiB2YXJpYW50PVwib3V0bGluZVwiIG9uQ2xpY2s9eygpID0+IGRlbGV0ZVN1cnZleS5tdXRhdGUoKX0+PFRyYXNoMiBjbGFzc05hbWU9XCJtci0yIGgtNCB3LTRcIiAvPkVsaW1pbmFyPC9CdXR0b24+fVxuICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgPC9DYXJkQ29udGVudD5cbiAgICAgICAgICAgICAgPC9DYXJkPlxuXG4gICAgICAgICAgICAgIHshY3JlYXRpbmcgJiYgKFxuICAgICAgICAgICAgICAgIDw+XG4gICAgICAgICAgICAgICAgICA8Q2FyZD5cbiAgICAgICAgICAgICAgICAgICAgPENhcmRIZWFkZXI+PENhcmRUaXRsZT5QcmVndW50YXM8L0NhcmRUaXRsZT48L0NhcmRIZWFkZXI+XG4gICAgICAgICAgICAgICAgICAgIDxDYXJkQ29udGVudCBjbGFzc05hbWU9XCJzcGFjZS15LTNcIj5cbiAgICAgICAgICAgICAgICAgICAgICB7cXVlc3Rpb25zUXVlcnkuaXNMb2FkaW5nID8gPFNrZWxldG9uIGNsYXNzTmFtZT1cImgtMzYgdy1mdWxsXCIgLz4gOiBxdWVzdGlvbnNRdWVyeS5lcnJvciA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxFcnJvclN0YXRlIHRpdGxlPVwiTm8gc2UgcHVkaWVyb24gY2FyZ2FyIGxhcyBwcmVndW50YXNcIiBkZXNjcmlwdGlvbj17cXVlc3Rpb25zUXVlcnkuZXJyb3IubWVzc2FnZX0gLz5cbiAgICAgICAgICAgICAgICAgICAgICApIDogIXF1ZXN0aW9ucy5sZW5ndGggPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8RW1wdHlTdGF0ZSB0aXRsZT1cIlNpbiBwcmVndW50YXNcIiBkZXNjcmlwdGlvbj1cIkFncmVnYSBsYSBwcmltZXJhIHByZWd1bnRhIGRlIGVzdGEgZW5jdWVzdGEuXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICApIDogcXVlc3Rpb25zLm1hcCgocXVlc3Rpb24sIGluZGV4KSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGtleT17cXVlc3Rpb24uaWR9IGNsYXNzTmFtZT1cInJvdW5kZWQtbGcgYm9yZGVyIGJvcmRlci1baHNsKHZhcigtLWJvcmRlcikpXSBwLTRcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGZsZXgtY29sIGp1c3RpZnktYmV0d2VlbiBnYXAtMyBtZDpmbGV4LXJvdyBtZDppdGVtcy1zdGFydFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwibWluLXctMFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGZsZXgtd3JhcCBpdGVtcy1jZW50ZXIgZ2FwLTJcIj48c3BhbiBjbGFzc05hbWU9XCJmb250LW1lZGl1bVwiPntpbmRleCArIDF9LiB7cXVlc3Rpb24udGV4dG99PC9zcGFuPntxdWVzdGlvbi5vYmxpZ2F0b3JpYSAmJiA8QmFkZ2U+T2JsaWdhdG9yaWE8L0JhZGdlPn08L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cIm10LTEgdGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntxdWVzdGlvblR5cGVMYWJlbChxdWVzdGlvbi50aXBvKX17cXVlc3Rpb24ub3BjaW9uZXM/Lmxlbmd0aCA/IGAgXHUwMEI3ICR7cXVlc3Rpb24ub3BjaW9uZXMubGVuZ3RofSBvcGNpb25lc2AgOiAnJ308L3A+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGdhcC0xXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8QnV0dG9uIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gcmVvcmRlclF1ZXN0aW9uLm11dGF0ZSh7IGlkOiBxdWVzdGlvbi5pZCwgcG9zaWNpb246IE1hdGgubWF4KDAsIE51bWJlcihxdWVzdGlvbi5wb3NpY2lvbiA/PyBpbmRleCArIDEpIC0gMSkgfSl9IGRpc2FibGVkPXtpbmRleCA9PT0gMH0+PENoZXZyb25VcCBjbGFzc05hbWU9XCJoLTQgdy00XCIgLz48L0J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxCdXR0b24gdmFyaWFudD1cIm91dGxpbmVcIiBvbkNsaWNrPXsoKSA9PiByZW9yZGVyUXVlc3Rpb24ubXV0YXRlKHsgaWQ6IHF1ZXN0aW9uLmlkLCBwb3NpY2lvbjogTnVtYmVyKHF1ZXN0aW9uLnBvc2ljaW9uID8/IGluZGV4ICsgMSkgKyAxIH0pfSBkaXNhYmxlZD17aW5kZXggPT09IHF1ZXN0aW9ucy5sZW5ndGggLSAxfT48Q2hldnJvbkRvd24gY2xhc3NOYW1lPVwiaC00IHctNFwiIC8+PC9CdXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8QnV0dG9uIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gZWRpdFF1ZXN0aW9uKHF1ZXN0aW9uKX0+RWRpdGFyPC9CdXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8QnV0dG9uIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gcmVtb3ZlUXVlc3Rpb24ubXV0YXRlKHF1ZXN0aW9uLmlkKX0+PFRyYXNoMiBjbGFzc05hbWU9XCJoLTQgdy00XCIgLz48L0J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICAgICAgPC9DYXJkQ29udGVudD5cbiAgICAgICAgICAgICAgICAgIDwvQ2FyZD5cblxuICAgICAgICAgICAgICAgICAgPENhcmQ+XG4gICAgICAgICAgICAgICAgICAgIDxDYXJkSGVhZGVyPjxDYXJkVGl0bGU+e2VkaXRpbmdRdWVzdGlvbklkID8gJ0VkaXRhciBwcmVndW50YScgOiAnQWdyZWdhciBwcmVndW50YSd9PC9DYXJkVGl0bGU+PC9DYXJkSGVhZGVyPlxuICAgICAgICAgICAgICAgICAgICA8Q2FyZENvbnRlbnQgY2xhc3NOYW1lPVwic3BhY2UteS00XCI+XG4gICAgICAgICAgICAgICAgICAgICAgPFRleHRGaWVsZCBsYWJlbD1cIlByZWd1bnRhXCIgdmFsdWU9e3F1ZXN0aW9uRm9ybS50ZXh0b30gb25DaGFuZ2U9eyhlKSA9PiBzZXRRdWVzdGlvbkZvcm0oKHMpID0+ICh7IC4uLnMsIHRleHRvOiBlLnRhcmdldC52YWx1ZSB9KSl9IHBsYWNlaG9sZGVyPVwiRXNjcmliZSBsYSBwcmVndW50YVwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgPGRpdj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cIm1iLTIgdGV4dC1zbSBmb250LW1lZGl1bVwiPlRpcG8gZGUgcmVzcHVlc3RhPC9wPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGZsZXgtd3JhcCBnYXAtMlwiPnt0eXBlcy5tYXAoKHR5cGUpID0+IDxCdXR0b24ga2V5PXt0eXBlfSB0eXBlPVwiYnV0dG9uXCIgdmFyaWFudD17cXVlc3Rpb25Gb3JtLnRpcG8gPT09IHR5cGUgPyAnZGVmYXVsdCcgOiAnb3V0bGluZSd9IG9uQ2xpY2s9eygpID0+IHNldFF1ZXN0aW9uRm9ybSgocykgPT4gKHsgLi4ucywgdGlwbzogdHlwZSB9KSl9PntxdWVzdGlvblR5cGVMYWJlbCh0eXBlKX08L0J1dHRvbj4pfTwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgIHtbJ29wY2lvbl91bmljYScsICdvcGNpb25fbXVsdGlwbGUnXS5pbmNsdWRlcyhxdWVzdGlvbkZvcm0udGlwbykgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgPFRleHRhcmVhRmllbGQgbGFiZWw9XCJPcGNpb25lc1wiIGRlc2NyaXB0aW9uPVwiVW5hIG9wY2lcdTAwRjNuIHBvciBsXHUwMEVEbmVhLlwiIHZhbHVlPXtxdWVzdGlvbkZvcm0ub3BjaW9uZXNUZXh0b30gb25DaGFuZ2U9eyhlKSA9PiBzZXRRdWVzdGlvbkZvcm0oKHMpID0+ICh7IC4uLnMsIG9wY2lvbmVzVGV4dG86IGUudGFyZ2V0LnZhbHVlIH0pKX0gcGxhY2Vob2xkZXI9eydFeGNlbGVudGVcXG5CdWVub1xcblJlZ3VsYXJcXG5NYWxvJ30gLz5cbiAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgIDxUZXh0RmllbGQgbGFiZWw9XCJUZXh0byBkZSBheXVkYVwiIHZhbHVlPXtxdWVzdGlvbkZvcm0uYXl1ZGF9IG9uQ2hhbmdlPXsoZSkgPT4gc2V0UXVlc3Rpb25Gb3JtKChzKSA9PiAoeyAuLi5zLCBheXVkYTogZS50YXJnZXQudmFsdWUgfSkpfSBwbGFjZWhvbGRlcj1cIk9wY2lvbmFsXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICA8QnV0dG9uIHR5cGU9XCJidXR0b25cIiB2YXJpYW50PVwib3V0bGluZVwiIG9uQ2xpY2s9eygpID0+IHNldFF1ZXN0aW9uRm9ybSgocykgPT4gKHsgLi4ucywgb2JsaWdhdG9yaWE6ICFzLm9ibGlnYXRvcmlhIH0pKX0gY2xhc3NOYW1lPVwidy1mdWxsIHJvdW5kZWQtbGcgYm9yZGVyIGJvcmRlci1baHNsKHZhcigtLWJvcmRlcikpXSBwLTQgdGV4dC1sZWZ0XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJmb250LW1lZGl1bVwiPlJlc3B1ZXN0YSBvYmxpZ2F0b3JpYTwvcD48cCBjbGFzc05hbWU9XCJtdC0xIHRleHQtc20gdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj57cXVlc3Rpb25Gb3JtLm9ibGlnYXRvcmlhID8gJ1NcdTAwRUQnIDogJ05vJ308L3A+XG4gICAgICAgICAgICAgICAgICAgICAgPC9CdXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGdhcC0yXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8QnV0dG9uIG9uQ2xpY2s9eygpID0+IHNhdmVRdWVzdGlvbi5tdXRhdGUoKX0gZGlzYWJsZWQ9e3NhdmVRdWVzdGlvbi5pc1BlbmRpbmd9PjxDaXJjbGVQbHVzIGNsYXNzTmFtZT1cIm1yLTIgaC00IHctNFwiIC8+e2VkaXRpbmdRdWVzdGlvbklkID8gJ0d1YXJkYXIgY2FtYmlvcycgOiAnQWdyZWdhciBwcmVndW50YSd9PC9CdXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICB7ZWRpdGluZ1F1ZXN0aW9uSWQgJiYgPEJ1dHRvbiB2YXJpYW50PVwib3V0bGluZVwiIG9uQ2xpY2s9eygpID0+IHsgc2V0RWRpdGluZ1F1ZXN0aW9uSWQobnVsbCk7IHNldFF1ZXN0aW9uRm9ybShlbXB0eVF1ZXN0aW9uKSB9fT5DYW5jZWxhciBlZGljaVx1MDBGM248L0J1dHRvbj59XG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgIDwvQ2FyZENvbnRlbnQ+XG4gICAgICAgICAgICAgICAgICA8L0NhcmQ+XG4gICAgICAgICAgICAgICAgPC8+XG4gICAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICApfVxuICAgICAgICA8L2Rpdj5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gIClcbn1cbiIsICJpbXBvcnQgeyB1c2VNZW1vLCB1c2VTdGF0ZSB9IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgdXNlTXV0YXRpb24sIHVzZVF1ZXJ5IH0gZnJvbSAnQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5J1xuaW1wb3J0IHtcbiAgUGFnZUhlYWRlciwgQ2FyZCwgQ2FyZEhlYWRlciwgQ2FyZFRpdGxlLCBDYXJkQ29udGVudCwgQnV0dG9uLCBUZXh0RmllbGQsIFRleHRhcmVhRmllbGQsXG4gIEJhZGdlLCBFbXB0eVN0YXRlLCBFcnJvclN0YXRlLCBTa2VsZXRvbiwgYnVpbGRBcGlIZWFkZXJzLFxufSBmcm9tICdAcnVubHkvdWknXG5pbXBvcnQgeyB0b2FzdCB9IGZyb20gJ3Nvbm5lcidcbmltcG9ydCB7IENoZWNrLCBQYWNrYWdlLCBTZW5kLCBVc2VyUm91bmQgfSBmcm9tICdsdWNpZGUtcmVhY3QnXG5pbXBvcnQgeyBhcGlSZXF1ZXN0LCBxdWVzdGlvblR5cGVMYWJlbCB9IGZyb20gJy4vYXBpLmpzJ1xuXG5mdW5jdGlvbiBRdWVzdGlvbklucHV0KHsgcXVlc3Rpb24sIHZhbHVlLCBvbkNoYW5nZSB9KSB7XG4gIGlmIChxdWVzdGlvbi50aXBvID09PSAndGV4dG9fbGFyZ28nKSB7XG4gICAgcmV0dXJuIDxUZXh0YXJlYUZpZWxkIHZhbHVlPXt2YWx1ZSA/PyAnJ30gb25DaGFuZ2U9eyhlKSA9PiBvbkNoYW5nZShlLnRhcmdldC52YWx1ZSl9IHBsYWNlaG9sZGVyPVwiRXNjcmliZSB0dSByZXNwdWVzdGFcIiAvPlxuICB9XG4gIGlmIChxdWVzdGlvbi50aXBvID09PSAndGV4dG9fY29ydG8nKSB7XG4gICAgcmV0dXJuIDxUZXh0RmllbGQgdmFsdWU9e3ZhbHVlID8/ICcnfSBvbkNoYW5nZT17KGUpID0+IG9uQ2hhbmdlKGUudGFyZ2V0LnZhbHVlKX0gcGxhY2Vob2xkZXI9XCJFc2NyaWJlIHR1IHJlc3B1ZXN0YVwiIC8+XG4gIH1cbiAgaWYgKHF1ZXN0aW9uLnRpcG8gPT09ICdudW1lcm8nKSB7XG4gICAgcmV0dXJuIDxUZXh0RmllbGQgdmFsdWU9e3ZhbHVlID8/ICcnfSBvbkNoYW5nZT17KGUpID0+IG9uQ2hhbmdlKGUudGFyZ2V0LnZhbHVlID09PSAnJyA/ICcnIDogTnVtYmVyKGUudGFyZ2V0LnZhbHVlKSl9IHBsYWNlaG9sZGVyPVwiRXNjcmliZSB1biBuXHUwMEZBbWVyb1wiIC8+XG4gIH1cbiAgaWYgKHF1ZXN0aW9uLnRpcG8gPT09ICdzaV9ubycpIHtcbiAgICByZXR1cm4gPGRpdiBjbGFzc05hbWU9XCJmbGV4IGdhcC0yXCI+e1tbJ1NcdTAwRUQnLCB0cnVlXSwgWydObycsIGZhbHNlXV0ubWFwKChbbGFiZWwsIG9wdGlvbl0pID0+IDxCdXR0b24ga2V5PXtsYWJlbH0gdHlwZT1cImJ1dHRvblwiIHZhcmlhbnQ9e3ZhbHVlID09PSBvcHRpb24gPyAnZGVmYXVsdCcgOiAnb3V0bGluZSd9IG9uQ2xpY2s9eygpID0+IG9uQ2hhbmdlKG9wdGlvbil9PntsYWJlbH08L0J1dHRvbj4pfTwvZGl2PlxuICB9XG4gIGlmIChxdWVzdGlvbi50aXBvID09PSAnY2FsaWZpY2FjaW9uJykge1xuICAgIHJldHVybiA8ZGl2IGNsYXNzTmFtZT1cImZsZXggZmxleC13cmFwIGdhcC0yXCI+e1sxLDIsMyw0LDVdLm1hcCgoc2NvcmUpID0+IDxCdXR0b24ga2V5PXtzY29yZX0gdHlwZT1cImJ1dHRvblwiIHZhcmlhbnQ9e3ZhbHVlID09PSBzY29yZSA/ICdkZWZhdWx0JyA6ICdvdXRsaW5lJ30gb25DbGljaz17KCkgPT4gb25DaGFuZ2Uoc2NvcmUpfT57c2NvcmV9PC9CdXR0b24+KX08L2Rpdj5cbiAgfVxuICBpZiAocXVlc3Rpb24udGlwbyA9PT0gJ29wY2lvbl9tdWx0aXBsZScpIHtcbiAgICBjb25zdCBzZWxlY3RlZCA9IEFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgOiBbXVxuICAgIHJldHVybiA8ZGl2IGNsYXNzTmFtZT1cImZsZXggZmxleC13cmFwIGdhcC0yXCI+eyhxdWVzdGlvbi5vcGNpb25lcyA/PyBbXSkubWFwKChvcHRpb24pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2ZSA9IHNlbGVjdGVkLmluY2x1ZGVzKG9wdGlvbilcbiAgICAgIHJldHVybiA8QnV0dG9uIGtleT17b3B0aW9ufSB0eXBlPVwiYnV0dG9uXCIgdmFyaWFudD17YWN0aXZlID8gJ2RlZmF1bHQnIDogJ291dGxpbmUnfSBvbkNsaWNrPXsoKSA9PiBvbkNoYW5nZShhY3RpdmUgPyBzZWxlY3RlZC5maWx0ZXIoKHgpID0+IHggIT09IG9wdGlvbikgOiBbLi4uc2VsZWN0ZWQsIG9wdGlvbl0pfT57YWN0aXZlICYmIDxDaGVjayBjbGFzc05hbWU9XCJtci0yIGgtNCB3LTRcIiAvPn17b3B0aW9ufTwvQnV0dG9uPlxuICAgIH0pfTwvZGl2PlxuICB9XG4gIHJldHVybiA8ZGl2IGNsYXNzTmFtZT1cImZsZXggZmxleC13cmFwIGdhcC0yXCI+eyhxdWVzdGlvbi5vcGNpb25lcyA/PyBbXSkubWFwKChvcHRpb24pID0+IDxCdXR0b24ga2V5PXtvcHRpb259IHR5cGU9XCJidXR0b25cIiB2YXJpYW50PXt2YWx1ZSA9PT0gb3B0aW9uID8gJ2RlZmF1bHQnIDogJ291dGxpbmUnfSBvbkNsaWNrPXsoKSA9PiBvbkNoYW5nZShvcHRpb24pfT57b3B0aW9ufTwvQnV0dG9uPil9PC9kaXY+XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVUYXJnZXRzKHsgYXBpQmFzZVVybCwgdG9rZW4sIGNvbXBhbnlJZCwgdHlwZSwgaWRzIH0pIHtcbiAgaWYgKCFpZHM/Lmxlbmd0aCkgcmV0dXJuIFtdXG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYCR7YXBpQmFzZVVybH0vcmVsYXRpb24tdGFyZ2V0cy8ke3R5cGV9L3Jlc29sdmVgLCB7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczogYnVpbGRBcGlIZWFkZXJzKHRva2VuLCBjb21wYW55SWQsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGlkczogaWRzLnNsaWNlKDAsIDEwMCkgfSksXG4gIH0pXG4gIGNvbnN0IHBheWxvYWQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSlcbiAgaWYgKCFyZXNwb25zZS5vaykgdGhyb3cgbmV3IEVycm9yKHBheWxvYWQ/LmVycm9yID8/ICdObyBzZSBwdWRpZXJvbiByZXNvbHZlciBsb3MgcmVnaXN0cm9zIHJlbGFjaW9uYWRvcy4nKVxuICByZXR1cm4gcGF5bG9hZC5kYXRhID8/IFtdXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFJlc3BvbmRlckVuY3Vlc3RhKHsgdG9rZW4sIGNvbXBhbnlJZCwgYXBpQmFzZVVybCB9KSB7XG4gIGNvbnN0IFtzdXJ2ZXlJZCwgc2V0U3VydmV5SWRdID0gdXNlU3RhdGUobnVsbClcbiAgY29uc3QgW2Fuc3dlcnMsIHNldEFuc3dlcnNdID0gdXNlU3RhdGUoe30pXG4gIGNvbnN0IFtjb250YWN0LCBzZXRDb250YWN0XSA9IHVzZVN0YXRlKHsgbm9tYnJlOiAnJywgY29ycmVvOiAnJyB9KVxuICBjb25zdCBbY29tcGxldGVkLCBzZXRDb21wbGV0ZWRdID0gdXNlU3RhdGUoZmFsc2UpXG5cbiAgY29uc3Qgc3VydmV5c1F1ZXJ5ID0gdXNlUXVlcnkoe1xuICAgIHF1ZXJ5S2V5OiBbJ2N1c3RvbS5lbmN1ZXN0YXMnLCAncHVibGlzaGVkJywgY29tcGFueUlkXSxcbiAgICBlbmFibGVkOiBCb29sZWFuKHRva2VuICYmIGNvbXBhbnlJZCksXG4gICAgcXVlcnlGbjogKCkgPT4gYXBpUmVxdWVzdCh7IGFwaUJhc2VVcmwsIHRva2VuLCBjb21wYW55SWQsIHBhdGg6ICcvZW5jdWVzdGFzL3N1cnZleXM/cGFnZVNpemU9MTAwJmVzdGFkbz1wdWJsaWNhZGEnIH0pLFxuICB9KVxuXG4gIGNvbnN0IGFjdGl2ZVN1cnZleSA9IHVzZU1lbW8oKCkgPT4gc3VydmV5c1F1ZXJ5LmRhdGE/LmRhdGE/LmZpbmQoKHN1cnZleSkgPT4gc3VydmV5LmlkID09PSBzdXJ2ZXlJZCkgPz8gbnVsbCwgW3N1cnZleXNRdWVyeS5kYXRhLCBzdXJ2ZXlJZF0pXG5cbiAgY29uc3QgcXVlc3Rpb25zUXVlcnkgPSB1c2VRdWVyeSh7XG4gICAgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdyZXNwb25kJywgc3VydmV5SWQsIGNvbXBhbnlJZF0sXG4gICAgZW5hYmxlZDogQm9vbGVhbihzdXJ2ZXlJZCksXG4gICAgcXVlcnlGbjogKCkgPT4gYXBpUmVxdWVzdCh7IGFwaUJhc2VVcmwsIHRva2VuLCBjb21wYW55SWQsIHBhdGg6IGAvZW5jdWVzdGFzL3N1cnZleXMvJHtzdXJ2ZXlJZH0vcXVlc3Rpb25zYCB9KSxcbiAgfSlcblxuICBjb25zdCBjb250ZXh0UXVlcnkgPSB1c2VRdWVyeSh7XG4gICAgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdyZXNwb25kZW50LWNvbnRleHQnLCBjb21wYW55SWRdLFxuICAgIGVuYWJsZWQ6IEJvb2xlYW4oYWN0aXZlU3VydmV5Py5jYXB0dXJhcl9jb250ZXh0b19pbnZlbnRhcmlvICYmIHRva2VuICYmIGNvbXBhbnlJZCksXG4gICAgcXVlcnlGbjogKCkgPT4gYXBpUmVxdWVzdCh7IGFwaUJhc2VVcmwsIHRva2VuLCBjb21wYW55SWQsIHBhdGg6ICcvZW5jdWVzdGFzL3Jlc3BvbmRlbnQtY29udGV4dCcgfSksXG4gIH0pXG5cbiAgY29uc3QgZW1wbG95ZWVSZXNvbHZlZFF1ZXJ5ID0gdXNlUXVlcnkoe1xuICAgIHF1ZXJ5S2V5OiBbJ2N1c3RvbS5lbmN1ZXN0YXMnLCAnZW1wbG95ZWUtcmVzb2x2ZWQnLCBjb250ZXh0UXVlcnkuZGF0YT8uZGF0YT8uZW1wbG95ZWVJZF0sXG4gICAgZW5hYmxlZDogQm9vbGVhbihjb250ZXh0UXVlcnkuZGF0YT8uZGF0YT8uZW1wbG95ZWVJZCksXG4gICAgcXVlcnlGbjogKCkgPT4gcmVzb2x2ZVRhcmdldHMoeyBhcGlCYXNlVXJsLCB0b2tlbiwgY29tcGFueUlkLCB0eXBlOiAnaHJfZW1wbG95ZWUnLCBpZHM6IFtjb250ZXh0UXVlcnkuZGF0YS5kYXRhLmVtcGxveWVlSWRdIH0pLFxuICB9KVxuXG4gIGNvbnN0IGl0ZW1zUmVzb2x2ZWRRdWVyeSA9IHVzZVF1ZXJ5KHtcbiAgICBxdWVyeUtleTogWydjdXN0b20uZW5jdWVzdGFzJywgJ2l0ZW1zLXJlc29sdmVkJywgY29udGV4dFF1ZXJ5LmRhdGE/LmRhdGE/LmFzc2lnbmVkSXRlbUlkc10sXG4gICAgZW5hYmxlZDogQm9vbGVhbihjb250ZXh0UXVlcnkuZGF0YT8uZGF0YT8uYXNzaWduZWRJdGVtSWRzPy5sZW5ndGgpLFxuICAgIHF1ZXJ5Rm46ICgpID0+IHJlc29sdmVUYXJnZXRzKHsgYXBpQmFzZVVybCwgdG9rZW4sIGNvbXBhbnlJZCwgdHlwZTogJ2ludmVudG9yeV9pdGVtJywgaWRzOiBjb250ZXh0UXVlcnkuZGF0YS5kYXRhLmFzc2lnbmVkSXRlbUlkcyB9KSxcbiAgfSlcblxuICBjb25zdCBzdWJtaXQgPSB1c2VNdXRhdGlvbih7XG4gICAgbXV0YXRpb25GbjogKCkgPT4gYXBpUmVxdWVzdCh7XG4gICAgICBhcGlCYXNlVXJsLCB0b2tlbiwgY29tcGFueUlkLCBwYXRoOiBgL2VuY3Vlc3Rhcy9zdXJ2ZXlzLyR7c3VydmV5SWR9L3Jlc3BvbnNlc2AsIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogeyByZXNwb25kZW50ZV9ub21icmU6IGNvbnRhY3Qubm9tYnJlIHx8IG51bGwsIHJlc3BvbmRlbnRlX2NvcnJlbzogY29udGFjdC5jb3JyZW8gfHwgbnVsbCwgcmVzcHVlc3RhczogYW5zd2VycyB9LFxuICAgIH0pLFxuICAgIG9uU3VjY2VzczogKCkgPT4geyBzZXRDb21wbGV0ZWQodHJ1ZSk7IHRvYXN0LnN1Y2Nlc3MoJ1Jlc3B1ZXN0YSBlbnZpYWRhLicpIH0sXG4gICAgb25FcnJvcjogKGVycm9yKSA9PiB0b2FzdC5lcnJvcihlcnJvci5tZXNzYWdlKSxcbiAgfSlcblxuICBjb25zdCBzZWxlY3RTdXJ2ZXkgPSAoaWQpID0+IHtcbiAgICBzZXRTdXJ2ZXlJZChpZClcbiAgICBzZXRBbnN3ZXJzKHt9KVxuICAgIHNldENvbnRhY3QoeyBub21icmU6ICcnLCBjb3JyZW86ICcnIH0pXG4gICAgc2V0Q29tcGxldGVkKGZhbHNlKVxuICB9XG5cbiAgY29uc3QgY29udGV4dCA9IGNvbnRleHRRdWVyeS5kYXRhPy5kYXRhXG4gIGNvbnN0IGVtcGxveWVlID0gZW1wbG95ZWVSZXNvbHZlZFF1ZXJ5LmRhdGE/LlswXVxuICBjb25zdCByZXNvbHZlZEl0ZW1zID0gaXRlbXNSZXNvbHZlZFF1ZXJ5LmRhdGEgPz8gW11cblxuICByZXR1cm4gKFxuICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS02IHAtNCBtZDpwLTZcIj5cbiAgICAgIDxQYWdlSGVhZGVyIHRpdGxlPVwiUmVzcG9uZGVyIGVuY3Vlc3RhXCIgZGVzY3JpcHRpb249XCJDb250ZXN0YSBlbmN1ZXN0YXMgcHVibGljYWRhcyBjb24gdHUgc2VzaVx1MDBGM24gYWN0aXZhIGRlIFJ1bmx5LlwiIC8+XG5cbiAgICAgIHtzdXJ2ZXlzUXVlcnkuaXNMb2FkaW5nID8gPFNrZWxldG9uIGNsYXNzTmFtZT1cImgtNzIgdy1mdWxsXCIgLz4gOiBzdXJ2ZXlzUXVlcnkuZXJyb3IgPyAoXG4gICAgICAgIDxFcnJvclN0YXRlIHRpdGxlPVwiTm8gc2UgcHVkaWVyb24gY2FyZ2FyIGxhcyBlbmN1ZXN0YXNcIiBkZXNjcmlwdGlvbj17c3VydmV5c1F1ZXJ5LmVycm9yLm1lc3NhZ2V9IC8+XG4gICAgICApIDogIXN1cnZleXNRdWVyeS5kYXRhPy5kYXRhPy5sZW5ndGggPyAoXG4gICAgICAgIDxFbXB0eVN0YXRlIHRpdGxlPVwiTm8gaGF5IGVuY3Vlc3RhcyBwdWJsaWNhZGFzXCIgZGVzY3JpcHRpb249XCJQdWJsaWNhIHVuYSBlbmN1ZXN0YSBkZXNkZSBlbCBjb25zdHJ1Y3RvciBwYXJhIGhhYmlsaXRhciByZXNwdWVzdGFzLlwiIC8+XG4gICAgICApIDogIWFjdGl2ZVN1cnZleSA/IChcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0xIGdhcC00IG1kOmdyaWQtY29scy0yIHhsOmdyaWQtY29scy0zXCI+XG4gICAgICAgICAge3N1cnZleXNRdWVyeS5kYXRhLmRhdGEubWFwKChzdXJ2ZXkpID0+IChcbiAgICAgICAgICAgIDxDYXJkIGtleT17c3VydmV5LmlkfSBjbGFzc05hbWU9XCJjdXJzb3ItcG9pbnRlclwiIG9uQ2xpY2s9eygpID0+IHNlbGVjdFN1cnZleShzdXJ2ZXkuaWQpfT5cbiAgICAgICAgICAgICAgPENhcmRIZWFkZXI+PGRpdiBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLXN0YXJ0IGp1c3RpZnktYmV0d2VlbiBnYXAtMlwiPjxDYXJkVGl0bGU+e3N1cnZleS50aXR1bG99PC9DYXJkVGl0bGU+PEJhZGdlPlB1YmxpY2FkYTwvQmFkZ2U+PC9kaXY+PC9DYXJkSGVhZGVyPlxuICAgICAgICAgICAgICA8Q2FyZENvbnRlbnQ+XG4gICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntzdXJ2ZXkuZGVzY3JpcGNpb24gfHwgJ1NpbiBkZXNjcmlwY2lcdTAwRjNuLid9PC9wPlxuICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cIm10LTQgdGV4dC1zbVwiPntzdXJ2ZXkucHJlZ3VudGFzX3RvdGFsID8/IDB9IHByZWd1bnRhczwvcD5cbiAgICAgICAgICAgICAgICB7c3VydmV5LmNhcHR1cmFyX2NvbnRleHRvX2ludmVudGFyaW8gJiYgPEJhZGdlIGNsYXNzTmFtZT1cIm10LTNcIiB2YXJpYW50PVwib3V0bGluZVwiPkluY2x1eWUgaWRlbnRpZGFkIGUgaW52ZW50YXJpbyBhc2lnbmFkbzwvQmFkZ2U+fVxuICAgICAgICAgICAgICAgIDxCdXR0b24gY2xhc3NOYW1lPVwibXQtNCB3LWZ1bGxcIiBvbkNsaWNrPXsoKSA9PiBzZWxlY3RTdXJ2ZXkoc3VydmV5LmlkKX0+UmVzcG9uZGVyPC9CdXR0b24+XG4gICAgICAgICAgICAgIDwvQ2FyZENvbnRlbnQ+XG4gICAgICAgICAgICA8L0NhcmQ+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvZGl2PlxuICAgICAgKSA6IGNvbXBsZXRlZCA/IChcbiAgICAgICAgPENhcmQ+PENhcmRDb250ZW50IGNsYXNzTmFtZT1cInAtOFwiPjxFbXB0eVN0YXRlIHRpdGxlPVwiUmVzcHVlc3RhIHJlZ2lzdHJhZGFcIiBkZXNjcmlwdGlvbj17YWN0aXZlU3VydmV5Lm1lbnNhamVfZmluYWwgfHwgJ0dyYWNpYXMgcG9yIHBhcnRpY2lwYXIuJ30gLz48ZGl2IGNsYXNzTmFtZT1cIm10LTQgZmxleCBqdXN0aWZ5LWNlbnRlclwiPjxCdXR0b24gdmFyaWFudD1cIm91dGxpbmVcIiBvbkNsaWNrPXsoKSA9PiBzZWxlY3RTdXJ2ZXkobnVsbCl9PlJlc3BvbmRlciBvdHJhIGVuY3Vlc3RhPC9CdXR0b24+PC9kaXY+PC9DYXJkQ29udGVudD48L0NhcmQ+XG4gICAgICApIDogKFxuICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cIm14LWF1dG8gbWF4LXctM3hsIHNwYWNlLXktNVwiPlxuICAgICAgICAgIDxDYXJkPjxDYXJkSGVhZGVyPjxDYXJkVGl0bGU+e2FjdGl2ZVN1cnZleS50aXR1bG99PC9DYXJkVGl0bGU+PC9DYXJkSGVhZGVyPjxDYXJkQ29udGVudD48cCBjbGFzc05hbWU9XCJ0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPnthY3RpdmVTdXJ2ZXkuZGVzY3JpcGNpb24gfHwgJ0NvbXBsZXRhIGxhcyBzaWd1aWVudGVzIHByZWd1bnRhcy4nfTwvcD48L0NhcmRDb250ZW50PjwvQ2FyZD5cblxuICAgICAgICAgIHthY3RpdmVTdXJ2ZXkuY2FwdHVyYXJfY29udGV4dG9faW52ZW50YXJpbyAmJiAoXG4gICAgICAgICAgICBjb250ZXh0UXVlcnkuaXNMb2FkaW5nID8gPFNrZWxldG9uIGNsYXNzTmFtZT1cImgtNDQgdy1mdWxsXCIgLz4gOiBjb250ZXh0UXVlcnkuZXJyb3IgPyAoXG4gICAgICAgICAgICAgIDxFcnJvclN0YXRlIHRpdGxlPVwiTm8gc2UgcHVkbyBjYXJnYXIgdHUgY29udGV4dG9cIiBkZXNjcmlwdGlvbj17YCR7Y29udGV4dFF1ZXJ5LmVycm9yLm1lc3NhZ2V9IFZlcmlmaWNhIHBlcm1pc29zIGRlIFJSLiBISC4gZSBJbnZlbnRhcmlvLmB9IC8+XG4gICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICA8Q2FyZD5cbiAgICAgICAgICAgICAgICA8Q2FyZEhlYWRlcj48Q2FyZFRpdGxlPlR1IGlkZW50aWRhZCBlIGludmVudGFyaW8gYXNpZ25hZG88L0NhcmRUaXRsZT48L0NhcmRIZWFkZXI+XG4gICAgICAgICAgICAgICAgPENhcmRDb250ZW50IGNsYXNzTmFtZT1cInNwYWNlLXktNFwiPlxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLXN0YXJ0IGdhcC0zIHJvdW5kZWQtbGcgYm9yZGVyIGJvcmRlci1baHNsKHZhcigtLWJvcmRlcikpXSBwLTRcIj5cbiAgICAgICAgICAgICAgICAgICAgPFVzZXJSb3VuZCBjbGFzc05hbWU9XCJtdC0wLjUgaC01IHctNVwiIC8+XG4gICAgICAgICAgICAgICAgICAgIDxkaXY+PHAgY2xhc3NOYW1lPVwiZm9udC1tZWRpdW1cIj57ZW1wbG95ZWU/LnRpdGxlIHx8IGNvbnRleHQ/LmVtcGxveWVlTmFtZSB8fCAnVXN1YXJpbyBzaW4gY29sYWJvcmFkb3IgdmluY3VsYWRvJ308L3A+PHAgY2xhc3NOYW1lPVwidGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntlbXBsb3llZT8uc3VidGl0bGUgfHwgY29udGV4dD8uZW1wbG95ZWVDb2RlIHx8ICdMYSBzZXNpXHUwMEYzbiBzZSByZWdpc3RyYXJcdTAwRTEgY29uIHR1IHVzdWFyaW8gZGUgSWRlbnRpdHkuJ308L3A+PC9kaXY+XG4gICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgIHshY29udGV4dD8uZW1wbG95ZWVJZCA/IChcbiAgICAgICAgICAgICAgICAgICAgPEVtcHR5U3RhdGUgdGl0bGU9XCJTaW4gY29sYWJvcmFkb3IgdmluY3VsYWRvXCIgZGVzY3JpcHRpb249XCJUdSBjdWVudGEgZGUgSWRlbnRpdHkgbm8gZXN0XHUwMEUxIHZpbmN1bGFkYSBhIHVuIGNvbGFib3JhZG9yIGRlIFJSLiBISC47IG5vIHNlIGVuY29udHJhcm9uIGFydFx1MDBFRGN1bG9zIGFzaWduYWRvcy5cIiAvPlxuICAgICAgICAgICAgICAgICAgKSA6IGNvbnRleHQuYXNzaWduZWRJdGVtSWRzPy5sZW5ndGggPT09IDAgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxFbXB0eVN0YXRlIHRpdGxlPVwiU2luIGFydFx1MDBFRGN1bG9zIGFzaWduYWRvc1wiIGRlc2NyaXB0aW9uPVwiSW52ZW50YXJpbyBubyB0aWVuZSBhcnRcdTAwRURjdWxvcyBhY3Rpdm9zIGFzaWduYWRvcyBhIGVzdGUgY29sYWJvcmFkb3IuXCIgLz5cbiAgICAgICAgICAgICAgICAgICkgOiBpdGVtc1Jlc29sdmVkUXVlcnkuaXNMb2FkaW5nID8gPFNrZWxldG9uIGNsYXNzTmFtZT1cImgtMjggdy1mdWxsXCIgLz4gOiBpdGVtc1Jlc29sdmVkUXVlcnkuZXJyb3IgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxFcnJvclN0YXRlIHRpdGxlPVwiTm8gc2UgcHVkaWVyb24gcmVzb2x2ZXIgbG9zIGFydFx1MDBFRGN1bG9zXCIgZGVzY3JpcHRpb249e2l0ZW1zUmVzb2x2ZWRRdWVyeS5lcnJvci5tZXNzYWdlfSAvPlxuICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJzcGFjZS15LTJcIj5cbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGdhcC0yXCI+PFBhY2thZ2UgY2xhc3NOYW1lPVwiaC00IHctNFwiIC8+PHAgY2xhc3NOYW1lPVwiZm9udC1tZWRpdW1cIj57cmVzb2x2ZWRJdGVtcy5sZW5ndGh9IGFydFx1MDBFRGN1bG8ocykgYXNpZ25hZG8ocyk8L3A+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAge3Jlc29sdmVkSXRlbXMubWFwKChpdGVtKSA9PiA8ZGl2IGtleT17aXRlbS5pZH0gY2xhc3NOYW1lPVwicm91bmRlZC1sZyBib3JkZXIgYm9yZGVyLVtoc2wodmFyKC0tYm9yZGVyKSldIHAtM1wiPjxwIGNsYXNzTmFtZT1cImZvbnQtbWVkaXVtXCI+e2l0ZW0udGl0bGV9PC9wPntpdGVtLnN1YnRpdGxlICYmIDxwIGNsYXNzTmFtZT1cInRleHQtc20gdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj57aXRlbS5zdWJ0aXRsZX08L3A+fTwvZGl2Pil9XG4gICAgICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQtc20gdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj5TZXNpXHUwMEYzbjoge2NvbnRleHQ/LnVzZXJOYW1lIHx8IGNvbnRleHQ/LnVzZXJFbWFpbCB8fCBjb250ZXh0Py51c2VyUHJvZmlsZUlkfTwvcD5cbiAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj5Fc3RhIGluZm9ybWFjaVx1MDBGM24gc2Ugb2J0aWVuZSBkZSBJZGVudGl0eS9SUi4gSEguIGUgSW52ZW50YXJpbyB5IHNlIGd1YXJkYSBjb21vIHVuYSBmb3RvZ3JhZlx1MDBFRGEganVudG8gY29uIHR1IHJlc3B1ZXN0YS48L3A+XG4gICAgICAgICAgICAgICAgPC9DYXJkQ29udGVudD5cbiAgICAgICAgICAgICAgPC9DYXJkPlxuICAgICAgICAgICAgKVxuICAgICAgICAgICl9XG5cbiAgICAgICAgICB7YWN0aXZlU3VydmV5LnNvbGljaXRhcl9jb250YWN0byAmJiA8Q2FyZD48Q2FyZEhlYWRlcj48Q2FyZFRpdGxlPkRhdG9zIGRlIGNvbnRhY3RvPC9DYXJkVGl0bGU+PC9DYXJkSGVhZGVyPjxDYXJkQ29udGVudCBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0xIGdhcC00IG1kOmdyaWQtY29scy0yXCI+PFRleHRGaWVsZCBsYWJlbD1cIk5vbWJyZVwiIHZhbHVlPXtjb250YWN0Lm5vbWJyZX0gb25DaGFuZ2U9eyhlKSA9PiBzZXRDb250YWN0KCh4KSA9PiAoeyAuLi54LCBub21icmU6IGUudGFyZ2V0LnZhbHVlIH0pKX0gLz48VGV4dEZpZWxkIGxhYmVsPVwiQ29ycmVvIGVsZWN0clx1MDBGM25pY29cIiB2YWx1ZT17Y29udGFjdC5jb3JyZW99IG9uQ2hhbmdlPXsoZSkgPT4gc2V0Q29udGFjdCgoeCkgPT4gKHsgLi4ueCwgY29ycmVvOiBlLnRhcmdldC52YWx1ZSB9KSl9IC8+PC9DYXJkQ29udGVudD48L0NhcmQ+fVxuXG4gICAgICAgICAge3F1ZXN0aW9uc1F1ZXJ5LmlzTG9hZGluZyA/IDxTa2VsZXRvbiBjbGFzc05hbWU9XCJoLTgwIHctZnVsbFwiIC8+IDogcXVlc3Rpb25zUXVlcnkuZXJyb3IgPyAoXG4gICAgICAgICAgICA8RXJyb3JTdGF0ZSB0aXRsZT1cIk5vIHNlIHB1ZGllcm9uIGNhcmdhciBsYXMgcHJlZ3VudGFzXCIgZGVzY3JpcHRpb249e3F1ZXN0aW9uc1F1ZXJ5LmVycm9yLm1lc3NhZ2V9IC8+XG4gICAgICAgICAgKSA6IChxdWVzdGlvbnNRdWVyeS5kYXRhPy5kYXRhID8/IFtdKS5tYXAoKHF1ZXN0aW9uLCBpbmRleCkgPT4gKFxuICAgICAgICAgICAgPENhcmQga2V5PXtxdWVzdGlvbi5pZH0+PENhcmRDb250ZW50IGNsYXNzTmFtZT1cInNwYWNlLXktMyBwLTVcIj48ZGl2PjxkaXYgY2xhc3NOYW1lPVwiZmxleCBmbGV4LXdyYXAgaXRlbXMtY2VudGVyIGdhcC0yXCI+PHAgY2xhc3NOYW1lPVwiZm9udC1tZWRpdW1cIj57aW5kZXggKyAxfS4ge3F1ZXN0aW9uLnRleHRvfTwvcD57cXVlc3Rpb24ub2JsaWdhdG9yaWEgJiYgPEJhZGdlPk9ibGlnYXRvcmlhPC9CYWRnZT59PC9kaXY+PHAgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LXhzIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+e3F1ZXN0aW9uLmF5dWRhIHx8IHF1ZXN0aW9uVHlwZUxhYmVsKHF1ZXN0aW9uLnRpcG8pfTwvcD48L2Rpdj48UXVlc3Rpb25JbnB1dCBxdWVzdGlvbj17cXVlc3Rpb259IHZhbHVlPXthbnN3ZXJzW3F1ZXN0aW9uLmlkXX0gb25DaGFuZ2U9eyh2YWx1ZSkgPT4gc2V0QW5zd2VycygoY3VycmVudCkgPT4gKHsgLi4uY3VycmVudCwgW3F1ZXN0aW9uLmlkXTogdmFsdWUgfSkpfSAvPjwvQ2FyZENvbnRlbnQ+PC9DYXJkPlxuICAgICAgICAgICkpfVxuXG4gICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGZsZXgtd3JhcCBnYXAtMlwiPjxCdXR0b24gb25DbGljaz17KCkgPT4gc3VibWl0Lm11dGF0ZSgpfSBkaXNhYmxlZD17c3VibWl0LmlzUGVuZGluZyB8fCAoYWN0aXZlU3VydmV5LmNhcHR1cmFyX2NvbnRleHRvX2ludmVudGFyaW8gJiYgY29udGV4dFF1ZXJ5LmlzTG9hZGluZyl9PjxTZW5kIGNsYXNzTmFtZT1cIm1yLTIgaC00IHctNFwiIC8+RW52aWFyIHJlc3B1ZXN0YXM8L0J1dHRvbj48QnV0dG9uIHZhcmlhbnQ9XCJvdXRsaW5lXCIgb25DbGljaz17KCkgPT4gc2VsZWN0U3VydmV5KG51bGwpfT5DYW1iaWFyIGVuY3Vlc3RhPC9CdXR0b24+PC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKVxufVxuIiwgImltcG9ydCB7IHVzZU1lbW8sIHVzZVN0YXRlIH0gZnJvbSAncmVhY3QnXG5pbXBvcnQgeyB1c2VRdWVyeSB9IGZyb20gJ0B0YW5zdGFjay9yZWFjdC1xdWVyeSdcbmltcG9ydCB7IFBhZ2VIZWFkZXIsIENhcmQsIENhcmRIZWFkZXIsIENhcmRUaXRsZSwgQ2FyZENvbnRlbnQsIEJ1dHRvbiwgQmFkZ2UsIEVtcHR5U3RhdGUsIEVycm9yU3RhdGUsIFNrZWxldG9uIH0gZnJvbSAnQHJ1bmx5L3VpJ1xuaW1wb3J0IHsgQmFyQ2hhcnQsIEJhciwgQ2FydGVzaWFuR3JpZCwgUmVzcG9uc2l2ZUNvbnRhaW5lciwgVG9vbHRpcCwgWEF4aXMsIFlBeGlzIH0gZnJvbSAncmVjaGFydHMnXG5pbXBvcnQgeyBhcGlSZXF1ZXN0LCBxdWVzdGlvblR5cGVMYWJlbCwgc3RhdHVzTGFiZWwgfSBmcm9tICcuL2FwaS5qcydcblxuZnVuY3Rpb24gc3VtbWFyaXplKHF1ZXN0aW9uLCByZXNwb25zZXMpIHtcbiAgY29uc3QgdmFsdWVzID0gcmVzcG9uc2VzLm1hcCgocikgPT4gci5yZXNwdWVzdGFzPy5bcXVlc3Rpb24uaWRdKS5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCAmJiB2ICE9PSBudWxsICYmIHYgIT09ICcnKVxuICBpZiAoWydvcGNpb25fdW5pY2EnLCAnc2lfbm8nLCAnY2FsaWZpY2FjaW9uJ10uaW5jbHVkZXMocXVlc3Rpb24udGlwbykpIHtcbiAgICBjb25zdCBjb3VudHMgPSBuZXcgTWFwKClcbiAgICB2YWx1ZXMuZm9yRWFjaCgodikgPT4gY291bnRzLnNldChTdHJpbmcodiksIChjb3VudHMuZ2V0KFN0cmluZyh2KSkgPz8gMCkgKyAxKSlcbiAgICByZXR1cm4geyBraW5kOiAnY2hhcnQnLCBkYXRhOiBbLi4uY291bnRzLmVudHJpZXMoKV0ubWFwKChbbmFtZSwgdG90YWxdKSA9PiAoeyBuYW1lLCB0b3RhbCB9KSkgfVxuICB9XG4gIGlmIChxdWVzdGlvbi50aXBvID09PSAnb3BjaW9uX211bHRpcGxlJykge1xuICAgIGNvbnN0IGNvdW50cyA9IG5ldyBNYXAoKVxuICAgIHZhbHVlcy5mbGF0TWFwKCh2KSA9PiBBcnJheS5pc0FycmF5KHYpID8gdiA6IFtdKS5mb3JFYWNoKCh2KSA9PiBjb3VudHMuc2V0KFN0cmluZyh2KSwgKGNvdW50cy5nZXQoU3RyaW5nKHYpKSA/PyAwKSArIDEpKVxuICAgIHJldHVybiB7IGtpbmQ6ICdjaGFydCcsIGRhdGE6IFsuLi5jb3VudHMuZW50cmllcygpXS5tYXAoKFtuYW1lLCB0b3RhbF0pID0+ICh7IG5hbWUsIHRvdGFsIH0pKSB9XG4gIH1cbiAgaWYgKHF1ZXN0aW9uLnRpcG8gPT09ICdudW1lcm8nKSB7XG4gICAgY29uc3QgbnVtcyA9IHZhbHVlcy5tYXAoTnVtYmVyKS5maWx0ZXIoTnVtYmVyLmlzRmluaXRlKVxuICAgIGNvbnN0IGF2ZXJhZ2UgPSBudW1zLmxlbmd0aCA/IG51bXMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgLyBudW1zLmxlbmd0aCA6IDBcbiAgICByZXR1cm4geyBraW5kOiAnbnVtYmVyJywgY291bnQ6IG51bXMubGVuZ3RoLCBhdmVyYWdlIH1cbiAgfVxuICByZXR1cm4geyBraW5kOiAndGV4dCcsIHZhbHVlczogdmFsdWVzLm1hcChTdHJpbmcpLnNsaWNlKDAsIDgpLCBjb3VudDogdmFsdWVzLmxlbmd0aCB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFJlc3VsdGFkb3NFbmN1ZXN0YXMoeyB0b2tlbiwgY29tcGFueUlkLCBhcGlCYXNlVXJsIH0pIHtcbiAgY29uc3QgW3N1cnZleUlkLCBzZXRTdXJ2ZXlJZF0gPSB1c2VTdGF0ZShudWxsKVxuICBjb25zdCBzdXJ2ZXlzUXVlcnkgPSB1c2VRdWVyeSh7XG4gICAgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdyZXN1bHRzLXN1cnZleXMnLCBjb21wYW55SWRdLFxuICAgIGVuYWJsZWQ6IEJvb2xlYW4odG9rZW4gJiYgY29tcGFueUlkKSxcbiAgICBxdWVyeUZuOiAoKSA9PiBhcGlSZXF1ZXN0KHsgYXBpQmFzZVVybCwgdG9rZW4sIGNvbXBhbnlJZCwgcGF0aDogJy9lbmN1ZXN0YXMvc3VydmV5cz9wYWdlU2l6ZT0xMDAnIH0pLFxuICB9KVxuXG4gIGNvbnN0IHNlbGVjdGVkID0gdXNlTWVtbyhcbiAgICAoKSA9PiBzdXJ2ZXlzUXVlcnkuZGF0YT8uZGF0YT8uZmluZCgocykgPT4gcy5pZCA9PT0gc3VydmV5SWQpID8/IG51bGwsXG4gICAgW3N1cnZleXNRdWVyeS5kYXRhLCBzdXJ2ZXlJZF0sXG4gIClcblxuICBjb25zdCBxdWVzdGlvbnNRdWVyeSA9IHVzZVF1ZXJ5KHtcbiAgICBxdWVyeUtleTogWydjdXN0b20uZW5jdWVzdGFzJywgJ3Jlc3VsdHMtcXVlc3Rpb25zJywgc3VydmV5SWRdLFxuICAgIGVuYWJsZWQ6IEJvb2xlYW4oc3VydmV5SWQpLFxuICAgIHF1ZXJ5Rm46ICgpID0+IGFwaVJlcXVlc3QoeyBhcGlCYXNlVXJsLCB0b2tlbiwgY29tcGFueUlkLCBwYXRoOiBgL2VuY3Vlc3Rhcy9zdXJ2ZXlzLyR7c3VydmV5SWR9L3F1ZXN0aW9uc2AgfSksXG4gIH0pXG5cbiAgY29uc3QgcmVzcG9uc2VzUXVlcnkgPSB1c2VRdWVyeSh7XG4gICAgcXVlcnlLZXk6IFsnY3VzdG9tLmVuY3Vlc3RhcycsICdyZXNwb25zZXMnLCBzdXJ2ZXlJZF0sXG4gICAgZW5hYmxlZDogQm9vbGVhbihzdXJ2ZXlJZCksXG4gICAgcXVlcnlGbjogKCkgPT4gYXBpUmVxdWVzdCh7IGFwaUJhc2VVcmwsIHRva2VuLCBjb21wYW55SWQsIHBhdGg6IGAvZW5jdWVzdGFzL3N1cnZleXMvJHtzdXJ2ZXlJZH0vcmVzcG9uc2VzP3BhZ2VTaXplPTEwMGAgfSksXG4gIH0pXG5cbiAgY29uc3QgcmVzcG9uc2VzID0gcmVzcG9uc2VzUXVlcnkuZGF0YT8uZGF0YSA/PyBbXVxuICBjb25zdCBxdWVzdGlvbnMgPSBxdWVzdGlvbnNRdWVyeS5kYXRhPy5kYXRhID8/IFtdXG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IGNsYXNzTmFtZT1cInNwYWNlLXktNiBwLTQgbWQ6cC02XCI+XG4gICAgICA8UGFnZUhlYWRlciB0aXRsZT1cIlJlc3VsdGFkb3MgZGUgZW5jdWVzdGFzXCIgZGVzY3JpcHRpb249XCJDb25zdWx0YSByZXNwdWVzdGFzIHkgZGlzdHJpYnVjaW9uZXMgcG9yIHByZWd1bnRhLlwiIC8+XG4gICAgICB7c3VydmV5c1F1ZXJ5LmlzTG9hZGluZyA/IDxTa2VsZXRvbiBjbGFzc05hbWU9XCJoLTY0IHctZnVsbFwiIC8+IDogc3VydmV5c1F1ZXJ5LmVycm9yID8gKFxuICAgICAgICA8RXJyb3JTdGF0ZSB0aXRsZT1cIk5vIHNlIHB1ZGllcm9uIGNhcmdhciBsYXMgZW5jdWVzdGFzXCIgZGVzY3JpcHRpb249e3N1cnZleXNRdWVyeS5lcnJvci5tZXNzYWdlfSAvPlxuICAgICAgKSA6IChcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0xIGdhcC02IHhsOmdyaWQtY29scy1bMzAwcHhfbWlubWF4KDAsMWZyKV1cIj5cbiAgICAgICAgICA8Q2FyZCBjbGFzc05hbWU9XCJoLWZpdFwiPlxuICAgICAgICAgICAgPENhcmRIZWFkZXI+PENhcmRUaXRsZT5FbmN1ZXN0YXM8L0NhcmRUaXRsZT48L0NhcmRIZWFkZXI+XG4gICAgICAgICAgICA8Q2FyZENvbnRlbnQgY2xhc3NOYW1lPVwic3BhY2UteS0yXCI+XG4gICAgICAgICAgICAgIHshc3VydmV5c1F1ZXJ5LmRhdGE/LmRhdGE/Lmxlbmd0aCA/IDxFbXB0eVN0YXRlIHRpdGxlPVwiU2luIGVuY3Vlc3Rhc1wiIGRlc2NyaXB0aW9uPVwiVG9kYXZcdTAwRURhIG5vIGhheSBpbmZvcm1hY2lcdTAwRjNuIHBhcmEgYW5hbGl6YXIuXCIgLz4gOiBzdXJ2ZXlzUXVlcnkuZGF0YS5kYXRhLm1hcCgoc3VydmV5KSA9PiAoXG4gICAgICAgICAgICAgICAgPEJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgdmFyaWFudD1cImdob3N0XCIga2V5PXtzdXJ2ZXkuaWR9IG9uQ2xpY2s9eygpID0+IHNldFN1cnZleUlkKHN1cnZleS5pZCl9IGNsYXNzTmFtZT17YHctZnVsbCByb3VuZGVkLWxnIGJvcmRlciBwLTMgdGV4dC1sZWZ0ICR7c3VydmV5SWQgPT09IHN1cnZleS5pZCA/ICdib3JkZXItW2hzbCh2YXIoLS1icmFuZC1wcmltYXJ5KSldIGJnLVtoc2wodmFyKC0tbXV0ZWQpKV0nIDogJ2JvcmRlci1baHNsKHZhcigtLWJvcmRlcikpXSd9YH0+XG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlbiBnYXAtMlwiPjxzcGFuIGNsYXNzTmFtZT1cInRydW5jYXRlIGZvbnQtbWVkaXVtXCI+e3N1cnZleS50aXR1bG99PC9zcGFuPjxCYWRnZT57c3RhdHVzTGFiZWwoc3VydmV5LmVzdGFkbyl9PC9CYWRnZT48L2Rpdj5cbiAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cIm10LTEgdGV4dC14cyB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntzdXJ2ZXkucmVzcHVlc3Rhc190b3RhbCA/PyAwfSByZXNwdWVzdGFzPC9wPlxuICAgICAgICAgICAgICAgIDwvQnV0dG9uPlxuICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgIDwvQ2FyZENvbnRlbnQ+XG4gICAgICAgICAgPC9DYXJkPlxuXG4gICAgICAgICAgeyFzZWxlY3RlZCA/IChcbiAgICAgICAgICAgIDxDYXJkPjxDYXJkQ29udGVudCBjbGFzc05hbWU9XCJwLTZcIj48RW1wdHlTdGF0ZSB0aXRsZT1cIlNlbGVjY2lvbmEgdW5hIGVuY3Vlc3RhXCIgZGVzY3JpcHRpb249XCJFbGlnZSB1bmEgZW5jdWVzdGEgcGFyYSB2ZXIgc3VzIHJlc3VsdGFkb3MuXCIgLz48L0NhcmRDb250ZW50PjwvQ2FyZD5cbiAgICAgICAgICApIDogcmVzcG9uc2VzUXVlcnkuaXNMb2FkaW5nIHx8IHF1ZXN0aW9uc1F1ZXJ5LmlzTG9hZGluZyA/IChcbiAgICAgICAgICAgIDxTa2VsZXRvbiBjbGFzc05hbWU9XCJoLTk2IHctZnVsbFwiIC8+XG4gICAgICAgICAgKSA6IHJlc3BvbnNlc1F1ZXJ5LmVycm9yIHx8IHF1ZXN0aW9uc1F1ZXJ5LmVycm9yID8gKFxuICAgICAgICAgICAgPEVycm9yU3RhdGUgdGl0bGU9XCJObyBzZSBwdWRpZXJvbiBjYXJnYXIgbG9zIHJlc3VsdGFkb3NcIiBkZXNjcmlwdGlvbj17KHJlc3BvbnNlc1F1ZXJ5LmVycm9yIHx8IHF1ZXN0aW9uc1F1ZXJ5LmVycm9yKT8ubWVzc2FnZX0gLz5cbiAgICAgICAgICApIDogKFxuICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJzcGFjZS15LTVcIj5cbiAgICAgICAgICAgICAgPENhcmQ+XG4gICAgICAgICAgICAgICAgPENhcmRIZWFkZXI+PENhcmRUaXRsZT57c2VsZWN0ZWQudGl0dWxvfTwvQ2FyZFRpdGxlPjwvQ2FyZEhlYWRlcj5cbiAgICAgICAgICAgICAgICA8Q2FyZENvbnRlbnQgY2xhc3NOYW1lPVwiZ3JpZCBncmlkLWNvbHMtMiBnYXAtNCBtZDpncmlkLWNvbHMtM1wiPlxuICAgICAgICAgICAgICAgICAgPGRpdj48cCBjbGFzc05hbWU9XCJ0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+UmVzcHVlc3RhczwvcD48cCBjbGFzc05hbWU9XCJ0ZXh0LTN4bCBmb250LXNlbWlib2xkXCI+e3Jlc3BvbnNlc1F1ZXJ5LmRhdGE/LnBhZ2luYXRpb24/LnRvdGFsID8/IHJlc3BvbnNlcy5sZW5ndGh9PC9wPjwvZGl2PlxuICAgICAgICAgICAgICAgICAgPGRpdj48cCBjbGFzc05hbWU9XCJ0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+UHJlZ3VudGFzPC9wPjxwIGNsYXNzTmFtZT1cInRleHQtM3hsIGZvbnQtc2VtaWJvbGRcIj57cXVlc3Rpb25zLmxlbmd0aH08L3A+PC9kaXY+XG4gICAgICAgICAgICAgICAgICA8ZGl2PjxwIGNsYXNzTmFtZT1cInRleHQtc20gdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj5Fc3RhZG88L3A+PHAgY2xhc3NOYW1lPVwibXQtMlwiPjxCYWRnZT57c3RhdHVzTGFiZWwoc2VsZWN0ZWQuZXN0YWRvKX08L0JhZGdlPjwvcD48L2Rpdj5cbiAgICAgICAgICAgICAgICA8L0NhcmRDb250ZW50PlxuICAgICAgICAgICAgICA8L0NhcmQ+XG5cbiAgICAgICAgICAgICAgeyFyZXNwb25zZXMubGVuZ3RoID8gPEVtcHR5U3RhdGUgdGl0bGU9XCJBXHUwMEZBbiBubyBoYXkgcmVzcHVlc3Rhc1wiIGRlc2NyaXB0aW9uPVwiTGFzIHJlc3B1ZXN0YXMgYXBhcmVjZXJcdTAwRTFuIGFxdVx1MDBFRCBlbiBjdWFudG8gYWxndWllbiBjb21wbGV0ZSBsYSBlbmN1ZXN0YS5cIiAvPiA6IHF1ZXN0aW9ucy5tYXAoKHF1ZXN0aW9uLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN1bW1hcnkgPSBzdW1tYXJpemUocXVlc3Rpb24sIHJlc3BvbnNlcylcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgPENhcmQga2V5PXtxdWVzdGlvbi5pZH0+XG4gICAgICAgICAgICAgICAgICAgIDxDYXJkSGVhZGVyPjxDYXJkVGl0bGU+e2luZGV4ICsgMX0uIHtxdWVzdGlvbi50ZXh0b308L0NhcmRUaXRsZT48cCBjbGFzc05hbWU9XCJ0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+e3F1ZXN0aW9uVHlwZUxhYmVsKHF1ZXN0aW9uLnRpcG8pfTwvcD48L0NhcmRIZWFkZXI+XG4gICAgICAgICAgICAgICAgICAgIDxDYXJkQ29udGVudD5cbiAgICAgICAgICAgICAgICAgICAgICB7c3VtbWFyeS5raW5kID09PSAnY2hhcnQnID8gKFxuICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeS5kYXRhLmxlbmd0aCA/IDxkaXYgY2xhc3NOYW1lPVwiaC02NCB3LWZ1bGxcIj48UmVzcG9uc2l2ZUNvbnRhaW5lciB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCI+PEJhckNoYXJ0IGRhdGE9e3N1bW1hcnkuZGF0YX0+PENhcnRlc2lhbkdyaWQgc3Ryb2tlRGFzaGFycmF5PVwiMyAzXCIgLz48WEF4aXMgZGF0YUtleT1cIm5hbWVcIiAvPjxZQXhpcyBhbGxvd0RlY2ltYWxzPXtmYWxzZX0gLz48VG9vbHRpcCAvPjxCYXIgZGF0YUtleT1cInRvdGFsXCIgLz48L0JhckNoYXJ0PjwvUmVzcG9uc2l2ZUNvbnRhaW5lcj48L2Rpdj4gOiA8cCBjbGFzc05hbWU9XCJ0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+U2luIHJlc3B1ZXN0YXMgcGFyYSBlc3RhIHByZWd1bnRhLjwvcD5cbiAgICAgICAgICAgICAgICAgICAgICApIDogc3VtbWFyeS5raW5kID09PSAnbnVtYmVyJyA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiZ3JpZCBncmlkLWNvbHMtMiBnYXAtNFwiPjxkaXY+PHAgY2xhc3NOYW1lPVwidGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPlJlc3B1ZXN0YXM8L3A+PHAgY2xhc3NOYW1lPVwidGV4dC0yeGwgZm9udC1zZW1pYm9sZFwiPntzdW1tYXJ5LmNvdW50fTwvcD48L2Rpdj48ZGl2PjxwIGNsYXNzTmFtZT1cInRleHQtc20gdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj5Qcm9tZWRpbzwvcD48cCBjbGFzc05hbWU9XCJ0ZXh0LTJ4bCBmb250LXNlbWlib2xkXCI+e3N1bW1hcnkuYXZlcmFnZS50b0ZpeGVkKDIpfTwvcD48L2Rpdj48L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJzcGFjZS15LTJcIj57c3VtbWFyeS52YWx1ZXMubGVuZ3RoID8gc3VtbWFyeS52YWx1ZXMubWFwKCh2YWx1ZSwgaSkgPT4gPGRpdiBrZXk9e2Ake3ZhbHVlfS0ke2l9YH0gY2xhc3NOYW1lPVwicm91bmRlZC1sZyBib3JkZXIgYm9yZGVyLVtoc2wodmFyKC0tYm9yZGVyKSldIHAtMyB0ZXh0LXNtXCI+e3ZhbHVlfTwvZGl2PikgOiA8cCBjbGFzc05hbWU9XCJ0ZXh0LXNtIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+U2luIHJlc3B1ZXN0YXMgcGFyYSBlc3RhIHByZWd1bnRhLjwvcD59PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPC9DYXJkQ29udGVudD5cbiAgICAgICAgICAgICAgICAgIDwvQ2FyZD5cbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgIH0pfVxuXG4gICAgICAgICAgICAgIHtyZXNwb25zZXMubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgICAgICAgPENhcmQ+XG4gICAgICAgICAgICAgICAgICA8Q2FyZEhlYWRlcj48Q2FyZFRpdGxlPlJlc3B1ZXN0YXMgaW5kaXZpZHVhbGVzPC9DYXJkVGl0bGU+PC9DYXJkSGVhZGVyPlxuICAgICAgICAgICAgICAgICAgPENhcmRDb250ZW50IGNsYXNzTmFtZT1cInNwYWNlLXktM1wiPlxuICAgICAgICAgICAgICAgICAgICB7cmVzcG9uc2VzLnNsaWNlKDAsIDIwKS5tYXAoKHJlc3BvbnNlLCBpbmRleCkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgIDxkaXYga2V5PXtyZXNwb25zZS5pZH0gY2xhc3NOYW1lPVwicm91bmRlZC1sZyBib3JkZXIgYm9yZGVyLVtoc2wodmFyKC0tYm9yZGVyKSldIHAtNFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmbGV4IGZsZXgtd3JhcCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0yXCI+PHAgY2xhc3NOYW1lPVwiZm9udC1tZWRpdW1cIj5SZXNwdWVzdGEgI3tyZXNwb25zZXMubGVuZ3RoIC0gaW5kZXh9PC9wPjxzcGFuIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj57cmVzcG9uc2UuZW52aWFkb19lbiB8fCAnJ308L3NwYW4+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICB7KHJlc3BvbnNlLnJlc3BvbmRlbnRlX25vbWJyZSB8fCByZXNwb25zZS5yZXNwb25kZW50ZV9jb3JyZW8pICYmIDxwIGNsYXNzTmFtZT1cIm10LTEgdGV4dC1zbSB0ZXh0LVtoc2wodmFyKC0tbXV0ZWQtZm9yZWdyb3VuZCkpXVwiPntyZXNwb25zZS5yZXNwb25kZW50ZV9ub21icmUgfHwgJ1NpbiBub21icmUnfSBcdTAwQjcge3Jlc3BvbnNlLnJlc3BvbmRlbnRlX2NvcnJlbyB8fCAnU2luIGNvcnJlbyd9PC9wPn1cbiAgICAgICAgICAgICAgICAgICAgICAgIHtyZXNwb25zZS5yZXNwb25kZW50ZV91c2VyX2lkICYmIDxwIGNsYXNzTmFtZT1cIm10LTIgdGV4dC1zbVwiPklkZW50aXR5OiB7cmVzcG9uc2UucmVzcG9uZGVudGVfdXNlcl9ub21icmUgfHwgcmVzcG9uc2UucmVzcG9uZGVudGVfdXNlcl9jb3JyZW8gfHwgcmVzcG9uc2UucmVzcG9uZGVudGVfdXNlcl9pZH08L3A+fVxuICAgICAgICAgICAgICAgICAgICAgICAge3Jlc3BvbnNlLnJlc3BvbmRlbnRlX3VzZXJfY29ycmVvICYmIDxwIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1baHNsKHZhcigtLW11dGVkLWZvcmVncm91bmQpKV1cIj57cmVzcG9uc2UucmVzcG9uZGVudGVfdXNlcl9jb3JyZW99PC9wPn1cbiAgICAgICAgICAgICAgICAgICAgICAgIHtyZXNwb25zZS5yZXNwb25kZW50ZV9lbXBsZWFkb19ub21icmUgJiYgPHAgY2xhc3NOYW1lPVwibXQtMSB0ZXh0LXNtIGZvbnQtbWVkaXVtXCI+Q29sYWJvcmFkb3I6IHtyZXNwb25zZS5yZXNwb25kZW50ZV9lbXBsZWFkb19ub21icmV9PC9wPn1cbiAgICAgICAgICAgICAgICAgICAgICAgIHsocmVzcG9uc2UuaXRlbXNfYXNpZ25hZG9zID8/IFtdKS5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtdC0zIHNwYWNlLXktMlwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQtc20gZm9udC1tZWRpdW1cIj5JbnZlbnRhcmlvIGFzaWduYWRvIGFsIG1vbWVudG8gZGUgcmVzcG9uZGVyICh7cmVzcG9uc2UuaXRlbXNfYXNpZ25hZG9zX3RvdGFsID8/IHJlc3BvbnNlLml0ZW1zX2FzaWduYWRvcy5sZW5ndGh9KTwvcD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7KHJlc3BvbnNlLml0ZW1zX2FzaWduYWRvcyA/PyBbXSkubWFwKChpdGVtKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGtleT17aXRlbS5pZH0gY2xhc3NOYW1lPVwicm91bmRlZC1tZCBib3JkZXIgYm9yZGVyLVtoc2wodmFyKC0tYm9yZGVyKSldIHAtMiB0ZXh0LXNtXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cImZvbnQtbWVkaXVtXCI+e1tpdGVtLmFzc2V0VGFnLCBpdGVtLm5hbWVdLmZpbHRlcihCb29sZWFuKS5qb2luKCcgXHUwMEI3ICcpIHx8IGl0ZW0uaWR9PC9wPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtW2hzbCh2YXIoLS1tdXRlZC1mb3JlZ3JvdW5kKSldXCI+e1tpdGVtLm1vZGVsLCBpdGVtLnNlcmlhbE51bWJlciA/IGBTTiAke2l0ZW0uc2VyaWFsTnVtYmVyfWAgOiBudWxsLCBpdGVtLmxvY2F0aW9uTmFtZV0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyBcdTAwQjcgJykgfHwgJ1NpbiBkZXRhbGxlIGFkaWNpb25hbCd9PC9wPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgICA8L0NhcmRDb250ZW50PlxuICAgICAgICAgICAgICAgIDwvQ2FyZD5cbiAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICl9XG4gICAgICAgIDwvZGl2PlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKVxufVxuIiwgImV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWdpc3RlcihyZWdpc3RyeSkge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVyblxuICBjb25zdCBbXG4gICAgeyBkZWZhdWx0OiBFbmN1ZXN0YXNEYXNoYm9hcmQgfSxcbiAgICB7IGRlZmF1bHQ6IEVuY3Vlc3Rhc1N0dWRpbyB9LFxuICAgIHsgZGVmYXVsdDogUmVzcG9uZGVyRW5jdWVzdGEgfSxcbiAgICB7IGRlZmF1bHQ6IFJlc3VsdGFkb3NFbmN1ZXN0YXMgfSxcbiAgXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBpbXBvcnQoJy4vRW5jdWVzdGFzRGFzaGJvYXJkLmpzeCcpLFxuICAgIGltcG9ydCgnLi9FbmN1ZXN0YXNTdHVkaW8uanN4JyksXG4gICAgaW1wb3J0KCcuL1Jlc3BvbmRlckVuY3Vlc3RhLmpzeCcpLFxuICAgIGltcG9ydCgnLi9SZXN1bHRhZG9zRW5jdWVzdGFzLmpzeCcpLFxuICBdKVxuXG4gIHJlZ2lzdHJ5LnJlZ2lzdGVyKCdjdXN0b20uZW5jdWVzdGFzOkVuY3Vlc3Rhc0Rhc2hib2FyZCcsIEVuY3Vlc3Rhc0Rhc2hib2FyZClcbiAgcmVnaXN0cnkucmVnaXN0ZXIoJ2N1c3RvbS5lbmN1ZXN0YXM6RW5jdWVzdGFzU3R1ZGlvJywgRW5jdWVzdGFzU3R1ZGlvKVxuICByZWdpc3RyeS5yZWdpc3RlcignY3VzdG9tLmVuY3Vlc3RhczpSZXNwb25kZXJFbmN1ZXN0YScsIFJlc3BvbmRlckVuY3Vlc3RhKVxuICByZWdpc3RyeS5yZWdpc3RlcignY3VzdG9tLmVuY3Vlc3RhczpSZXN1bHRhZG9zRW5jdWVzdGFzJywgUmVzdWx0YWRvc0VuY3Vlc3Rhcylcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7O0FBQUEsU0FBUyx1QkFBdUI7QUFFaEMsZUFBc0IsV0FBVyxFQUFFLFlBQVksT0FBTyxXQUFXLE1BQU0sU0FBUyxPQUFPLEtBQUssR0FBRztBQUM3RixRQUFNLFdBQVcsTUFBTSxNQUFNLEdBQUcsVUFBVSxHQUFHLElBQUksSUFBSTtBQUFBLElBQ25EO0FBQUEsSUFDQSxTQUFTO0FBQUEsTUFDUCxHQUFHLGdCQUFnQixPQUFPLFNBQVM7QUFBQSxNQUNuQyxHQUFJLFNBQVMsU0FBWSxFQUFFLGdCQUFnQixtQkFBbUIsSUFBSSxDQUFDO0FBQUEsSUFDckU7QUFBQSxJQUNBLEdBQUksU0FBUyxTQUFZLEVBQUUsTUFB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WUFBWSxFQUFFLE9BQU8sT0FBTyxFQUFFLEtBQUssUUFBSyxLQUFLLHlCQUF3QjtBQUFBLG1CQUZqTSxLQUFLLEVBR2YsQ0FDRDtBQUFBLGVBQ0g7QUFBQSxlQWZNLFNBQVMsRUFpQm5CLENBQ0QsR0FDSDtBQUFBLFdBQ0Y7QUFBQSxTQUVKO0FBQUEsT0FFSjtBQUFBLEtBRUo7QUFFSjtBQTdJQTtBQUFBO0FBSUE7QUFBQTtBQUFBOzs7QUNKQSxlQUFzQixTQUFTLFVBQVU7QUFDdkMsTUFBSSxPQUFPLFdBQVcsWUFBYTtBQUNuQyxRQUFNO0FBQUEsSUFDSixFQUFFLFNBQVNFLG9CQUFtQjtBQUFBLElBQzlCLEVBQUUsU0FBU0MsaUJBQWdCO0FBQUEsSUFDM0IsRUFBRSxTQUFTQyxtQkFBa0I7QUFBQSxJQUM3QixFQUFFLFNBQVNDLHFCQUFvQjtBQUFBLEVBQ2pDLElBQUksTUFBTSxRQUFRLElBQUk7QUFBQSxJQUNwQjtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0YsQ0FBQztBQUVELFdBQVMsU0FBUyx1Q0FBdUNILG1CQUFrQjtBQUMzRSxXQUFTLFNBQVMsb0NBQW9DQyxnQkFBZTtBQUNyRSxXQUFTLFNBQVMsc0NBQXNDQyxrQkFBaUI7QUFDekUsV0FBUyxTQUFTLHdDQUF3Q0Msb0JBQW1CO0FBQy9FOyIsCiAgIm5hbWVzIjogWyJ1c2VRdWVyeSIsICJQYWdlSGVhZGVyIiwgIkNhcmQiLCAiQ2FyZEhlYWRlciIsICJDYXJkVGl0bGUiLCAiQ2FyZENvbnRlbnQiLCAiQnV0dG9uIiwgIkJhZGdlIiwgIkVtcHR5U3RhdGUiLCAiRXJyb3JTdGF0ZSIsICJTa2VsZXRvbiIsICJQbHVzIiwgIkZyYWdtZW50IiwgImpzeCIsICJqc3hzIiwgInVzZU1lbW8iLCAidXNlU3RhdGUiLCAidXNlTXV0YXRpb24iLCAidXNlUXVlcnkiLCAiUGFnZUhlYWRlciIsICJDYXJkIiwgIkNhcmRIZWFkZXIiLCAiQ2FyZFRpdGxlIiwgIkNhcmRDb250ZW50IiwgIkJ1dHRvbiIsICJUZXh0RmllbGQiLCAiVGV4dGFyZWFGaWVsZCIsICJCYWRnZSIsICJFbXB0eVN0YXRlIiwgIkVycm9yU3RhdGUiLCAiU2tlbGV0b24iLCAiYnVpbGRBcGlIZWFkZXJzIiwgInRvYXN0IiwgImpzeCIsICJqc3hzIiwgInVzZU1lbW8iLCAidXNlU3RhdGUiLCAidXNlUXVlcnkiLCAiUGFnZUhlYWRlciIsICJDYXJkIiwgIkNhcmRIZWFkZXIiLCAiQ2FyZFRpdGxlIiwgIkNhcmRDb250ZW50IiwgIkJ1dHRvbiIsICJCYWRnZSIsICJFbXB0eVN0YXRlIiwgIkVycm9yU3RhdGUiLCAiU2tlbGV0b24iLCAianN4IiwgImpzeHMiLCAiRW5jdWVzdGFzRGFzaGJvYXJkIiwgIkVuY3Vlc3Rhc1N0dWRpbyIsICJSZXNwb25kZXJFbmN1ZXN0YSIsICJSZXN1bHRhZG9zRW5jdWVzdGFzIl0KfQo=
