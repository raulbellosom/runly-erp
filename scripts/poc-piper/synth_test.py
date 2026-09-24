"""PoC aislada de Piper TTS (rhasspy/piper-voices, paquete piper-tts).

Mide tiempo de descarga/carga, tiempo de sintesis, RAM pico, y genera un .wav
real. No toca Postgres, Supabase ni ningun servicio de Runly.

A diferencia de kokoro-onnx, PiperVoice es una dataclass simple que guarda su
sesion de ONNX Runtime en `self.session` — esto permite reemplazarla por una
sesion propia con `intra_op_num_threads` explicito, algo que no era posible
con la API publica de kokoro-onnx. Este script prueba AMBOS casos (sesion por
defecto vs. sesion con hilos acotados) para saber si eso resuelve aqui el
mismo problema de sobre-suscripcion de hilos que encontramos con Kokoro.

Fuente verificada de tamanos de modelo (rhasspy/piper-voices en Hugging Face,
carpeta es/es_MX):
  es_MX-ald-x_low.onnx     ~21.0 MB (calidad baja, 16kHz)
  es_MX-ald-medium.onnx    ~63.2 MB (calidad media, 22.05kHz)
  es_MX-claude-high.onnx   ~63.1 MB (calidad alta, 22.05kHz)
"""

import argparse
import json
import os
import time
import urllib.request
import wave
from pathlib import Path

import onnxruntime
import psutil
from piper import PiperVoice

HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX"

VOICE_PATHS = {
    "x_low": "ald/x_low/es_MX-ald-x_low",
    "medium": "ald/medium/es_MX-ald-medium",
    "high": "claude/high/es_MX-claude-high",
}

SAMPLE_TEXT = (
    "Hola, soy MirAI. Puedo leer mis respuestas en voz alta cuando lo necesites, "
    "sin generar nada hasta que presiones el boton."
)


def download_if_missing(url, dest: Path):
    if dest.exists():
        return 0.0
    t0 = time.monotonic()
    print(f"[poc-piper] Descargando {dest.name}...")
    urllib.request.urlretrieve(url, dest)
    return time.monotonic() - t0


def rss_mb(proc):
    return proc.memory_info().rss / (1024 * 1024)


def synthesize_and_time(voice, text, out_path, proc, peak_rss_mb):
    t0 = time.monotonic()
    with wave.open(str(out_path), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    synth_s = time.monotonic() - t0
    current_rss = rss_mb(proc)
    peak_rss_mb = max(peak_rss_mb, current_rss)
    with wave.open(str(out_path), "rb") as wav_file:
        audio_duration_s = wav_file.getnframes() / wav_file.getframerate()
    return synth_s, audio_duration_s, peak_rss_mb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quality", default="high", choices=list(VOICE_PATHS.keys()))
    parser.add_argument("--models-dir", default="/models")
    parser.add_argument("--out-dir", default="/output")
    parser.add_argument("--text", default=SAMPLE_TEXT)
    parser.add_argument("--cpu-threads", type=int, default=None,
                         help="Si se da, ademas de la sesion por defecto, prueba una sesion con este numero de hilos explicito.")
    parser.add_argument("--out-json", default=None)
    args = parser.parse_args()

    models_dir = Path(args.models_dir)
    out_dir = Path(args.out_dir)
    models_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    voice_rel = VOICE_PATHS[args.quality]
    voice_name = voice_rel.split("/")[-1]
    model_path = models_dir / f"{voice_name}.onnx"
    config_path = models_dir / f"{voice_name}.onnx.json"

    proc = psutil.Process(os.getpid())

    download_s = download_if_missing(f"{HF_BASE}/{voice_rel}.onnx", model_path)
    download_s += download_if_missing(f"{HF_BASE}/{voice_rel}.onnx.json", config_path)

    print(f"[poc-piper] Cargando voz '{voice_name}' (sesion por defecto)...")
    t0 = time.monotonic()
    voice = PiperVoice.load(str(model_path), config_path=str(config_path))
    load_s = time.monotonic() - t0
    rss_after_load_mb = rss_mb(proc)
    peak_rss_mb = rss_after_load_mb
    print(f"[poc-piper] Voz cargada en {load_s:.2f}s. RSS tras cargar: {rss_after_load_mb:.1f} MB")

    out_path_default = out_dir / f"{voice_name}_default.wav"
    synth_s, audio_s, peak_rss_mb = synthesize_and_time(voice, args.text, out_path_default, proc, peak_rss_mb)
    default_result = {
        "session": "default (sin configurar hilos, comportamiento estandar de la API publica)",
        "synth_s": round(synth_s, 3),
        "audio_duration_s": round(audio_s, 3),
        "realtime_factor": round(synth_s / audio_s, 3) if audio_s else None,
        "out_path": str(out_path_default),
    }
    print(f"[poc-piper]   {json.dumps(default_result, ensure_ascii=False)}")

    patched_result = None
    if args.cpu_threads:
        print(f"[poc-piper] Reemplazando la sesion con intra_op_num_threads={args.cpu_threads}...")
        sess_options = onnxruntime.SessionOptions()
        sess_options.intra_op_num_threads = args.cpu_threads
        sess_options.inter_op_num_threads = args.cpu_threads
        voice.session = onnxruntime.InferenceSession(
            str(model_path), sess_options=sess_options, providers=["CPUExecutionProvider"],
        )
        out_path_patched = out_dir / f"{voice_name}_patched.wav"
        synth_s2, audio_s2, peak_rss_mb = synthesize_and_time(voice, args.text, out_path_patched, proc, peak_rss_mb)
        patched_result = {
            "session": f"patched (intra_op_num_threads={args.cpu_threads}, sesion propia reemplazando voice.session)",
            "synth_s": round(synth_s2, 3),
            "audio_duration_s": round(audio_s2, 3),
            "realtime_factor": round(synth_s2 / audio_s2, 3) if audio_s2 else None,
            "out_path": str(out_path_patched),
        }
        print(f"[poc-piper]   {json.dumps(patched_result, ensure_ascii=False)}")

    metrics = {
        "quality": args.quality,
        "voice": voice_name,
        "model_size_mb_on_disk": round(model_path.stat().st_size / (1024 * 1024), 1),
        "download_s": round(download_s, 3),
        "model_load_s": round(load_s, 3),
        "rss_after_load_mb": round(rss_after_load_mb, 1),
        "peak_rss_mb": round(peak_rss_mb, 1),
        "text": args.text,
        "default_session": default_result,
        "patched_session": patched_result,
    }

    print("\n--- METRICS ---")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))

    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(metrics, f, ensure_ascii=False, indent=2)
        print(f"\n[poc-piper] Resultado completo escrito en {args.out_json}")


if __name__ == "__main__":
    main()
