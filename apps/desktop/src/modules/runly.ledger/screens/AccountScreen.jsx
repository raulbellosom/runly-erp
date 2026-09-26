import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx
import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Badge,
  DatePickerField,
  UserSearchModal,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  TextField,
  SelectField,
  Tabs,
  TabsList,
  TabsTrigger,
  Card,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@runly/ui";
import { toast } from "sonner";
import {
  FileText,
  Table,
  Download,
  Upload,
  UserPlus,
  Trash2,
  FolderOpen,
  Pencil,
  Landmark,
  Receipt,
  BarChart3,
  ShieldCheck,
  ChevronUp,
  ChevronDown,
  Sparkles,
  FileSpreadsheet,
} from "lucide-react";
import SpreadsheetRegister from "./SpreadsheetRegister.jsx";
import AccountSummary from "./AccountSummary.jsx";
import DeletedTransactionsSheet from "../components/DeletedTransactionsSheet.jsx";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import {
  useLedgerSQLite,
  useAccount,
  useLedgerTypes,
  useLedgerCategories,
} from "../hooks/use-ledger-queries.js";

const API_BASE = getApiUrl();

const TABS = [
  { key: "registro", label: "Registro", icon: Receipt },
  { key: "resumen", label: "Resumen", icon: BarChart3 },
  { key: "acceso", label: "Acceso", icon: ShieldCheck },
];

const MEMBER_ROLE_BADGE_VARIANT = { editor: "secondary", viewer: "outline" };

