# Preparar Firebase para Android

Estado: proyecto Firebase creado por el usuario; los dos JSON locales coinciden con el proyecto y el paquete Android. Google Services y Firebase Messaging están integrados en el build; recepción personalizada, registro de tokens y envío desde Runly pendientes de implementación. Las variables de Runly que se documentan aquí no activan el flujo completo por sí solas. La web/PWA conserva su Web Push con VAPID.

## 1. Obtener el identificador del proyecto

En Firebase, abrir **Configuración del proyecto > General**. Copiar el **ID del proyecto**, no el nombre visible ni el número del proyecto, a `FIREBASE_PROJECT_ID` en el `.env` raíz.

## 2. Registrar la aplicación Android

En la descripción general del proyecto, elegir **Agregar app > Android**. Usar exactamente `com.racoondevs.runlyerp` como nombre del paquete. El apodo puede ser `Runly ERP Android`.

Descargar `google-services.json` y guardarlo en:

```text
D:/path/to/runly/.secrets/firebase/google-services.json
```

La variable `RUNLY_ANDROID_GOOGLE_SERVICES_JSON` del `.env` local apunta a esa ubicación. Este archivo contiene identificadores de configuración de Android, no la clave privada del servidor. El wrapper Android lee esta variable de `process.env`, con respaldo en el `.env` raíz, valida el paquete y el proyecto, rechaza claves privadas y copia el JSON al módulo Android antes de configurar/compilar. No exporta las credenciales del `.env` a Gradle. No copiar la credencial del siguiente paso a Android.

Gradle incorpora Google Services 4.5.0 y Firebase Messaging con BoM 34.19.0 cuando existe esa configuración. No se añade Analytics. Sin ruta configurada, el wrapper retira la copia de una compilación anterior y permite compilar sin Firebase. Para sincronizar desde Android Studio, ejecutar primero desde la raíz `node apps/desktop/scripts/native-host.mjs android config production` y después sincronizar Gradle. Ese comando no compila ni publica un APK.

