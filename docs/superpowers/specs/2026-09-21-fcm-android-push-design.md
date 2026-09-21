# Push nativo Android vía FCM — diseño

Fecha: 2026-09-21
Estado: propuesto (pendiente de aprobación final del usuario tras esta escritura)

## Contexto

`docs/mobile/FIREBASE_SETUP.md` documenta la preparación de credenciales de Firebase (proyecto `runlymx-87cae`, `google-services.json` en el módulo Android, `service-account.json` en el servidor) pero deja explícito que "recepción personalizada, registro de tokens y envío desde Runly" están pendientes de implementación. Este incremento construye esa pieza faltante.

El pipeline de notificaciones ya existente (`apps/api/src/services/notification-service.js`, `web-push-service.js`, `notification-delivery-worker.js`, `apps/worker/src/index.js`) entrega tres canales — `in_app`, `email`, `web_push` — mediante filas en `NotificationDelivery` (`channel` es un string libre, sin enum) procesadas por un worker con reintentos. Del lado del cliente, `apps/desktop/src/lib/systemNotifications.js` → `native/index.js` → plugin Tauri → `HostNotifications.kt` ya muestra notificaciones nativas Android cuando la app está viva y recibe un evento por el socket de Realtime. Ese camino **no cubre** el caso en que el proceso Android está en segundo plano sin socket vivo o matado por el sistema — ese es exactamente el caso que FCM resuelve.

## Alcance

Incluido:
- Registro y renovación de tokens FCM por instalación (tabla, endpoints, SDK).
- Envío de push nativo desde la cola de Runly (worker), con paridad total con `web_push`: mismos tipos de evento, mismo interruptor de preferencia (`pushEnabled`).
- Receptor Android (`FirebaseMessagingService`) que muestra la notificación del sistema cuando el proceso está en segundo plano/matado, reutilizando canales y deep links ya definidos (`runly-calls-v1`, `runly-alerts-v1`, `runly://call/<id>`, `runly://chat/<id>`).

Explícitamente fuera de alcance (a decisión del usuario, 2026-09-21):
- UI de llamada entrante nativa estilo CallKit (pantalla completa, contestar/rechazar desde la notificación).
- Continuidad de llamada con la pantalla bloqueada.
- Soporte iOS/APNs — este incremento es solo Android.

## Modelo de datos

Nueva tabla Prisma (modelo core, mismo patrón que `PushSubscription`; **no** es una tabla de módulo RME3, así que sí se edita `prisma/schema.prisma` + migración):

```prisma
model FcmDeviceToken {
  id          String    @id @default(uuid(7)) @db.Uuid
  userId      String    @db.Uuid @map("user_id")
  companyId   String?   @db.Uuid @map("company_id")
  token       String    @unique
  deviceLabel String?   @map("device_label")
  enabled     Boolean   @default(true)
  lastSeenAt  DateTime? @map("last_seen_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  user UserProfile @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, enabled])
  @@map("fcm_device_token")
}
```

Sin campo `platform`: el proyecto solo compila Android por ahora. Se añadiría si algún día se agrega iOS.

## Registro de token (API + SDK)

En `apps/api/src/routes/notifications.js`, calcado de `subscribeWebPush`/`unsubscribeWebPush`:

- `POST /notifications/subscriptions/fcm` — upsert por `token` único (igual que el upsert por `endpoint` de web push). Body: `{ token, deviceLabel? }`.
- `DELETE /notifications/subscriptions/fcm/:id` — borra la fila, verificando que pertenezca al usuario autenticado.

Nuevas funciones en `notification-service.js`: `subscribeFcm`/`unsubscribeFcm`, mismo esqueleto que las de web push (resolución de compañía activa, validación Zod, upsert/delete).

`packages/sdk` gana `notifications.subscribeFcm(input)` / `notifications.unsubscribeFcm(id)`.

El token nunca se registra desde Kotlin directamente contra la API: `RunlyMessagingService.onNewToken()` lo entrega al JS vía el mismo bus de eventos nativo que ya existe (`host_events`/`host_ack_events`, visto en `native/index.js`), y el JS —ya autenticado— llama a `notifications.subscribeFcm` la próxima vez que la app esté en foreground. Esto evita duplicar lógica de autenticación en Kotlin.

## Envío: extender el pipeline existente sin tocar cada productor

Todos los productores actuales de notificaciones (`call-service.js`, chat, proyectos, calendario, growth, ledger, pfm, notas) ya arman su lista `channels` incluyendo `"web_push"` cuando corresponde. En vez de tocar cada uno de esos call sites para añadir `"fcm"` a mano, la regla se centraliza en `notification-service.js#publish`: dentro del `allowedChannels.filter(...)`, cuando `"web_push"` pasa el filtro de preferencia `pushEnabled`, se añade también una fila de delivery `"fcm"` a la misma lista — mismo interruptor de preferencia del usuario, sin campo nuevo, sin tocar productores existentes. Esto da paridad total FCM/web_push tal como se acordó.

