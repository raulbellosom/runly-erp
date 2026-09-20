import { companyFetch } from '../../../lib/companyFetch.js'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  SelectField,
  TextField,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  LoadingState,
} from "@runly/ui";
import { toast } from "sonner";
import MenuItemTree from "./MenuItemTree.jsx";

const LOCATION_LABELS = {
  header: "Encabezado",
  footer: "Pie de pagina",
  sidebar: "Barra lateral",
};

const LOCATION_OPTIONS = [
  { value: "header", label: "Encabezado" },
  { value: "footer", label: "Pie de pagina" },
  { value: "sidebar", label: "Barra lateral" },
];

async function apiGet(path, token) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function WebsiteMenusScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  const [selectedMenuId, setSelectedMenuId] = useState(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newMenuForm, setNewMenuForm] = useState({
    name: "",
    location: "header",
  });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const siteQuery = useQuery({
    queryKey: ["website-site", token],
    queryFn: () => apiGet("/website/site", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const siteId = siteQuery.data?.data?.id ?? null;

  const menusQuery = useQuery({
    queryKey: ["website-menus", siteId, token],
    queryFn: () => apiGet(`/website/menus?siteId=${siteId}`, token),
    enabled: Boolean(token) && Boolean(siteId),
    staleTime: 15_000,
  });

  const menus = menusQuery.data?.data ?? [];
  const activeId = selectedMenuId ?? menus[0]?.id ?? null;
  const selectedMenu = menus.find((m) => m.id === activeId) ?? null;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const createMenuMutation = useMutation({
    mutationFn: async (data) => {
      const res = await companyFetch(`${getApiUrl()}/website/menus`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...data, siteId }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`,
        );
      return res.json();
    },
    onSuccess: (menu) => {
      toast.success("Menu creado");
      queryClient.invalidateQueries({ queryKey: ["website-menus", siteId] });
      setSelectedMenuId(menu.id);
      setNewMenuOpen(false);
      setNewMenuForm({ name: "", location: "header" });
    },
    onError: (err) => toast.error(err.message || "Error al crear menu"),
  });

  const deleteMenuMutation = useMutation({
    mutationFn: async (menuId) => {
      const res = await companyFetch(`${getApiUrl()}/website/menus/${menuId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error al eliminar");
    },
    onSuccess: () => {
      toast.success("Menu eliminado");
      setSelectedMenuId(null);
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["website-menus", siteId] });
    },
    onError: () => {
      toast.error("Error al eliminar el menu");
      setConfirmDelete(null);
    },
  });

  function handleReorder(reorderedItems) {
    queryClient.setQueryData(["website-menus", siteId, token], (prev) => {
      if (!prev?.data) return prev;
      return {
        ...prev,
        data: prev.data.map((m) =>
          m.id === activeId ? { ...m, items: reorderedItems } : m,
        ),
      };
    });
  }

  if (siteQuery.isPending) return <LoadingState variant="page" />;

  if (!siteId) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader
          eyebrow="Runly Website"
          title="Menus"
          description="Configura la navegacion del sitio publico."
        />
        <EmptyState
          title="Sitio web no configurado"
          description='Configura tu sitio web primero desde la seccion "Sitio web".'
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Website"
        title="Menus"
        description="Configura la navegacion del sitio publico."
        actions={
          <Button onClick={() => setNewMenuOpen(true)}>Nuevo menu</Button>
        }
      />

      {menusQuery.isPending ? (
        <LoadingState message="Cargando menús..." />
      ) : menus.length === 0 ? (
        <EmptyState
          title="Sin menus"
          description="Crea tu primer menu para configurar la navegacion del sitio."
          action={{
            label: "Crear primer menu",
            onClick: () => setNewMenuOpen(true),
          }}
        />
      ) : (
        <div className="flex gap-6">
          <div className="w-48 shrink-0 space-y-1">
            {menus.map((menu) => (
              <button
                key={menu.id}
                onClick={() => setSelectedMenuId(menu.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeId === menu.id
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium"
                    : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                <div className="font-medium truncate">{menu.name}</div>
                <div
                  className={`text-xs mt-0.5 ${activeId === menu.id ? "opacity-70" : "text-[hsl(var(--muted-foreground))]"}`}
                >
                  {LOCATION_LABELS[menu.location] ?? menu.location}
                </div>
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-4">
            {selectedMenu ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-medium text-[hsl(var(--foreground))]">
                    {selectedMenu.name}
                    <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))] font-normal">
                      (
                      {LOCATION_LABELS[selectedMenu.location] ??
                        selectedMenu.location}
                      )
                    </span>
                  </h2>
                  <button
                    onClick={() => setConfirmDelete(selectedMenu)}
                    className="text-xs text-[hsl(var(--destructive))] hover:underline"
                  >
                    Eliminar menu
                  </button>
                </div>
                <MenuItemTree
                  menuId={selectedMenu.id}
                  items={selectedMenu.items ?? []}
                  onReorder={handleReorder}
                  onRefresh={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["website-menus", siteId],
                    })
                  }
                />
              </>
            ) : null}
          </div>
        </div>
      )}

      <Dialog open={newMenuOpen} onOpenChange={setNewMenuOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo menu</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMenuMutation.mutate(newMenuForm);
            }}
            className="space-y-4 py-2"
          >
            <TextField
              label="Nombre"
              value={newMenuForm.name}
              onChange={(e) =>
                setNewMenuForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="Principal"
              required
              autoFocus
            />
            <SelectField
              label="Ubicacion"
              value={newMenuForm.location}
              onChange={(v) => setNewMenuForm((f) => ({ ...f, location: v }))}
              options={LOCATION_OPTIONS}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewMenuOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  createMenuMutation.isPending || !newMenuForm.name.trim()
                }
              >
                {createMenuMutation.isPending ? "Creando..." : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title="Eliminar menu"
        description={`Se eliminara permanentemente el menu "${confirmDelete?.name}". Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMenuMutation.isPending}
        onConfirm={() => deleteMenuMutation.mutate(confirmDelete?.id)}
      />
    </div>
  );
}
