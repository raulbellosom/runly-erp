import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Button, Card, ComboboxField, ConfirmDialog, Dialog, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState,
  LoadingState, PageHeader, SelectField, SwitchField, Tabs, TabsContent,
  TabsList, TabsTrigger, TextField,
} from "@runly/ui";
import { Code2, Eye, FileText, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../../../auth/AuthProvider.jsx";
import { runly } from "../../../lib/runly.js";
import FormFieldBuilder from "../../../components/forms/FormFieldBuilder.jsx";
import FormSubmissionsPanel from "../../../components/forms/FormSubmissionsPanel.jsx";
import FormSettingsPanel from "../../../components/forms/FormSettingsPanel.jsx";
import FormPreview from "../../../components/forms/FormPreview.jsx";
import FormApiPanel from "../../../components/forms/FormApiPanel.jsx";

const BASE_PATH = "/growth";

const NEW_FORM_DEFAULTS = {
  name: "", description: "", submitLabel: "Enviar", successMessage: "",
  notifyEmail: "", createsLead: true, defaultAssigneeUserId: "",
  honeypotEnabled: true, turnstileRequired: false, wizardMode: false,
};

function FormCard({ form, active, onClick }) {
  const fieldCount = form._count?.fields ?? 0;
  const subCount = form._count?.submissions ?? 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={[
        "w-full text-left rounded-xl border p-3.5 cursor-pointer",
        active
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] shadow-sm"
          : "border-[hsl(var(--border))]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-sm font-semibold leading-tight truncate ${active ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"}`}>
          {form.name}
        </span>
        <FileText size={13} className={`shrink-0 mt-0.5 ${active ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
      </div>
      <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
        <span>{fieldCount} campo{fieldCount !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span className="flex items-center gap-1"><Send size={10} />{subCount}</span>
      </div>
    </div>
  );
}

function IntegrationTip({ formId }) {
  const snippet = `window.RunlyERP.renderForm("#mi-formulario", { formId: "${formId}" })`;
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-2 bg-[hsl(var(--muted)/0.4)]">
      <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
        Como usar en un sitio externo
      </p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Con el snippet de <code className="font-mono">runly-sdk.js</code> ya instalado (ver "Sitios conectados"),
        renderiza el formulario completo en un contenedor:
      </p>
      <pre className="overflow-x-auto rounded-md bg-[hsl(var(--background))] border border-[hsl(var(--border))] p-3 text-xs font-mono">
        {snippet}
      </pre>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        O usa <code className="font-mono">sdk.forms.get(formId)</code> /{" "}
        <code className="font-mono">sdk.forms.submit(formId, values)</code> del paquete{" "}
        <code className="font-mono">@raulbellosom/runly-sdk</code> para construir tu propia UI.
      </p>
    </div>
  );
}

function NewFormDialog({ open, onOpenChange, propertyId, token, assignees, onCreated }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState(NEW_FORM_DEFAULTS);
  const set = (key, val) => setData((d) => ({ ...d, [key]: val }));

  const mutation = useMutation({
    mutationFn: (payload) => runly.growth.createForm(payload, token),
    onSuccess: (form) => {
      toast.success("Formulario creado");
      queryClient.invalidateQueries({ queryKey: ["growth", "forms", propertyId] });
      setData(NEW_FORM_DEFAULTS);
      onCreated(form.data?.id ?? form.id);
    },
    onError: (err) => toast.error(err.message || "Error al crear formulario"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setData(NEW_FORM_DEFAULTS); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nuevo formulario</DialogTitle></DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({
              ...data,
              propertyId,
              description: data.description.trim() || undefined,
              successMessage: data.successMessage.trim() || undefined,
              notifyEmail: data.notifyEmail.trim() || null,
              defaultAssigneeUserId: data.defaultAssigneeUserId || null,
            });
          }}
          className="space-y-4 py-2"
        >
          <TextField label="Nombre" value={data.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
          <TextField label="Notificar por email" type="email" value={data.notifyEmail} onChange={(e) => set("notifyEmail", e.target.value)} placeholder="tu@empresa.com" />
          <ComboboxField
            label="Responsable"
            options={[{ value: "", label: "Sin responsable" }, ...assignees.map((a) => ({ value: a.id, label: a.displayName }))]}
            value={data.defaultAssigneeUserId}
            onChange={(v) => set("defaultAssigneeUserId", v)}
          />
          <SwitchField id="gf-lead" label="Crear lead automaticamente" checked={data.createsLead} onChange={(v) => set("createsLead", v)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending || !data.name.trim()}>
              {mutation.isPending ? "Creando..." : "Crear formulario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function GrowthFormsScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFormId = searchParams.get("form");
  const setSelectedFormId = (id) => setSearchParams(id ? { form: id } : {}, { replace: true });
  const [activeTab, setActiveTab] = useState("campos");
  const [newFormOpen, setNewFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const propertiesQuery = useQuery({
    queryKey: ["growth", "properties"],
    queryFn: () => runly.growth.listProperties(token),
    enabled: Boolean(token),
  });
  const properties = propertiesQuery.data?.data ?? [];
  const [propertyId, setPropertyId] = useState(null);
  const activePropertyId = propertyId ?? properties[0]?.id ?? null;
  const activeProperty = properties.find((p) => p.id === activePropertyId) ?? null;
  const turnstileConfigured = Boolean(
    activeProperty?.turnstileSiteKey && activeProperty?.turnstileSecretKeySet,
  );

  const formsQuery = useQuery({
    queryKey: ["growth", "forms", activePropertyId],
    queryFn: () => runly.growth.listForms(token, { propertyId: activePropertyId }),
    enabled: Boolean(token) && Boolean(activePropertyId),
  });
  const forms = formsQuery.data?.data ?? [];
  const activeFormId = selectedFormId ?? forms[0]?.id ?? null;

  const formDetailQuery = useQuery({
    queryKey: ["growth", "form-detail", activeFormId],
    queryFn: () => runly.growth.getForm(activeFormId, token),
    enabled: Boolean(token) && Boolean(activeFormId),
  });
  const formDetail = formDetailQuery.data ?? null;

  const { data: assigneesData } = useQuery({
    queryKey: ["growth", "form-assignees"],
    queryFn: () => runly.growth.listFormAssignees(token),
    enabled: Boolean(token),
  });
  const assignees = assigneesData?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (formId) => runly.growth.deleteForm(formId, token),
    onSuccess: () => {
      toast.success("Formulario eliminado");
      setSelectedFormId(null);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["growth", "forms", activePropertyId] });
    },
    onError: () => { toast.error("Error al eliminar"); setDeleteTarget(null); },
  });

  if (propertiesQuery.isPending) return <LoadingState variant="page" />;

  if (!activePropertyId) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader eyebrow="Runly Growth" title="Formularios" />
        <EmptyState title="Sin sitios conectados" description='Conecta un sitio primero en "Sitios conectados".' />
      </div>
    );
  }

  const selectedForm = forms.find((f) => f.id === activeFormId) ?? null;
  const subCount = selectedForm?._count?.submissions ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Growth"
        title="Formularios"
        description="Define campos y notificaciones para formularios en sitios internos o externos."
        actions={<Button onClick={() => setNewFormOpen(true)}>Nuevo formulario</Button>}
      />

      {properties.length > 1 && (
        <SelectField
          label="Sitio"
          value={activePropertyId}
          options={properties.map((p) => ({ value: p.id, label: p.domain ? `${p.name} - ${p.domain}` : p.name }))}
          onValueChange={(id) => { setPropertyId(id); setSelectedFormId(null); }}
        />
      )}

      {formsQuery.isPending ? (
        <LoadingState message="Cargando formularios..." />
      ) : forms.length === 0 ? (
        <EmptyState
          title="Sin formularios"
          description="Crea tu primer formulario para capturar envios desde este sitio."
          action={{ label: "Crear primer formulario", onClick: () => setNewFormOpen(true) }}
        />
      ) : (
        <div className="flex gap-5 items-start">
          <div className="w-56 shrink-0 space-y-2">
            {forms.map((form) => (
              <FormCard
                key={form.id}
                form={form}
                active={activeFormId === form.id}
                onClick={() => { setSelectedFormId(form.id); setActiveTab("campos"); }}
              />
            ))}
          </div>

          <div key={activeFormId} className="flex-1 min-w-0 space-y-4">
            {selectedForm ? (
              <>
                <Card className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-bold text-[hsl(var(--foreground))] truncate">{selectedForm.name}</h2>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(selectedForm)}
                      className="flex items-center gap-1.5 shrink-0 text-xs text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.1)] px-2.5 py-1.5 rounded-md transition-colors"
                    >
                      <Trash2 size={12} />Eliminar
                    </button>
                  </div>
                  <IntegrationTip formId={selectedForm.id} />
                </Card>

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="campos">Campos</TabsTrigger>
                    <TabsTrigger value="preview"><Eye size={13} className="mr-1.5" />Vista previa</TabsTrigger>
                    <TabsTrigger value="configuracion">Configuracion</TabsTrigger>
                    <TabsTrigger value="api"><Code2 size={13} className="mr-1.5" />API</TabsTrigger>
                    <TabsTrigger value="envios">
                      Envios
                      {subCount > 0 && (
                        <span className="ml-1.5 text-[10px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-full px-1.5 py-0.5 leading-none">
                          {subCount}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="campos">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando campos..." />
                    ) : (
                      <FormFieldBuilder
                        formId={selectedForm.id}
                        fields={formDetail?.fields ?? []}
                        wizardMode={formDetail?.wizardMode ?? false}
                        basePath={BASE_PATH}
                        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["growth", "form-detail", selectedForm.id] })}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="preview">
                    {formDetailQuery.isPending ? <LoadingState message="Cargando..." /> : <FormPreview form={formDetail} />}
                  </TabsContent>

                  <TabsContent value="configuracion">
                    {formDetailQuery.isPending ? (
                      <LoadingState message="Cargando..." />
                    ) : formDetailQuery.isError ? (
                      <ErrorState title="No se pudo cargar" message={formDetailQuery.error?.message} onRetry={() => formDetailQuery.refetch()} />
                    ) : (
                      <FormSettingsPanel
                        key={formDetail?.id}
                        form={formDetail}
                        token={token}
                        assignees={assignees}
                        turnstileConfigured={turnstileConfigured}
                        basePath={BASE_PATH}
                        onSaved={() => {
                          formDetailQuery.refetch();
                          queryClient.invalidateQueries({ queryKey: ["growth", "forms", activePropertyId] });
                        }}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="api">
                    {formDetailQuery.isPending ? <LoadingState message="Cargando..." /> : <FormApiPanel form={formDetail} />}
                  </TabsContent>

                  <TabsContent value="envios">
                    <FormSubmissionsPanel formId={selectedForm.id} basePath={BASE_PATH} />
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un formulario.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <NewFormDialog
        open={newFormOpen}
        onOpenChange={setNewFormOpen}
        propertyId={activePropertyId}
        token={token}
        assignees={assignees}
        onCreated={(id) => { setSelectedFormId(id); setNewFormOpen(false); }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Eliminar formulario"
        description={`Se eliminara permanentemente "${deleteTarget?.name}" con todos sus campos y envios.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget?.id)}
      />
    </div>
  );
}