Nuevo `apps/api/src/services/fcm-service.js`, mismo rol que `web-push-service.js`:

- Dependencia nueva: `firebase-admin` en `apps/api/package.json` (Application Default Credentials vía `GOOGLE_APPLICATION_CREDENTIALS`, ya configurado — sin manejar OAuth a mano).
- `sendToToken({ token, payload })` — mensaje **data-only** (sin bloque `notification:` de FCM), con las mismas claves que ya arma `buildPushPayload` de `web-push-service.js` (title, body, tag, data.link, data.priority, data.eventType, etc.), para que Android construya la notificación con la misma información que hoy usa `HostNotifications.show`.
- Detecta tokens inválidos/no registrados (`messaging/registration-token-not-registered`, `messaging/invalid-registration-token`) igual que `isPermanentSubscriptionError` hace con HTTP 404/410 en web push, y marca `enabled: false` en `FcmDeviceToken`.

`notification-delivery-worker.js` gana un bloque `else if (channel === "fcm")`, calcado del de `web_push`: busca tokens activos del destinatario, envía a cada uno, cuenta éxitos/fallos, desactiva los tokens con fallo permanente, lanza error solo si todos fallaron (mismo criterio de "al menos una entrega exitosa" que ya usa web_push).

`apps/worker/src/index.js`: `const channels = ['email', 'web_push']` pasa a incluir `'fcm'`.

`call-service.js`: los dos lugares que drenan inmediatamente la cola de `web_push` para no esperar el tick del worker (líneas ~499 y ~872, llamadas entrantes) agregan también el drenado inmediato de `'fcm'`.

## Receptor nativo Android

Nuevo archivo `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/RunlyMessagingService.kt`, extiende `FirebaseMessagingService`:

- `onNewToken(token: String)` — entrega el token nuevo al JS vía el bus de eventos nativo existente (no llama a la API directamente).
- `onMessageReceived(message: RemoteMessage)` — payload data-only; reconstruye la notificación con la misma lógica de hash de id/canal/deep-link que hoy vive en `apps/desktop/src/native/notification-policy.js`, reimplementada en Kotlin (el JS no corre cuando el proceso está matado): usa `message.data["tag"]`, `message.data["link"]`, y el mismo criterio de canal — `eventType == "chat.call.incoming"` → `runly-calls-v1`, resto → `runly-alerts-v1` — mostrando la notificación con `NotificationCompat` igual que `HostNotifications.show`.

Registro en `AndroidManifest.xml` con el `intent-filter` estándar `com.google.firebase.MESSAGING_EVENT`.

## Manejo de errores y casos límite

- Usuario sin token FCM activo: la fila de delivery `fcm` falla con "Destinatario sin tokens FCM activos" tras agotar los reintentos configurados — mismo comportamiento que hoy tiene `web_push` sin suscripciones (no bloquea ni reintenta indefinidamente).
- Token inválido/desregistrado: se desactiva (`enabled: false`), igual que una suscripción web push con error permanente.
- Doble notificación mientras la app está viva y llega tanto por Realtime como por FCM: no se resuelve en este incremento (mismo riesgo ya documentado para web_push vs. realtime); Android reemplaza la notificación si coincide el `id` derivado del `tag`, así que en el peor caso hay una vibración doble, no una notificación duplicada.
- `GOOGLE_APPLICATION_CREDENTIALS` ausente o inválido en el entorno del worker: `fcm-service.js` falla al inicializar `firebase-admin`; el canal `fcm` queda inoperante pero no debe tumbar el resto del worker (mismo patrón defensivo que ya usa `web-push-service.js` con `configured: false`).

## Pruebas

Cobertura enfocada en la lógica nueva, no exhaustiva (canal `web_push` ya está probado y no se re-testea solo porque `fcm` lo espeja):

- `fcm-service.js`: envío exitoso, token inválido → desactivación, error de red/config → no configurado.
- `notification-service.js`: `publish()` agrega `fcm` cuando `web_push` pasa el filtro de preferencia; no lo agrega si `pushEnabled` es falso o el usuario está silenciado.
- `notification-delivery-worker.js`: canal `fcm` — éxito con un token, fallo total con todos los tokens inválidos, éxito parcial con varios tokens.
- `subscribeFcm`/`unsubscribeFcm`: upsert por token, borrado con verificación de propiedad.

Sin pruebas end-to-end de entrega real a un dispositivo (igual que la preparación de Firebase documentó: eso requiere un dispositivo físico y no es parte de esta verificación).

## Despliegue

Cambios de servidor (API + worker) y de cliente (nuevo build Android). `POST /modules/sync` no aplica — esto es código core, no un módulo RME3. Requiere migración de Prisma (`FcmDeviceToken`) y recompilación del APK para que el receptor Kotlin quede incluido.
