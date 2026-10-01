---
title: Inventario
summary: Activos y equipo de la empresa (laptops, mobiliario, herramientas) y a quien se le asigno cada uno.
---
Runly Inventario lleva el control de los activos fisicos de tu compania: laptops, mobiliario, herramientas y cualquier equipo que necesites rastrear — que hay, en que estado, y quien lo tiene asignado.

- **Inventario**: la lista completa de activos, con nombre, etiqueta, numero de serie, estado y a quien esta asignado.
- **Registro con IA**: da de alta un activo tomandole una foto — la IA ayuda a llenar los datos (requiere IA configurada en la instancia).
- **Asignaciones**: a que colaborador o area se le asigno cada activo, con su historial de asignaciones anteriores.
- **Catalogos**: tipos (con icono, color y campos personalizados), marcas, modelos y ubicaciones. Un modelo agrupa tipo, marca, nombre y año; al elegirlo en un activo se completan el tipo y la marca. Cada catalogo se puede importar desde una plantilla CSV o Excel.

Este modulo esta conectado a MirAI, el asistente de IA del ERP: aparece como pestaña lateral en cualquier pantalla de Inventario. Puede responder con cifras exactas sobre tus equipos, dar de alta varios a la vez a partir de un archivo adjunto, y editar o eliminar un equipo conversando en vez de llenar un formulario (siempre te muestra una tarjeta de confirmacion antes de guardar nada).

Ejemplos:

- Selecciona varios equipos en la lista y pregunta: "¿cuantos tienen la garantia vencida?"
- "¿cuantas laptops Dell hay, por modelo?"
- Adjunta una factura en PDF y pide "da de alta estos equipos" — te muestra una tarjeta con la propuesta antes de crear nada.
- Con un equipo abierto: "busca las especificaciones de este modelo en internet".

### Alcances y limites

- El registro con foto (IA) es opcional; sin IA configurada, das de alta un activo llenando el formulario a mano desde Inventario.
- Este modulo es para activos y equipo propios de la empresa, no para productos que vendes — eso lo maneja el modulo de Catalogo (con su propia pestaña de existencias).
- MirAI en este modulo requiere que la instancia tenga un motor de IA configurado (igual que el resto de MirAI); sin eso, el cuadro de MirAI muestra "no configurado". La busqueda de especificaciones en internet necesita ademas un proveedor de busqueda configurado.
