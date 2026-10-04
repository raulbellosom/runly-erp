import { AgendaWidget } from "./AgendaWidget";
import { PfmWidget } from "./PfmWidget";
import { LedgerWidget } from "./LedgerWidget";
import { InventoryWidget } from "./InventoryWidget";
import { OnlineUsersWidget } from "./OnlineUsersWidget";
import { ActivityWidget } from "./ActivityWidget";

// Home widget catalog. A widget is offered only when its module is available
// to the user; order here is the board order.
export const HOME_WIDGETS = [
  { id: "agenda", title: "Agenda", description: "Tus próximos eventos", moduleKey: "runly.calendar", Component: AgendaWidget },
  { id: "pfm", title: "Finanzas personales", description: "Saldo, ingresos y gastos del mes", moduleKey: "runly.pfm", Component: PfmWidget },
  { id: "ledger", title: "Cuentas", description: "Saldos de tus cuentas", moduleKey: "runly.ledger", Component: LedgerWidget },
  { id: "inventory", title: "Inventario", description: "Activos, asignaciones y garantías", moduleKey: "runly.inventory", Component: InventoryWidget },
  { id: "online", title: "En línea", description: "Quién está conectado ahora", moduleKey: "runly.chat", Component: OnlineUsersWidget },
  { id: "activity", title: "Actividad reciente", description: "Lo último que pasó en la empresa", moduleKey: "runly.activity", Component: ActivityWidget },
];
