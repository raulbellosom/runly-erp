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

### Versiones

Cada publicacion lleva una version `mayor.menor.correccion` (por ejemplo 1.3.0). No tienes que calcularla: al publicar cambios, el dialogo compara el borrador con lo publicado y te recomienda una de tres opciones, explicando por que:

- **Correccion** (1.2.0 a 1.2.1): cambiaste textos, diseno, condiciones u opciones.
- **Mejora** (1.2.0 a 1.3.0): agregaste entidades, campos o vistas.
- **Cambio mayor** (1.2.0 a 2.0.0): quitaste algo o cambiaste el tipo de un campo.

Puedes elegir otra opcion; la version elegida se guarda sola al publicar. Si escribiste una version a mano en la pestana General, tambien aparece como opcion.

### Actualizar un modulo publicado

Sigue editando el mismo proyecto y vuelve a publicar. Son **seguros** (no afectan datos): agregar entidades, campos, vistas, cambiar el diseno, condiciones, etiquetas y reglas de relaciones.

Son **destructivos** y bloquean la publicacion: eliminar un campo o una entidad que ya tienen datos, o cambiar el tipo de un campo publicado. Si la publicacion se bloquea, el modulo instalado y tu borrador quedan intactos; el aviso indica que cambio revertir.

### Modo desarrollador: pantallas propias en React

Si necesitas algo que el Constructor no hace (una pantalla a la medida, una grafica especial), trabaja el modulo como codigo. En el editor, boton **Modo desarrollador** (arriba, junto a "Volver"); tambien esta en la pestana General y en el menu (···). Ahi se explica el flujo y puedes descargar el paquete:

1. **Descarga el ZIP**. Incluye **GUIA_DESARROLLO_RUNLY.md**: como crear una pantalla React paso a paso, que librerias puedes usar (con su version exacta), como llamar a la API de tu modulo y las reglas de diseno de Runly.
2. **Programa en tu editor** (VS Code u otro) siguiendo la guia. No hace falta publicar antes.
3. **Subelo** con **Subir actualizacion** (en el editor) o en **Modulos > Subir modulo** (permiso `core.modules.upload`). Antes de aplicar, Runly lo **revisa**: valida el paquete, lista los cambios en la estructura de datos (y bloquea los que perderian datos) y muestra una **vista previa de tus pantallas React** con tus datos reales. Nada se aplica hasta que confirmas con **Aplicar actualizacion**. Si el modulo ya estaba instalado se actualiza al momento; si es la primera vez, despues dale **Instalar** en su tarjeta del catalogo. Repite 2 y 3 las veces que quieras.

**Pantallas React sin salir del modo visual.** Si tu ZIP solo **agrega** pantallas (archivos en `components/`, vistas `*.custom.js` y sus entradas de menu), el Constructor las guarda en el proyecto y las incluye en cada publicacion; sigues editando todo lo demas visualmente. Aparecen en la pestana **Vistas**, seccion **Pantallas propias (codigo)**, donde tambien puedes quitarlas.

**Modo desarrollador.** Si el ZIP cambia otros archivos (por ejemplo `api/`, los modelos o archivos que genera el Constructor), el proyecto pasa solo a modo desarrollador: el Constructor deja de editarlo y publicarlo para no borrar tu codigo. La revision te avisa antes de aplicar. Tambien puedes cambiarlo a mano: en el dialogo **Modo desarrollador**, arriba en **Modo de edicion**, usa **Cambiar a modo desarrollador** en la tarjeta Desarrollador. El modulo necesita al menos una entidad.

**Volver al modo visual.** En el mismo dialogo, la tarjeta **Visual** muestra **Volver al modo visual**. Conserva tus pantallas React. Si hay otros cambios de codigo que se perderian en la siguiente publicacion, te los lista y te deja **Descargar respaldo** del paquete instalado antes de confirmar.

### Errores frecuentes

- **"No tienes permiso para usar el Module Builder"**: falta el permiso `core.modules.builder`.
- **Publicacion bloqueada por cambios destructivos**: revierte el cambio indicado o crea un campo nuevo en lugar de cambiar el tipo del existente.
- **Diferencia entre el esquema instalado y el esperado**: alguien modifico las tablas fuera del Constructor; contacta a un administrador.
