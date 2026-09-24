# PoC aislada de Piper TTS

Segunda alternativa evaluada para una futura función "leer en voz alta" en
MirAI (`runly.chat`), tras descartar `kokoro-onnx` por velocidad real medida.
**Ver `RESULTS.md` primero** — a diferencia de Kokoro, el resultado aquí es
positivo, pero todavía no se probó en el VPS KVM4 real ni se integró con
Runly.

No es un contenedor de producción — no toca Postgres, Supabase, ni ningún
servicio de Runly.

## Contenido

- `Dockerfile` — Python 3.11 + `espeak-ng` + `piper-tts`.
- `synth_test.py` — descarga una voz en español (una vez, cacheada en un
  volumen), sintetiza un texto de prueba con la sesión por defecto y,
  opcionalmente, con una sesión de ONNX Runtime propia (`intra_op_num_threads`
  explícito) para comparar. Mide tiempo de carga/síntesis y RAM real.

## Uso

```bash
docker build -t runly-piper-poc:latest scripts/poc-piper

MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" docker run --rm --cpus=1.5 --memory=2g \
  -v runly-poc-piper-cache:/models \
  -v "$(pwd)/scripts/poc-piper/output:/output" \
  runly-piper-poc:latest \
  --quality high --cpu-threads 2 --out-json /output/resultado.json
```

`--quality` acepta `x_low`/`medium`/`high` (voces `es_MX-ald-*`/`es_MX-claude-high`
de `rhasspy/piper-voices`). `--cpu-threads` es opcional — si se omite, solo
prueba la sesión por defecto.
