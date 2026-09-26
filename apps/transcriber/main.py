"""runly-transcriber — servicio de transcripcion de llamadas (Etapa 2 de
docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md).

Proceso Python independiente que sondea directamente la tabla `call_transcript`
(patron "fila de BD como cola de trabajo", el mismo idioma que ya usa
apps/worker para OCR de recibos de PFM) usando una credencial de PostgreSQL de
minimo privilegio (ver infra/db/provision-transcriber-role.sql) — nunca la
credencial completa de la API. No expone ni consume ninguna API HTTP de Runly;
toda la logica de negocio (retencion, mensajes de sistema en el chat) vive en
apps/api/src/routes/calls/call-transcript-service.js, no aqui. Ver
docs/TRANSCRIPTION_SPEC.md para el diseno completo.

Responsabilidad de este proceso, y solo esta:
  - reclamar una fila PENDING (o PROCESSING con lease vencido) de forma
    atomica (FOR UPDATE SKIP LOCKED),
  - descargar el audio de la CallRecording asociada desde Supabase Storage,
  - extraer audio con ffmpeg, transcribir con faster-whisper,
  - escribir los segmentos de forma idempotente (DELETE + INSERT
    transaccional) y marcar la fila READY o FAILED,
  - renovar el lease (heartbeat) mientras el trabajo sigue en curso.
"""

import os
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

import boto3
import psycopg
from faster_whisper import WhisperModel

LOG_PREFIX = "[runly-transcriber]"

# Debe coincidir con RECORDING_BUCKET en call-recording-service.js — las
# grabaciones y (en V1) el audio que transcribimos viven en el mismo bucket.
RECORDING_BUCKET = "runly-chat"

MAX_ATTEMPTS = int(os.environ.get("TRANSCRIBER_MAX_ATTEMPTS", "3"))
POLL_INTERVAL_S = int(os.environ.get("TRANSCRIBER_POLL_INTERVAL_MS", "20000")) / 1000
LEASE_MINUTES = int(os.environ.get("TRANSCRIBER_LEASE_MINUTES", "10"))
HEARTBEAT_MINUTES = int(os.environ.get("TRANSCRIBER_HEARTBEAT_MINUTES", "2"))

# Sin valor por defecto silencioso a "automatico" — hallazgo real de la Etapa 1
# (docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md, Etapa 2): el numero de hilos que
# faster-whisper autodetecta depende de los nucleos VISIBLES del contenedor,
# no del limite real de `--cpus`/`deploy.resources.limits.cpus`, lo que infla
# la RAM y puede ralentizar la transcripcion. Se exige un valor explicito,
# con un default conservador y una advertencia si no se configuro a proposito.
WHISPER_CPU_THREADS = os.environ.get("WHISPER_CPU_THREADS")
if WHISPER_CPU_THREADS is None:
    print(f"{LOG_PREFIX} WARNING: WHISPER_CPU_THREADS no configurado — usando 2 por defecto. "
          f"Fijalo explicitamente segun el limite real de CPU del contenedor (ver "
          f"docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md, Etapa 2).", file=sys.stderr)
    WHISPER_CPU_THREADS = 2
else:
    WHISPER_CPU_THREADS = int(WHISPER_CPU_THREADS)

# "small" (no "base") por la evidencia real de la Etapa 1 — sobre audio real
# con ruido, "base" produjo alucinaciones/bucles de repeticion mientras
# "small" no, y fue ademas mas rapido en el VPS de produccion real. Ver
# scripts/poc-transcription/RESULTS.md.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE") or None  # None = autodeteccion

DATABASE_URL = os.environ.get("TRANSCRIBER_DATABASE_URL")
WORKER_INSTANCE_ID = f"{os.uname().nodename if hasattr(os, 'uname') else 'transcriber'}-{os.getpid()}"


class TransientError(Exception):
    """Error recuperable — la fila vuelve a PENDING para reintentar."""


class PermanentError(Exception):
    """Error definitivo — la fila pasa directo a FAILED, sin agotar reintentos que no cambiarian el resultado."""


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["SUPABASE_S3_ENDPOINT"],
        aws_access_key_id=os.environ["SUPABASE_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["SUPABASE_S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("SUPABASE_S3_REGION", "us-east-1"),
    )


