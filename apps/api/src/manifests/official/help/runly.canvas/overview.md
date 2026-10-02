---
title: Canvas
summary: Boards visuales para planos, mapas tecnicos, diagramas y distribuciones, con hotspots conectados a los registros de Runly.
---
Runly Canvas es un lienzo infinito para dibujar y anotar sobre planos, mapas, diagramas o documentos PDF, y conectar cada punto con la informacion real de tu empresa (contactos, empleados, vehiculos, inventario, proyectos, tareas, eventos, cuentas o archivos).

Cada **Board** tiene paginas, y cada pagina tiene capas. Varias personas pueden trabajar en el mismo Board: veras quien esta conectado en la barra superior y los cambios de los demas aparecen solos.

### Tipos de Board (plantillas)

Al crear un Board eliges una plantilla. Cada plantilla **prepara el Board para su uso**: crea capas con nombre, configura la cuadricula y el ajuste a la cuadricula, elige la herramienta inicial y muestra en la pagina vacia el primer paso recomendado. Todas las herramientas (formas, textos, hotspots, imagenes y PDF) funcionan en cualquier plantilla, y la cuadricula se puede cambiar despues.

- **En blanco**: lienzo libre para bocetos, ideas o cualquier uso que no encaje en otro tipo.
- **Plano**: plantas de oficinas, bodegas, locales o casas. Inserta el plano como imagen o PDF y marca areas con rectangulos y puntos con hotspots (tomas electricas, extintores, camaras).
- **Mapa tecnico**: instalaciones y redes (electricidad, agua, datos, maquinaria). Usa hotspots para cada equipo y vinculalos con el articulo de inventario o el vehiculo correspondiente.
- **Diagrama**: procesos, flujos y organigramas con rectangulos, rombos (decisiones), flechas y textos.
- **Distribucion**: acomodo de espacios y mobiliario (mesas, estantes, puestos de trabajo), por ejemplo para un evento o una reubicacion.
- **Revision de PDF**: inserta las paginas de un PDF y marca observaciones con hotspots, formas y textos encima.

### Capas y elementos

Cada pagina trae las capas de su plantilla (por ejemplo, un Plano trae **Plano base**, **Mobiliario** y **Hotspots**; una Revision de PDF trae **Documento**, **Anotaciones** y **Hotspots**). Las imagenes y PDF que insertes van a la capa de fondo de la plantilla (Plano base, Instalaciones, Espacios o Documento); en Revision de PDF esa capa se bloquea al insertar para que las paginas no se muevan mientras anotas. Los hotspots siempre van a su capa de hotspots.

El panel izquierdo muestra **Paginas** (plegable; la cabecera siempre indica la pagina activa) y **Capas**: cada capa se despliega con la flecha para ver sus elementos, de arriba hacia abajo en el mismo orden en que se dibujan. Capa y elemento tienen su propio icono de ojo (ocultar) y candado (bloquear) para no moverlos por accidente, y cada elemento tiene un boton **Enfocar** que centra y resalta un momento ese elemento en el lienzo. Arrastra desde el asa (el icono de puntos a la derecha de la fila) para reordenar capas o elementos, o para mover un elemento a otra capa; en pantalla tactil, mantén presionada el asa un momento antes de arrastrar. Al elegir una herramienta de dibujo, Canvas cambia solo a la capa correcta. La ayuda "¿Que es cada capa?", al final del panel, explica el tipo de cada una y esta plegada por defecto.

- **Datos Runly**: aqui van los objetos **conectados a datos**. Selecciona una forma y usa "Conectar a datos" en el inspector (o el boton "Insertar datos" de la barra inferior) para ligarla a una ubicacion o articulo de inventario, un vehiculo, un colaborador, un proyecto, una mesa de POS (se ve libre, ocupada o con cuenta pedida) u otro registro. El objeto muestra el nombre del registro, un resumen y un color segun su estado (por ejemplo, una ubicacion con equipos en mantenimiento se ve en ambar) y se actualiza solo cada minuto. Ocultar esta capa oculta todos los datos de la pagina.

