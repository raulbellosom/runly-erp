---
viewKey: /module-builder
title: Constructor de modulos
summary: Crea tus propios modulos sin programar - define entidades y campos, disena pantallas, vistas, menu y permisos, y publicalos en tu instancia.
---
El Constructor de modulos te permite crear un modulo completo de Runly sin escribir codigo: una "Agenda de citas", un "Registro de visitas", un "Control de equipos"... Tu defines que datos guarda y como se ven; Runly genera las tablas, las pantallas, la API, los permisos y el menu.

### Como se trabaja

1. **Crear modulo**: desde esta pantalla, boton **Crear modulo**. Eliges como empezar: **Desde plantilla** (Visitas a clientes, Prestamo de herramientas, Mantenimiento de equipos, Solicitudes internas, Inventario ligero o Lista simple), **Con IA** (describes lo que necesitas y MirAI arma el borrador para que lo revises) o **En blanco**. Despues pones nombre y clave (por ejemplo `custom.visitas`); la clave no se puede cambiar despues.
2. **Editar el borrador**: el editor tiene cinco pestanas:
   - **General**: nombre, descripcion, version, icono, color y nombre corto para la app.
   - **Datos**: las **entidades** (las "tablas" del modulo, como Cliente o Pedido) y sus **campos**. Cada entidad tiene ademas un boton **Diseno** para organizar su formulario y su detalle.
   - **Vistas**: pantallas extra como Dashboard, Kanban, Tarjetas, Calendario, Linea de tiempo o Reporte.
   - **Navegacion**: las entradas del menu lateral del modulo.
   - **Permisos**: los permisos que se generan (ver, crear, editar, desactivar por entidad).
3. **Preview**: muestra como se veran las pantallas con datos de ejemplo, sin instalar nada.
4. **Validar**: revisa el borrador y lista cualquier problema con la ruta exacta de donde esta.
5. **Publicar**: instala o actualiza el modulo en tu instancia.

Todo se guarda solo mientras editas (el indicador de abajo a la izquierda muestra "Guardando" o "Guardado"). Nada cambia en el modulo instalado hasta que publicas.

### Temas relacionados

- **Datos y campos**: tipos de campo, requeridos, opciones, relaciones y archivos.
- **Diseno de formulario y detalle**: pestanas, secciones, columnas, encabezado, indicadores.
- **Condiciones**: mostrar pestanas, secciones o campos solo en ciertos casos.
- **Relaciones e integridad**: que pasa al desactivar un registro que otros usan.
- **Archivos, fotos y documentos**: campos de archivo, camara y documentos adjuntos.
- **Vistas adicionales** y **Publicar y actualizar** (incluye el **modo desarrollador** para agregar pantallas propias en React descargando el ZIP; boton **Modo desarrollador** arriba del editor).

### Alcances y limites

- Necesitas el permiso **Use Module Builder** (`core.modules.builder`); pideselo a un administrador si no ves esta pantalla.
- Los modulos creados aqui conviven con los modulos oficiales; su clave no puede usar los prefijos reservados del sistema (como `runly.`).
- Las relaciones pueden apuntar a entidades de tu modulo o de modulos del sistema (Flotilla, Inventario, Contactos, RR. HH., Proyectos, Calendario, Cuentas, Archivos).
