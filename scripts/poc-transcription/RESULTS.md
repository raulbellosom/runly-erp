# Resultados reales — PoC de faster-whisper (Etapa 1)

**Fecha de ejecución:** 2026-09-23 (rondas 1-2, máquina de desarrollo) y 2026-09-24 (ronda 3, VPS
de producción KVM4 real, ejecutada por el usuario siguiendo instrucciones — ningún agente/asistente
tuvo ni necesitó acceso remoto a esa VPS).

**Entornos de ejecución:**
- Rondas 1-2: máquina de desarrollo local de Windows (Docker Desktop / WSL2, backend reporta 16
  CPUs / ~15.4 GiB asignados a la VM de Docker).
- Ronda 3: **el VPS KVM4 real de producción** (`nproc` → 4, `free -h` → 15Gi total, confirmado en
  el momento de la prueba) — ver "Tercera ronda" más abajo.

**Audio de prueba:**
- Rondas 1: sintético, generado con `generate_sample_audio.ps1` (voces de Windows `Microsoft Sabina
  Desktop`/`Microsoft Helena Desktop`, es-MX/es-ES), ~59.36 segundos, 16kHz mono PCM16.
- Rondas 2-3: real, proporcionado por el usuario (~71 segundos) — mismo archivo en ambas rondas, lo
  que permite una comparación directa de la misma grabación en dos máquinas distintas.

Sigue pendiente, y se documenta explícitamente como tal (el encargo original prohíbe presentar
mediciones como representativas de algo no probado): una reunión real de duración típica (10-20
minutos, el usuario no dispone de una así todavía) y una prueba con una llamada/grabación de
LiveKit activa compitiendo por CPU en el KVM4. Lo que sigue son cifras reales de cada ejecución
concreta, no estimaciones.

## Configuración común

- Imagen: `runly-transcription-poc:latest`, construida desde `scripts/poc-transcription/Dockerfile`
  (`python:3.11-slim` + `ffmpeg` + `faster-whisper==1.2.1` vía `requirements.txt`).
- Límites del contenedor: `--cpus=1.5 --memory=3g` (valor inicial sugerido en el encargo original).
- `--compute-type int8`, `--device cpu`, `--language es` (forzado, para no medir el costo de
  autodetección en un audio tan corto).
- Caché del modelo persistida en un volumen Docker con nombre (`runly-poc-whisper-cache`) entre
  ejecuciones.

## Resultado — modelo `base`

Comando ejecutado (ver `README.md` para el comando completo con los volúmenes):

```
--audio /data/sample_meeting_es.wav --model base --compute-type int8 --language es
```

| Métrica | Valor |
|---|---|
| Duración del audio | 59.36 s |
| Tiempo de carga del modelo (caché tibia, tras una descarga previa) | 0.88 s |
| Tiempo de transcripción | 6.85 s |
| **Factor de tiempo real** (transcripción / duración audio) | **0.115** (~8.7× más rápido que tiempo real) |
| RAM tras cargar el modelo | 442.7 MB |
| RAM pico durante transcripción | 620.3 MB |
| Idioma detectado | es (probabilidad 1.0 — forzado) |
| Segmentos generados | 10 |

Texto resultante (íntegro, sin editar):

```
[   0.00s ->    5.38s] Buenos días a todos, gracias por unirse a esta reunión de seguimiento del proyecto.
[   5.38s ->   11.82s] Buenos días Raúl, acuí estamos. Empezamos revisando los pendientes del
[  11.82s ->   18.90s] modulo de inventario. Sí, exactamente. Necesitamos revisar los pendientes del
[  18.90s ->   24.22s] proyecto antes del viernes. Yo puedo encargarme de realizar las pruebas de esa
[  24.22s ->   30.18s] parte esta semana. Perfecto, entonces lo revisamos Manana por la tarde para
[  30.18s ->   36.52s] confirmar avances. De acuerdo. También quería mencionar que el cliente pidió una
[  36.52s ->   42.96s] demostración la próxima semana. Buena idea, vamos a proponer el próximo viernes a las
[  42.96s ->   49.24s] diez de la Manana para esa demostración. Me parece bien, yo preparo la agenda y se las
[  49.24s ->   56.84s] comparto por correo. Excelente, entonces quedamos así. Gracias a todos por su tiempo,
[  56.84s ->   58.36s] nos vemos Manana.
```

