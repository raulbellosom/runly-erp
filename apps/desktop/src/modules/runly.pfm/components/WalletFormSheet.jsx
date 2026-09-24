// apps/desktop/src/modules/runly.pfm/components/WalletFormSheet.jsx
import { useEffect } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  TextField,
  SelectField,
  SwatchField,
  IconPickerField,
  CurrencyField,
  NumberField,
} from "@runly/ui";
import { useCreateWallet, useUpdateWallet, useLedgerAccounts } from "../hooks/use-pfm-queries";
import { WALLET_KIND_LABEL } from "../lib/format";

// Radix <Select.Item> forbids an empty string value, so "no link" needs a real
// sentinel; ledger account ids are UUIDs, so "none" never collides.
const NO_LEDGER = "none";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(120),
  kind: z.enum(["CASH", "DEBIT", "CREDIT", "INVESTMENT"]),
  currency: z.enum(["MXN", "USD"]),
  openingBalance: z.coerce.number().default(0),
  color: z.string().max(32).optional().nullable(),
  icon: z.string().max(48).optional().nullable(),
  ledgerAccountId: z.string().optional().nullable(),
  reference: z.string().max(40).optional().nullable(),
  creditLimit: z.coerce.number().optional().nullable(),
  statementDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  paymentDueDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  openingUsed: z.coerce.number().min(0).optional().nullable(),
  expectedRate: z.coerce.number().min(0).max(100).optional().nullable(),
});

const KIND_OPTIONS = Object.entries(WALLET_KIND_LABEL).map(([value, label]) => ({ value, label }));
const CURRENCY_OPTIONS = [
  { value: "MXN", label: "Pesos (MXN)" },
  { value: "USD", label: "Dolares (USD)" },
];

