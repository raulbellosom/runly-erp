---
viewKey: /modules
title: Modulos
summary: Instala, habilita, deshabilita o desinstala los modulos disponibles en esta instancia.
---
En esta pantalla ves el catalogo completo de modulos disponibles para tu instancia de Runly, con su version, categoria y estado actual (instalado, deshabilitado o disponible para instalar).

- Los modulos **core** (como Runly Core, Identidad, Archivos, Empresa, Contactos y RRHH) siempre estan instalados y no se pueden desinstalar.
- Los modulos **opcionales** se pueden instalar, deshabilitar temporalmente o desinstalar desde la tarjeta de cada uno.
- Si un modulo depende de otro (por ejemplo, POS depende de Catalogo), Runly te avisa y no te deja instalarlo hasta resolver la dependencia.
- Al desinstalar puedes elegir conservar los datos o purgarlos por completo, con una confirmacion explicita antes de borrar cualquier cosa.
- Deshabilitar un modulo no borra sus datos: solo lo oculta de la navegacion y le impide seguir funcionando hasta que lo vuelvas a habilitar.
- **Subir modulo** recibe un ZIP y primero lo revisa: valida el paquete, muestra que cambiara en la estructura de datos (bloquea los cambios que perderian datos), avisa si no subiste la version y muestra una vista previa de las pantallas React del modulo. Solo se aplica cuando confirmas.
- **Sincronizar** vuelve a leer el manifiesto de un modulo (util despues de una actualizacion) sin perder los datos que ya tenia guardados.
