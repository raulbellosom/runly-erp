# runly-transcriber — servicio de transcripcion de llamadas.
# Ver apps/transcriber/main.py y docs/TRANSCRIPTION_SPEC.md.
FROM python:3.11-slim

# Sin esto, el stdout de un proceso Python de larga duracion dentro de Docker
# queda en un buffer de bloque completo (no linea por linea, como en una
# terminal real) y `docker logs`/`docker compose logs` no muestra nada hasta
# que el buffer se llena o el proceso termina — confirmado en produccion: el
# contenedor corria sano pero sin una sola linea de log, ni el mensaje de
# arranque inmediato.
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/transcriber/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/transcriber/main.py .

CMD ["python", "main.py"]
