import { toLocalIso } from '../../../lib/localDate.js';
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RunlyTable, Button, ConfirmDialog, ErrorState, PageHeader } from "@runly/ui";
import { FileSpreadsheet, FileText, Power, PowerOff, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { runly } from "../../../lib/runly";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { ContactsKpis } from "../components/ContactsKpis.jsx";
import { buildContactsBlueprint, CONTACTS_URL_FILTERS } from "../lib/contacts-list-blueprint.js";

const API_BASE_URL = getApiUrl();

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}

function getUniformStatusMode(rows) {
  if (!rows.length) return "mixed";
  const allEnabled = rows.every((row) => Boolean(row.enabled));
  const allDisabled = rows.every((row) => !row.enabled);
  if (allEnabled) return "disable";
  if (allDisabled) return "enable";
  return "mixed";
}

export default function ContactsScreen() {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canReadContacts = hasPermission("contacts.contacts.read");
  const canCreateContacts = hasPermission("contacts.contacts.create");
  const canUpdateContacts = hasPermission("contacts.contacts.update");
  const canDeleteContacts = hasPermission("contacts.contacts.delete");

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [bulkState, setBulkState] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = useMemo(
    () => Object.fromEntries(CONTACTS_URL_FILTERS.map((key) => [key, searchParams.get(key)]).filter(([, value]) => value)),
    [searchParams],
  );
  const filterKey = JSON.stringify(initialFilters);
  const activeTile = initialFilters.enabled === "false"
    ? "inactive"
    : initialFilters.type ?? (Object.keys(initialFilters).length ? null : "all");

  const summaryQuery = useQuery({
    queryKey: ["contacts", "summary", activeCompanyId, refreshSignal],
    queryFn: () => runly.contacts.getSummary(token),
    enabled: Boolean(token && canReadContacts),
    staleTime: 30_000,
  });
  const tagsQuery = useQuery({
    queryKey: ["contact-tags", "", activeCompanyId],
    queryFn: () => runly.contacts.listTags("", token),
    enabled: Boolean(token && canReadContacts),
    staleTime: 60_000,
  });
  const blueprint = useMemo(
    () => buildContactsBlueprint({ tagOptions: (tagsQuery.data?.data ?? []).map((tag) => ({ value: tag, label: tag })) }),
    [tagsQuery.data],
  );

  // KPI tiles replace the type/state filters; clicking the active tile clears it.
  const selectTile = (value) => {
    const next = new URLSearchParams(searchParams);
    next.delete("type");
    next.delete("enabled");
    if (value !== activeTile) {
      if (value === "inactive") next.set("enabled", "false");
      else if (value !== "all") next.set("type", value);
    }
    setSearchParams(next, { replace: true });
  };
  const basePath = "/app/m/runly.contacts/contacts";

  const openCreate = () => navigate(`${basePath}/new`);
  const openDetail = (contact) => navigate(`${basePath}/${contact.id}`);
  const openEdit = (contact) => navigate(`${basePath}/${contact.id}/edit`);

  const deleteMutation = useMutation({
    mutationFn: (id) => runly.contacts.delete(id, token),
    onSuccess: () => {
      setConfirmDelete(null);
      setRefreshSignal((s) => s + 1);
      toast.success("Contacto eliminado");
    },
    onError: () => toast.error("No se pudo eliminar el contacto"),
  });

  const bulkEnabledMutation = useMutation({
    mutationFn: ({ ids, enabled }) =>
      runly.contacts.setContactsEnabled(ids, enabled, token),
    onSuccess: () => {
      setRefreshSignal((s) => s + 1);
      setBulkState(null);
      toast.success("Contactos actualizados");
    },
    onError: () => toast.error("No se pudo actualizar el estado de los contactos"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => runly.contacts.deleteContactsBulk(ids, token),
    onSuccess: () => {
      setRefreshSignal((s) => s + 1);
      setBulkState(null);
      toast.success("Contactos eliminados");
    },
    onError: () => toast.error("No se pudieron eliminar los contactos"),
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: ({ id, enabled }) => runly.contacts.setEnabled(id, enabled, token),
    onSuccess: (_, { enabled }) => {
      setRefreshSignal((s) => s + 1);
      toast.success(enabled ? "Contacto activado" : "Contacto desactivado");
    },
    onError: () => toast.error("No se pudo actualizar el estado del contacto"),
  });

  const bulkActions = useMemo(() => [
    {
      label: "Exportar Excel",
      icon: FileSpreadsheet,
      onClick: async (selectedRows) => {
        try {
          const ids = selectedRows.map((row) => row.id).filter(Boolean);
          if (!ids.length) return;
          const blob = await runly.contacts.exportContactsExcel(ids, token);
          downloadBlob(blob, `contactos-${toLocalIso()}.xlsx`);
          toast.success("Excel generado");
        } catch {
          toast.error("No se pudo exportar el archivo Excel");
        }
      },
    },
    {
      label: "Exportar PDF",
      icon: FileText,
      onClick: async (selectedRows) => {
        try {
          const ids = selectedRows.map((row) => row.id).filter(Boolean);
          if (!ids.length) return;
          const blob = await runly.contacts.exportContactsPdf(ids, token);
          downloadBlob(blob, `contactos-${toLocalIso()}.pdf`);
          toast.success("PDF generado");
        } catch {
          toast.error("No se pudo generar el PDF");
        }
      },
    },
    canUpdateContacts && ((selectedRows) => {
      const mode = getUniformStatusMode(selectedRows);
      if (mode === "mixed") {
        return {
          label: "Estado",
          icon: Power,
          disabled: true,
          title: "Solo disponible cuando todos tienen el mismo estado.",
          onClick: () => {},
        };
      }
      const enabling = mode === "enable";
      return {
        label: enabling ? "Activar" : "Desactivar",
        icon: enabling ? Power : PowerOff,
        onClick: () =>
          setBulkState({ type: "enable", rows: selectedRows, enabled: enabling }),
      };
    }),
    canDeleteContacts && ((selectedRows) => ({
      label: "Eliminar",
      icon: Trash2,
      variant: "destructive",
      onClick: () => setBulkState({ type: "delete", rows: selectedRows }),
    })),
  ].filter(Boolean), [token, canUpdateContacts, canDeleteContacts]);

  if (!canReadContacts) {
    return (
      <div className="p-4 md:p-6 space-y-6 min-h-dvh">
        <PageHeader
          eyebrow="Runly Contacts"
          title="Contactos"
          description="Clientes, proveedores y personas vinculadas a tu empresa."
        />
        <ErrorState title="No tienes permisos para ver los contactos." />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Contacts"
        title="Contactos"
        description="Clientes, proveedores y personas vinculadas a tu empresa."
        actions={
          canCreateContacts && (
            <Button onClick={openCreate}>
              <UserPlus className="mr-2 h-4 w-4" />
              Nuevo contacto
            </Button>
          )
        }
      />

      <ContactsKpis
        summary={summaryQuery.data?.data}
        isLoading={summaryQuery.isLoading}
        active={activeTile}
        onSelect={selectTile}
      />

      <RunlyTable
        key={`${activeCompanyId}:${filterKey}`}
        initialFilters={initialFilters}
        blueprint={blueprint}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE_URL}
        onCreate={canCreateContacts ? openCreate : undefined}
        onView={openDetail}
        onEdit={canUpdateContacts ? openEdit : undefined}
        onToggleEnabled={canUpdateContacts ? (row) =>
          toggleEnabledMutation.mutate({ id: row.id, enabled: !row.enabled }) : undefined}
        onDelete={canDeleteContacts ? (row) => setConfirmDelete(row) : undefined}
        refreshSignal={refreshSignal}
        bulkActions={bulkActions}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title="Eliminar contacto"
        description="El contacto sera eliminado permanentemente. Esta accion no se puede deshacer."
        detail={confirmDelete?.name}
        confirmLabel="Eliminar"
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(bulkState)}
        onOpenChange={(v) => !v && setBulkState(null)}
        title={
          bulkState?.type === "delete"
            ? "Eliminar contactos seleccionados"
            : bulkState?.enabled
              ? "Activar contactos seleccionados"
              : "Desactivar contactos seleccionados"
        }
        description={
          bulkState?.type === "delete"
            ? "Esta accion elimina los contactos de forma permanente."
            : "Se actualizara el estado de los contactos seleccionados."
        }
        detail={`${bulkState?.rows?.length ?? 0} contactos seleccionados`}
        confirmLabel={bulkState?.type === "delete" ? "Eliminar" : "Confirmar"}
        onConfirm={() => {
          const ids = (bulkState?.rows ?? []).map((r) => r.id).filter(Boolean);
          if (!ids.length) {
            setBulkState(null);
            return;
          }
          if (bulkState?.type === "delete") {
            bulkDeleteMutation.mutate(ids);
          } else {
            bulkEnabledMutation.mutate({ ids, enabled: Boolean(bulkState?.enabled) });
          }
        }}
        loading={bulkDeleteMutation.isPending || bulkEnabledMutation.isPending}
      />
    </div>
  );
}
