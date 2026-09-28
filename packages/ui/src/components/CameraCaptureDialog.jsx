import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { Button } from "./Button.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog.jsx";

// Desktop webcam capture (touch devices use ImageSourceSheet, whose
// capture="environment" input opens the native camera). Produces a JPEG File
// through onCapture. The stream is always stopped when the dialog closes.
export function CameraCaptureDialog({ open, onOpenChange, onCapture, fileName = "foto" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open || snapshot) return undefined;
    let cancelled = false;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo no permite usar la cámara. Selecciona un archivo.");
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo acceder a la cámara. Revisa el permiso o selecciona un archivo.");
      });
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, snapshot, stopStream]);

  useEffect(() => () => {
    if (snapshot?.url) URL.revokeObjectURL(snapshot.url);
  }, [snapshot]);

  function close(nextOpen) {
    if (nextOpen) return;
    stopStream();
    setSnapshot(null);
    onOpenChange(false);
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stopStream();
      setSnapshot({ blob, url: URL.createObjectURL(blob) });
    }, "image/jpeg", 0.9);
  }

  function confirm() {
    if (!snapshot) return;
    const stamp = new Date().getTime();
    onCapture(new File([snapshot.blob], `${fileName}-${stamp}.jpg`, { type: "image/jpeg" }));
    close(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tomar foto</DialogTitle>
          <DialogDescription>Encuadra la imagen y presiona Capturar.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-xl bg-black/80 aspect-video flex items-center justify-center">
          {error ? (
            <p className="px-6 text-center text-sm text-white/80">{error}</p>
          ) : snapshot ? (
            <img src={snapshot.url} alt="Foto capturada" className="h-full w-full object-contain" />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)}>Cancelar</Button>
          {snapshot ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setSnapshot(null)}>
                <RotateCcw className="h-4 w-4" /> Repetir
              </Button>
              <Button type="button" onClick={confirm}>Usar foto</Button>
            </>
          ) : (
            <Button type="button" onClick={capture} disabled={Boolean(error)}>
              <Camera className="h-4 w-4" /> Capturar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
