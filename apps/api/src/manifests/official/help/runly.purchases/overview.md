---
title: Compras
summary: Adquisiciones de bienes y servicios con un proceso que cada empresa ajusta a su medida — órdenes, recepciones, facturas, pagos y proveedores.
---
Runly Compras registra cómo adquiere tu empresa lo que necesita: qué se pidió, a quién, cuánto costó, qué llegó y qué falta por pagar. El proceso se adapta a tu tamaño: puedes trabajar solo con facturas o usar el flujo completo con solicitudes, cotizaciones y aprobaciones.

- **Resumen**: el tablero de compras — lo pedido contra lo facturado, lo que falta por pagar, aprobaciones pendientes y lo que requiere atención.
- **Expedientes**: agrupan todos los documentos de una misma compra (solicitud, cotizaciones, orden, recepción, factura).
- **Solicitudes**: alguien pide que se compre algo; al aprobarse se convierte en orden.
- **Aprobaciones**: bandeja de lo que espera tu autorización.
- **Órdenes**: órdenes de compra a proveedores, con sus conceptos y totales.
- **Recepciones**: registro de lo que llegó, total o parcial, contra una orden.
- **Facturas**: facturas de proveedor y su estado de pago.
- **Pagos**: facturas por pagar, pagadas parcialmente o vencidas.
- **Proveedores**: tus contactos que venden, con su historial de documentos y gasto.
- **Configuración**: qué etapas usa tu empresa y cuándo son obligatorias.

### Cómo se adapta el proceso

- Cada etapa (Solicitud, Cotizaciones, Aprobación, Orden, Recepción, Factura, Pago) puede ser Obligatoria, Opcional, Condicional o estar Desactivada. Lo desactivado no aparece en el menú ni en las pantallas.
- Hay configuraciones listas para empezar: Simple (Factura y relación con inventario), Básico (Orden y Factura), Compras con Inventario (Orden, Recepción y Factura) y Completo (todas las etapas). También puedes elegir Personalizado.
- Las políticas definen cuándo una etapa condicional se vuelve obligatoria; por ejemplo, "montos mayores a 50,000 requieren aprobación" o "las compras de bienes requieren recepción". Si falta una etapa obligatoria, Runly te lo indica antes de emitir la orden o pagar la factura.

### Compras e Inventario

- Inventario es dueño de los activos; Compras es dueño de las órdenes, facturas, montos y proveedores. Se conectan con relaciones: un activo puede estar en varias órdenes o facturas, y una factura puede cubrir muchos activos.
- En la ficha de un activo, "Compras relacionadas" muestra su historia de compra como una línea de tiempo (solo las etapas activas que tienen documentos) y el monto asignado al activo. Desde ahí creas una orden o factura para él, relacionas un documento existente o quitas una relación.
- El formulario del activo guarda su origen de adquisición: Compra, Donación, Transferencia, Arrendamiento, Producción interna, Inventario inicial u Otro. Los datos de compra capturados antes de Compras (fecha, precio, proveedor y factura) se muestran como "Datos de compra heredados".
- Desde una orden o factura eliges activos existentes o creas activos nuevos a partir de un concepto.
- Al relacionar una factura con una orden, Runly propone heredar los activos de esa orden.
- Cada relación indica su origen: Manual (la hiciste tú), Heredada (vino de una orden), Automática (se creó al generar el activo desde un concepto) o Migrada (venía de los datos de compra anteriores del activo).

### Alcances y límites

- Compras funciona aunque Inventario, Flotilla o Finanzas no estén instalados.
- Compras registra el estado y la referencia de cada pago, pero no genera asientos contables.
- Las facturas PDF y XML se guardan como archivos adjuntos; el XML no se interpreta automáticamente.
- Las órdenes no se envían por correo al proveedor desde Runly.
- Ocultar una pantalla o botón es solo visual: el servidor valida siempre permisos, etapas activas y empresa.

### Con MirAI

Con la pestaña de MirAI abierta puedes pedirle, por ejemplo:

- "Que tengo pendiente en compras"
- "Busca las ordenes abiertas con el proveedor Acero del Norte"
- "Cuanto le compramos a Acero del Norte este trimestre vs el anterior"
- "Crea una solicitud de compra para laptops del equipo"

Si tienes un documento de compras abierto, MirAI sabe cual es. Decidir una aprobacion o registrar una recepcion require el id exacto (te lo da si le pides antes la lista de aprobaciones pendientes o buscas la orden); como con cualquier accion, te muestra una tarjeta para confirmar antes de guardar algo.
