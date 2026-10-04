---
viewKey: /module-builder/datos-y-campos
title: Constructor - Datos y campos
summary: Como crear entidades y campos en el Constructor de modulos - tipos de campo, requeridos, opciones de seleccion, relaciones y archivos.
---
En la pestana **Datos** del editor defines que informacion guarda tu modulo.

### Entidades

Una entidad es un tipo de registro: Cliente, Pedido, Visita. Con **Anadir entidad** creas una nueva; luego le pones nombre en singular y plural. La opcion **Eliminacion suave** (recomendada) hace que "Desactivar" oculte el registro en lugar de borrarlo.

### Campos

Con **Crear campo** abres un panel donde eliges etiqueta y tipo. La clave interna se genera a partir de la etiqueta. Puedes cambiarla despues desde **Editar campo**: el Constructor actualiza el diseño, las vistas y las demas referencias, y si el campo ya esta publicado, al publicar se renombra la columna conservando sus datos (disponible despues de la primera publicacion del campo).

| Tipo | Para que sirve |
|---|---|
| Texto / Texto largo | Nombres, descripciones, notas |
| Numero / Decimal | Cantidades enteras o importes |
| Si/No | Casillas de verdadero o falso |
| Seleccion unica / multiple | Listas de opciones fijas (estado, categoria) |
| Fecha / Fecha y hora | Vencimientos, citas |
| Correo / Telefono | Datos de contacto con su formato |
| Relacion | Liga el registro con otra entidad del modulo (un Pedido con su Cliente) |
| Archivo | Una foto o un documento concreto (foto del cliente, contrato firmado) |
| Color, Markdown, Texto enriquecido, JSON | Casos especiales |

- **Requerido**: el registro no se puede guardar sin este dato. Si el campo esta dentro de algo que se oculta con una condicion, solo se exige mientras esta visible.
- **Opciones** (seleccion): cada opcion tiene una etiqueta visible y un valor guardado. No repitas valores.

### Campos de relacion

Al elegir **Relacion** seleccionas la entidad relacionada y dos opciones mas:

- **Campo a mostrar**: que dato del registro relacionado se ve en tablas, detalle y selector (por defecto, su primer campo de texto). Asi se ve "Juan Perez" y no un codigo interno.
- **Al desactivar el registro relacionado**: que pasa si alguien desactiva el registro al que apunta. Ver el tema **Relaciones e integridad**.

### Campos de archivo

Al elegir **Archivo** configuras **Tipo de archivo** (Imagen, Documento o Cualquiera), **Permitir camara** (solo imagenes) y **Tamano maximo** (hasta 10 MB). Elige **Imagen** si sera una foto: permite usar la camara y mostrarla en el encabezado del detalle. Ver **Archivos, fotos y documentos**.

### Cambios despues de publicar

Si un campo ya existe en la version publicada, el panel te avisa: eliminarlo o cambiar su tipo es un **cambio destructivo** y bloquea la publicacion para proteger los datos existentes. Agregar campos nuevos siempre es seguro.
