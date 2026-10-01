// apps/desktop/src/modules/runly.chat/lib/miraiPrompts.js
//
// Example requests shown in an empty MirAI sidebar thread, chosen by the
// module the user is in (spec 2026-10-01-mirai-sidebar-v2 §3).
const PROMPTS = {
  "runly.calendar": ["Qué huecos libres tengo mañana", "Cuántas horas de reuniones tuve esta semana vs la pasada", "Agenda una reunión mañana a las 10"],
  "runly.pfm": ["Cuánto gasté en comida este mes vs el anterior", "Apunta 250 de gasolina en mi tarjeta", "Qué cargos tengo en los próximos 14 días"],
  "runly.inventory": ["Cuántos equipos hay por marca y modelo", "Cuáles tienen la garantía vencida", "Da de alta los equipos de esta factura"],
  "runly.projects": ["Qué tareas tengo vencidas", "Cómo van mis proyectos", "Crea una tarea para el viernes"],
  "runly.notes": ["Busca mis notas sobre proveedores", "Crea una nota con un resumen de esta semana"],
  "runly.contacts": ["Cuántos clientes dimos de alta este mes", "Busca información pública de esta empresa"],
  "runly.purchases": ["Qué tengo pendiente en compras", "Cuánto le compramos a cada proveedor este trimestre"],
  "runly.ledger": ["Cuánto entró y salió este mes vs el anterior", "Importa este estado de cuenta"],
  "runly.hr": ["Cuántos empleados hay por departamento", "Busca a un empleado por nombre"],
  "runly.fleet": ["Qué seguros vencen este mes", "Busca las especificaciones de este modelo"],
};

const GENERIC = ["Qué puedes hacer por mí", "Qué tengo pendiente hoy", "Busca en internet el tipo de cambio del dólar"];

export function miraiPromptsFor(moduleKey) {
  return PROMPTS[moduleKey] ?? GENERIC;
}
