# Archivos: documentos, acceso e invitaciones

El espacio Archivos incorpora creación de DOCX, XLSX y PPTX, invitaciones internas y paginación de servidor. Funciona como nube personal: las vistas Mis archivos, Compartidos conmigo, De mis módulos e Invitaciones están dentro del módulo, y Todos solo aparece para administradores. Modelo de acceso: [especificación](../superpowers/specs/2026-10-01-files-access-model-design.md).

## Uso

1. En **Nuevo** o las tarjetas de formato, elige Documento, Hoja de cálculo o Presentación. Escribe el nombre y pulsa **Crear y abrir**. Se guarda un archivo Office válido antes de abrir CODE. Si el editor falla, el archivo permanece en la lista para volver a abrirlo.
2. Los documentos creados empiezan con acceso restringido al propietario y los administradores. **Compartir** permite invitar a usuarios activos de la misma empresa, elegir **Puede ver** o **Puede editar**, cambiar el acceso general y retirar invitaciones.
3. La persona invitada acepta o rechaza desde **Archivos → Invitaciones**. Al aceptar, el documento aparece en **Compartidos conmigo**. Las invitaciones se guardan en Atlas; esta entrega no envía correos ni incorpora invitados externos.
4. **Copiar enlace** copia una ruta autenticada de Atlas, sin tokens ni URLs de Storage. El destinatario necesita acceso; copiar el enlace no lo concede. En Tauri se usa el dominio web configurado en el servidor (`RUNLY_OFFICE_HOST_ORIGIN`, con respaldo en `RUNLY_APP_URL`), en lugar del origen nativo. Estos valores deben apuntar al ERP de esa instalación.
5. **Enlaces públicos** (en Compartir, solo propietario o administrador): crea un enlace "Solo ver" (vista previa sin botón de descarga) o "Ver y descargar", con vencimiento y máximo de usos opcionales, y revócalo cuando quieras. La página pública es `/p/files/:token`; cada apertura cuenta como un uso y las URLs firmadas que entrega duran 5 minutos.
6. La lista muestra 20, 50 o 100 archivos por página. Búsqueda, tipo, origen, estado y orden se aplican en el servidor antes de paginar. La URL conserva página y filtros. La selección se reinicia al cambiar de consulta y se limita a 50 archivos por descarga masiva.

Para coeditar, ambas personas necesitan edición en el documento y en el módulo, abrir el mismo archivo y usar la misma instalación de Atlas/CODE. Las invitaciones conceden acceso; no unen sesiones de dos servidores CODE distintos. Se conserva el [flujo Office existente](office-collabora.md).

## Reglas de acceso

| Caso | Comportamiento |
|---|---|
| Crear un documento | Requiere lectura, creación y actualización en Archivos; membresía y perfil activos. |
| Documento restringido | Propietario, administradores y personas con invitación aceptada. EDITOR permite editar; VIEWER solo leer. |
| Acceso general de empresa ("Toda la empresa") | Cualquier miembro con lectura de Archivos lo ve. Una invitación VIEWER no reduce ese acceso general. |
| Cambiar acceso | Propietario o administrador, dentro de la empresa activa. Editar contenido no concede administración de permisos. |
| Adjuntos de módulos (De mis módulos) | En Archivos solo los ve quien tiene acceso al registro de origen: Canvas y Proyectos por membresía, RH/Contactos/Compras/Inventario/Flota/Ventas/Documentos por el permiso de lectura del módulo, logos y avatares toda la empresa, recibos de Finanzas personales solo quien los subió. Tipos sin regla: solo quien subió, invitados y administradores. Las rutas de adjuntos de cada módulo no cambian. |
| Administradores | Leen todos los archivos de la empresa (vista Todos). |
| Nuevas cargas en Archivos | Privadas por defecto; la casilla "Compartir con toda la empresa" las deja con acceso general. |
| Archivos anteriores subidos en Archivos | La migración `20261002090000_files_private_by_default` los pasa a privados de quien los subió y guarda sus ids en `instance_config` (`files.access_model.migrated_company_ids`). Los que no tienen propietario conservan el acceso general. |

El control por documento cubre lista, detalle, previews, descarga directa/ZIP, emisión de URLs y solicitudes WOPI, además de excluir documentos restringidos de la firma de adjuntos sin contexto de usuario. La revocación bloquea nuevas solicitudes autorizadas por Atlas, incluidos los guardados WOPI. No borra copias descargadas ni invalida URLs firmadas previamente emitidas: estas conservan su vigencia hasta expirar.

El bucket `runly-files` debe seguir siendo privado y sin políticas de lectura directa para usuarios finales, como exige la arquitectura de Storage de Atlas. La API usa credenciales de servidor. La migración protege los metadatos de archivos y las invitaciones frente a los roles Supabase `anon` y `authenticated`; no modifica esquemas internos de Supabase.

## Actualizar una instalación existente

Este cambio requiere **imágenes nuevas de API/web y la migración `20260908090000_files_workspace`**. No necesita otro contenedor, dominio, puerto, secreto ni cambio de Nginx. CODE continúa usando el servicio Office existente.

Primero deben publicarse las imágenes que contienen estos cambios. En el directorio del instalador del VPS, con `.env.external` y el instalador Office ya actualizados:

```bash
npm run runly:external
```

El comando normal descarga imágenes y ejecuta `pnpm db:migrate` antes de iniciar Atlas. **No usar `runly:external:quick`, `--skip-migrate` o `--skip-pull` para esta primera actualización.** No hace falta volver a ejecutar el bootstrap solo por el rediseño; sí hace falta si el instalador aún no incorpora Office. El comando no publica imágenes ni actualiza sus propios scripts.

En un checkout de desarrollo, con la conexión apuntando a la base que corresponde al entorno:

```bash
pnpm db:migrate
pnpm dev
```

No ejecutar `/modules/sync` para estas tablas: son modelos del núcleo gestionados por Prisma. La migración añade campos e índices a FileAsset, crea FileAssetShare y mantiene COMPANY para registros existentes. Las tres plantillas se incluyen en la imagen API desde `apps/api/src/services/files/templates/`.

## Validación

Pruebas automatizadas: plantillas OOXML, creación concurrente e idempotente, permisos por empresa, invitaciones pendientes/aceptadas, lectores/editores, perfil deshabilitado, revocación de sesión WOPI, fallos de Storage, SQL de restricciones y paginación con 125 registros. El test PostgreSQL exige una base desechable `files_test` en localhost con el esquema y las migraciones aplicados; no usa `.env` de producción como destino implícito.

```bash
# Ejecutar en una base aislada; definir FILES_TEST_DATABASE_URL explícitamente.
node --test apps/api/src/services/__tests__/files-workspace.test.js
```

Se comprobó el flujo de la UI real con Hono y PostgreSQL aislado en dos contextos de navegador: crear, invitar, aceptar, listar compartidos, buscar fuera de la página actual y abrir enlaces directos. Storage fue un fixture en memoria y la apertura del editor se interceptó; esa prueba no representa un despliegue ni una nueva validación de coedición real en el VPS. La comprobación visual cubre escritorio, móvil emulado y tema oscuro. La aceptación en la instalación desplegada y dispositivos nativos queda para después de actualizarla.

Los reintentos de creación usan una clave persistida por propietario. Un fallo inequívoco de unicidad elimina el objeto candidato sobrante; un resultado de transacción ambiguo conserva los bytes por seguridad. No hay una tarea automática nueva de limpieza de objetos huérfanos.
