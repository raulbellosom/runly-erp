// apps/desktop/src/modules/runly.pfm/components/AdjustBalanceSheet.jsx
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  TextField,
  CurrencyField,
  DateField,
} from "@runly/ui";
import { useAdjustWalletBalance } from "../hooks/use-pfm-queries";
import { formatMoney, todayIso, creditUsage } from "../lib/format";

// Reconcile a wallet's balance to a real-world figure. Books one adjustment
// movement for the difference (server side).
export function AdjustBalanceSheet({ open, onOpenChange, wallet }) {
  const mut = useAdjustWalletBalance();
  const isCredit = wallet?.kind === "CREDIT";
  const isInvestment = wallet?.kind === "INVESTMENT";
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !wallet) return;
    setError(null);
    setNote("");
    setDate(todayIso());
    setTarget(
      isCredit
        ? String(creditUsage(wallet).ocupado)
        : String(Number(wallet.currentBalance ?? 0)),
    );
  }, [open, wallet, isCredit]);

  if (!wallet) return null;

  const current = Number(wallet.currentBalance ?? 0);
  const parsed = Number(target);
  const internalTarget = isCredit ? -parsed : parsed;
  const delta = Number.isFinite(parsed)
    ? Math.round((internalTarget - current) * 100) / 100
    : 0;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(parsed)) {
      setError("Escribe un monto válido.");
      return;
    }
    if (delta === 0) {
      setError("El saldo ya coincide con el registrado.");
      return;
    }
    try {
      await mut.mutateAsync({
        id: wallet.id,
        targetBalance: parsed,
        note: note.trim() || null,
        occurredOn: date,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err?.message ?? "No se pudo ajustar el saldo.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Ajustar saldo</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <CurrencyField
            label={
              isCredit
                ? "Saldo ocupado real"
                : isInvestment
                  ? "Saldo real de la cuenta"
                  : "Saldo real"
            }
            value={Number(target) || 0}
            onChange={(v) => setTarget(String(v))}
          />
          <DateField
            label="Fecha"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            label="Nota (opcional)"
            placeholder={
              isInvestment
                ? "Ajuste de rendimiento / corrección"
                : "Rendimiento, corrección de banco..."
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {delta === 0
              ? "Sin cambios: el saldo ya coincide."
              : `Se registrará un ajuste de ${delta > 0 ? "+" : "-"}${formatMoney(Math.abs(delta), wallet.currency)}.`}
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mut.isPending || delta === 0}>
              Registrar ajuste
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