def claim_next_job(conn):
    """Reclamo atomico — spec §4.2/§5.6. Devuelve None si no hay trabajo."""
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            UPDATE call_transcript
            SET status = 'PROCESSING',
                started_at = COALESCE(started_at, now()),
                attempts = attempts + 1,
                lease_expires_at = now() + make_interval(mins => %(lease_minutes)s),
                worker_instance_id = %(worker_id)s
            WHERE id = (
                SELECT id FROM call_transcript
                WHERE status = 'PENDING'
                   OR (status = 'PROCESSING' AND lease_expires_at < now())
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, call_id, conversation_id, company_id, recording_id, source_kind, attempts
            """,
            {"lease_minutes": LEASE_MINUTES, "worker_id": WORKER_INSTANCE_ID},
        )
        row = cur.fetchone()
        conn.commit()
        return row


def start_heartbeat(conn_str, transcript_id, stop_event):
    """Renueva el lease cada HEARTBEAT_MINUTES mientras el trabajo sigue vivo
    — evita que un trabajo real pero lento (una reunion larga) sea reclamado
    por error por otro contenedor mientras se procesa con normalidad
    (spec §5.6). Corre en su propia conexion (un cursor/hilo separado del
    trabajo principal, que puede estar bloqueado en CPU con faster-whisper)."""

    def run():
        with psycopg.connect(conn_str) as hb_conn:
            while not stop_event.wait(HEARTBEAT_MINUTES * 60):
                try:
                    with hb_conn.cursor() as cur:
                        cur.execute(
                            "UPDATE call_transcript SET lease_expires_at = now() + make_interval(mins => %s) "
                            "WHERE id = %s AND status = 'PROCESSING'",
                            (LEASE_MINUTES, transcript_id),
                        )
                        hb_conn.commit()
                except Exception as error:  # noqa: BLE001 — un latido fallido no debe tumbar el worker
                    print(f"{LOG_PREFIX} heartbeat fallo para {transcript_id}: {error}", file=sys.stderr)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


def download_recording_audio(conn, recording_id, workdir: Path) -> Path:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT playlist_object_key FROM call_recording WHERE id = %s", (recording_id,))
        row = cur.fetchone()
    if not row or not row["playlist_object_key"]:
        raise PermanentError("La grabación no tiene un archivo de reproducción disponible.")

    playlist_key = row["playlist_object_key"]
    prefix = playlist_key.rsplit("/", 1)[0]
    s3 = s3_client()

    try:
        obj = s3.get_object(Bucket=RECORDING_BUCKET, Key=playlist_key)
        manifest_text = obj["Body"].read().decode("utf-8")
    except Exception as error:  # noqa: BLE001
        raise TransientError(f"No se pudo descargar el manifiesto de la grabación: {error}") from error

    segment_names = [
        line.strip() for line in manifest_text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not segment_names:
        raise PermanentError("El manifiesto de la grabación no referencia ningún segmento de audio.")

    combined_ts = workdir / "combined.ts"
    with open(combined_ts, "wb") as out:
        for name in segment_names:
            key = f"{prefix}/{name}"
            try:
                seg_obj = s3.get_object(Bucket=RECORDING_BUCKET, Key=key)
                out.write(seg_obj["Body"].read())
            except Exception as error:  # noqa: BLE001
                raise TransientError(f"No se pudo descargar el segmento {name}: {error}") from error

    audio_wav = workdir / "audio.wav"
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(combined_ts),
                "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
                str(audio_wav),
            ],
            check=True, capture_output=True, timeout=600,
        )
    except subprocess.CalledProcessError as error:
        raise PermanentError(f"ffmpeg no pudo extraer el audio: {error.stderr.decode(errors='replace')[:500]}") from error
    except subprocess.TimeoutExpired as error:
        raise TransientError(f"ffmpeg excedió el tiempo límite: {error}") from error

    return audio_wav


def download_track_audio(conn, transcript_id, workdir: Path):
    """V2 (PER_TRACK, spec §2.2/§3.1): descarga el archivo de audio de cada
    pista READY de esta transcripcion. A diferencia de la grabacion mezclada
    (un manifest HLS con muchos segmentos .ts), cada pista es un unico
    objeto (DirectFileOutput via startTrackEgress) — no hay manifest que
    resolver. Devuelve una lista de dicts {path, speaker_user_id,
    speaker_guest_id}; una pista individual que falle al descargar/procesar
    se omite (se loguea) en vez de abortar toda la transcripcion — las demas
    pistas siguen siendo utiles."""
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT object_key, speaker_user_id, speaker_guest_id, livekit_identity "
            "FROM call_transcript_track WHERE transcript_id = %s AND status = 'READY' AND object_key IS NOT NULL",
            (transcript_id,),
        )
        tracks = cur.fetchall()
    if not tracks:
        raise PermanentError("No hay pistas de audio listas para esta transcripción.")

    s3 = s3_client()
    result = []
    for i, track in enumerate(tracks):
        raw_path = workdir / f"track_{i}.ogg"
        try:
            obj = s3.get_object(Bucket=RECORDING_BUCKET, Key=track["object_key"])
            with open(raw_path, "wb") as out:
                out.write(obj["Body"].read())
        except Exception as error:  # noqa: BLE001
            print(f"{LOG_PREFIX} No se pudo descargar la pista {track['livekit_identity']} (se omite): {error}", file=sys.stderr)
            continue

        wav_path = workdir / f"track_{i}.wav"
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", str(raw_path),
                    "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
                    str(wav_path),
                ],
                check=True, capture_output=True, timeout=600,
            )
        except subprocess.CalledProcessError as error:
            print(f"{LOG_PREFIX} ffmpeg no pudo procesar la pista {track['livekit_identity']} (se omite): "
                  f"{error.stderr.decode(errors='replace')[:300]}", file=sys.stderr)
            continue
        except subprocess.TimeoutExpired as error:
            print(f"{LOG_PREFIX} ffmpeg excedió el tiempo límite en la pista {track['livekit_identity']} (se omite): {error}", file=sys.stderr)
            continue

        result.append({
            "path": wav_path,
            "speaker_user_id": track["speaker_user_id"],
            "speaker_guest_id": track["speaker_guest_id"],
        })

    if not result:
        raise TransientError("Ninguna pista de audio se pudo descargar o procesar; se reintentará.")
    return result


_model_cache = {}


def get_model():
    key = (WHISPER_MODEL, WHISPER_COMPUTE_TYPE, WHISPER_CPU_THREADS)
    if key not in _model_cache:
        print(f"{LOG_PREFIX} Cargando modelo {WHISPER_MODEL} ({WHISPER_COMPUTE_TYPE}, {WHISPER_CPU_THREADS} hilos)…")
        _model_cache.clear()  # un solo modelo en memoria a la vez — V1 procesa secuencialmente
        _model_cache[key] = WhisperModel(
            WHISPER_MODEL, device="cpu", compute_type=WHISPER_COMPUTE_TYPE, cpu_threads=WHISPER_CPU_THREADS,
        )
    return _model_cache[key]


def transcribe(audio_path: Path):
    model = get_model()
    segments_iter, info = model.transcribe(
        str(audio_path), language=WHISPER_LANGUAGE, vad_filter=True, condition_on_previous_text=True,
    )
    segments = [
        {"start_ms": round(seg.start * 1000), "end_ms": round(seg.end * 1000), "text": seg.text.strip()}
        for seg in segments_iter
    ]
    duration_ms = round((getattr(info, "duration", 0) or 0) * 1000)
    return segments, duration_ms, getattr(info, "language", None)


def transcribe_tracks(tracks):
    """V2 (PER_TRACK, spec §2.2): transcribe cada pista por separado y fusiona
    los segmentos por marca de tiempo absoluta, atribuyendo cada uno a la
    identidad ya conocida de esa pista — sin ejecutar ningun modelo de
    diarizacion acustica.

    Simplificacion deliberada: cada pista arranca su propio egress dentro de
    la MISMA llamada a requestTrackTranscription (el bucle en
    call-transcript-service.js es sincronico), por lo que sus puntos de
    inicio quedan lo bastante cerca entre si como para fusionar directamente
    por start_ms sin un offset de correccion. La correccion fina por
    CallParticipant.joinedAt/CallGuest.admittedAt que el plan de
    implementacion menciona como posible refinamiento queda pendiente de
    validarse contra una llamada real con varios participantes (spec §9
    riesgo 4) antes de implementarse — no se inventa aqui sin poder medirla."""
    all_segments = []
    max_duration_ms = 0
    detected_language = None
    for track in tracks:
        segments, duration_ms, language = transcribe(track["path"])
        max_duration_ms = max(max_duration_ms, duration_ms)
        detected_language = detected_language or language
        for seg in segments:
            all_segments.append({
                **seg,
                "speaker_user_id": track["speaker_user_id"],
                "speaker_guest_id": track["speaker_guest_id"],
            })
    all_segments.sort(key=lambda s: s["start_ms"])
    return all_segments, max_duration_ms, detected_language


def write_result(conn, transcript_id, segments, duration_ms, language):
    """Escritura idempotente y transaccional — spec §5.6: si este trabajo fue
    reclamado dos veces por error (lease vencido de forma espuria), el
    segundo intento en completarse deja el resultado correcto sin duplicar
    segmentos, en vez de intentar prevenir la doble ejecucion en si (eso ya
    lo hace el lease + FOR UPDATE SKIP LOCKED)."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM call_transcript_segment WHERE transcript_id = %s", (transcript_id,))
        if segments:
            cur.executemany(
                "INSERT INTO call_transcript_segment "
                "(transcript_id, start_ms, end_ms, text, speaker_user_id, speaker_guest_id) "
                "VALUES (%(transcript_id)s, %(start_ms)s, %(end_ms)s, %(text)s, %(speaker_user_id)s, %(speaker_guest_id)s)",
                [
                    {
                        **seg,
                        "transcript_id": transcript_id,
                        # MIXED segments (V1) never set these — .get() defaults to NULL.
                        "speaker_user_id": seg.get("speaker_user_id"),
                        "speaker_guest_id": seg.get("speaker_guest_id"),
                    }
                    for seg in segments
                ],
            )
        cur.execute(
            "UPDATE call_transcript SET status = 'READY', duration_ms = %s, completed_at = now(), "
            "model = %s, language = %s, lease_expires_at = NULL WHERE id = %s",
            (duration_ms, f"faster-whisper-{WHISPER_MODEL}-{WHISPER_COMPUTE_TYPE}", language, transcript_id),
        )
    conn.commit()


