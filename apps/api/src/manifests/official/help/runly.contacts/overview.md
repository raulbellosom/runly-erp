---
title: Contactos
summary: Clientes, proveedores, personas y empresas con las que interactua tu compania.
---
Runly Contactos es el directorio central de personas y empresas con las que tu compania se relaciona: clientes, proveedores, personas individuales u otras empresas. Es un modulo **core**: siempre esta instalado, porque casi todos los demas modulos lo necesitan.

- Cada contacto tiene un tipo (cliente, proveedor, persona o empresa), datos de contacto (correo, telefono, direccion), identificadores fiscales como el RFC y observaciones en texto enriquecido.
- Busca por nombre, correo, telefono o RFC, y filtra por tipo de contacto para encontrar lo que buscas rapido.
- Otros modulos (Finanzas/Libro de cuentas, POS, Chat, Growth) reutilizan este mismo directorio en vez de tener su propia lista de contactos separada — das de alta un contacto una sola vez y aparece disponible en el selector de contacto de cualquier modulo que lo necesite.

### Alcances y limites

- Desactivar un contacto lo oculta de las listas normales pero no borra su historial en otros modulos que lo referencian (documentos, ordenes, conversaciones de chat, etc.).
- Contactos no gestiona cuentas de usuario ni acceso al sistema — eso es responsabilidad del modulo de Identidad. Un contacto y un usuario son conceptos distintos, aunque puedan compartir el mismo correo.

### Con MirAI

Con la pestaña de MirAI abierta puedes pedirle, por ejemplo:

- "Cuantos clientes dimos de alta este mes"
- "Busca al proveedor Acero del Norte"
- "Crea un contacto cliente para Panaderia La Espiga con correo contacto@laespiga.mx"
- "Actualiza el telefono de este contacto"

Si tienes un contacto abierto, MirAI sabe cual es: puedes pedirle "actualiza el telefono de este contacto a 55 1234 5678" sin repetir el nombre. Como con cualquier accion, te muestra una tarjeta para confirmar antes de guardar algo.
