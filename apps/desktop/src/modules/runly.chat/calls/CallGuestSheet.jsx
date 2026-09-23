import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, Sheet, SheetContent, SheetHeader, SheetTitle } from "@runly/ui";
import { Check, X, Mic, MicOff, UserX, Link2 } from "lucide-react";

function Initial({ name }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/25 text-sm font-semibold text-violet-100">
      {(name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

// Host-only guest approval / roster. `side="right"` — SheetContent
// (@runly/ui) auto-falls-back to a bottom sheet below its own mobile
// breakpoint, so this reads as a proper desktop side panel instead of a
// bottom sheet floating over the call on large screens, without any
// extra plumbing here. `guestsApi` is the object from useCallGuests();
// `onShare` opens the CallShareDialog.
export function CallGuestSheet({ open, onOpenChange, guestsApi, onShare }) {
  const { lobby, admitted, admit, deny, kick, mute } = guestsApi;
  const [muted, setMuted] = useState({});
  const [confirmKick, setConfirmKick] = useState(null);
  const empty = lobby.length === 0 && admitted.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 bg-[hsl(var(--popover,var(--background)))]" style={{ zIndex: 10002 }}>
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center gap-2 text-sm">
            Invitados
            {lobby.length > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">
                {lobby.length} en espera
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        {/* flex-1/min-h-0 (not a fixed max-h) so this fills whatever height
            the panel actually has — a tall desktop side panel or a capped
            mobile bottom sheet (see BOTTOM_SHEET_SURFACE_CLASS) — instead of
            an awkward fixed vh that's too short on desktop. */}
        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pb-2">
          {empty && (
            <EmptyState
              title="Sin invitados"
              description="Comparte el enlace para que se unan invitados externos."
            />
          )}

          {lobby.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Esperando aprobación
              </p>
              <ul className="space-y-1">
                {lobby.map((g) => (
                  <li key={g.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-[hsl(var(--muted))]">
                    <Initial name={g.displayName} />
                    <span className="min-w-0 flex-1 truncate text-sm">{g.displayName}</span>
                    <Button size="sm" className="h-8" onClick={() => admit(g.id)}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Admitir
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500" title="Rechazar" onClick={() => deny(g.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {admitted.length > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                En la llamada
              </p>
              <ul className="space-y-1">
                {admitted.map((g) => {
                  const isMuted = !!muted[g.id];
                  return (
                    <li key={g.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-[hsl(var(--muted))]">
                      <Initial name={g.displayName} />
                      <span className="min-w-0 flex-1 truncate text-sm">{g.displayName}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title={isMuted ? "Reactivar micrófono" : "Silenciar"}
                        onClick={() => { setMuted((m) => ({ ...m, [g.id]: !isMuted })); mute(g.id, !isMuted); }}
                      >
                        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-500"
                        title="Expulsar"
                        onClick={() => setConfirmKick(g)}
                      >
                        <UserX className="h-4 w-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
          <Button variant="outline" className="w-full" onClick={onShare}>
            <Link2 className="mr-2 h-4 w-4" /> Compartir enlace
          </Button>
        </div>

        <ConfirmDialog
          open={!!confirmKick}
          onOpenChange={(v) => !v && setConfirmKick(null)}
          title="Expulsar invitado"
          description={confirmKick ? `Se sacará a ${confirmKick.displayName} de la llamada.` : ""}
          confirmLabel="Expulsar"
          variant="destructive"
          onConfirm={() => { kick(confirmKick.id); setConfirmKick(null); }}
        />
      </SheetContent>
    </Sheet>
  );
}
