# PoC aislada de Kokoro TTS — evaluación de viabilidad para una futura funcion
# "leer en voz alta" en MirAI (runly.chat), on-demand, nunca en tiempo real.
# No es un contenedor de produccion — no toca Runly ni ningun servicio real.
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends espeak-ng libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY synth_test.py .

ENTRYPOINT ["python", "synth_test.py"]