### Acciones rapidas y cambiar forma

Clic derecho sobre el lienzo (o pulsacion larga sobre un elemento en pantalla tactil) abre un menu en ese punto: Enfocar, Editar texto o Abrir hotspot segun el tipo, Duplicar, Copiar, Cambiar forma, Mover a capa, Traer al frente, Enviar al fondo, Ocultar, Bloquear y Eliminar; sobre el lienzo vacio ofrece Pegar, Seleccionar todo y Ajustar vista. Tambien se abre con Shift+F10 o la tecla de menu del teclado, centrado en la seleccion. Copiar y pegar tambien funcionan con Ctrl+C / Ctrl+V.

Cualquier rectangulo, elipse, triangulo o rombo puede **cambiar de forma** a otro de ese mismo grupo, y una linea puede volverse flecha (o al reves), desde el inspector ("Forma") o desde el menu de acciones rapidas; conserva posicion, tamano, color, vinculos y conexiones, y Ctrl+Z lo revierte.

### Donde aparece un registro

En la ficha de un articulo de inventario, la seccion **En Canvas** lista los Boards donde ese articulo esta conectado o vinculado, con un boton para abrirlos.

### Cuadricula y ajuste

Sin nada seleccionado, el inspector muestra **Ajustes del Board**: mostrar u ocultar la cuadricula, su tamano y **Ajustar a la cuadricula**. Con el ajuste activo, las formas se alinean a la cuadricula al dibujarlas, moverlas o cambiar su tamano; manten **Alt** mientras arrastras para desactivarlo un momento.

### Poligonos

Los poligonos muestran un punto en cada vertice cuando estan seleccionados: arrastralo para moverlo, arrastra el punto pequeno entre dos vertices para agregar uno nuevo y haz doble clic en un vertice para quitarlo.

### Hotspots y registros vinculados

Un hotspot es un pin con informacion. Al colocarlo se abre su ficha; despues se abre con doble clic, con Enter o con el boton del inspector. En la ficha puedes poner titulo, descripcion, estado (Activo, En revision, Resuelto, Inactivo), color, **icono del pin** (mas de 200 iconos recomendados por categoria —seguridad, electricidad, agua, redes, oficina, almacen, mantenimiento, vehiculos, personas, lugares y estados— con busqueda en espanol, y la libreria completa de mas de 1800 iconos), **vincular registros de Runly** y **adjuntar archivos** (fotos, fichas tecnicas, manuales). Cualquier forma tambien puede tener registros vinculados desde el inspector; los elementos vinculados muestran un pequeno distintivo en el lienzo.

Los pines se ven del mismo tamano con cualquier zoom, como en un mapa, y su punta marca el lugar exacto. En el inspector puedes elegir su tamano (pequeno, mediano o grande) o la escala "Crece con el plano" para que el pin cubra un elemento del plano y se pueda redimensionar.

### Imagenes y PDF

Con el boton de insertar (o la tecla I) subes una imagen o un PDF. De un PDF con varias paginas eliges cuales colocar; cada pagina queda como imagen nitida en el lienzo, detras de las formas, y el PDF original se guarda como referencia. Al acercarte a una pagina de PDF, Canvas la vuelve a dibujar desde el PDF original con mas resolucion para que se lean los detalles.

### Mapas

La plantilla **Mapa de sitio** (o "Fondo de mapa..." en el menu de escala) pone un mapa de OpenStreetMap detras de la pagina. Busca una direccion o lugar y el mapa se movera y hara zoom junto con el lienzo. En una pagina con mapa las medidas salen en metros sin calibrar. El mapa no aparece en exportaciones, miniaturas ni enlaces publicos.

### Planos DXF

Puedes insertar un archivo **DXF** de AutoCAD con el boton de insertar. Canvas lo dibuja como imagen en la capa de fondo y, si el archivo declara sus unidades (milimetros, centimetros, metros, pulgadas o pies), la pagina queda calibrada automaticamente.

### Escala y medidas

