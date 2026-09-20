# Aislamiento de usuarios y recursos

Runly conserva una identidad global (`UserProfile`/Supabase Auth) y separa el
acceso empresarial mediante `Membership.companyId`. No existe una capa de
organización superior que otorgue permisos implícitos entre empresas.

## Diagnóstico y decisión

Los puntos corregidos combinaban permisos o colaboradores de varias membresías,
reutilizaban participantes sin revalidar su empresa, o confiaban en selectores del
cliente. También faltaba vincular ciertos identificadores de tareas a su proyecto.
Los accesos privilegiados de Prisma necesitan autorización propia porque omiten RLS.

La empresa activa se resuelve en el servidor. Un administrador de empresa administra
esa membresía; cambiar la identidad, contraseña o rol de plataforma requiere los
permisos de plataforma correspondientes. Eliminar/desactivar un usuario de una
empresa revoca su membresía, conservando su identidad y las demás empresas.

## Contratos para módulos

- `createUserAccessService`: valida empresa, perfil, membresía, rol habilitado,
  permiso de módulo y, opcionalmente, participación en proyecto.
- `GET /identity/users/candidates`: directorio mínimo para selectores; admite
  `action`, `projectId` y búsqueda dentro del contexto autorizado. No devuelve
  otras membresías, correo, datos personales ni identificadores de Auth.
- Las operaciones deben volver a validar todos los destinatarios. Una lista
  previamente cargada o conocer un UUID no constituye autorización.
- El identificador de un recurso hijo debe pertenecer al padre autorizado.
- La autorización de un recurso existente utiliza su empresa y su ACL. Las listas
  empresariales y las herramientas de MirAI utilizan la empresa activa.

Chat, menciones, proyectos, tareas, comentarios, notas, calendario, Ledger y POS
aplican validaciones de destinatarios. Los selectores de Growth e Inventario usan
el directorio central. HR, archivos y los demás servicios conservan sus consultas
por empresa y ACL existentes; Office y las descargas de chat revalidan participantes.
Las tablas de módulos RME3 habilitan RLS y deniegan acceso directo a los roles del
navegador. Las rutas del módulo siguen siendo responsables de su autorización.

## Invitaciones explícitas

`collaboration_invitation` almacena el hash de un token aleatorio, recurso,
empresa, creador, permiso, caducidad y aceptación/revocación. El token admite una
aceptación dentro de 24 horas. Al aceptar se vuelve a comprobar la autoridad del
creador. La identidad invitada a una empresa debe coincidir con el correo indicado.
Crear la invitación no descubre ni modifica una cuenta existente por su correo.

En notas y conversaciones, un propietario puede generar y revocar enlaces desde
los controles de compartir. El receptor inicia sesión y acepta. El acceso externo
se limita a esa nota o conversación, mediante `/app/shared/:resourceType/:id`:
no concede membresía empresarial, directorio, administración ni acceso a MirAI.
Las notas distinguen lectura y edición; una invitación de chat permite participar.
Una invitación aceptada mantiene su acceso hasta revocarlo; las 24 horas limitan
la aceptación, no la duración de la colaboración.

Las API y SDK exponen crear, listar, aceptar y revocar invitaciones. Revocar un
enlace aceptado retira el acceso externo a ese recurso. Una membresía empresarial
independiente conserva sus propios permisos. Las invitaciones de empresa se crean
desde «Invitar usuario»; los nuevos usuarios reciben identidad, pero no membresía
hasta aceptar. SMTP es opcional: el administrador también puede copiar el enlace.

## Revocación y tiempo real

Las funciones SQL `runly_member_active`, `runly_chat_user_access` y
`runly_note_user_access` comparten las reglas usadas por RLS y los servicios.
Solo el backend puede llamar a las variantes que reciben un usuario arbitrario.
El navegador usa funciones ligadas a su propia identidad.

Los cambios de autorización incrementan una revisión transaccional. El servidor
publica en `topic@revision`; las conexiones antiguas dejan de recibir eventos
nuevos y los clientes vuelven a suscribirse comprobando la revisión cada 10 segundos.
Los envíos y la presencia pasan por Hono y validan acceso en cada petición.
Los eventos dirigidos a usuarios y las notificaciones pendientes vuelven a validar
el recurso antes de entregarse. Postgres Changes conserva SELECT únicamente en
las tablas consumidas por chat, llamadas y notificaciones, bajo RLS.

