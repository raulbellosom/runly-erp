---
viewKey: /desactivados
title: Desactivados
summary: "Donde ver, reactivar o eliminar definitivamente los registros desactivados de cada modulo."
---
Cuando desactivas un registro (un articulo, un contacto, un colaborador o un registro de un modulo propio) deja de mostrarse en las listas, pero sus datos se conservan.

Cada modulo que lo admite muestra en su menu la seccion **Desactivados**:

- Elige el tipo de registro (si el modulo tiene varios) y busca por nombre.
- **Reactivar** lo devuelve a su lista con todos sus datos. Requiere el mismo permiso que desactivarlo.
- **Eliminar** lo borra para siempre, despues de dos confirmaciones. Requiere ademas el permiso *Eliminar definitivamente registros desactivados* (los administradores lo tienen).

Si otros registros dependen del que quieres eliminar (por ejemplo, un contacto con prestamos configurados como *Impedir la eliminacion*), Runly no lo borra y te lo indica. Reactivalo o elimina primero lo que lo usa.

Lo admiten Inventario (articulos), Contactos, Recursos humanos (colaboradores), Calendario (eventos), Flota (vehiculos y conductores), Documentos (plantillas y documentos generados), Archivos y todos los modulos creados con el Constructor o subidos como ZIP. En Archivos, eliminar definitivamente tambien borra el archivo guardado; los documentos de Office conservan su historial y no se pueden eliminar desde aqui. Canvas y Compras no tienen desactivados: los tableros se eliminan directamente y las compras se cancelan.