## Resultado — modelo `small` (primera ejecución, incluye descarga del modelo)

| Métrica | Valor |
|---|---|
| Tiempo de carga del modelo (incluye descarga ~484MB) | 40.76 s |
| Tiempo de transcripción | 18.47 s |
| Factor de tiempo real | 0.311 (~3.2× más rápido que tiempo real) |
| RAM tras cargar el modelo | 1183.3 MB |
| RAM pico durante transcripción | 1455.0 MB |
| Segmentos generados | 13 |

## Resultado — modelo `small` (segunda ejecución, caché tibia — comparación justa con `base`)

| Métrica | Valor |
|---|---|
| Tiempo de carga del modelo | 2.40 s |
| Tiempo de transcripción | 18.26 s |
| Factor de tiempo real | 0.308 (~3.2× más rápido que tiempo real) |
| RAM pico durante transcripción | 1281.3 MB |
| Segmentos generados | 13 |

Texto resultante (íntegro, sin editar):

```
[   0.00s ->    5.50s] Buenos días a todos, gracias por unirse a esta reunión de seguimiento del proyecto.
[   6.30s ->    8.80s] Buenos días Raúl, a cuy estamos.
[   9.60s ->   13.10s] Empezamos revisando los pendientes del módulo de inventario.
[  13.90s ->   15.70s] Sí, exactamente.
[  16.50s ->   20.70s] Necesitamos revisar los pendientes del proyecto antes del viernes.
[  21.60s ->   25.50s] Yo puedo encargarme de realizar las pruebas de esa parte esta semana.
[  26.30s ->   31.50s] Perfecto, entonces lo revisamos manana por la tarde para confirmar avances.
[  32.40s ->   33.20s] De acuerdo.
[  34.10s ->   38.60s] También quería mencionar que el cliente pidió una demostración la próxima semana.
[  39.50s ->   45.50s] Buena idea, vamos a proponer el próximo viernes a las 10 de la manana para esa demostración.
[  46.40s ->   50.60s] Me parece bien, yo preparo la agenda y se las comparto por correo.
[  51.40s ->   54.30s] Excelente, entonces quedamos así.
[  54.30s ->   58.60s] Gracias a todos por su tiempo, nos vemos manana.
```

## Comparación `base` vs. `small`

| | `base` | `small` (caché tibia) | Diferencia |
|---|---|---|---|
| Tiempo de transcripción | 6.85 s | 18.26 s | `small` ~2.7× más lento |
| Factor de tiempo real | 0.115 | 0.308 | ambos muy por debajo de 1.0 (más rápido que tiempo real) |
| RAM pico | 620 MB | 1281 MB | `small` ~2.1× más RAM |
| Segmentación | Agrupa varias oraciones por segmento (frases largas de 5-7s) | Segmenta más fino, más cercano a límites de oración | `small` produce segmentos más naturales |
| Calidad del texto | Errores puntuales ("acuí", "Manana" sin ñ) | Errores similares, ligeramente distintos ("a cuy" en vez de "acuí") | Ninguno de los dos es perfecto sobre este audio sintético — ver limitación abajo |

**Nota sobre los errores de reconocimiento**: los errores observados (p. ej. "aquí" transcrito como
"acuí"/"a cuy", "mañana" sin ñ) son consistentes en ambos modelos, lo que sugiere que el problema
está más en cómo la voz sintética de Windows pronuncia esas palabras que en una limitación de
faster-whisper — una voz humana real probablemente no cometería ese error de pronunciación en
primer lugar. Esta es precisamente la razón por la que el criterio de aceptación de la Etapa 1
exige audio real, no sintético: la calidad medida aquí no es un proxy confiable de la calidad
esperada sobre habla humana real.

