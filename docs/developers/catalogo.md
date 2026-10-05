# Catálogo de módulos v1

**Módulos > Disponibles** verifica cada ZIP antes de mostrar permisos. **Oficial verificado** exige firma válida con una clave oficial fijada en Runly, además de SHA-256, tamaño e identidad del manifiesto correctos. Un campo official del paquete o del índice no otorga ese estado.

El administrador revisa servicios, eventos, Connections, capacidades y grants reales antes de instalar o actualizar. Se conserva el pipeline de estructura, respaldos, decisiones de migración e instalación. Grants desconocidos, duplicados o no solicitados por el ZIP se rechazan antes de publicar el paquete en la instancia. Notas editoriales del índice no se presentan como cambios verificados del paquete.

## Publicación desde Developer Hub

1. Guardar revisión, completar build estático y crear versión privada inmutable. CUSTOM requiere además un bundle vigente.
2. En **Publicación**, solicitar review de esa versión. Se fijan proyecto, revisión, artifact, digest, tamaño, versión, autor, toolchain y manifiesto.
3. Un reviewer oficial toma la solicitud y aprueba, pide cambios o rechaza. El autor no aprueba su propia evidencia. Editar source invalida reviews no publicadas; requiere una versión nueva.
4. Un publisher oficial confirma expresamente los bytes aprobados. El build no firma ni publica automáticamente.
5. Un publicador separado revalida, llama al signer aislado, registra ledger y exporta ZIPs inmutables e índice v1.

La clave privada oficial permanece fuera de API, worker, frontend, Supabase y repositorios. La firma Ed25519 sigue cubriendo exactamente el payload UTF-8 `<key>@<version>:<sha256>`. El digest corresponde al ZIP completo. El JSON del índice no está firmado; v1 no garantiza frescura u omisión de entradas por un host comprometido. No se introduce protocolo v2.

## Schema y descargas

`catalog/v1/index.json` contiene schemaVersion 1, generatedAt y modules. Cada entrada requiere key, semver version, sha256 hexadecimal de 64 caracteres, signature Ed25519 de 64 bytes en base64 y packageUrl. Size es opcional por compatibilidad v1; el export oficial siempre lo incluye. Metadata opcional: nombre, descripción, icono, color, dependencies, consumes, events, connections, capabilities, changelog y keyId.

Se rechazan campos desconocidos, identidades duplicadas, versiones/hashes/firmas/tamaños inválidos, arrays excesivos y metadata de seguridad inconsistente con el artifact. Índice máximo 1 MiB y 1.000 entradas; ZIP máximo 25 MiB. Varias versiones de una key ofrecen la mayor según semver.

Las descargas cuentan bytes mientras llegan, sin depender de Content-Length. HTTP/HTTPS validan todas las respuestas DNS y fijan una dirección pública en la conexión; cada redirect vuelve a validarse. Se bloquean destinos privados, locales, link-local, metadata, cambios a file y downgrade HTTPS. Timeout de 20 segundos y hasta cuatro redirects. Las listas tienen presupuesto de 30 segundos antes de iniciar otra descarga y cache de evidencia de 60 segundos; un catálogo grande puede requerir recargar. Instalar siempre vuelve a descargar y verificar.

Identidad/version y permisos se obtienen del ZIP estáticamente inspeccionado, sin ejecutar sus declaraciones. Si el índice declara consumes, eventos, Connections o capacidades diferentes, la entrada queda sin verificar.

## Catálogos administrados y offline

Un administrador configura catalog.url y catalog.publicKeys (lista JSON de claves públicas SPKI DER en base64). Las claves adicionales permiten **Catálogo administrado**, sin convertir el paquete en oficial. Los scripts scripts/catalog/keygen.mjs y sign-package.mjs sirven para catálogos privados; el canal oficial usa review y signer del Hub.

Se mantiene `file:///ruta/catalog/v1/index.json` explícito: índice y paquetes deben permanecer dentro del directorio del índice, incluso al resolver symlinks. No se permite que un catálogo remoto salte a archivos locales.

ETag/304 reutiliza un índice validado. Offline se muestra el índice cacheado y evidencia de paquetes verificados en ese proceso. Tras reiniciar, entradas sin evidencia aparecen **Sin verificar**, sin instalación ni grants. Los módulos instalados siguen funcionando. Errores de schema, SSRF o metadata no se encubren con el cache.

## Distribución y rollback

El publicador guarda packages/<sha256>.zip, snapshots del índice por digest e index.json. El ledger precede al ZIP; el índice cambia sólo cuando existen todos sus ZIPs. Retry conserva firma/snapshot y rollback conserva ZIPs históricos y ledger.

Runly Web contiene un índice fuente vacío y preparación estática validada. Los binarios generados permanecen fuera de Git. Esta entrega está probada localmente con datos sintéticos y claves TEST; no activa producción ni distribuye nuevas claves oficiales.
