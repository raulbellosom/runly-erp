---
title: Catálogo oficial de módulos
summary: Cómo se publican módulos firmados en el catálogo de runly.mx y cómo los instala una instancia desde Módulos > Disponibles.
order: 9
---
El catálogo oficial es una lista de módulos **firmados** que cualquier instancia de Runly puede instalar y actualizar desde **Módulos > Disponibles**, sin subir ZIPs a mano.

## Cómo lo usa una instancia

1. **Módulos > Disponibles** descarga `https://runly.mx/catalog/v1/index.json` (o la URL configurada) y muestra cada módulo con su versión y su estado: *Instalar*, *Actualizar* o *Instalado*.
2. Al instalar o actualizar, un administrador (`core.modules.manage`) ve qué datos de otros módulos podrá usar el módulo (servicios), qué avisos recibirá (eventos) y qué conexiones ofrece, y autoriza solo lo que quiera.
3. Runly descarga el ZIP y comprueba **tamaño, huella SHA-256 y firma**. Si algo no coincide: *"El paquete no es auténtico"* y no se instala nada.
4. El paquete pasa por el mismo flujo que una subida manual (revisión de estructura, respaldo, migraciones) y se instala.

Sin conexión, la pestaña muestra la última lista descargada y los módulos instalados siguen funcionando.

## Formato de `index.json`

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-04T00:00:00.000Z",
  "modules": [
    {
      "key": "custom.horas",
      "name": "Registro de horas",
      "description": "Horas trabajadas por proyecto y colaborador.",
      "icon": "Clock",
      "color": "#0EA5E9",
      "version": "1.0.0",
      "packageUrl": "custom.horas-1.0.0.zip",
      "size": 18342,
      "sha256": "…64 caracteres hex…",
      "signature": "…base64…",
      "dependencies": ["runly.core", "runly.projects"],
      "consumes": { "runly.projects": ["tasks.read"] },
      "events": ["projects.task.created"],
      "connections": [{ "target": "project", "kind": "related", "label": "Horas" }],
      "changelog": "Primera versión."
    }
  ]
}
```

`packageUrl` puede ser relativa al `index.json`. Una instancia solo marca como **oficial** un paquete firmado con la clave de Runly; ese dato nunca se toma del manifiesto.

## Publicar una versión (equipo de Runly)

1. Genera el ZIP del módulo (Constructor > Descargar ZIP, o tu paquete) con la versión nueva en `module.manifest.js`.
2. Firma y obtén su entrada:

   ```bash
   node scripts/catalog/sign-package.mjs custom.horas-1.0.0.zip --url custom.horas-1.0.0.zip --changelog "Primera versión."
   ```

   Usa la clave privada en `~/.runly/catalog-signing-key.pem` (creada con `scripts/catalog/keygen.mjs`; nunca va al repositorio).
3. Copia el ZIP y la entrada al sitio (`runly-web`, carpeta del catálogo) y actualiza `index.json`. La firma cubre `clave@versión:sha256`: cambiar cualquiera de los tres invalida el paquete.

## Catálogo propio (instancias privadas)

Un administrador puede apuntar su instancia a otro catálogo y confiar en otra clave guardando en la configuración de la instancia `catalog.url` (puede ser `file:///ruta/index.json`) y `catalog.publicKeys` (lista JSON de claves públicas). Esos paquetes se instalan igual, pero no se marcan como oficiales.
