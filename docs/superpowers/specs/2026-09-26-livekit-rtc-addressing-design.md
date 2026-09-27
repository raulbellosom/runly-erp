# Configuración general de la dirección RTC de LiveKit

Date: 2026-09-26
Status: In Progress
Spec file: docs/superpowers/specs/2026-09-26-livekit-rtc-addressing-design.md
Plan file: docs/superpowers/plans/2026-09-26-livekit-rtc-addressing.md

## 1. Feature title

Selección configurable y persistente de la dirección anunciada por LiveKit.

## 2. Status

In Progress. Spec y plan aprobados por el usuario el 2026-09-26. Implementación
terminada y verificada localmente con 66 pruebas; quedan pendientes la aceptación
operativa de medios y la comprobación global de privacidad, que reporta dos
hallazgos preexistentes ajenos al cambio. Véase la evidencia final en el plan.

## 3. Context

Runly genera la configuración del LiveKit integrado desde una biblioteca compartida
por `setup-local.mjs` y `setup-external.mjs`. El transporte RTC es independiente
de las URLs de señalización y del proxy TLS. El mismo instalador se utiliza en
Linux con red del host y en Docker Desktop con red bridge.

Descubrimiento: se revisaron los documentos de arquitectura 01/02/03/08, TASKS,
la especificación y el plan de Calls del 2026-08-27, los instaladores, la biblioteca
`livekit-config.mjs`, Compose, el README y las pruebas de LiveKit.
Se conserva la arquitectura de Calls existente; este trabajo pertenece al instalador.

