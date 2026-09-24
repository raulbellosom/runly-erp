# PoC aislada de Kokoro TTS

Investigación de viabilidad para una futura función "leer en voz alta" en MirAI
(`runly.chat`), propuesta en una conversación con otra IA. **Ver `RESULTS.md`
primero** — el resultado medido contradice la expectativa inicial de "casi
tiempo real" y la investigación se detuvo ahí, sin llegar a probarse en el VPS
real ni a integrarse con Runly.

No es un contenedor de producción — no toca Postgres, Supabase, ni ningún
servicio de Runly.

## Contenido

- `Dockerfile` — Python 3.11 + `espeak-ng` (fonemizador requerido para español)
  + `kokoro-onnx` + `soundfile`.
- `synth_test.py` — descarga el modelo (una vez, cacheado en un volumen),
  sintetiza un texto de prueba con las 3 voces en español, mide tiempo de
  carga/síntesis y RAM real.
- `models/`, `output/` — carpetas de trabajo, ignoradas por git.

## Uso

```bash
docker build -t runly-tts-poc:latest scripts/poc-tts

MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" docker run --rm --cpus=1.5 --memory=2g \
  -v runly-poc-tts-cache:/models \
  -v "$(pwd)/scripts/poc-tts/output:/output" \
  runly-tts-poc:latest \
  --model-variant int8 --out-json /output/resultado.json
```

`--model-variant` acepta `fp32`/`fp16`/`int8` (recomendado para CPU). En Git
Bash/MSYS (Windows), `MSYS_NO_PATHCONV=1` evita que las rutas `/data`/`/output`
se traduzcan a rutas de Windows antes de llegar al contenedor.

En Linux/macOS, el mismo comando sin las variables `MSYS_*`.