## Segunda ronda — audio real proporcionado por el usuario

El usuario proporcionó un archivo real (`Grabación 22 sep 2026, 09_28 p.m..mp4`, ~71 segundos,
video 1280×720 + audio AAC 44.1kHz estéreo — consistente con el formato que produce hoy LiveKit
Egress en composición de sala completa) para poder probar con habla humana real en vez de voz
sintética. **Nota de privacidad**: el contenido de esa grabación es una conversación real. Se
extrajo solo el audio (nunca se commiteó el video ni el audio al repositorio — ambos se procesaron
y luego se borraron de esta carpeta), y **el texto transcrito no se reproduce aquí**, siguiendo la
política de privacidad del repositorio (`docs/REPOSITORY_PRIVACY.md`) — se reportan únicamente
métricas cuantitativas y una caracterización cualitativa general, sin contenido literal.

Esto sigue sin ser el VPS KVM 4 (misma limitación de máquina que la ronda anterior), pero sí es la
primera medición de esta PoC sobre habla humana real, con ruido/eco/acústica de sala reales — un
paso significativamente más cercano a las condiciones reales que el audio sintético.

| Configuración | Tiempo de transcripción | Factor tiempo real | RAM pico | Segmentos | Coherencia observada |
|---|---|---|---|---|---|
| `base`, int8, `condition_on_previous_text=True` (default) | 31.48 s | 0.444 | 739.6 MB | 14 | **Baja** — bucle de repetición literal de un token ("y y y y..." por ~3.4s) y varios tramos de texto sin sentido gramatical en español |
| `base`, int8, `condition_on_previous_text=False` | 30.87 s | 0.435 | 753.2 MB | 20 | **Peor aún** — más alucinaciones (exclamaciones sin relación con el contexto, nuevos bucles de repetición como "se grabó y se grabó y se grabó"). La hipótesis de que desactivar este parámetro mejoraría la calidad **no se confirmó** — quedó descartada con evidencia real, no solo teórica |
| `small`, int8, `condition_on_previous_text=True` (default) | **19.97 s** | 0.282 | 1218.3 MB | 33 | **Notablemente mejor** — sin bucles de repetición, sin exclamaciones inventadas, oraciones en español gramaticalmente coherentes de principio a fin. Algunos tramos puntuales con palabras dudosas, pero la estructura general es utilizable como base de una transcripción real |

**Hallazgo real más importante de esta ronda**: sobre audio limpio y sintético (ronda 1), `base`
fue más rápido y con calidad aparentemente aceptable, lo que habría sugerido usarlo como modelo por
defecto. **Sobre audio real con ruido/acústica de sala, `small` no solo tuvo mejor calidad —
también fue más rápido** (19.97s vs. 30-31s de `base`), probablemente porque los bucles de
repetición de `base` en audio difícil consumen tiempo de decodificación extra generando texto
inútil. Esto es exactamente el tipo de resultado contraintuitivo que esta etapa existía para
descubrir — decidir el modelo por defecto únicamente con audio sintético limpio habría llevado a
una recomendación equivocada.

**Alcance de esta ronda, sin exagerar su validez**: una sola grabación de ~71 segundos, una sola
persona explicando principalmente la función de grabación de Runly (contenido con vocabulario
técnico y coloquial mezclado). No es una muestra representativa de todos los tipos de reunión
(varias personas, superposición de voces, acentos distintos, diferente calidad de micrófono) — solo
es evidencia real de que la brecha `base` vs. `small` en audio real puede ser mucho mayor de lo que
sugiere el audio sintético, y que **`small` es, con esta evidencia, la recomendación provisional
más razonable para producción**, no `base`. Esto reemplaza la recomendación provisional de la ronda
1 (que favorecía `base` por ser más rápido sobre audio limpio).

## Tercera ronda — mismo audio real, ejecutado en el VPS de producción real (KVM4)