Con **Calibrar escala** (junto a los controles de zoom) trazas una linea sobre una medida conocida del plano, por ejemplo una pared de 5 m, y escribes su longitud real. Desde entonces la herramienta **Medir** (tecla M) muestra distancias en metros, centimetros, milimetros o pies, y el inspector muestra ancho, alto, area y perimetro de cada forma. Cada pagina tiene su propia escala.

### Alinear y distribuir

Con varios elementos seleccionados, la seccion **Alinear** del inspector los alinea por la izquierda, el centro, la derecha, arriba, en medio o abajo, y los distribuye con espacios iguales (minimo tres).

### Conectores

Si sueltas el inicio o el final de una linea o flecha sobre una forma, queda **conectada**: al mover o cambiar el tamano de la forma, la flecha la sigue. Arrastra el extremo fuera de la forma para desconectarlo.

### Bibliotecas

El boton **Biblioteca** (icono de libro) de la barra inferior abre un panel con elementos reutilizables, personales o de la empresa. Puedes importar bibliotecas .excalidrawlib descargadas de libraries.excalidraw.com (revisa la licencia de cada una antes de usarla), iconos SVG sueltos o un ZIP con varios SVG (por ejemplo un paquete de iconos de redes o de nube); cada SVG queda como un elemento de imagen. Si no eliges una biblioteca al importar, se crea una nueva con el nombre del archivo.

Haz clic en un elemento para insertarlo en el centro de la vista, o arrastralo al lienzo para soltarlo en un punto exacto. Desde el menu de acciones rapidas o desde el inspector (un elemento o varios), **Guardar en biblioteca** guarda la seleccion como un elemento nuevo, listo para reutilizar en cualquier Board.

Cada biblioteca puede ser **Personal** (solo tu la ves) o de **Empresa** (todo el equipo la ve); cambiar una biblioteca a Empresa requiere el permiso correspondiente. Desde el menu de cada biblioteca puedes renombrarla, cambiar su alcance o eliminarla.

### Exportar

El menu **Exportar** de la barra superior descarga la pagina actual como imagen PNG o como PDF listo para imprimir, con el nombre del Board, la fecha y la escala.

### Trabajo en equipo en vivo

Cuando otra persona edita el mismo Board ves su **cursor con su nombre** y un contorno de su color alrededor de lo que tiene seleccionado. Sus cambios aparecen al instante sin recargar. Si ustedes dos cambian el mismo elemento casi al mismo tiempo, se guarda el primero y al otro le aparece un aviso con la version mas reciente.

### Versiones

El boton **Versiones** de la barra superior guarda el estado completo del Board con un nombre opcional (por ejemplo "Antes de reacomodar"). El propietario puede **restaurar** cualquier version; antes de restaurar se guarda automaticamente una version del estado actual, asi que nada se pierde. Se conservan las ultimas 100 versiones.

### Miniaturas

La lista de Boards muestra una miniatura de cada Board. Se actualiza sola unos segundos despues de que dejas de editar. Si un Board todavia no tiene miniatura, se crea sola unos segundos despues de abrirlo.

### Buscar y filtrar

El buscador de la lista de Boards encuentra un Board por su nombre, descripcion, paginas, hotspots, textos del lienzo y registros vinculados; no importan mayusculas ni acentos y tolera errores de dedo. Cada resultado indica donde coincidio. Los filtros permiten ver solo ciertas plantillas, tus Boards o los compartidos contigo, por fecha de actualizacion, y ordenar por recientes, nombre o antiguedad.

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

- Deshacer y rehacer (Ctrl+Z / Ctrl+Shift+Z) cubren lo que haces en el lienzo durante la sesion abierta, incluido ocultar, bloquear o cambiar de forma un elemento; los cambios de la ficha del hotspot y ocultar o bloquear una capa completa no se deshacen.
- Solo ves los Boards que creaste o que te compartieron; en la lista, los compartidos muestran tu rol.
- MirAI no dibuja ni mueve formas; consulta Boards y hotspots, crea Boards y actualiza hotspots.
