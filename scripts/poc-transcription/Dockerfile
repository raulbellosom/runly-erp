# PoC aislada de faster-whisper (Etapa 1 de docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md).
# No es el contenedor de produccion runly-transcriber (Etapa 2+) — este Dockerfile
# existe solo para medir rendimiento real en un entorno aislado, controlable con
# limites explicitos de CPU/RAM via `docker run --cpus --memory`.
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY transcribe_test.py .

ENTRYPOINT ["python", "transcribe_test.py"]
