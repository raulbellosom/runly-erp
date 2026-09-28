// Renders the CUSTOM (React) views of an uploaded-but-not-applied module ZIP:
// loads the preview bundle built by POST /modules/:key/upload/check into a
// temporary component registry (never the app's own) and mounts each view
// with the real session props. Data comes from the currently installed API.
import { Component, useEffect, useState } from "react";
import { EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from "@runly/ui";
import { AlertTriangle, MonitorPlay } from "lucide-react";
import { toast } from "sonner";
import { getApiUrl } from "../../../../lib/runtimeConfig.js";
import { createModuleComponentRegistry } from "../../../../lib/module-component-registry-core.js";
import { useActiveCompany } from "../../../../company/ActiveCompanyProvider";

const API_BASE_URL = getApiUrl();

// The previewed code is the user's own: show its crash inside the frame
// instead of taking the page down.
class PreviewBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="space-y-1 rounded-xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Tu pantalla falló al mostrarse</p>
          <pre className="whitespace-pre-wrap text-xs">{String(this.state.error?.message ?? this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function CustomViewPreview({ moduleKey, previewId, views, token }) {
  const { activeCompanyId } = useActiveCompany();
  const [state, setState] = useState({ status: "loading", registry: null, error: null });
  const [active, setActive] = useState(views[0]?.key ?? null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", registry: null, error: null });
    const url = `${API_BASE_URL}/modules/${encodeURIComponent(moduleKey)}/preview/${previewId}/bundle.js`;
    import(/* @vite-ignore */ url)
      .then(async (mod) => {
        const registry = createModuleComponentRegistry();
        if (typeof mod.register === "function") await mod.register(registry);
        if (!cancelled) setState({ status: "ready", registry, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", registry: null, error: error?.message ?? "No se pudo cargar la vista previa." });
      });
    return () => {
      cancelled = true;
    };
  }, [moduleKey, previewId]);

  if (!views.length) {
    return <EmptyState icon={MonitorPlay} title="Sin pantallas React" description="El ZIP trae componentes, pero ninguna vista CUSTOM en el manifiesto los usa." />;
  }
  if (state.status === "loading") return <Skeleton className="h-48 w-full rounded-xl" />;
  if (state.status === "error") {
    return <p className="rounded-xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">No se pudo cargar la vista previa: {state.error}</p>;
  }

  const view = views.find((item) => item.key === active) ?? views[0];
  const View = view.component ? state.registry.resolve(view.component) : null;

  return (
    <div className="space-y-3">
      {views.length > 1 && (
        <Tabs value={view.key} onValueChange={setActive}>
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {views.map((item) => <TabsTrigger key={item.key} value={item.key}>{item.title}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
      <div className="max-h-[60vh] overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        {View ? (
          <PreviewBoundary key={view.key}>
            <View
              token={token}
              companyId={activeCompanyId}
              apiBaseUrl={API_BASE_URL}
              moduleKey={moduleKey}
              navigate={() => toast.info("La navegación está desactivada en la vista previa.")}
            />
          </PreviewBoundary>
        ) : (
          <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
            El componente <code>{view.component ?? "(sin schema.component)"}</code> no está registrado en <code>components/index.js</code>. Revisa que la clave de <code>registry.register</code> coincida.
          </p>
        )}
      </div>
    </div>
  );
}
