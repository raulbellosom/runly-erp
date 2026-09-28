---
viewKey: /module-builder/archivos
title: Constructor - Archivos, fotos y documentos
summary: Diferencia entre un campo de Archivo y la seccion de Documentos adjuntos, captura con camara, tipos y tamanos permitidos.
---
Tu modulo puede guardar archivos de dos formas distintas. Elegir la correcta evita que el usuario se confunda.

### Campo de tipo Archivo

Un **dato concreto** del registro: "Foto del cliente", "Contrato firmado", "Comprobante". Cada campo guarda **un** archivo.

- **Tipo de archivo**: *Imagen* (solo fotos), *Documento* (PDF, Word, Excel, etc.) o *Cualquiera*.
- **Permitir camara** (solo Imagen): en celular o tableta ofrece tomar la foto o elegirla de la galeria; en computadora abre la webcam con un boton **Tomar foto**. Si no hay camara o no se da el permiso, se puede elegir un archivo.
- **Tamano maximo**: 1, 2, 5 o 10 MB. Se revisa en la pantalla y tambien en el servidor.
- Un campo de Imagen se puede usar como **foto del encabezado** del detalle y como imagen en la vista de Tarjetas.
- El archivo se sube en cuanto se elige; el formulario guarda la referencia al guardar el registro.

### Seccion de Documentos adjuntos

Una **lista abierta** de archivos sueltos por registro: varios contratos, fotos extra, facturas escaneadas. Se agrega en el **Diseno** de la entidad (Agregar a la pestana > Documentos adjuntos) y solo puede haber una por entidad.

- En la creacion de un registro los archivos quedan en espera y se suben al guardar.
- Quitar un documento lo retira del registro.
- Los archivos de los **campos de Archivo no aparecen** en esta lista, para no mostrarlos dos veces.

### Cual usar

- ¿Es un dato que siempre tiene nombre propio ("la foto", "el contrato")? Usa un **campo de Archivo**.
- ¿Son varios archivos sin un nombre fijo? Usa **Documentos adjuntos**.
- Puedes usar ambos en la misma entidad.

### Permisos y privacidad

Los archivos se guardan de forma privada y solo se ven con enlaces temporales. Ver, subir y quitar archivos depende de los permisos de la entidad (ver y editar), no de permisos del modulo de Archivos.

### Nota para modulos ya publicados

Si tu modulo se publico antes de que existieran estas opciones, vuelve a **Publicar** desde el Constructor para que se generen las rutas de archivos actualizadas.
