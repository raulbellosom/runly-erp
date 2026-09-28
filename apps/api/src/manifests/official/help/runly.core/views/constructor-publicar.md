---
viewKey: /module-builder/publicar
title: Constructor - Validar, publicar y actualizar
summary: Como validar un borrador, publicarlo en la instancia y actualizar un modulo ya publicado sin perder datos.
---
### Validar

El boton **Validar** revisa el borrador completo y lista los problemas encontrados, cada uno con la ubicacion exacta (entidad, campo, pestana o seccion). Ejemplos: una condicion que usa un campo de texto, una foto de encabezado que no es de tipo Imagen, una relacion "Dejar vacio" en un campo requerido. Mientras haya errores no se puede publicar; los avisos (como "campos sin colocar") no bloquean.

### Publicar

**Publicar** muestra un resumen del impacto (entidades, campos, vistas y permisos) y luego:

1. Crea o actualiza las tablas del modulo.
2. Genera las pantallas, la API y los permisos.
3. Instala el modulo o lo actualiza a la nueva version, y aparece en el menu.

Despues de publicar, asigna los permisos del modulo a los roles que lo usaran desde el modulo de **Identidad**.

### Actualizar un modulo publicado

Sigue editando el mismo proyecto y vuelve a publicar. Son **seguros** (no afectan datos): agregar entidades, campos, vistas, cambiar el diseno, condiciones, etiquetas y reglas de relaciones.

Son **destructivos** y bloquean la publicacion: eliminar un campo o una entidad que ya tienen datos, o cambiar el tipo de un campo publicado. Si la publicacion se bloquea, el modulo instalado y tu borrador quedan intactos; el aviso indica que cambio revertir.

### Errores frecuentes

- **"No tienes permiso para usar el Module Builder"**: falta el permiso `core.modules.builder`.
- **Publicacion bloqueada por cambios destructivos**: revierte el cambio indicado o crea un campo nuevo en lugar de cambiar el tipo del existente.
- **Diferencia entre el esquema instalado y el esperado**: alguien modifico las tablas fuera del Constructor; contacta a un administrador.