El usuario construyó la misma imagen y corrió las mismas pruebas **directamente en el VPS KVM4
real** (no en un entorno de staging), usando el mismo comando y el mismo audio real de la segunda
ronda (~71s). Hardware confirmado en el momento de la prueba: `nproc` → 4, `free -h` → 15Gi total,
~948Mi libre / ~12Gi disponible (buff/cache incluido) antes de correr la prueba — coincide con el
KVM4 descrito (4 vCPU / 16GB).

**Importante sobre el proceso**: esta ronda se ejecutó de forma segura porque es un experimento
Docker completamente aislado (`scripts/poc-transcription/`) — no toca `docker-compose.yml`, no usa
`update-local.sh`, no reinicia ningún servicio de Runly. El usuario copió a mano los 3 archivos
necesarios (`Dockerfile`, `requirements.txt`, `transcribe_test.py`) y construyó/corrió el
contenedor de forma independiente, exactamente igual que en las rondas anteriores.

| Configuración | Mi máquina de desarrollo (16 núcleos visibles) | KVM4 real (4 núcleos visibles) |
|---|---|---|
| `small`, int8, tiempo de transcripción | 19.97 s | 20.78 s |
| `small`, int8, RAM pico | 1218.3 MB | 717.6 MB |
| `base`, int8, tiempo de transcripción | 30.87-31.48 s | 35.29 s |
| `base`, int8, RAM pico | 739.6-753.2 MB | 325.6 MB |

**Hallazgo operativo real, no anticipado**: con el mismo límite `--cpus=1.5`, el tiempo de
transcripción fue muy similar entre ambas máquinas para `small` pero notablemente más lento para
`base` en el KVM4 real, mientras que el consumo de RAM fue sustancialmente **menor** en el KVM4
para ambos modelos. La explicación más probable: `--cpus` limita el *tiempo* de CPU asignado al
contenedor, pero no reduce cuántos núcleos *ve* el proceso por dentro (`nproc` dentro del
contenedor refleja el host, no el límite de cgroup). En mi máquina, con 16 núcleos visibles,
faster-whisper (que por defecto autodetecta el número de hilos según los núcleos visibles) lanzó
más hilos de los que el cupo de 1.5 CPU realmente puede ejecutar en paralelo — eso infla el uso de
RAM (buffers internos por hilo) y, en el caso de `base` en el KVM4 (solo 4 núcleos visibles, más
cercano a la relación real hilos/cupo), la contención entre hilos parece haber costado más tiempo
que en mi máquina, donde el sistema operativo tenía más margen para repartir el tiempo de CPU
disponible entre muchos hilos ociosos.

**Implicación concreta para producción**: fijar `--cpu-threads` explícitamente (no dejarlo en
automático) al configurar el contenedor `runly-transcriber` real, en vez de confiar en la
autodetección — de forma que el número de hilos coincida con el límite de CPU real asignado al
contenedor, no con los núcleos visibles del host. Esto queda como un parámetro concreto a validar
en la Etapa 2/4 del plan de implementación (ver nota agregada ahí), no algo que se pueda decidir
solo con esta evidencia — faltaría repetir esta misma comparación fijando `--cpu-threads 1` o `2`
explícitamente en ambas máquinas para confirmar la hipótesis con más certeza.

**Confirmación cualitativa**: el patrón observado en la segunda ronda (`base` con alucinaciones y
bucles de repetición, `small` con texto coherente y sin bucles) se reprodujo de forma consistente
en el hardware real — mismo tipo de errores, mismas fortalezas relativas. Esto refuerza la
recomendación provisional de usar `small` como modelo por defecto, ahora confirmada tanto en un
entorno de desarrollo como en el hardware de producción real.

## Qué queda pendiente (criterios de aceptación de la Etapa 1 aún no satisfechos)

Según `docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md`, Etapa 1:

1. ✅ **¿Puede faster-whisper ejecutarse en CPU dentro de un presupuesto de recursos acotado?** —
   Sí, confirmado con límites explícitos (`--cpus=1.5 --memory=3g`), tanto en desarrollo como
   **en el KVM4 real** (tercera ronda).