def mark_transient_failure(conn, transcript_id, attempts, reason):
    if attempts >= MAX_ATTEMPTS:
        mark_permanent_failure(conn, transcript_id, f"{reason} (máximo de reintentos alcanzado)")
        return
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE call_transcript SET status = 'PENDING', lease_expires_at = NULL, failure_reason = %s "
            "WHERE id = %s",
            (str(reason)[:500], transcript_id),
        )
    conn.commit()


def mark_permanent_failure(conn, transcript_id, reason):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE call_transcript SET status = 'FAILED', lease_expires_at = NULL, failure_reason = %s, "
            "completed_at = now() WHERE id = %s",
            (str(reason)[:500], transcript_id),
        )
    conn.commit()


def process_job(conn, job):
    transcript_id = job["id"]
    stop_heartbeat = threading.Event()
    heartbeat_thread = start_heartbeat(DATABASE_URL, transcript_id, stop_heartbeat)
    try:
        with tempfile.TemporaryDirectory(prefix=f"transcript-{transcript_id}-") as tmp:
            workdir = Path(tmp)
            if job["source_kind"] == "PER_TRACK":
                tracks = download_track_audio(conn, transcript_id, workdir)
                segments, duration_ms, language = transcribe_tracks(tracks)
            else:
                audio_path = download_recording_audio(conn, job["recording_id"], workdir)
                segments, duration_ms, language = transcribe(audio_path)
            write_result(conn, transcript_id, segments, duration_ms, language)
            print(f"{LOG_PREFIX} Transcripción {transcript_id} lista — {len(segments)} segmentos, {duration_ms}ms.")
    except TransientError as error:
        print(f"{LOG_PREFIX} Error transitorio en {transcript_id} (se reintentará): {error}", file=sys.stderr)
        mark_transient_failure(conn, transcript_id, job["attempts"], error)
    except PermanentError as error:
        print(f"{LOG_PREFIX} Error definitivo en {transcript_id}: {error}", file=sys.stderr)
        mark_permanent_failure(conn, transcript_id, error)
    except Exception as error:  # noqa: BLE001 — cualquier otra cosa se trata como transitoria, nunca tumba el proceso
        print(f"{LOG_PREFIX} Error inesperado en {transcript_id} (se reintentará): {error}", file=sys.stderr)
        traceback.print_exc()
        mark_transient_failure(conn, transcript_id, job["attempts"], f"Error inesperado: {error}")
    finally:
        stop_heartbeat.set()
        heartbeat_thread.join(timeout=5)
        # Nota: si la fila fue borrada por la API mientras se procesaba
        # (DELETE /calls/transcripts/:id), los UPDATE de arriba simplemente
        # afectan 0 filas — psycopg no lanza error por eso, es un no-op seguro.


def main():
    if not DATABASE_URL:
        print(f"{LOG_PREFIX} TRANSCRIBER_DATABASE_URL no configurado — abortando.", file=sys.stderr)
        sys.exit(1)

    print(f"{LOG_PREFIX} Iniciado. Modelo={WHISPER_MODEL} hilos={WHISPER_CPU_THREADS} "
          f"sondeo={POLL_INTERVAL_S}s lease={LEASE_MINUTES}min worker_id={WORKER_INSTANCE_ID}")

    while True:
        try:
            with psycopg.connect(DATABASE_URL) as conn:
                job = claim_next_job(conn)
                if job:
                    process_job(conn, job)
                    continue  # revisa inmediatamente si hay mas trabajo pendiente
        except psycopg.OperationalError as error:
            print(f"{LOG_PREFIX} Error de conexión a la base de datos (se reintentará): {error}", file=sys.stderr)
        except Exception as error:  # noqa: BLE001 — el bucle principal nunca debe morir
            print(f"{LOG_PREFIX} Error inesperado en el bucle principal: {error}", file=sys.stderr)
            traceback.print_exc()
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
