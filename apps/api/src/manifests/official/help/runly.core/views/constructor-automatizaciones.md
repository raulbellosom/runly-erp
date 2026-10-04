---
viewKey: /module-builder/automatizaciones
title: Constructor - Automatizaciones
summary: Hacer que tu modulo agende, notifique o registre informacion en otros modulos (Calendario, Contactos, Inventario, Proyectos, Libro de cuentas, Flota...) al guardar un registro o cuando algo pasa en otro modulo, sin programar.
---
Una **automatizacion** dice: "cuando pase esto, haz aquello en otro modulo". Por ejemplo:

- Al crear una orden de servicio, agendar la visita en el **Calendario**.
- Al cerrar la orden, **notificar** a quien la cerro.
- Cuando un vehiculo de **Flota** entra a mantenimiento, crear el contacto del taller.

Tu modulo nunca modifica las tablas de otro modulo: la accion la hace el modulo dueno, con sus mismas reglas, permisos y bitacora.

### Crear una automatizacion

En el Constructor, pestana **Automatizaciones**, usa **Nueva automatizacion** y completa:

1. **Cuando**: *Cuando se guarda un registro de este modulo* (eliges la entidad y si es al crear, al actualizar o ambos) o *Cuando pasa algo en otro modulo* (eliges el evento).
2. **Solo si** (opcional): una condicion sobre un campo: *Es igual a* un valor, *Tiene valor* o *Cambio* (solo al actualizar).
3. **Que hacer**: la accion en el otro modulo, por ejemplo *Calendario - Crear eventos de calendario* o *Notificaciones - Enviar notificaciones*.
4. **Datos que se envian**: para cada dato de la accion eliges de donde sale:
   - **Valor fijo**: lo escribes tu.
   - **Campo del registro** (o **Dato del evento**).
   - **Texto con campos**: texto con campos entre llaves dobles, por ejemplo `Visita {{folio}}`.
   - **Id del registro**.
   - **Usuario que guarda**: la persona que guardo el registro (util como destinatario de una notificacion).

Los datos marcados **Obligatorio** necesitan un origen. Con el interruptor **Activa** puedes pausar una automatizacion sin borrarla.

### Que pasa al guardar

- La automatizacion corre despues de guardar. Si falla (por ejemplo, quien guarda no tiene permiso en el Calendario), **el registro se guarda de todos modos** y el error queda registrado.
- Usa los permisos de **la persona que guarda**.
- No se repite dos veces para el mismo registro al crearlo.

### Automatizaciones por eventos de otros modulos

Corren en segundo plano unos segundos despues del cambio, sin una persona detras. Por eso solo ofrecen acciones que no necesitan a alguien: notificaciones, contactos, articulos de inventario y actualizar tareas. Si fallan se reintentan solas y nunca duplican registros.

### Autorizacion al publicar

Arriba de la pestana ves que servicios usara el modulo. Al **Publicar**, si puedes administrar modulos quedan autorizados. Si no, el dialogo avisa que quedaron pendientes y un administrador los autoriza en **Modulos**, en el detalle del modulo.

Si quitas una automatizacion y publicas, se retira la autorizacion que ya no se usa; lo que ya se creo en otros modulos se conserva.

Limite: hasta 20 automatizaciones por modulo, una accion por automatizacion.
