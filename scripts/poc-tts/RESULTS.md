# Resultados reales — PoC de Kokoro TTS

**Fecha:** 2026-09-24
**Entorno:** máquina de desarrollo local de Windows (Docker Desktop/WSL2, 16 núcleos visibles). **No se probó en el VPS KVM4** — a diferencia de la PoC de transcripción, esta investigación se detuvo antes de llegar a esa validación porque el primer hallazgo ya es lo bastante negativo como para justificar una pausa y una decisión explícita antes de seguir invirtiendo tiempo.

**Motivación**: otra IA, en una conversación aparte, propuso integrar Kokoro TTS (hexgrad/Kokoro-82M) en MirAI para una función "leer en voz alta" on-demand, describiéndolo como "relativamente pequeño" y con buen desempeño. Antes de construir nada sobre Runly, se hizo esta PoC aislada — exactamente el mismo criterio aplicado a faster-whisper: no confiar en cifras de una fuente externa sin medir en hardware real.

## Verificación de los datos externos — correctos en lo básico

Antes de medir, se verificaron (vía búsqueda web) las afirmaciones de la otra IA:
- ✅ Licencia Apache-2.0, modelo real y de código abierto (`hexgrad/Kokoro-82M` en Hugging Face).
- ✅ 82 millones de parámetros, arquitectura StyleTTS2 + vocoder ISTFTNet.
- ✅ Las 3 voces en español citadas (`ef_dora`, `em_alex`, `em_santa`) existen tal cual, confirmadas en `VOICES.md` del repositorio oficial.
- ⚠️ Tamaño real por variante (release `model-files-v1.1` de `kokoro-onnx`): `kokoro-v1.0.onnx` 326MB (fp32), `.fp16.onnx` 164MB, `.int8.onnx` 114MB (cuantizado) + `voices-v1.0.bin` 28MB. La cifra de "~327MB" de la otra IA corresponde a la variante fp32, no a la cuantizada — coherente pero incompleto.
- ⚠️ **Dato que la otra IA no mencionó, encontrado en el propio model card**: a diferencia de otros idiomas soportados, las voces en español **no tienen documentadas métricas de calidad ni duración de entrenamiento** en `VOICES.md` — a diferencia de inglés/japonés/etc., que sí las tienen. Esto sugiere (no confirma) que el español podría ser un soporte de segunda categoría en este modelo.

## Medición real — hallazgo crítico que contradice la expectativa de "casi tiempo real"

Configuración común: modelo `int8` (114MB, la variante recomendada para CPU), texto de prueba de ~7.4s de audio resultante, voz `ef_dora`.

| Configuración | Factor de tiempo real | Tiempo real para 7.4s de audio |
|---|---|---|
| `--cpus=1.5` (mismo límite usado para Whisper) | **9.4x** | ~69 segundos |
| `--cpus=1.5` + `OMP_NUM_THREADS=2` | **9.4x** (sin cambio) | ~69 segundos |
| `--cpuset-cpus=0,1` (2 núcleos reales, no solo cupo de tiempo) | **6.8x** | ~50 segundos |
| Sin ningún límite de CPU (16 núcleos completos disponibles) | **1.8x** | ~13 segundos |

**Ningún escenario probado llega a tiempo real** (factor < 1.0) — ni siquiera con los 16 núcleos completos de esta máquina de desarrollo disponibles sin restricción.

## Por qué — y por qué no es el mismo arreglo que funcionó con Whisper

Se probó exactamente la misma hipótesis que resolvió (parcialmente) el caso de faster-whisper: que ONNX Runtime autodetecta hilos según los núcleos *visibles* del host, no el cupo real de CPU del contenedor. Se confirmó que el problema es el mismo tipo de causa, pero **el arreglo no está disponible aquí**:

- `OMP_NUM_THREADS` no tuvo ningún efecto — el build de `onnxruntime` que usa `kokoro-onnx` no lo respeta (no es un build basado en OpenMP).
- `--cpuset-cpus` (que si cambia cuántos núcleos ve el proceso, a diferencia de `--cpus`) mejoró el resultado (9.4x → 6.8x) pero generó errores de afinidad de hilos en los logs (`pthread_setaffinity_np failed ... mask: {14, 15}`) — ONNX Runtime intentó anclar hilos a núcleos del 0 al 15 aunque el cgroup solo permitía 2, confirmando que detecta la topología completa del host, no la del contenedor.
- La clase `Kokoro` de `kokoro-onnx` **no expone ningún parámetro** para pasar `SessionOptions` de ONNX Runtime (`intra_op_num_threads`, `inter_op_num_threads`) — a diferencia de `faster-whisper`, que sí expone `cpu_threads` directamente. Sin acceso a esa configuración, no hay una forma soportada de decirle a ONNX Runtime "usa solo N hilos" en este paquete tal cual está.

## Lo que NO se investigó todavía (quedó fuera de esta ronda, no se descartó por falta de mérito)

- Reemplazar la sesión interna de `Kokoro` con una `onnxruntime.InferenceSession` construida a mano con `SessionOptions` explícitas (viable en teoría, requiere modificar cómo se usa la librería, no es soportado directamente por su API pública).
- Probar `pykokoro` u otras variantes/forks de la comunidad que puedan exponer esa configuración.
- Medir en el propio VPS KVM4 (4 vCPU reales, no un límite artificial sobre 16) — dado que el hallazgo aquí ya es negativo, no se justificó gastar ese paso todavía sin antes decidir si vale la pena seguir por esta vía.
- Evaluar la calidad subjetiva de audio de las 3 voces en español (los archivos `.wav` sí se generaron correctamente y están en `output/` si se quieren escuchar) — irrelevante mientras el tiempo de generación no sea aceptable.

## Conclusión honesta

Con el paquete `kokoro-onnx` tal como está empaquetado hoy, en esta máquina, **la velocidad real está muy lejos de "casi tiempo real"** — la afirmación de la otra IA no se sostuvo con la medición. Aun en el mejor caso (sin ningún límite de CPU), sigue siendo casi 2 veces más lento que el audio que produce. En un KVM4 real, compartiendo 4 vCPU con LiveKit, Egress, Supabase, la API, el worker y (si se activa) el transcriptor de Whisper, es razonable esperar un resultado en el rango de los escenarios limitados medidos aquí (~7-50 segundos de espera por una respuesta corta de MirAI), no algo utilizable como botón "🔊 Leer en voz alta" con expectativa de respuesta rápida.

**Recomendación**: no seguir con esta integración usando `kokoro-onnx` tal cual, a menos que se invierta trabajo adicional en forzar la configuración de hilos de ONNX Runtime (ruta no probada, no garantizada) — y aun así, medir de nuevo antes de comprometerse. No se descarta Kokoro como modelo (la licencia y el tamaño siguen siendo atractivos), pero sí se descarta esta ruta de integración específica como una solución lista para usar sin más trabajo de ingeniería.
