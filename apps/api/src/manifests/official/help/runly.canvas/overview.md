---
title: Canvas
summary: Boards visuales para planos, mapas tecnicos, diagramas y distribuciones, con hotspots conectados a los registros de Runly.
---
Runly Canvas es un lienzo infinito para dibujar y anotar sobre planos, mapas, diagramas o documentos PDF, y conectar cada punto con la informacion real de tu empresa (contactos, empleados, vehiculos, inventario, proyectos, tareas, eventos, cuentas o archivos).

Cada **Board** tiene paginas, y cada pagina tiene capas. Varias personas pueden trabajar en el mismo Board: veras quien esta conectado en la barra superior y los cambios de los demas aparecen solos.

### Tipos de Board (plantillas)

Al crear un Board eliges una plantilla. La plantilla solo sirve para identificar el uso del Board y mostrar su icono en la lista: **todas las herramientas funcionan igual en cualquier tipo** (formas, textos, hotspots, imagenes y PDF).

- **En blanco**: lienzo libre para bocetos, ideas o cualquier uso que no encaje en otro tipo.
- **Plano**: plantas de oficinas, bodegas, locales o casas. Inserta el plano como imagen o PDF y marca areas con rectangulos y puntos con hotspots (tomas electricas, extintores, camaras).
- **Mapa tecnico**: instalaciones y redes (electricidad, agua, datos, maquinaria). Usa hotspots para cada equipo y vinculalos con el articulo de inventario o el vehiculo correspondiente.
- **Diagrama**: procesos, flujos y organigramas con rectangulos, rombos (decisiones), flechas y textos.
- **Distribucion**: acomodo de espacios y mobiliario (mesas, estantes, puestos de trabajo), por ejemplo para un evento o una reubicacion.
- **Revision de PDF**: inserta las paginas de un PDF y marca observaciones con hotspots, formas y textos encima.

### Capas

Cada pagina trae tres capas:

- **Vectores**: formas, textos, imagenes y PDF.
- **Hotspots**: puntos con informacion (titulo, descripcion, estado, color), archivos adjuntos y registros vinculados.
- **Datos Runly**: para elementos que representan registros del ERP; dibujalos aqui y vinculalos desde el inspector.

Puedes ocultar una capa (icono de ojo) o bloquearla (candado) para no moverla por accidente. Al elegir una herramienta, Canvas cambia solo a la capa correcta.

### Hotspots y registros vinculados

Un hotspot es un pin con informacion. Al colocarlo se abre su ficha; despues se abre con doble clic, con Enter o con el boton del inspector. En la ficha puedes poner titulo, descripcion, estado (Activo, En revision, Resuelto, Inactivo), color, **icono del pin** (mas de 200 iconos recomendados por categoria —seguridad, electricidad, agua, redes, oficina, almacen, mantenimiento, vehiculos, personas, lugares y estados— con busqueda en espanol, y la libreria completa de mas de 1800 iconos), **vincular registros de Runly** y **adjuntar archivos** (fotos, fichas tecnicas, manuales). Cualquier forma tambien puede tener registros vinculados desde el inspector; los elementos vinculados muestran un pequeno distintivo en el lienzo.

### Imagenes y PDF

Con el boton de insertar (o la tecla I) subes una imagen o un PDF. De un PDF con varias paginas eliges cuales colocar; cada pagina queda como imagen nitida en el lienzo, detras de las formas, y el PDF original se guarda como referencia.

### Compartir y accesos

Usa el boton **Compartir** de la barra superior del Board.

- **Personas**: el propietario agrega miembros de la empresa y elige su rol. **Editor** dibuja y edita todo; **Comentarista** ve el Board, abre hotspots y adjunta archivos; **Lector** solo ve y abre hotspots. El rol se puede cambiar o quitar en cualquier momento. La persona necesita el permiso "Ver Boards" del modulo.
- **Enlace publico**: el propietario crea enlaces de solo visualizacion para personas sin cuenta en Runly, con nombre, fecha de vencimiento y maximo de aperturas opcionales; se copian, se muestran como codigo QR y se revocan cuando quieras. Quien abre el enlace puede recorrer el Board, hacer zoom, cambiar de pagina y tocar los hotspots para ver su titulo, descripcion, estado e icono. No ve archivos adjuntos, registros vinculados, capas ocultas ni colaboradores, y no puede editar nada.
- Lectores y comentaristas ven el Board en **modo solo lectura**: no aparecen las herramientas de dibujo y tocar un hotspot abre su ficha de consulta.
- "Conectados ahora", en el inspector, muestra quien tiene el Board abierto en este momento; no es la lista de accesos (esa esta en Compartir).

### Con MirAI

Con la pestana de MirAI abierta puedes pedirle, por ejemplo:

- "Que tipo de Board me conviene para el plano de la bodega"
- "Que Boards tengo y cuales se editaron esta semana"
- "Resume el Board Planta baja: cuantas paginas, hotspots y registros vinculados tiene"
- "Que hotspots estan en revision"
- "Busca el hotspot del tablero electrico"
- "Crea un Board de tipo plano llamado Bodega norte"
- "Marca como resuelto el hotspot Fuga en bano"
- "Ponle el icono de extintor al hotspot Pasillo norte"

Si tienes un Board abierto, MirAI sabe cual es: puedes preguntar por "este Board" sin repetir su nombre. Para crear o cambiar algo te muestra una tarjeta para confirmar antes de guardar.

### Alcances y limites

- Deshacer y rehacer (Ctrl+Z / Ctrl+Shift+Z) cubren lo que haces en el lienzo durante la sesion abierta; los cambios de la ficha del hotspot y ocultar o bloquear capas no se deshacen.
- Solo ves los Boards que creaste o que te compartieron; en la lista, los compartidos muestran tu rol.
- MirAI no dibuja ni mueve formas; consulta Boards y hotspots, crea Boards y actualiza hotspots.
