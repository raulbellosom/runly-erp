# runly-tts — servicio de texto a voz para "leer en voz alta" en MirAI.
# Ver apps/tts/main.py y scripts/poc-piper/RESULTS.md (validacion real).
FROM python:3.11-slim

# Aplicado desde el dia uno esta vez — lo aprendimos con runly-transcriber en
# produccion: sin esto, un proceso Python de larga duracion en Docker deja su
# stdout en buffer de bloque completo y `docker compose logs` no muestra nada
# hasta que el buffer se llena o el proceso termina.
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends espeak-ng libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/tts/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Voz horneada en la imagen en build time, no descargada en runtime: es un
# unico archivo pequeno (~63MB) y fijo para V1 (una sola voz, sin selector en
# la UI) — a diferencia de WHISPER_MODEL (configurable, varios tamanos
# posibles), no hay razon para pagar el costo de un volumen compartido ni una
# descarga en el primer arranque. Fuente verificada: rhasspy/piper-voices en
# Hugging Face (misma que valido scripts/poc-piper).
RUN mkdir -p /app/voices \
    && python -c "import urllib.request; \
base='https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high'; \
urllib.request.urlretrieve(base + '.onnx', '/app/voices/es_MX-claude-high.onnx'); \
urllib.request.urlretrieve(base + '.onnx.json', '/app/voices/es_MX-claude-high.onnx.json')"

COPY apps/tts/main.py .

CMD ["python", "main.py"]