const EMPTY = {
  name: "",
  kind: "CASH",
  currency: "MXN",
  openingBalance: 0,
  color: "#0ea5e9",
  icon: "",
  ledgerAccountId: NO_LEDGER,
  reference: "",
  creditLimit: "",
  statementDay: "",
  paymentDueDay: "",
  openingUsed: "",
  expectedRate: "",
};

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function WalletFormSheet({ open, onOpenChange, wallet }) {
  const isEdit = Boolean(wallet);
  const createMut = useCreateWallet();
  const updateMut = useUpdateWallet();
  const { data: ledgerAccounts = [] } = useLedgerAccounts();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const kind = useWatch({ control, name: "kind" });
  const isCredit = kind === "CREDIT";
  const isInvestment = kind === "INVESTMENT";

  useEffect(() => {
    if (!open) return;
    reset(
      wallet
        ? {
            name: wallet.name,
            kind: wallet.kind,
            currency: wallet.currency,
            openingBalance: wallet.openingBalance ?? 0,
            color: wallet.color ?? "#0ea5e9",
            icon: wallet.icon ?? "",
            ledgerAccountId: wallet.ledgerAccountId ?? NO_LEDGER,
            reference: wallet.reference ?? "",
            creditLimit: wallet.creditLimit ?? "",
            statementDay: wallet.statementDay ?? "",
            paymentDueDay: wallet.paymentDueDay ?? "",
            openingUsed: "",
            expectedRate: wallet.expectedRate != null ? String(wallet.expectedRate * 100) : "",
          }
        : EMPTY,
    );
  }, [open, wallet, reset]);

  async function onSubmit(values) {
    const base = {
      name: values.name,
      kind: values.kind,
      currency: values.currency,
      color: values.color ?? null,
      icon: values.icon || "Wallet",
      ledgerAccountId:
        values.ledgerAccountId && values.ledgerAccountId !== NO_LEDGER
          ? values.ledgerAccountId
          : null,
      reference: values.reference?.trim() || null,
    };
    if (values.kind === "CREDIT") {
      const creditFields = {
        creditLimit: numOrNull(values.creditLimit),
        statementDay: numOrNull(values.statementDay),
        paymentDueDay: numOrNull(values.paymentDueDay),
      };
      if (isEdit) {
        await updateMut.mutateAsync({ id: wallet.id, ...base, ...creditFields });
      } else {
        await createMut.mutateAsync({
          ...base,
          ...creditFields,
          openingUsed: numOrNull(values.openingUsed) ?? 0,
        });
      }
    } else if (values.kind === "INVESTMENT") {
      const rateNum = numOrNull(values.expectedRate);
      const payload = {
        ...base,
        openingBalance: Number(values.openingBalance) || 0,
        expectedRate: rateNum == null ? null : rateNum / 100,
      };
      if (isEdit) {
        await updateMut.mutateAsync({ id: wallet.id, ...payload });
      } else {
        await createMut.mutateAsync(payload);
      }
    } else {
      const payload = { ...base, openingBalance: Number(values.openingBalance) || 0 };
      if (isEdit) {
        await updateMut.mutateAsync({ id: wallet.id, ...payload });
      } else {
        await createMut.mutateAsync(payload);
      }
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cartera" : "Nueva cartera"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <TextField
            label="Nombre"
            placeholder="Efectivo, BBVA debito..."
            error={errors.name?.message}
            {...register("name")}
          />
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <SelectField
                label="Tipo"
                options={KIND_OPTIONS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <SelectField
                label="Moneda"
                options={CURRENCY_OPTIONS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />

          {!isCredit && (
            <Controller
              control={control}
              name="openingBalance"
              render={({ field }) => (
                <CurrencyField
                  label="Saldo inicial"
                  error={errors.openingBalance?.message}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          )}

          {isCredit && (
            <div className="space-y-4 rounded-lg border border-[hsl(var(--border))] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Tarjeta de credito
              </p>
              <Controller
                control={control}
                name="creditLimit"
                render={({ field }) => (
                  <CurrencyField
                    label="Limite de credito"
                    error={errors.creditLimit?.message}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <Controller
                  control={control}
                  name="statementDay"
                  render={({ field }) => (
                    <NumberField
                      label="Dia de corte"
                      min="1"
                      max="31"
                      allowNegative={false}
                      allowDecimal={false}
                      error={errors.statementDay?.message}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="paymentDueDay"
                  render={({ field }) => (
                    <NumberField
                      label="Dia limite de pago"
                      min="1"
                      max="31"
                      allowNegative={false}
                      allowDecimal={false}
                      error={errors.paymentDueDay?.message}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  )}
                />
              </div>
              {!isEdit && (
                <Controller
                  control={control}
                  name="openingUsed"
                  render={({ field }) => (
                    <CurrencyField
                      label="Saldo ocupado actual"
                      hint="Cuanto debes hoy en esta tarjeta"
                      error={errors.openingUsed?.message}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              )}
            </div>
          )}

          {isInvestment && (
            <Controller
              control={control}
              name="expectedRate"
              render={({ field }) => (
                <NumberField
                  label="Tasa anual esperada (%)"
                  allowNegative={false}
                  hint="Rendimiento anual estimado; se acumula dia a dia"
                  error={errors.expectedRate?.message}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            />
          )}

          {(ledgerAccounts.length > 0 || wallet?.ledgerAccountId) && (
            <Controller
              control={control}
              name="ledgerAccountId"
              render={({ field }) => {
                const opts = [
                  { value: NO_LEDGER, label: "Sin enlazar" },
                  ...ledgerAccounts.map((a) => ({ value: a.id, label: a.name })),
                ];
                if (
                  field.value &&
                  field.value !== NO_LEDGER &&
                  !ledgerAccounts.some((a) => a.id === field.value)
                ) {
                  opts.push({ value: field.value, label: "Cuenta enlazada" });
                }
                return (
                  <SelectField
                    label="Cuenta bancaria enlazada (opcional)"
                    hint="Al enlazar, esta cartera refleja los movimientos de la cuenta del libro y no se editan aqui"
                    options={opts}
                    value={field.value || NO_LEDGER}
                    onChange={field.onChange}
                  />
                );
              }}
            />
          )}

          <TextField
            label="Referencia (opcional)"
            placeholder="4821 o un apodo"
            hint="Ultimos digitos de la tarjeta o una nota para reconocerla"
            error={errors.reference?.message}
            {...register("reference")}
          />
          <Controller
            control={control}
            name="color"
            render={({ field }) => (
              <SwatchField label="Color" value={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            control={control}
            name="icon"
            render={({ field }) => (
              <IconPickerField
                label="Icono (opcional)"
                value={field.value || ""}
                onChange={field.onChange}
                placeholder="Billetera (por defecto)"
              />
            )}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
