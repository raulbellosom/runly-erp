import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  EmptyState,
  MarkdownViewer,
} from "@runly/ui";
import { runly } from "../lib/runly";
import { useAuth } from "../auth/AuthProvider";

// Strips the "/app" prefix the desktop router always adds so the path
// matches the navigation.path values stored in each module's manifest
// (e.g. "/app/help" -> "/help").
function toApiPath(pathname) {
  return pathname.startsWith("/app") ? pathname.slice(4) || "/" : pathname;
}

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const { session } = useAuth();
  const token = session?.access_token;
  const location = useLocation();
  const navigate = useNavigate();
  const apiPath = toApiPath(location.pathname);

  const { data, isLoading } = useQuery({
    queryKey: ["help", "resolve", apiPath],
    queryFn: () => runly.help.resolveHelp(apiPath, token).then((r) => r.data),
    enabled: Boolean(token) && open,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ayuda"
        title="Ayuda"
        className="h-9 w-9 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer"
      >
        <CircleHelp size={16} />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ayuda</SheetTitle>
            <SheetDescription>
              {data?.moduleName ? `Ayuda de ${data.moduleName}` : "Ayuda del sistema"}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-6">
            {isLoading && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>
            )}
            {!isLoading && !data?.view && !data?.overview && (
              <EmptyState
                title="Aun no hay ayuda para este modulo"
                description="Estamos escribiendo la documentacion de esta seccion."
              />
            )}
            {data?.view && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{data.view.title}</h3>
                <MarkdownViewer value={data.view.content} />
              </div>
            )}
            {data?.overview && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{data.overview.title}</h3>
                <MarkdownViewer value={data.overview.content} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/app/help");
            }}
            className="mt-6 text-xs text-[hsl(var(--primary))] hover:underline"
          >
            Ver toda la documentacion
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
