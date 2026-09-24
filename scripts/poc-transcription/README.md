# PoC aislada de faster-whisper (Etapa 1)

Corresponde a la **Etapa 1** de `docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md`. Es un experimento
autocontenido — no toca Postgres, Supabase, LiveKit ni ningún servicio de Runly. Su único
propósito es medir (no asumir) el comportamiento real de faster-whisper en CPU, dentro de un
contenedor con límites explícitos de recursos.

**No es el contenedor de producción `runly-transcriber`** (eso es la Etapa 2 en adelante). No se
conecta a ninguna base de datos, no reclama trabajos, no escribe en ningún lado salvo un archivo
JSON local de resultados.

Ver `RESULTS.md` en esta misma carpeta para la evidencia real ya ejecutada, sus limitaciones, y
qué falta validar en el VPS de destino.

## Contenido

- `Dockerfile` — Python 3.11 + `ffmpeg` + `faster-whisper` + `psutil`.
- `requirements.txt` — dependencias Python.
- `transcribe_test.py` — script que carga un modelo, transcribe un archivo de audio local, e
  imprime/guarda métricas reales (tiempo de carga, tiempo de transcripción, RAM pico, segmentos
  con marcas de tiempo).
- `generate_sample_audio.ps1` — genera un audio **sintético** en español (voz de Windows,
  `System.Speech`) para poder ejecutar la prueba sin depender de una grabación real de Runly. Ver
  la advertencia de la sección "Sobre el audio de prueba" más abajo.
- `sample-audio/`, `output/` — carpetas de trabajo, ignoradas por git (`.gitignore`).

## Uso

### 1. Construir la imagen

```bash
docker build -t runly-transcription-poc:latest scripts/poc-transcription
```

### 2. Obtener un archivo de audio

**Opción A — audio sintético (smoke test, sin datos reales):**

```powershell
cd scripts/poc-transcription
powershell -ExecutionPolicy Bypass -File generate_sample_audio.ps1 -OutPath sample-audio\sample_meeting_es.wav
```

Genera un diálogo corto en español (dos voces de Windows alternadas) leyendo un guion sintético
inspirado en el ejemplo del encargo original. Sirve para validar que el pipeline funciona de
extremo a extremo y obtener una primera cifra real — **no sustituye** la validación pedida con
audio real de una reunión.

**Opción B — audio real de una grabación de Runly (requiere autorización explícita):**

1. Descargar el archivo `.m3u8` + segmentos `.ts` de una grabación autorizada desde Supabase
   Storage (bucket `runly-chat`, prefijo `recordings/<conversationId>/<recordingId>/`) — esto
   requiere las credenciales `SUPABASE_S3_*` de la instancia, que **nunca deben imprimirse ni
   commitearse**.
2. Extraer solo el audio, sin recodificar el video innecesariamente:
   ```bash
   ffmpeg -i index.m3u8 -vn -acodec pcm_s16le -ar 16000 -ac 1 sample-audio/real_meeting.wav
   ```
3. Nunca commitear el archivo de audio resultante al repositorio — es contenido potencialmente
   privado de una reunión real. Usarlo solo localmente para esta prueba y borrarlo después.

### 3. Ejecutar la transcripción con límites de recursos explícitos

En Git Bash / MSYS (Windows), las rutas que empiezan con `/` se traducen automáticamente a rutas
de Windows salvo que se desactive esa conversión — por eso el prefijo `MSYS_NO_PATHCONV=1` es
necesario aquí (no es parte del contrato de la imagen, es una particularidad del shell).

```bash
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" docker run --rm --cpus=1.5 --memory=3g \
  -v runly-poc-whisper-cache:/root/.cache/huggingface \
  -v "$(pwd)/scripts/poc-transcription/sample-audio:/data:ro" \
  -v "$(pwd)/scripts/poc-transcription/output:/output" \
  runly-transcription-poc:latest \
  --audio /data/sample_meeting_es.wav \
  --model base \
  --compute-type int8 \
  --language es \
  --out-json /output/base-int8-es.json
```

En Linux/macOS, el comando es igual sin las variables `MSYS_*`.

Parámetros relevantes de `transcribe_test.py`:
- `--model`: `tiny`/`base`/`small`/`medium`/`large-v3` (empezar con `base`, comparar con `small`).
- `--compute-type`: `int8` (recomendado para CPU sin GPU), `float32` (más preciso, más lento/RAM).
- `--language`: forzar `es` evita el costo de autodetección y evita falsos positivos de idioma en
  audio corto; omitir para autodetección real.
- El volumen `runly-poc-whisper-cache` persiste el modelo descargado entre ejecuciones — sin él,
  cada `docker run` volvería a descargar el modelo desde Hugging Face.

### 4. Ajustar los límites de recursos

Los valores `--cpus=1.5 --memory=3g` son un punto de partida sugerido por el encargo original, no
un valor final. Repetir la prueba con distintos límites (ej. `--cpus=1 --memory=2g`) para entender
el punto de degradación antes de fijar los límites reales del contenedor de producción
(`deploy.resources.limits` en `infra/installer/docker-compose.yml`, Etapa 4 del plan).

## Sobre el audio de prueba — limitación reconocida

Esta intervención **no tuvo acceso autorizado a una grabación real de Runly** (ni al VPS de
producción, ni a credenciales de Supabase Storage de una instancia con reuniones grabadas) ni al
VPS KVM 4 de destino. Por eso:

1. El audio usado para las mediciones en `RESULTS.md` es **sintético** (voz de Windows leyendo un
   guion escrito para esta prueba), no una grabación real de una reunión.
2. Las mediciones se ejecutaron en **la máquina de desarrollo local**, no en el KVM 4. Docker
   Desktop en esa máquina reporta 16 CPUs / ~15.4 GiB asignados a su VM — muy distinto en núcleos
   (aunque similar en RAM) al KVM 4 real (4 vCPU / 16 GB), y con hardware de escritorio/portátil
   probablemente más rápido por núcleo que un vCPU de un VPS económico compartido.
3. El audio sintético dura ~59 segundos — muy por debajo de los 10-20 minutos de una reunión real
   que pide el criterio de aceptación de la Etapa 1.

**Estas tres limitaciones significan que las cifras de `RESULTS.md` demuestran que el pipeline
funciona y dan una primera señal de orden de magnitud, pero NO satisfacen por sí solas el
criterio de aceptación de la Etapa 1**, que exige audio real en el hardware de destino. Ese paso
sigue pendiente y requiere que alguien con acceso autorizado al VPS y a una grabación real lo
ejecute — los archivos de esta carpeta están listos para que ese paso sea un simple `docker build`
+ `docker run` con el audio real, sin más preparación.
