"""PoC aislada de faster-whisper — Etapa 1 de docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md.

Mide tiempo de carga del modelo, tiempo de transcripcion, RAM pico del proceso
y produce segmentos con marcas de tiempo, a partir de un archivo de audio local.

No toca Postgres, Supabase ni ningun servicio de Runly — es un experimento
aislado. Ver README.md de esta misma carpeta para instrucciones de uso.
"""

import argparse
import json
import os
import time

import psutil
from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe un archivo de audio local con faster-whisper y mide recursos reales."
    )
    parser.add_argument("--audio", required=True, help="Ruta al archivo de audio (dentro del contenedor).")
    parser.add_argument("--model", default="base", help="Tamano del modelo (tiny/base/small/medium/large-v3).")
    parser.add_argument("--compute-type", default="int8", help="int8, int8_float16, float16, float32.")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--cpu-threads", type=int, default=0, help="0 = valor por defecto de faster-whisper.")
    parser.add_argument("--language", default=None, help="Forzar idioma (ej. 'es'). Por defecto: autodeteccion.")
    parser.add_argument(
        "--no-condition-on-previous-text",
        action="store_true",
        help="Desactiva condition_on_previous_text (mitigacion conocida para bucles de repeticion "
        "de Whisper en audio real con silencios/ruido). Por defecto queda activado (comportamiento "
        "estandar de faster-whisper).",
    )
    parser.add_argument("--out-json", default=None, help="Ruta donde escribir el resultado completo en JSON.")
    args = parser.parse_args()

    proc = psutil.Process(os.getpid())

    def rss_mb():
        return proc.memory_info().rss / (1024 * 1024)

    print(f"[poc] Cargando modelo '{args.model}' (device={args.device}, compute_type={args.compute_type})...")
    t0 = time.monotonic()
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=args.cpu_threads or 0,
    )
    load_s = time.monotonic() - t0
    rss_after_load_mb = rss_mb()
    print(f"[poc] Modelo cargado en {load_s:.2f}s. RSS tras cargar: {rss_after_load_mb:.1f} MB")

    print(f"[poc] Transcribiendo '{args.audio}'...")
    t1 = time.monotonic()
    segments_iter, info = model.transcribe(
        args.audio,
        language=args.language,
        vad_filter=True,
        condition_on_previous_text=not args.no_condition_on_previous_text,
    )

    segments = []
    peak_rss_mb = rss_after_load_mb
    for seg in segments_iter:
        text = seg.text.strip()
        segments.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
        current_rss = rss_mb()
        if current_rss > peak_rss_mb:
            peak_rss_mb = current_rss
        print(f"[{seg.start:7.2f}s -> {seg.end:7.2f}s] {text}")
    transcribe_s = time.monotonic() - t1

    audio_duration = getattr(info, "duration", None)
    detected_language = getattr(info, "language", None)
    language_probability = getattr(info, "language_probability", None)

    result = {
        "audio_path": args.audio,
        "audio_duration_s": round(audio_duration, 2) if audio_duration else None,
        "model": args.model,
        "compute_type": args.compute_type,
        "device": args.device,
        "cpu_threads_requested": args.cpu_threads or "default",
        "language_forced": args.language,
        "condition_on_previous_text": not args.no_condition_on_previous_text,
        "detected_language": detected_language,
        "language_probability": round(language_probability, 3) if language_probability else None,
        "model_load_s": round(load_s, 3),
        "transcription_s": round(transcribe_s, 3),
        "realtime_factor": round(transcribe_s / audio_duration, 3) if audio_duration else None,
        "rss_after_load_mb": round(rss_after_load_mb, 1),
        "peak_rss_mb": round(peak_rss_mb, 1),
        "segment_count": len(segments),
        "segments": segments,
    }

    print("\n--- METRICS (ver tambien docker stats para el consumo del contenedor completo) ---")
    print(json.dumps({k: v for k, v in result.items() if k != "segments"}, ensure_ascii=False, indent=2))

    if args.out_json:
        os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\n[poc] Resultado completo escrito en {args.out_json}")


if __name__ == "__main__":
    main()
