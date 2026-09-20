# Despachos y báscula

Módulo RME3 para vales de materiales a granel, pesajes y control de salida por QR.

La versión `0.4.0` centraliza los sitios, estaciones, responsables, materiales y
series de folios de la operación. Incluye además un lector de vales optimizado para
dispositivos QR que funcionan como teclado.

## Instalación desde ZIP

El artefacto instalable está en `D:/RacoonDevs/runly-modules/custom.dispatch.zip`.
No copies esta carpeta dentro de `runly/modules/custom`; el objetivo es validar
el mismo flujo que utilizará un módulo distribuido externamente.

1. Abre el catálogo de módulos de Runly.
2. Selecciona **Subir módulo** y carga `custom.dispatch.zip`.
3. Confirma que la clave sea exactamente `custom.dispatch`.
4. La carga extrae el módulo y sincroniza el catálogo; todavía no crea sus tablas.
5. Busca **Despachos y báscula** en el catálogo y pulsa **Instalar módulo**.
6. Abre `/app/m/custom.dispatch/operacion`.
7. Crea al menos un sitio, estaciones de venta y báscula, un material y las series
   `SCALE` y `VOLUME`.

El ZIP admite un único directorio contenedor `custom.dispatch/` y su manifiesto debe
estar en `custom.dispatch/module.manifest.js`. La clave del manifiesto y la capturada
en Runly deben coincidir.
