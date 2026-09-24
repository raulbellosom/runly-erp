# runly-transcriber — servicio de transcripcion de llamadas.
# Ver apps/transcriber/main.py y docs/TRANSCRIPTION_SPEC.md.
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/transcriber/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/transcriber/main.py .

CMD ["python", "main.py"]