La imagen predeterminada es `livekit/livekit-server:v1.12.0`. Su
[go.mod](https://github.com/livekit/livekit/blob/v1.12.0/go.mod)
fija mediatransportutil en `8818f1b77e59`. La
[configuración de esa dependencia](https://github.com/livekit/mediatransportutil/blob/8818f1b77e59/pkg/rtcconfig/config.go)
admite `node_ip` y `use_external_ip`; el formato de la IP se valida en LiveKit.
El [ejemplo de la versión](https://github.com/livekit/livekit/blob/v1.12.0/config-sample.yaml)
indica que el descubrimiento externo tiene precedencia sobre la IP configurada.

## 4. Problem

Antes de este cambio, Runly emitía siempre `use_external_ip: true`. El operador no podía expresar una
dirección RTC explícita mediante la configuración persistida del instalador.
Editar el YAML generado manualmente no constituye un contrato de configuración.

El diagnóstico recibido es una hipótesis operativa, no una reproducción de la
avería en este workspace. El
[código de construcción de WebRTC](https://github.com/livekit/mediatransportutil/blob/8818f1b77e59/pkg/rtcconfig/webrtc_config.go)
aplica reglas de reescritura con la IP del nodo cuando no obtiene mapeos externos.
Por tanto, un fallo de descubrimiento por interfaz no demuestra por sí solo que
el cliente reciba exclusivamente candidatos privados. Faltan la configuración
efectivamente cargada, candidatos de la sesión y el par ICE seleccionado.

## 5. Goals

1. Exponer un contrato común de dirección RTC, independiente del cliente,
   proveedor, router, dominio, sistema operativo y modo TLS.
2. Conservar el descubrimiento automático por defecto y permitir una IP
   explícita, pública o privada, validada y persistida.
3. Permitir volver deliberadamente al modo automático y conservar credenciales
   y URLs durante las actualizaciones.
4. Verificar resolución, generación e integración del entorno sin confundir
   pruebas de configuración con conectividad de audio/video.

## 6. Non-goals

1. Actualizar LiveKit o emitir campos ausentes en la versión fijada.
2. Detectar routers, adivinar la IP desde el dominio TLS, consultar servicios
   públicos de IP o modificar firewall, port forwarding y configuración remota.
3. Resolver CGNAT, desplegar TURN, implementar DDNS o garantizar conectividad
   LAN/WAN simultánea con una única dirección anunciada.
4. Filtrar interfaces por nombres o rangos fijos; introducir perfiles por cliente.
5. Añadir un segundo interruptor `LIVEKIT_USE_EXTERNAL_IP`, YAML arbitrario o
   listas de direcciones. Dual stack simultáneo queda para un contrato posterior.

## 7. User stories

- Como operador, quiero conservar el descubrimiento automático cuando funciona.
- Como operador de una red con NAT o VPN, quiero indicar una IP alcanzable por
  mis participantes sin modificar código ni perderla al actualizar.
- Como operador, quiero limpiar esa opción y recuperar el modo automático.

## 8. UX requirements

No hay UI nueva. Documentar la opción en ambos ejemplos de entorno y el README.
Los errores nuevos se expresan en español y nombran `LIVEKIT_NODE_IP` sin
reproducir su contenido. No solicitar la IP interactivamente si está ausente.

El README explica tres direcciones diferentes: `LIVEKIT_URL` para el navegador,
`LIVEKIT_INTERNAL_URL` para la API y `LIVEKIT_NODE_IP` para el transporte RTC.
Se aclara que el smoke test de salas comprueba control/señalización, no medios.

## 9. Routes/screens

N/A. No se crean rutas, pantallas, componentes ni vistas de módulos.

## 10. Data model

Sin entidades persistentes nuevas. Se amplía el objeto de configuración existente:

| Campo | Contrato |
|---|---|
| `values.nodeIp` | Entrada opcional desde `LIVEKIT_NODE_IP` |
| `config.nodeIp` | Cadena validada y recortada; `""` significa automático |

El contrato de entrada de `renderLiveKitConfig` incorpora `nodeIp` opcional.
La misma normalización y validación se utiliza desde el resolver y el renderer,
para que una llamada directa al renderer tampoco pueda producir YAML inválido.

| Modo LiveKit | `nodeIp` | Resultado |
|---|---|---|
| `embedded` | Vacío o ausente | YAML actual: `use_external_ip: true`, sin `node_ip` |
| `embedded` | IP válida | `use_external_ip: false` y `node_ip` como cadena YAML entre comillas |
| `external` / `disabled` | Vacío o IP válida | Conservar valor en entorno; no generar ni aplicar configuración RTC local |
| Cualquiera | Valor no vacío inválido | Error `LIVEKIT_NODE_IP_INVALID` antes de escribir configuración LiveKit |

Una IP explícita es un dato de despliegue, nunca una constante de código. No se
infiere de `LIVEKIT_DOMAIN`, DNS, hostnames de Docker ni URLs de la aplicación.
El renderer conserva el resto del YAML y las reglas actuales de puertos por plataforma.

## 11. Prisma impact

N/A. Sin modelos nuevos o modificados; sin migraciones.

## 12. API contract

N/A. Sin endpoints, cambios de autenticación, permisos ni respuestas de Calls.

## 13. SDK contract

N/A. Sin dominios ni métodos nuevos en `@runly/sdk`.

## 14. Validator contract

Validación local en `infra/installer/lib/livekit-config.mjs`, con `node:net`:
recortar espacios exteriores; vacío equivale a automático; exigir una única IP
literal IPv4 o IPv6. Aceptar direcciones privadas para VPN/LAN. Rechazar hostnames,
URLs, CIDR, puertos, IPv6 entre corchetes, listas y zonas IPv6 con `%` (aunque
`net.isIP` acepte algunas zonas, el parser de LiveKit no las acepta).
No introducir dependencias ni esquemas compartidos de API.

## 15. Module manifest impact

N/A. No es un módulo RME3 nuevo. No cambian clave, ubicación del manifest,
dependencias, kind, lifecycle, PWA, ACL, identidades ni permisos de Calls.

## 16. Navigation impact

N/A. Sin entradas, etiquetas, iconos ni permissionKey nuevos.

## 17. Blueprint impact

N/A. Sin blueprints nuevos o modificados.

## 18. RBAC/permissions

N/A. Se conserva la autorización de Calls. Sin permisos ni mapas ACL nuevos.

## 19. Multi-company behavior

Configuración de infraestructura por instalación, no por empresa. No modifica
consultas, aislamiento de salas, tokens ni scoping de datos de negocio.

## 20. Files/storage impact

Sin cambios en archivos de negocio ni almacenamiento de adjuntos.
Los artefactos afectados son el entorno privado del instalador y el YAML generado.

Precedencia de la nueva clave en ambos instaladores:

1. Si existe en `.env.local` o `.env.external`, usar ese valor, incluido vacío.
2. Si está ausente, usar `process.env.LIVEKIT_NODE_IP` cuando exista.
3. En otro caso, usar vacío.

Usar `parseEnvValue(...) ?? process.env.LIVEKIT_NODE_IP ?? ""` en los dos puntos
de entrada. No usar `||` ni cambiar la precedencia de variables existentes.
El helper actual `fromLocalEnv` no preserva el vacío explícito y no se modifica
globalmente para este trabajo. El flujo externo lee su archivo directamente.

Persistir `LIVEKIT_NODE_IP` normalizado en la plantilla local y mediante la
actualización del archivo externo. Incluirlo en la ampliación de plantillas de
instalaciones existentes sin que esa ampliación oculte un valor heredado del
proceso cuando originalmente faltaba la clave. Un segundo pase conserva el valor.
Los ejemplos nuevos dejan la clave vacía; el entorno de la instalación es la
fuente principal y el proceso solo sirve de fallback para claves ausentes.
No añadir interpolación a Compose: el YAML ya contiene el valor literal.
Conservar los permisos actuales de archivos. No editar entornos reales.

## 21. Export/import requirements

N/A. Sin importaciones ni exportaciones de datos de negocio.

## 22. Audit log requirements

N/A. No hay acción de usuario ERP nueva. No registrar secretos ni logs reales
de infraestructura en archivos versionados.

## 23. Edge cases

1. Ausencia, cadena vacía, espacios y valores entre comillas del archivo env.
2. IP IPv4, IPv6 o privada válida; rechazar zonas IPv6 y entradas malformadas.
3. Vacío explícito en archivo con IP antigua en el proceso: prevalece automático.
4. Cambio de `embedded` a `external`/`disabled` y vuelta: conservar la opción,
   sin intentar modificar un servidor remoto.
5. TLS `managed`/`external` es independiente de esta opción y de `deployment`.
6. IP dinámica: actualizar el literal y regenerar/reiniciar tras cada cambio;
   actualizar únicamente DDNS no actualiza los candidatos RTC configurados.
7. En Docker Desktop, cambiar la IP no corrige una traducción de puertos RTC
   incompatible: la ruta externa debe entregar el tráfico al puerto anunciado.
8. Una IP pública fija puede seguir siendo inaccesible desde LAN sin hairpin.
   Probar cada red cliente; no asumir que desaparecen todos los candidatos privados.
9. Una entrada inválida no debe sobrescribir el YAML o las credenciales existentes.

## 24. Risks

1. Confundir anuncio con alcance de red. Documentar puertos RTC efectivos,
   firewall, NAT, CGNAT y necesidad eventual de TURN.
2. Convertir logs en prueba de medios. No automatizar aceptación por cadenas
   de logs; registrar por separado configuración, control y prueba de medios.
3. Pérdida del valor al actualizar. Probar lectura/escritura de ambos flujos;
   ejecutar dos veces el resolver aislado no demuestra persistencia del instalador.
4. Los instaladores ya son grandes: 1254 líneas local y 987 externas al revisar.
   Mantener cambios de cableado mínimos y lógica nueva en la biblioteca de 280
   líneas. No añadir refactors ajenos; ningún archivo debe superar 1500 líneas.
5. Hay un cambio previo en `setup-local.mjs` sobre la URL pública de la API.
   Preservarlo y revisar únicamente el diff propio.

## 25. Acceptance criteria

1. Dada una configuración anterior sin la clave, al renderizar el YAML, la rama
   automática mantiene exactamente el contenido anterior.
2. Dada una IP válida y modo integrado, al generar configuración para Linux o
   Desktop, aparecen la IP y `use_external_ip: false`, con puertos apropiados.
3. Dados ambos modos TLS y ambos tipos de instalación, la misma entrada produce
   la misma política RTC sin modificar URLs ni credenciales.
4. Dada una IP inválida, resolver y renderer la rechazan con el código previsto;
   no se escriben artefactos LiveKit nuevos desde los flujos afectados.
5. Dado cada instalador y un archivo temporal, al persistir, volver a leer y
   ejecutar otro pase, la IP y credenciales conservan su valor.
6. Dado vacío explícito en archivo y valor en proceso, al configurar se obtiene
   automático; dada ausencia real se utiliza y persiste el fallback del proceso.
7. Dado LiveKit externo o desactivado, no se emite configuración RTC local.
8. Dada la documentación publicada, describe los límites de NAT/DDNS, las tres
   direcciones y la diferencia entre smoke de control y comprobación de medios.

## 26. Verification plan

- `node --test infra/installer/__tests__/livekit-installer.test.js`: regresiones
  existentes y política RTC, incluyendo snapshots completos de YAML.
- `node --test infra/installer/__tests__/livekit-node-ip-env.test.js`: integración
  aislada con archivos temporales, sin ejecutar `main`, Docker ni red real.
- `node --check` sobre biblioteca y ambos instaladores modificados.
- `pnpm check:privacy` y `git diff --check`.
- Revisión manual del cableado y de la matriz de aceptación.
- Aceptación operativa posterior: dos participantes en redes distintas y luego
  LAN si aplica; comprobar par ICE seleccionado y audio/video bidireccional.
  No declarar esta prueba realizada por pasar pruebas unitarias o leer logs.

Baseline de descubrimiento: el 2026-09-26 pasaron 22/22 pruebas existentes de
`livekit-installer.test.js`. No se ejecutó una llamada real ni se desplegó nada.
TASKS recibirá una entrada propia con evidencia al verificar la implementación;
no es necesario actualizar los documentos de arquitectura 01–09.

## 27. Rollback plan

Dejar `LIVEKIT_NODE_IP=` en el archivo de instalación y regenerar configuración
con el instalador devuelve la política automática. El reinicio de LiveKit puede
interrumpir llamadas activas y se programa como operación de despliegue.
Para revertir código, retirar solo el cambio de esta funcionalidad; no hay
migraciones ni cambios de datos. No sobrescribir modificaciones previas del workspace.

## 28. Future enhancements

1. Contrato dual stack simultáneo y selección avanzada de interfaces, si existe
   un caso demostrado que la opción de IP única no cubra.
2. TURN y tratamiento de redes sin entrada directa, como iniciativa separada.
3. Actualización controlada de direcciones dinámicas, con manejo del reinicio.
4. Diagnóstico RTC que inspeccione candidatos y estadísticas sin publicar datos
   sensibles ni depender de mensajes de log específicos de una versión.
