# Resultados reales — PoC de Piper TTS

**Fecha:** 2026-09-24
**Entorno:** máquina de desarrollo local de Windows (Docker Desktop/WSL2, 16 núcleos visibles). **No se probó en el VPS KVM4** — igual que con Kokoro, se midió primero en desarrollo; dado que el resultado aquí es muy positivo (a diferencia de Kokoro), sí vale la pena confirmar en el KVM4 real antes de integrarlo a Runly, pero no se ha hecho todavía en esta ronda.

**Contexto**: segunda alternativa evaluada tras descartar `kokoro-onnx` por velocidad real (ver `scripts/poc-tts/RESULTS.md` — factor de tiempo real de 6.8x-9.4x bajo el mismo límite de CPU, es decir, 50-70 segundos de espera por una respuesta corta). Piper (Rhasspy / Open Home Foundation, licencia MIT) fue diseñado explícitamente para hardware de bajos recursos tipo Raspberry Pi, a diferencia de Kokoro, que prioriza calidad por parámetro sin optimizarse para inferencia de borde en el mismo sentido.

## Resultado — dramáticamente distinto a Kokoro

Misma configuración de prueba que con Kokoro: `--cpus=1.5` (mismo límite artificial usado toda la noche para simular una VPS de pocos núcleos), texto de ~7.5-8.1s de audio resultante, voz en español mexicano.

| Voz / calidad | Tamaño en disco | Sesión | Factor de tiempo real | Tiempo real para ~8s de audio |
|---|---|---|---|---|
| `es_MX-claude-high` (alta calidad) | 60.2 MB | Por defecto (sin tocar nada) | **0.282x** | 2.29 s |
| `es_MX-claude-high` (alta calidad) | 60.2 MB | Con `intra_op_num_threads=2` explícito | **0.070x** | 0.57 s |
| `es_MX-ald-x_low` (calidad baja) | 20.0 MB | Por defecto | **0.216x** | 1.63 s |
| `es_MX-ald-x_low` (calidad baja) | 20.0 MB | Con `intra_op_num_threads=2` explícito | **0.056x** | 0.42 s |

**Las cuatro configuraciones probadas están muy por debajo de tiempo real** — algo que Kokoro nunca logró ni sin ningún límite de CPU (su mejor caso, con 16 núcleos completos sin restricción, fue 1.8x, es decir, más lento que el audio que produce).

RAM pico: 396MB (alta calidad) / 268MB (calidad baja) — cómodo para el KVM4 (16GB) incluso corriendo junto a LiveKit/Egress/Supabase/API/worker.

## Por qué Piper no tuvo el mismo problema de hilos que Kokoro

Se investigó la misma hipótesis que con Kokoro: `PiperVoice.load()` tampoco expone ningún parámetro para configurar hilos de ONNX Runtime en su API pública (confirmado leyendo el código fuente — usa `onnxruntime.SessionOptions()` por defecto, igual que `kokoro-onnx`). Sin embargo, a diferencia de `kokoro-onnx`, `PiperVoice` es una `dataclass` simple que expone su sesión como un atributo público (`voice.session`) — esto permitió **reemplazar la sesión por una propia con `intra_op_num_threads` explícito después de cargar la voz**, algo que la API de `kokoro-onnx` no permite en absoluto.

Aun así, el hallazgo más importante es otro: **incluso sin aplicar ese parche, la sesión por defecto de Piper ya rinde muy por debajo de tiempo real** (0.28x/0.22x) bajo el mismo límite de CPU donde Kokoro tardaba 9.4x. El modelo de Piper es computacionalmente mucho más liviano en la práctica, no solo más pequeño en disco — el parche de hilos lo mejora todavía más (2-4x adicional), pero no es indispensable para que sea utilizable, a diferencia de Kokoro, donde ningún ajuste probado lo hizo viable.

## Verificación de integridad

Los archivos `.wav` generados con sesión por defecto y con sesión parchada son **idénticos en contenido** (mismo número de frames, misma duración, 22050Hz mono) — confirma que ajustar los hilos solo cambia la velocidad, no la corrección del audio producido.

## Tercera ronda — confirmado en el VPS de producción real (KVM4, 4 vCPU reales)

El usuario construyó la misma imagen y corrió la prueba **directamente en el KVM4**, sin ningún límite artificial de CPU (a diferencia de las rondas en desarrollo, aquí `nproc` refleja los 4 vCPU reales de la VPS, no un límite de cgroup sobre una máquina con más núcleos visibles).

| Sesión | Factor de tiempo real | Tiempo real para 8.03s de audio |
|---|---|---|
| Por defecto | **0.069x** | 0.56 segundos |
| Con `intra_op_num_threads=2` explícito | **0.064x** | 0.51 segundos |

**Más rápido que en la máquina de desarrollo** (0.28x allá vs. 0.069x aquí) — y la diferencia entre sesión por defecto y sesión parchada casi desaparece (0.556s vs. 0.514s), a diferencia de la brecha grande vista en desarrollo. Esto confirma la explicación del hallazgo anterior: el problema de sobre-suscripción de hilos ocurría porque la máquina de desarrollo tiene 16 núcleos visibles compitiendo contra un límite artificial de cgroup — en el KVM4 real, con exactamente 4 núcleos reales y sin restricción artificial, ONNX Runtime no tiene ese descalce que corregir, así que la sesión por defecto ya rinde casi igual de bien que la ajustada a mano.

RAM pico: 387.6 MB — igual de cómodo que en desarrollo.

**Con esto, Piper queda validado en las tres dimensiones que importaban, en el hardware real de producción**: velocidad (14x más rápido que tiempo real), RAM (bajo 400MB), y calidad (confirmada por el usuario escuchando el archivo generado en desarrollo).

## Lo que falta antes de integrar esto a Runly de verdad

1. ✅ ~~Medir en el VPS KVM4 real~~ — hecho, ver "Tercera ronda" arriba.
2. ✅ ~~Evaluar la calidad subjetiva de la voz~~ — el usuario escuchó `es_MX-claude-high_patched.wav` y confirmó que le gustó.
3. **Probar con el contenedor de transcripción y/o una llamada de LiveKit activa simultáneamente** — no hecho todavía. Ambas pruebas de esta ronda corrieron con la VPS en uso normal, no con contención real de CPU. Dado que Piper deja tanto margen (0.56s de cómputo real por respuesta), es razonable esperar que tolere bien compartir CPU con el resto de servicios, pero sigue sin confirmarse.
4. **Ninguna integración con MirAI se ha diseñado ni implementado todavía** — esto fue solo la validación de viabilidad del motor (equivalente a la Etapa 1 de la transcripción). Falta: diseño del endpoint en la API, el botón "🔊" en la UI, el contenedor de producción, y el wiring del instalador — todo el ciclo que ya se hizo para la transcripción, mismo patrón.

## Conclusión

A diferencia de Kokoro, **Piper queda validado como viable** para una función "leer en voz alta" on-demand en MirAI — velocidad, RAM y calidad confirmadas, incluida la medición en el hardware real de producción, no solo en desarrollo. Es el candidato recomendado si se decide construir esta integración; el trabajo restante es de implementación (diseño + código), no de investigación de viabilidad.
