import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button, TextField } from "@runly/ui";
import { Loader2, PhoneOff, Globe } from "lucide-react";
import { useGuestCall } from "./useGuestCall";
import { endedReason } from "./lib/guestCall";
import { GuestCallRoom } from "./GuestCallRoom";

const RUNLY_LOGO = "/runly/runly-logo-horizontal-light.png";

function CompanyHeader({ branding }) {
  if (!branding?.companyName && !branding?.logoUrl) return null;
  return (
    <div className="mb-4 flex flex-col items-center gap-2 text-center">
      {branding.logoUrl ? (
        <img src={branding.logoUrl} alt={branding.companyName ?? ""} className="h-12 max-w-[180px] object-contain" />
      ) : null}
      {branding.companyName ? (
        <p className="text-base font-semibold text-gray-900">{branding.companyName}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
        {branding.location ? <span>{branding.location}</span> : null}
        {branding.website ? (
          <a href={branding.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-gray-700">
            <Globe className="h-3 w-3" /> {branding.website.replace(/^https?:\/\//, "")}
          </a>
        ) : null}
        {branding.email ? <span>{branding.email}</span> : null}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gray-50 p-4">
      {/* Runly ERP watermark */}
      <img
        src={RUNLY_LOGO}
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 w-[min(70vw,520px)] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.04] select-none"
      />
      <div className="relative z-10 w-full max-w-sm">
        {children}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
          <img src={RUNLY_LOGO} alt="" className="h-3 opacity-60" /> Reunión con tecnología de Runly ERP
        </p>
      </div>
    </div>
  );
}

function Card({ children }) {
  return <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">{children}</div>;
}

export default function GuestCallScreen() {
  const { token = null } = useParams();
  const [sp] = useSearchParams();
  const inviteToken = sp.get("i");
  const urlCode = sp.get("code");

  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains("dark");
    html.classList.remove("dark");
    return () => { if (hadDark) html.classList.add("dark"); };
  }, []);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(urlCode ?? "");
  const gc = useGuestCall({ token, code: token ? null : code, inviteToken });
  const formRef = useRef({ name: "", email: "" });
  const waitTimer = useRef(null);

  useEffect(() => {
    if (gc.phase === "lobby" && gc.state.status === "waiting") {
      waitTimer.current = setInterval(() => {
        if (formRef.current.name) {
          gc.join({ displayName: formRef.current.name, email: formRef.current.email || undefined });
        }
      }, 4000);
      return () => { if (waitTimer.current) clearInterval(waitTimer.current); };
    }
    return undefined;
  }, [gc.phase, gc.state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function submitGate(e) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return;
    formRef.current = { name: n, email: email.trim() };
    gc.join({ displayName: n, email: email.trim() || undefined });
  }

  if (gc.phase === "room") {
    return (
      <GuestCallRoom
        fetchLivekitToken={gc.fetchLivekitToken}
        messages={gc.messages}
        onSendMessage={gc.sendMessage}
        onLeave={gc.leave}
        myName={formRef.current.name || name}
        recordingActive={gc.state.recording?.active}
      />
    );
  }

  if (gc.phase === "ended") {
    const ended = gc.state.callEnded;
    return (
      <Shell>
        <Card>
          <CompanyHeader branding={gc.branding} />
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <PhoneOff className="h-5 w-5 text-gray-500" />
            </div>
            <p className="text-base font-semibold text-gray-900">
              {ended ? "La reunión ha terminado" : endedReason(gc.state)}
            </p>
            {ended && (
              <p className="text-sm text-gray-500">Gracias por participar. Ya puedes cerrar esta pestaña.</p>
            )}
            {!ended && (
              <Button variant="secondary" className="w-full" onClick={() => window.location.reload()}>
                Volver a intentar
              </Button>
            )}
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CompanyHeader branding={gc.branding} />

        {gc.phase === "gate" && (
          <form onSubmit={submitGate} className="space-y-4">
            <h1 className="text-lg font-semibold text-gray-900">Unirte a la llamada</h1>
            <TextField label="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            {!inviteToken && (
              <TextField label="Correo (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
            {inviteToken && <p className="text-xs text-gray-500">Invitación por correo verificada.</p>}
            {!token && (
              <TextField
                label="Código de la llamada"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
              />
            )}
            {gc.state.error && <p className="text-sm text-red-600">{gc.state.error}</p>}
            <Button type="submit" className="w-full" disabled={gc.joining || name.trim().length < 2}>
              {gc.joining ? "Conectando..." : "Entrar"}
            </Button>
          </form>
        )}

        {gc.phase === "lobby" && (
          <div className="space-y-3 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
            <p className="text-sm text-gray-700">
              {gc.state.status === "waiting"
                ? "La llamada aún no ha comenzado. Te uniremos automáticamente."
                : "Esperando a que el anfitrión te admita..."}
            </p>
          </div>
        )}

        {gc.phase === "error" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-red-600">{gc.state.error || "Algo salió mal."}</p>
            <Button variant="secondary" className="w-full" onClick={() => window.location.reload()}>Reintentar</Button>
          </div>
        )}
      </Card>
    </Shell>
  );
}
