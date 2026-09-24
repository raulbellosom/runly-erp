# PoC aislada de Piper TTS — segunda alternativa evaluada para una futura
# funcion "leer en voz alta" en MirAI, tras descartar kokoro-onnx por
# velocidad real medida (ver scripts/poc-tts/RESULTS.md).
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends espeak-ng libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY synth_test.py .

ENTRYPOINT ["python", "synth_test.py"]
