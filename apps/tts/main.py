"""runly-tts — servicio de texto a voz para "leer en voz alta" en MirAI
(runly.chat). Ver scripts/poc-piper/RESULTS.md para la validacion de
rendimiento (14x mas rapido que tiempo real, <400MB RAM, medido en el KVM4
real de produccion) y docs/TASKS.md para las decisiones de esta fase.

A diferencia de apps/transcriber/main.py, este servicio es SIN ESTADO: no
toca Postgres ni Supabase Storage, no hay tabla de trabajos, no hay lease ni
reintentos. Sintetizar ~8s de audio toma ~0.5s de CPU en el KVM4 real, asi
que un ciclo HTTP sincrono (Hono llama, este proceso responde con el WAV) es
suficiente — el patron de cola en Postgres que usa el transcriptor existe
para un trabajo genuinamente largo (minutos), no para esto.

Expone:
  GET  /health      -> 200 una vez que la voz esta cargada en memoria.
  POST /synthesize   {"text": "..."} -> 200 con el audio/wav en el body.

No expuesto a internet — solo la API de Runly le habla, por la red interna
de Docker Compose (ver MIRAI_TTS_URL). Sin autenticacion propia a proposito:
la autorizacion (permiso chat.mirai.use) ya la hace la API antes de llamar
aqui, igual que un servicio de storage privado no reimplementa auth.
"""

import io
import json
import os
import sys
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import onnxruntime
from piper import PiperVoice

LOG_PREFIX = "[runly-tts]"

MODEL_PATH = os.environ.get("TTS_MODEL_PATH", "/app/voices/es_MX-claude-high.onnx")
CONFIG_PATH = os.environ.get("TTS_CONFIG_PATH", f"{MODEL_PATH}.json")
PORT = int(os.environ.get("TTS_PORT", "8090"))
MAX_TEXT_CHARS = int(os.environ.get("TTS_MAX_TEXT_CHARS", "2000"))

# Mismo hallazgo de la PoC (scripts/poc-piper/RESULTS.md): en el KVM4 real
# (4 vCPU reales, sin limite artificial de cgroup) la sesion por defecto ya
# rinde casi igual que una con intra_op_num_threads explicito (0.556s vs
# 0.514s) — el parche importa mas en una maquina con muchos nucleos
# visibles compitiendo contra un limite de cgroup, que es exactamente el
# caso que TTS_CPU_THREADS cubre si esta VPS alguna vez cambia de perfil.
TTS_CPU_THREADS = os.environ.get("TTS_CPU_THREADS")

_voice = None


def load_voice():
    global _voice
    print(f"{LOG_PREFIX} Cargando voz desde {MODEL_PATH}...", flush=True)
    voice = PiperVoice.load(MODEL_PATH, config_path=CONFIG_PATH)
    if TTS_CPU_THREADS:
        threads = int(TTS_CPU_THREADS)
        sess_options = onnxruntime.SessionOptions()
        sess_options.intra_op_num_threads = threads
        sess_options.inter_op_num_threads = threads
        voice.session = onnxruntime.InferenceSession(
            MODEL_PATH, sess_options=sess_options, providers=["CPUExecutionProvider"],
        )
        print(f"{LOG_PREFIX} Sesion de ONNX Runtime con {threads} hilos explicitos.", flush=True)
    _voice = voice
    print(f"{LOG_PREFIX} Voz cargada, listo para recibir peticiones.", flush=True)


def synthesize_wav_bytes(text: str) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        _voice.synthesize_wav(text, wav_file)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _json_error(self, status, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            body = b'{"status":"ok"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._json_error(404, "not found")

    def do_POST(self):
        if self.path != "/synthesize":
            self._json_error(404, "not found")
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._json_error(400, "invalid JSON body")
            return

        text = str(payload.get("text") or "").strip()
        if not text:
            self._json_error(400, "text is required")
            return
        if len(text) > MAX_TEXT_CHARS:
            self._json_error(400, f"text exceeds {MAX_TEXT_CHARS} characters")
            return

        try:
            audio = synthesize_wav_bytes(text)
        except Exception as error:  # noqa: BLE001 — never crash the server on a bad synth
            print(f"{LOG_PREFIX} Error sintetizando: {error}", file=sys.stderr, flush=True)
            self._json_error(500, "synthesis failed")
            return

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, format_str, *args):  # noqa: A002 — matches BaseHTTPRequestHandler's signature
        print(f"{LOG_PREFIX} {self.address_string()} - {format_str % args}", flush=True)


def main():
    load_voice()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"{LOG_PREFIX} Escuchando en :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
