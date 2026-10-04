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

Antes de eliminar, Runly te muestra que otros registros lo usan:

- **Se eliminaran tambien**: registros que dependen totalmente de el (por ejemplo, las paginas de un Board).
- **Quedaran sin este dato**: registros que lo mencionan en un campo opcional; se conservan con ese campo vacio (**Desvincular y eliminar**).
- **No se puede eliminar**: registros que lo necesitan (un campo obligatorio o una conexion con *Impedir la eliminacion*). Reactivalo o elimina primero lo que lo usa.

### Eliminacion automatica

Arriba de la lista eliges **Eliminar automaticamente despues de** 30, 60, 90 o 180 dias, o **Nunca** (por defecto, 90 dias; aplica a toda la empresa). Lo que lleve mas tiempo desactivado se elimina solo: si otros registros lo usan en un campo opcional, se desvincula; si lo necesitan, se conserva y queda anotado en la bitacora. Los archivos no se eliminan automaticamente. El conteo empezo cuando se activo esta funcion, asi que nada desactivado antes se borra sin haber estado ese tiempo en Desactivados.

Lo admiten Inventario (articulos), Contactos, Recursos humanos (colaboradores), Calendario (eventos), Flota (vehiculos y conductores), Documentos (plantillas y documentos generados), Archivos y todos los modulos creados con el Constructor o subidos como ZIP. En Archivos, eliminar definitivamente tambien borra el archivo guardado; los documentos de Office conservan su historial y no se pueden eliminar desde aqui. En Canvas, eliminar un Board lo manda a Desactivados (con sus paginas y elementos). Compras no tiene desactivados: las compras se cancelan.
