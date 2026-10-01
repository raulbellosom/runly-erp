---
title: Finanzas personales
summary: Tus gastos e ingresos personales, carteras, presupuestos y tickets escaneados con IA.
---
Runly Finanzas personales te ayuda a llevar tus propias finanzas (no las de la empresa): cuanto tienes, en que gastas y cuanto debes.

- **Resumen**: un vistazo general de tus carteras y tu situacion del mes.
- **Carteras**: tus cuentas personales (banco, efectivo, tarjeta de credito).
- **Recurrencias**: cargos o ingresos que se repiten cada mes (renta, suscripciones, nomina).
- **Categorias**: como clasificas tus gastos e ingresos.
- **Presupuestos**: cuanto planeas gastar por categoria.
- **Tickets**: sube la foto de un recibo y (si tu instancia tiene IA configurada) se registra el gasto automaticamente.

Este modulo esta conectado a MirAI, el asistente de IA del ERP: aparece como pestaña lateral en cualquier pantalla de Finanzas personales. Puede responder con cifras exactas sobre tus propios movimientos y carteras, y registrar, editar o eliminar un movimiento conversando en vez de llenar un formulario (siempre te muestra una tarjeta de confirmacion antes de guardar nada).

Ejemplos:

- "¿cuanto gaste en comida este mes vs el anterior?" — comparacion exacta contra el periodo anterior.
- "apunta 250 de gasolina en mi tarjeta" — prepara el movimiento, lo confirmas y aparece en la cartera.
- Con una cartera abierta: "¿cual es mi gasto mas grande aqui este mes?"
- "¿cuanto debo de la tarjeta?", "¿cuales son mis presupuestos?", "¿que cargos tengo proximos?"

### Alcances y limites

- Es completamente personal: nadie mas ve tus finanzas aqui a menos que compartas una cartera explicitamente.
- Es independiente del Libro de cuentas de la empresa (otro modulo) — aqui llevas tu dinero personal, no el de tu compania, aunque ambos modulos convivan en la misma instancia.
- El escaneo de tickets con IA requiere que tu instancia tenga un motor de IA configurado; sin eso, registras los gastos a mano desde Carteras.
- MirAI en este modulo solo conoce tus propias carteras y movimientos (las tuyas y las que te compartan), nunca datos de otros usuarios ni de la empresa. Una cartera vinculada a una cuenta bancaria del Libro de cuentas no se puede editar desde aqui: MirAI lo señala y te manda a Libro de cuentas.
- Requiere que la instancia tenga un motor de IA configurado (igual que el resto de MirAI); sin eso, el cuadro de MirAI muestra "no configurado".