2. 🟡 **¿Cuánto tarda en transcribir una reunión real?** — Medido sobre un clip real corto (71s)
   **en el KVM4 real**: `small` transcribió en ~20.8s (factor 0.29). Sigue pendiente confirmar con
   una reunión de duración típica (10-20 minutos) — el usuario no dispone todavía de una grabación
   real tan larga; una llamada corta no permite descartar que el factor de tiempo real empeore con
   audio más largo o con más participantes hablando.
3. 🟡 **¿Qué calidad de reconocimiento obtenemos en español?** — Evaluado con habla humana real
   tanto en desarrollo como en el KVM4 real, con el mismo patrón en ambos: `base` produce bucles de
   repetición y alucinaciones — poco utilizable tal cual; `small` produce texto coherente y
   gramaticalmente correcto, con errores puntuales pero utilizable como borrador. Sigue pendiente
   confirmar con más muestras (distintas voces, acentos, calidad de micrófono, superposición de
   hablantes) antes de generalizar más allá de esta única grabación.
4. ✅ **¿Qué diferencia existe entre `base` y `small`?** — Medido en tres condiciones distintas
   (sintético/local, real/local, real/KVM4), con un resultado consistente en las dos últimas:
   **sobre audio real, `small` es mejor en calidad y no más lento que `base`** (en el KVM4 real,
   incluso fue notablemente más rápido: 20.8s vs. 35.3s) — la recomendación provisional es `small`,
   no `base`, confirmada ahora en el hardware de producción real.
5. ⏳ **¿Qué impacto podría tener sobre otros servicios de Runly?** — Aún no evaluado: la tercera
   ronda corrió con la VPS en un estado normal de uso, no con una llamada/grabación de LiveKit
   activa compitiendo por los mismos 4 vCPU. Sigue pendiente repetir con una llamada real en curso,
   replicando el escenario de la sección 4.2 del encargo original.
6. 🟡 **¿Qué configuración inicial usaríamos para el contenedor de producción?** — Recomendación
   provisional, ahora confirmada en el KVM4 real: **`small`, int8, `condition_on_previous_text=True`
   (default)**. Se descartó explícitamente desactivar `condition_on_previous_text` (empeoró el
   resultado en ambas máquinas). Se identificó un parámetro adicional a fijar en producción:
   **`--cpu-threads` explícito** (no dejarlo en automático), para que el número de hilos de
   faster-whisper coincida con el límite real de CPU del contenedor y no con los núcleos visibles
   del host — ver "Tercera ronda" arriba para el razonamiento completo. Sigue siendo provisional:
   una sola muestra corta y un solo hablante no bastan para fijarlo como decisión final.

**Conclusión de esta intervención**: el pipeline técnico (contenedor Docker, límites de recursos,
faster-whisper en CPU con INT8) funciona de extremo a extremo con audio sintético, con audio humano
real en desarrollo, y **con audio humano real en el propio VPS de producción (KVM4)** — sin que
esto haya requerido acceso remoto de un agente/asistente a esa VPS en ningún momento; el usuario
ejecutó los comandos directamente y compartió los resultados. Dos hallazgos no anticipados: (1) la
calidad relativa de `base` vs. `small` se invierte entre audio limpio y audio real, y (2) el número
de hilos de CPU visible por el contenedor (no solo el límite de `--cpus`) afecta tanto el consumo
de RAM como el tiempo de transcripción — ambos son exactamente el tipo de resultado contraintuitivo
que esta etapa buscaba descubrir antes de comprometerse a una configuración de producción. La
Etapa 1 sigue sin poder declararse completada al 100%: falta una reunión real de duración típica
(10-20 min, pendiente de que exista una grabación así) y una prueba de contención con una
llamada/grabación de LiveKit activa — ambos pasos quedan documentados como pendientes concretos,
no como bloqueantes indefinidos.
