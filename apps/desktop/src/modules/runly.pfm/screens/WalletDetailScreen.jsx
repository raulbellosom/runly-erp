// apps/desktop/src/modules/runly.pfm/screens/WalletDetailScreen.jsx
import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  PageHeader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  SearchInput,
  resolveLucideIcon,
  ConfirmDialog,
} from "@runly/ui";
import { Plus, ArrowLeft, SlidersHorizontal, Wallet } from "lucide-react";
import {
  useWallet,
  useWalletMovements,
  useConfirmMovement,
  useSkipMovement,
  useSetMovementEnabled,
  usePfmCategories,
} from "../hooks/use-pfm-queries";
import { useMiraiRecordContext } from "../../runly.chat/lib/miraiPageContext";
import { MovementRow } from "../components/MovementRow";
import { ConfirmChargeDialog } from "../components/ConfirmChargeDialog";
import { QuickAddMovementSheet } from "../components/QuickAddMovementSheet";
import { CreditCyclePanel } from "../components/CreditCyclePanel";
import { InvestmentPanel } from "../components/InvestmentPanel";
import { WalletFormSheet } from "../components/WalletFormSheet";
import { AdjustBalanceSheet } from "../components/AdjustBalanceSheet";
import { YieldGroupRow } from "../components/YieldGroupRow";
import {
  formatMoney,
  currentMonthKey,
  shiftMonth,
  formatMonthLabel,
  groupMovements,
} from "../lib/format";

// Radix <Select.Item> forbids an empty-string value, so the "all" option needs a
// real sentinel; category ids are UUIDs, so "all" never collides.
const ALL_CATEGORIES = "all";

export default function WalletDetailScreen() {
  // ModuleOutlet mounts screens under `m/:moduleKey/*`, so the wallet id lives
  // in the splat param (e.g. "wallets/<id>"), not in a `:id` route param.
  const { "*": wildcard } = useParams();
  const id = useMemo(() => {
    const segs = String(wildcard ?? "")
      .replace(/^\/+/, "")
      .split("/")
      .filter(Boolean);
    return segs[segs.length - 1] || undefined;
  }, [wildcard]);
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonthKey());
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(ALL_CATEGORIES);
  const { data: wallet, isLoading, isError, refetch } = useWallet(id);
  useMiraiRecordContext({ recordType: "wallet", recordId: wallet?.id, label: wallet?.name });
  const query = useMemo(
    () => ({
      month,
      ...(search ? { search } : {}),
      ...(categoryId && categoryId !== ALL_CATEGORIES ? { categoryId } : {}),
      limit: 100,
    }),
    [month, search, categoryId],
  );
  const { data: movements = [], isLoading: movLoading } = useWalletMovements(id, query);
  const { data: categories = [] } = usePfmCategories();
  const confirmMut = useConfirmMovement();
  const skipMut = useSkipMovement();
  const setEnabledMut = useSetMovementEnabled();

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingState />
      </div>
    );
  }
  if (isError || !wallet) {
    return (
      <div className="p-6">
        <ErrorState title="Cartera no encontrada" onRetry={refetch} />
      </div>
    );
  }

  const monthOptions = [0, -1, -2, -3, -4, -5].map((d) => {
    const key = shiftMonth(currentMonthKey(), d);
    return { value: key, label: formatMonthLabel(key) };
  });
  const categoryOptions = [
    { value: ALL_CATEGORIES, label: "Todas las categorias" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  const canAdd = !wallet.ledgerAccountId && wallet.canWrite !== false;
  const WalletIcon = resolveLucideIcon(wallet.icon) ?? Wallet;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-sm"
              style={{ backgroundColor: wallet.color || "#0ea5e9" }}
            >
              <WalletIcon className="h-4 w-4" />
            </span>
            {wallet.name}
          </span>
        }
        description={`${formatMoney(wallet.currentBalance, wallet.currency)}${wallet.reference ? ` · ${wallet.reference}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {wallet.canWrite !== false && (
              <Button variant="outline" onClick={() => setAdjustOpen(true)}>
                <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Ajustar saldo
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate("/app/m/runly.pfm/wallets")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Carteras
            </Button>
          </div>
        }
      />

      {wallet.kind === "CREDIT" && (
        <CreditCyclePanel wallet={wallet} onEdit={() => setEditOpen(true)} />
      )}

      {wallet.kind === "INVESTMENT" && (
        <InvestmentPanel wallet={wallet} onEdit={() => setEditOpen(true)} />
      )}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <SelectField label="Mes" options={monthOptions} value={month} onChange={setMonth} />
        <SelectField
          label="Categoria"
          options={categoryOptions}
          value={categoryId}
          onChange={setCategoryId}
        />
        <SearchInput
          placeholder="Buscar comercio o nota"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[180px] flex-1"
        />
      </div>

      <Card variant="solid" className="divide-y divide-[hsl(var(--border))] px-4">
        {movLoading && (
          <div className="py-6">
            <LoadingState />
          </div>
        )}
        {!movLoading && movements.length === 0 && (
          <EmptyState title="Sin movimientos" description="Aun no hay movimientos para este filtro." />
        )}
        {groupMovements(movements).map((entry) =>
          entry.type === "yield-group" ? (
            <YieldGroupRow key={entry.key} group={entry} currency={wallet.currency} />
          ) : (
            <MovementRow
              key={`${entry.item.source ?? "native"}-${entry.item.id}`}
              movement={entry.item}
              currency={wallet.currency}
              onEdit={(mv) => {
                setEditingMovement(mv);
                setAddOpen(true);
              }}
              onConfirm={(mv) => setConfirmTarget(mv)}
              onSkip={(mv) => skipMut.mutate({ movementId: mv.id, walletId: wallet.id })}
              onDelete={
                wallet.canWrite !== false && entry.item.source !== "ledger"
                  ? (mv) => setDeleteTarget(mv)
                  : undefined
              }
            />
          ),
        )}
      </Card>

      {canAdd && (
        <button
          type="button"
          onClick={() => {
            setEditingMovement(null);
            setAddOpen(true);
          }}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-(--brand-primary) text-white shadow-lg"
          aria-label="Nuevo movimiento"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      <QuickAddMovementSheet
        open={addOpen}
        onOpenChange={(v) => {
          setAddOpen(v);
          if (!v) setEditingMovement(null);
        }}
        defaultWalletId={wallet.id}
        editingMovement={editingMovement}
      />

      <WalletFormSheet open={editOpen} onOpenChange={setEditOpen} wallet={wallet} />
      <AdjustBalanceSheet open={adjustOpen} onOpenChange={setAdjustOpen} wallet={wallet} />

      <ConfirmChargeDialog
        open={Boolean(confirmTarget)}
        onOpenChange={(v) => !v && setConfirmTarget(null)}
        charge={confirmTarget}
        currency={wallet.currency}
        onConfirm={(amount) =>
          confirmMut.mutateAsync({ movementId: confirmTarget.id, walletId: wallet.id, amount })
        }
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Eliminar movimiento"
        description={`Se eliminara "${deleteTarget?.merchant || deleteTarget?.note || "este movimiento"}" y dejara de contarse en el saldo.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          await setEnabledMut.mutateAsync({
            movementId: deleteTarget.id,
            walletId: wallet.id,
            enabled: false,
          });
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