Referencia: [Registrar Android y configurar el SDK](https://firebase.google.com/docs/android/setup).

## 3. Obtener la credencial para el servidor Runly

En **Configuración del proyecto > Cuentas de servicio > Firebase Admin SDK**, elegir **Generar nueva clave privada** y guardar el JSON descargado, renombrándolo a:

```text
D:/path/to/runly/.secrets/firebase/service-account.json
```

`GOOGLE_APPLICATION_CREDENTIALS` ya apunta a esa ubicación en el `.env` local. El JSON debe pertenecer al mismo proyecto que la configuración Android. No pegar su contenido en el chat ni incluirlo en el APK o en variables `VITE_`.

El servidor podrá autenticarse con este archivo mediante Application Default Credentials. No se necesita una clave de servidor de la API heredada de FCM.

Referencia: [Autenticación de FCM HTTP v1 con cuenta de servicio](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

## 4. Comprobar la API y completar el entorno

En Google Cloud Console, seleccionar el mismo proyecto y abrir **APIs y servicios > Biblioteca**. Buscar **Firebase Cloud Messaging API** y comprobar que esté habilitada.

El bloque local queda así, sustituyendo únicamente el ID:

```dotenv
RUNLY_FCM_ENABLED=false
FIREBASE_PROJECT_ID=tu-id-real-del-proyecto
GOOGLE_APPLICATION_CREDENTIALS=D:/path/to/runly/.secrets/firebase/service-account.json
RUNLY_ANDROID_GOOGLE_SERVICES_JSON=D:/path/to/runly/.secrets/firebase/google-services.json
```

Mantener `RUNLY_FCM_ENABLED=false` durante esta preparación. **Actualización 2026-09-24**: el interruptor ya tiene consumidor (`fcm-service.js`, mismo patrón kill-switch que `CHAT_MIRAI_WEB`) — con `false` explícito, el envío se desactiva aunque la credencial esté montada; sin la variable (o en `true`), el comportamiento sigue siendo el mismo de siempre: solo depende de que exista `GOOGLE_APPLICATION_CREDENTIALS`. En esta etapa de preparación, antes de tener la credencial real, el valor de la variable no cambia nada. No hay que migrar la autenticación, los datos ni las llamadas de Runly a Firebase para usar FCM.

## Archivos locales y producción

`.secrets/` contiene archivos persistentes de configuración; no es una carpeta temporal ni un resultado de build. Está excluida de Git y del contexto Docker, al igual que la copia Android de `google-services.json`. El `.env` real también está excluido. El repositorio contiene únicamente el ejemplo y esta guía.

Al desplegar la integración, la credencial privada debe provisionarse por separado en el servidor y montarse como archivo de solo lectura en el proceso/contenedor que envía los avisos. Allí `GOOGLE_APPLICATION_CREDENTIALS` debe apuntar a la ruta dentro del contenedor, por ejemplo `/run/secrets/firebase/service-account.json`. Una ruta Windows del entorno local no funciona dentro de un contenedor Linux. No se han modificado los despliegues con esta preparación.

### Instalador VPS actualizado

Los instaladores `setup-external.mjs` (incluido `--up-only`) y `setup-local.mjs` preparan `.secrets/firebase/` junto a sus archivos `.env.external` / `.env.local`, agregan las tres variables de servidor que falten y preservan sus valores existentes. Los bootstrap Bash/PowerShell descargan el helper y crean la carpeta. No generan ni descargan una clave privada de Firebase.

En ese VPS se necesita únicamente `service-account.json`. `google-services.json` permanece en la máquina que compila Android, a menos que también compiles el APK en el VPS. La carpeta `.secrets/firebase/` del instalador se monta en API y worker como `/run/secrets/firebase`, de solo lectura; no se monta en la web. Los perfiles local y external usan el mismo directorio del instalador: para proyectos Firebase distintos, usar instalaciones separadas.

Con estos scripts ya actualizados en el servidor, desde la carpeta del instalador puedes preparar solo Firebase, sin reiniciar servicios ni ejecutar migraciones:

```bash
node lib/firebase-config.mjs .env.external
```

Después copia mediante SFTP/SCP el JSON privado a `.secrets/firebase/service-account.json` dentro de esa carpeta y limita su lectura al usuario de despliegue (`chmod 600 .secrets/firebase/service-account.json` en Linux). Completa en `.env.external`:

```dotenv
RUNLY_FCM_ENABLED=true
FIREBASE_PROJECT_ID=tu-id-real-del-proyecto
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase/service-account.json
```

No copies el `.env` de Windows al VPS: las rutas y el resto de la configuración de producción son diferentes. El instalador utiliza la ruta de contenedor indicada arriba; cuando FCM está habilitado valida que exista una cuenta de servicio con clave RSA y proyecto coincidente antes de iniciar Runly. **Actualización 2026-09-24**: el runtime FCM (envío desde la cola, endpoints de suscripción, receptor Android) ya está implementado y su migración (`20260921010000_fcm_device_token`) ya se verificó aplicada contra la base de datos de desarrollo real — lo que falta es republicar/redesplegar esos servicios en este VPS con la credencial real montada, y compilar+instalar un APK que incluya el receptor, para ver una notificación de llamada real llegar en segundo plano en un dispositivo físico.

La configuración Android se utiliza al compilar y sus identificadores quedan en la app; la cuenta de servicio permanece exclusivamente en el servidor. Cambiar las variables de entorno del servidor no configura un APK ya instalado.

## Trabajo posterior a esta preparación

Integrar el registro y renovación de tokens por instalación, el envío desde la cola de Runly, el receptor Android y las acciones de llamada; compilar e instalar un APK nuevo y probar en un dispositivo real con la app en segundo plano. FCM avisa de la llamada; LiveKit sigue transportando audio y video. La presentación de llamada y su continuidad al bloquear la pantalla requieren su propia integración nativa.

El soporte iOS nativo requiere configurar Apple/APNs y, para llamadas VoIP, PushKit/CallKit. Estos dos archivos Android/servidor no habilitan por sí solos el soporte iOS.

## Verificación del build — 2026-09-13

- Los dos JSON locales coinciden en proyecto y el paquete Android es el esperado; el ID del `.env` también coincide. No se imprimieron claves privadas ni se enviaron notificaciones reales.
- Pasan cinco pruebas de preparación Firebase (aislamiento de credenciales, proyecto/paquete, configuración inválida y retirada de configuración anterior) y doce pruebas existentes del host y las notificaciones.
- Gradle completó `:app:processArm64DebugGoogleServices` y `:app:compileArm64DebugKotlin`, excluyendo `rustBuildArm64Debug`. El compilador Kotlin recurrió a su mecanismo alternativo tras errores del daemon local y terminó con `BUILD SUCCESSFUL`.
- Esta validación no genera un nuevo APK distribuible ni prueba entrega FCM en un dispositivo; tampoco despliega cambios en producción.
- Automatización VPS: pasan 23 pruebas del instalador, incluidos preservación de variables, validación de credenciales y ocho combinaciones de Compose (local/external, Office y red Linux). La preparación se ejecutó también sobre los archivos de entorno locales del instalador sin iniciar contenedores ni modificar el VPS.