function fmtCurrency(amount, currency = "MXN") {
  return Number(amount ?? 0).toLocaleString("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  });
}

export default function AccountScreen() {
  const { "*": wildcard } = useParams();
  const accountId = useMemo(() => wildcard?.split("/")[1] ?? null, [wildcard]);
  const navigate = useNavigate();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { activeCompanyId } = useActiveCompany();
  const { isUsingLocalLedger } = useLedgerSQLite();

  const [activeTab, setActiveTab] = useState("registro");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    bank: "",
    account_number: "",
    currency: "MXN",
  });
  const [editSaving, setEditSaving] = useState(false);

  const queryClient = useQueryClient();

  const { data: accountData, isLoading: accountLoading } =
    useAccount(accountId);
  const { data: typesData } = useLedgerTypes();
  const { data: categoriesData } = useLedgerCategories();

  const { data: membersData, refetch: refetchMembers } = useQuery({
    queryKey: ["ledger-account-members", accountId],
    queryFn: async () => {
      const res = await companyFetch(
        `${API_BASE}/ledger/accounts/${accountId}/members`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled:
      !!accountId && !!token && activeTab === "acceso" && !isUsingLocalLedger,
  });

  const members = membersData?.data ?? [];
  const account = accountData?.data ?? null;
  // Account settings + collaborator management are owner-only, and only for
  // personal (non-group) accounts — group accounts are managed from the group.
  const canEdit =
    !isUsingLocalLedger &&
    account != null &&
    account.group_id == null &&
    account.is_owner === true;
  // Owner-only, regardless of group membership — used for actions like
  // "Mover a personal" that only make sense while the account IS in a group.
  const isOwner = !isUsingLocalLedger && account?.is_owner === true;
  // Transaction register write access: owner OR editor member OR group editor/admin.
  const canWriteRegister = account == null || account.can_write !== false;
  const types = typesData?.data ?? [];
  const categories = categoriesData?.data ?? [];

  async function handleExport(format) {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    const url = `${API_BASE}/ledger/accounts/${accountId}/export/${format}?${params}`;
    try {
      const res = await companyFetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        toast.error("No se pudo exportar el archivo.");
        return;
      }
      const blob = await res.blob();
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `ledger-${Date.now()}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(anchor.href);
    } catch {
      toast.error("No se pudo exportar el archivo.");
    }
  }

  async function handleInvite(userId, role) {
    const res = await companyFetch(
      `${API_BASE}/ledger/accounts/${accountId}/members`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: userId, role }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "No se pudo compartir la cuenta.");
      return;
    }
    toast.success("Acceso concedido.");
    refetchMembers();
  }

  async function handleRevoke(targetUserId) {
    const res = await companyFetch(
      `${API_BASE}/ledger/accounts/${accountId}/members/${targetUserId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      toast.error("No se pudo remover al colaborador.");
      return;
    }
    toast.success("Acceso revocado.");
    setRevokeTarget(null);
    refetchMembers();
  }

  function openEdit() {
    setEditForm({
      name: account?.name ?? "",
      bank: account?.bank ?? "",
      account_number: account?.account_number ?? "",
      currency: account?.currency ?? "MXN",
    });
    setEditOpen(true);
  }

  async function handleEditAccount(e) {
    e.preventDefault();
    if (!editForm.name.trim() || !editForm.bank.trim()) return;
    setEditSaving(true);
    try {
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editForm.name.trim(),
          bank: editForm.bank.trim(),
          account_number: editForm.account_number.trim() || null,
          currency: editForm.currency,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "No se pudo actualizar la cuenta.");
        return;
      }
      toast.success("Cuenta actualizada.");
      setEditOpen(false);
      queryClient.invalidateQueries({
        queryKey: ["ledger-account", accountId],
      });
      queryClient.invalidateQueries({ queryKey: ["ledger-accounts"] });
    } finally {
      setEditSaving(false);
    }
  }

  async function handleMoveGroup(groupId) {
    const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}/group`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ group_id: groupId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "No se pudo mover la cuenta.");
      return;
    }
    toast.success(
      groupId ? "Cuenta movida al grupo." : "Cuenta movida a personal.",
    );
    queryClient.invalidateQueries({ queryKey: ["ledger-account", accountId] });
    refetchMembers();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-[hsl(var(--border))] shrink-0">
        <PageHeader
          className="pb-0"
          onBack={() => navigate("/app/m/runly.ledger/accounts")}
          backLabel="Cuentas bancarias"
          loading={accountLoading}
          title={
            <span className="inline-flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                <Landmark size={18} />
              </span>
              {account?.name ?? "Cuenta"}
            </span>
          }
          description={
            account && !headerCollapsed && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{account.bank}</Badge>
                {account.account_number && (
                  <Badge variant="outline">
                    •••• {String(account.account_number).slice(-4)}
                  </Badge>
                )}
                <Badge variant="outline">{account.currency}</Badge>
              </span>
            )
          }
          actions={
            account && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Saldo actual
                  </div>
                  <div className="text-xl font-bold tabular-nums text-(--brand-primary)">
                    {fmtCurrency(account.current_balance, account.currency)}
                  </div>
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={openEdit}>
                    <Pencil size={12} /> Editar
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setHeaderCollapsed((v) => !v)}
                  title={headerCollapsed ? "Expandir encabezado" : "Colapsar encabezado"}
                >
                  {headerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </Button>
              </div>
            )
          }
        />

        {/* Export actions row — only on Registro tab, hidden while collapsed */}
        {activeTab === "registro" && !headerCollapsed && (
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-[hsl(var(--muted))] p-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 hover:bg-[hsl(var(--card))] hover:text-(--brand-primary) hover:shadow-sm"
                onClick={() => handleExport("pdf")}
                disabled={isUsingLocalLedger}
              >
                <FileText size={12} />
                PDF
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 hover:bg-[hsl(var(--card))] hover:text-(--brand-primary) hover:shadow-sm"
                onClick={() => handleExport("xlsx")}
                disabled={isUsingLocalLedger}
              >
                <Table size={12} />
                Excel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 hover:bg-[hsl(var(--card))] hover:text-(--brand-primary) hover:shadow-sm"
                onClick={() => handleExport("csv")}
                disabled={isUsingLocalLedger}
              >
                <Download size={12} />
                CSV
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={isUsingLocalLedger}>
                  <Upload size={12} />
                  Importar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() =>
                    navigate('/app/m/runly.ledger/accounts/import-ai', {
                      state: { accountId, accountName: account?.name },
                    })
                  }
                >
                  <Sparkles size={13} className="mr-2 text-(--brand-primary)" /> Importar con IA
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    navigate(`/app/m/runly.ledger/accounts/${accountId}/import`)
                  }
                >
                  <FileSpreadsheet size={13} className="mr-2" /> Importar movimientos (CSV/XLSX)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setTrashOpen(true)}
              disabled={isUsingLocalLedger}
            >
              <Trash2 size={12} />
              Movimientos eliminados
            </Button>
          </div>
        )}
      </div>

      <div className="border-b border-[hsl(var(--border))] px-4 sm:px-6 py-2.5 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5">
                    <Icon size={14} />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {activeTab === "registro" && (
            <div className="hidden sm:flex items-center gap-2 py-2">
              <DatePickerField
                compact
                placeholder="Desde"
                aria-label="Filtrar desde"
                value={dateFrom || undefined}
                onChange={(val) => setDateFrom(val ?? "")}
              />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                —
              </span>
              <DatePickerField
                compact
                placeholder="Hasta"
                aria-label="Filtrar hasta"
                value={dateTo || undefined}
                onChange={(val) => setDateTo(val ?? "")}
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  title="Limpiar filtro"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>

        {/* Date filters — mobile only, below tabs */}
        {activeTab === "registro" && (
          <div className="sm:hidden flex items-center gap-2 pb-2">
            <DatePickerField
              compact
              placeholder="Desde"
              aria-label="Filtrar desde"
              value={dateFrom || undefined}
              onChange={(val) => setDateFrom(val ?? "")}
            />
            <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
            <DatePickerField
              compact
              placeholder="Hasta"
              aria-label="Filtrar hasta"
              value={dateTo || undefined}
              onChange={(val) => setDateTo(val ?? "")}
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                title="Limpiar filtro"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "registro" && (
          <SpreadsheetRegister
            accountId={accountId}
            dateFrom={dateFrom || undefined}
            dateTo={dateTo || undefined}
            types={types}
            categories={categories}
            canWrite={canWriteRegister}
            currency={account?.currency ?? "MXN"}
          />
        )}

        {activeTab === "resumen" && (
          <AccountSummary
            accountId={accountId}
            currency={account?.currency ?? "MXN"}
            dateFrom={dateFrom || undefined}
            dateTo={dateTo || undefined}
          />
        )}

        {activeTab === "acceso" && account && (
          <div className="px-6 pb-6 pt-4 space-y-6 max-w-2xl mx-auto">
            {isUsingLocalLedger ? (
              <Card variant="solid" className="rounded-xl p-4 text-sm text-[hsl(var(--muted-foreground))]">
                Los accesos, invitaciones y movimientos entre grupos siguen
                siendo online-only. Reconecta para administrarlos.
              </Card>
            ) : account.group_id ? (
              <Card variant="solid" className="rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--brand-soft) text-(--brand-primary)">
                    <FolderOpen size={18} />
                  </span>
                  <span className="text-sm font-semibold">Pertenece a un grupo</span>
                </div>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  El acceso a esta cuenta está controlado por el grupo. Para
                  gestionar miembros ve al grupo.
                </p>
                {isOwner && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleMoveGroup(null)}
                  >
                    Mover a personal
                  </Button>
                )}
              </Card>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <ShieldCheck size={15} className="text-[hsl(var(--muted-foreground))]" />
                    Colaboradores
                  </h3>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setInviteOpen(true)}
                    >
                      <UserPlus size={14} className="mr-1" /> Compartir
                    </Button>
                  )}
                </div>
                {members.length === 0 ? (
                  <EmptyState
                    icon={UserPlus}
                    title="Sin colaboradores"
                    description="Comparte esta cuenta con otros usuarios para que puedan verla o editarla."
                    action={
                      canEdit
                        ? {
                            label: "Compartir cuenta",
                            onClick: () => setInviteOpen(true),
                          }
                        : undefined
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    {members.map((member) => (
                      <Card
                        key={member.id}
                        variant="solid"
                        className="rounded-xl flex items-center justify-between px-3 py-2.5"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-xs font-bold text-[hsl(var(--muted-foreground))]">
                            {(member.display_name ?? "?").slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {member.display_name}
                            </div>
                            <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                              {member.email}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={MEMBER_ROLE_BADGE_VARIANT[member.role] ?? "outline"} className="capitalize">
                            {member.role}
                          </Badge>
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRevokeTarget(member)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!isUsingLocalLedger && (
              <>
                <UserSearchModal
                  open={inviteOpen}
                  onClose={() => setInviteOpen(false)}
                  onConfirm={handleInvite}
                  roles={[
                    { value: "viewer", label: "Viewer — solo ver" },
                    { value: "editor", label: "Editor — ver y editar" },
                  ]}
                  excludeIds={members.map((member) => member.user_id)}
                  apiBase={API_BASE}
                  token={token}
                  companyId={activeCompanyId}
                />

                <ConfirmDialog
                  open={!!revokeTarget}
                  onOpenChange={(open) => {
                    if (!open) setRevokeTarget(null);
                  }}
                  onConfirm={() => handleRevoke(revokeTarget?.user_id)}
                  title="Revocar acceso"
                  description={`¿Remover a ${revokeTarget?.display_name} de esta cuenta?`}
                  confirmLabel="Revocar"
                />
              </>
            )}
          </div>
        )}
      </div>

      <Sheet
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) setEditOpen(false);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Editar cuenta</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleEditAccount} className="space-y-4 pt-4">
            <TextField
              label="Nombre"
              id="edit-acc-name"
              required
              value={editForm.name}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, name: e.target.value }))
              }
              maxLength={255}
            />
            <TextField
              label="Banco"
              id="edit-acc-bank"
              required
              value={editForm.bank}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, bank: e.target.value }))
              }
              maxLength={255}
            />
            <TextField
              label="Número de cuenta"
              id="edit-acc-number"
              value={editForm.account_number}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, account_number: e.target.value }))
              }
              placeholder="Opcional"
              maxLength={64}
            />
            <SelectField
              label="Moneda"
              id="edit-acc-currency"
              options={[
                { value: "MXN", label: "MXN — Peso mexicano" },
                { value: "USD", label: "USD — Dólar estadounidense" },
              ]}
              value={editForm.currency}
              onValueChange={(val) =>
                setEditForm((f) => ({ ...f, currency: val }))
              }
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={
                  editSaving || !editForm.name.trim() || !editForm.bank.trim()
                }
              >
                {editSaving ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <DeletedTransactionsSheet
        accountId={accountId}
        currency={account?.currency}
        open={trashOpen}
        onOpenChange={setTrashOpen}
      />
    </div>
  );
}
