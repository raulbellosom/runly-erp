---
viewKey: /module-builder/enlaces
title: Constructor - Enlaces y paginas publicas
summary: Compartir una ficha o un formulario por enlace con personas sin cuenta, que campos se exponen, vigencia, limite de usos y revocacion.
---
Una **pagina publica** permite que alguien sin cuenta en Runly abra un enlace para ver un registro o llenar un formulario. Por ejemplo: un cliente consulta el estado de su pedido o un empleado responde una encuesta.

### Crear una pagina publica

En el Constructor, pestana **Enlaces**, usa **Nueva pagina publica** y elige:

- **Ficha publica (solo lectura)**: muestra los campos que marques de un registro.
- **Formulario publico**: cada envio crea un registro nuevo. Opcionalmente queda **ligado** al registro compartido; por ejemplo, cada Respuesta queda ligada a su Encuesta. Para ligarlos, la entidad del formulario necesita una relacion hacia la entidad compartida.

### Que se expone

Solo los campos que marques. Nunca se muestra "todo" por defecto.

- No se pueden mostrar campos de **Archivo** ni de datos tecnicos.
- Las relaciones se muestran solo con su nombre.
- En el formulario se pueden llenar textos, numeros, fechas, opciones, correo y telefono. Todos los campos obligatorios de la entidad del formulario deben estar marcados.

### Compartir el enlace

Despues de **Publicar**, abre el detalle de un registro y usa **Compartir**. Ahi puedes:

- Crear un enlace con **vigencia** y **maximo de usos** (ambos opcionales).
- Copiarlo o mostrar su **codigo QR**.
- Ver cuantas veces se ha usado.
- **Revocarlo**: el enlace deja de funcionar de inmediato.

Para compartir se necesita el permiso de editar la entidad compartida.

### Seguridad

- Cada enlace es una clave larga imposible de adivinar.
- Runly limita cuantas solicitudes puede hacer una misma persona y descarta envios automaticos (bots).
- La pagina muestra el nombre y logo de tu empresa.
- Si desinstalas el modulo, todos sus enlaces se revocan.

### Problemas frecuentes

- **"Enlace no disponible"**: el enlace vencio, fue revocado, ya no tiene usos o el modulo esta desactivado.
- **No aparece el boton Compartir**: publica el modulo despues de agregar la pagina publica y revisa que tengas permiso de editar la entidad.
- **Quitar una pagina publica** hace que los enlaces que ya compartiste dejen de funcionar al publicar.
