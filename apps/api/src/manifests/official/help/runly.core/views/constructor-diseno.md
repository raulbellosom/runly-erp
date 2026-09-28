---
viewKey: /module-builder/diseno
title: Constructor - Diseno de formulario y detalle
summary: Organiza el formulario y la ficha de detalle de una entidad en pestanas y secciones, con columnas, encabezado con foto, indicadores y vista previa en vivo.
---
Cada entidad tiene un boton **Diseno** (en la pestana Datos, junto a "Crear campo"). Ahi decides como se ve el **formulario** (crear y editar) y el **detalle** (la ficha de solo lectura) de esa entidad. Si nunca abres el Diseno, Runly usa un diseno automatico con todos los campos en una sola seccion.

### Pestana, seccion y campo

- **Pestana**: divide la pantalla en paginas ("General", "Facturacion", "Documentos"). Con una sola pestana no se muestra barra de pestanas.
- **Seccion**: agrupa campos bajo un titulo ("Datos de contacto") y define en cuantas **columnas** se acomodan (1, 2 o 3).
- **Campo**: un dato del registro. Se reordena arrastrandolo y se mueve a otra seccion con su menu (···).

Los campos que no coloques aparecen en el recuadro **Campos sin colocar** y, si los dejas asi, se muestran al final en una seccion "Otros datos". Ningun campo se pierde.

### Que puedes agregar a una pestana

Con el boton **Agregar a "..."**:

- **Seccion de campos**: un grupo de campos con titulo.
- **Documentos adjuntos**: una lista para adjuntar varios archivos sueltos al registro (solo una por entidad). Puedes ponerla dentro del formulario o en la columna lateral.
- **Registros relacionados**: en el detalle, la lista de registros de otra entidad que apuntan a este (por ejemplo, los Pedidos de un Cliente). No aparece en el formulario.

### Encabezado del detalle y apertura

En el panel plegable **Encabezado del detalle y apertura**:

- **Modo**: Automatico (pagina completa si el formulario es grande), **Pagina completa** o **Ventana lateral (modal)**.
- **Encabezado**: titulo, subtitulo, estado (un campo de seleccion que se muestra como etiqueta) y **foto**. La foto debe ser un campo de Archivo de tipo Imagen; si eliges uno que acepta cualquier archivo, aparece un boton para convertirlo.
- **Indicadores (KPIs)**: hasta 4 cifras destacadas (numeros, fechas o selecciones).
- **Detalle en dos columnas**: los documentos adjuntos pasan a una columna lateral.

### Formulario y detalle con disenos distintos

Arriba del editor eliges **Formulario** o **Detalle**. Por defecto el detalle usa las mismas pestanas y secciones que el formulario. Si activas **Detalle con diseno propio**, se copia el diseno actual del formulario como punto de partida y a partir de ahi lo organizas por separado.

### Vista previa en vivo

A la derecha del editor (o en la pestana "Vista previa" en pantallas chicas) ves el formulario o el detalle reales con datos de ejemplo. Se actualiza al instante con cada cambio. Los cambios se aplican al guardar con **Guardar diseno**; **Usar diseno automatico** descarta el diseno personalizado.