Retirar membresías/permisos cierra participantes corporativos, elimina permisos
compartidos derivados y cancela entregas pendientes. Los permisos externos
explícitos se revocan por separado. Las llamadas comprueban acceso al entrar y un
proceso cada 15 segundos solicita a LiveKit expulsar participantes no autorizados.
La efectividad de esa expulsión requiere que LiveKit esté disponible.
Se comprueban también participantes marcados como salidos y conexiones de pantalla,
para expulsar reconexiones con tokens anteriores. Los tokens iniciales duran un
minuto. LiveKit autoalojado no invalida tokens al expulsar y puede renovar los de
sesiones activas: existe una ventana hasta la siguiente comprobación, no revocación
instantánea del transporte multimedia. Véase la
[documentación de tokens de LiveKit](https://docs.livekit.io/frontends/reference/tokens-grants/).

Cambiar de cuenta/empresa elimina consultas y chats flotantes. El cliente revisa
membresías y revisión cada 15 segundos. No persiste consultas autenticadas en el
almacén compartido de React Query. Las descargas ya entregadas no se pueden borrar
del dispositivo: las URL firmadas de Storage conservan su vencimiento y el contenido
ya descargado conserva las propiedades de cualquier copia local.

## Instalación y actualización

La imagen API ejecuta `prisma migrate deploy`, luego el seed idempotente, antes de
iniciar Hono. Incluye Prisma CLI y cliente como dependencias de producción. Deben
configurarse `DIRECT_URL`, `DATABASE_URL` y Supabase mediante el instalador o entorno.
El servidor de Supabase debe estar inicializado antes de arrancar Runly.

Las migraciones nuevas de aislamiento son:

1. `20260919140000_user_resource_isolation`: funciones, RLS, cuarentena de miembros
   incompatibles y conversación MirAI por empresa/usuario.
2. `20260920000000_collaboration_invitations`: capacidades de recurso.
3. `20260920010000_realtime_revocation`: revisión, presencia y políticas Realtime.
4. `20260920020000_revoke_derived_memberships`: revocación derivada, validación de
   referencias y limpieza de relaciones incompatibles de desarrollo.
5. `20260920030000_company_invitations`: aceptación empresarial ligada al correo.

No se asigna empresa a registros ambiguos por heurística. Las relaciones inválidas
se retiran; el contenido histórico no se elimina masivamente. Las asignaciones
históricas válidas se conservan cuando después se retira una membresía, pero no se
pueden crear asignaciones nuevas para ese usuario.

La migración histórica de búsqueda de chat incorpora `search_path` explícito en
`atlas_unaccent`: permite aplicar la cadena completa en una base vacía con PostgreSQL
18. En una base de desarrollo que hubiera aplicado su versión anterior, Prisma
puede señalar el cambio de checksum al usar `migrate dev`; recrear esa base de
desarrollo aplica la cadena actual. No modificar `_prisma_migrations` manualmente.
Actualizar API, web y SDK de storefront juntos: clientes anteriores no conocen
los canales con revisión ni el nuevo flujo de invitaciones.

## Verificación reproducible

Con Docker y las dependencias instaladas:

```sh
pnpm test:isolation:fresh
pnpm --filter @runly/desktop build:web
pnpm check:privacy
```

El primer comando crea PostgreSQL 18 desechable, aplica toda la cadena de migraciones
y el seed, ejecuta los escenarios A–F y elimina su contenedor. Genera sus propias
credenciales; no utiliza ni modifica la base configurada para el despliegue.
Los esquemas mínimos de Auth/Realtime permiten probar SQL, privilegios y RLS;
no sustituyen una prueba con los servicios Supabase y LiveKit en ejecución.

Para una base de pruebas Supabase ya migrada, se puede definir explícitamente
`RUNLY_ISOLATION_TEST_DATABASE_URL` y ejecutar `pnpm test:isolation`. Nunca apuntarlo
a una base de usuarios: la prueba crea y elimina sus propios registros.

Las pruebas comprueban directorio y proyección, empresas A/B/C, UUID manipulados,
asignaciones, menciones, notas privadas, capacidades externas, aceptación empresarial,
revocación, permisos PostgREST/RLS, revisión Realtime y separación de búsquedas/MirAI.
También existen regresiones de servicios y del transporte Realtime del cliente.
