"""PoC aislada de Kokoro TTS (hexgrad/Kokoro-82M, via kokoro-onnx).

Mide tiempo de descarga/carga del modelo, tiempo de sintesis, RAM pico, y
genera un .wav real por cada voz en espanol probada. No toca Postgres,
Supabase ni ningun servicio de Runly — experimento aislado, igual que
scripts/poc-transcription/.

Fuente verificada de tamanos de modelo (release model-files-v1.1 del repo
github.com/thewh1teagle/kokoro-onnx):
  kokoro-v1.0.onnx        326 MB (fp32)
  kokoro-v1.0.fp16.onnx   164 MB
  kokoro-v1.0.int8.onnx   114 MB (cuantizado)
  voices-v1.0.bin          28 MB (todas las voces, incluidas las 3 en espanol)
"""

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

import psutil
import soundfile as sf
from kokoro_onnx import Kokoro

RELEASE_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
MODEL_FILES = {
    "fp32": "kokoro-v1.0.onnx",
    "fp16": "kokoro-v1.0.fp16.onnx",
    "int8": "kokoro-v1.0.int8.onnx",
}
VOICES_FILE = "voices-v1.0.bin"

# Voces en espanol confirmadas en hexgrad/Kokoro-82M/VOICES.md — a diferencia
# de otros idiomas, el model card no documenta calidad/duracion de
# entrenamiento para estas 3, senal de que podrian sonar menos pulidas que las
# voces en ingles. Se evaluan las 3 para confirmar (o no) esa sospecha.
SPANISH_VOICES = ["ef_dora", "em_alex", "em_santa"]

SAMPLE_TEXT = (
    "Hola, soy MirAI. Puedo leer mis respuestas en voz alta cuando lo necesites, "
    "sin generar nada hasta que presiones el boton."
)


def download_if_missing(url, dest: Path):
    if dest.exists():
        return 0.0
    t0 = time.monotonic()
    print(f"[poc-tts] Descargando {dest.name}...")
    urllib.request.urlretrieve(url, dest)
    return time.monotonic() - t0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-variant", default="int8", choices=list(MODEL_FILES.keys()))
    parser.add_argument("--models-dir", default="/models")
    parser.add_argument("--out-dir", default="/output")
    parser.add_argument("--voices", nargs="+", default=SPANISH_VOICES)
    parser.add_argument("--text", default=SAMPLE_TEXT)
    parser.add_argument("--out-json", default=None)
    args = parser.parse_args()

    models_dir = Path(args.models_dir)
    out_dir = Path(args.out_dir)
    models_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    model_path = models_dir / MODEL_FILES[args.model_variant]
    voices_path = models_dir / VOICES_FILE

    proc = psutil.Process(os.getpid())

    def rss_mb():
        return proc.memory_info().rss / (1024 * 1024)

    download_s = download_if_missing(f"{RELEASE_BASE}/{MODEL_FILES[args.model_variant]}", model_path)
    download_s += download_if_missing(f"{RELEASE_BASE}/{VOICES_FILE}", voices_path)

    print(f"[poc-tts] Cargando Kokoro ({args.model_variant})...")
    t0 = time.monotonic()
    kokoro = Kokoro(str(model_path), str(voices_path))
    load_s = time.monotonic() - t0
    rss_after_load_mb = rss_mb()
    print(f"[poc-tts] Modelo cargado en {load_s:.2f}s. RSS tras cargar: {rss_after_load_mb:.1f} MB")

    results = []
    peak_rss_mb = rss_after_load_mb
    for voice in args.voices:
        print(f"[poc-tts] Sintetizando con voz '{voice}'...")
        t1 = time.monotonic()
        samples, sample_rate = kokoro.create(args.text, voice=voice, speed=1.0, lang="es")
        synth_s = time.monotonic() - t1
        current_rss = rss_mb()
        if current_rss > peak_rss_mb:
            peak_rss_mb = current_rss
        audio_duration_s = len(samples) / sample_rate
        out_path = out_dir / f"{voice}.wav"
        sf.write(str(out_path), samples, sample_rate)
        result = {
            "voice": voice,
            "synth_s": round(synth_s, 3),
            "audio_duration_s": round(audio_duration_s, 3),
            "realtime_factor": round(synth_s / audio_duration_s, 3) if audio_duration_s else None,
            "sample_rate": sample_rate,
            "out_path": str(out_path),
        }
        results.append(result)
        print(f"[poc-tts]   {json.dumps(result, ensure_ascii=False)}")

    metrics = {
        "model_variant": args.model_variant,
        "model_size_mb_on_disk": round(model_path.stat().st_size / (1024 * 1024), 1),
        "download_s": round(download_s, 3),
        "model_load_s": round(load_s, 3),
        "rss_after_load_mb": round(rss_after_load_mb, 1),
        "peak_rss_mb": round(peak_rss_mb, 1),
        "text": args.text,
        "voices": results,
    }

    print("\n--- METRICS ---")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))

    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(metrics, f, ensure_ascii=False, indent=2)
        print(f"\n[poc-tts] Resultado completo escrito en {args.out_json}")


if __name__ == "__main__":
    main()
