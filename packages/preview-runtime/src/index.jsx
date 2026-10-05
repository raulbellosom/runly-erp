import { Component, forwardRef, useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RunlyCrudView, RunlyDashboard, RunlyKanban, ErrorState, extractBlueprintFields, RuntimeAdaptersProvider } from '@runly/ui/preview';
import { diagnoseBlueprints } from './contracts.js';
export { PREVIEW_RUNTIME_CONTRACT, diagnoseBlueprints } from './contracts.js';
export { createRuntimeSession } from './session.js';
export { createErpAdapters } from './erp-adapters.js';
export { resolveBlueprintPresentation } from './presentation.js';
export * from './resolver.js';
export { navigationTarget } from './navigation.js';
export { CUSTOM_BUNDLE_CONTRACT, createComponentRegistry, createBundleLoader, resolveCustomView, bundleSourceMap, customDiagnostic } from './custom-bundles.js';

// Third-party CUSTOM code may throw while rendering: contain it in its view.
export class CustomViewBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.props.onError?.(error, info); }
  render() {
    if (this.state.error) return this.props.fallback ? this.props.fallback(this.state.error) : <ErrorState title="La pantalla CUSTOM falló al mostrarse" description={String(this.state.error?.message ?? this.state.error).slice(0, 500)} />;
    return this.props.children;
  }
}

// ERP and external hosts use exactly the same original renderer dispatch.
export const BlueprintRenderer = forwardRef(function BlueprintRenderer({ kind = 'TABLE', adapters, ...props }, ref) {
  let view;
  if (kind === 'DASHBOARD') view = <RunlyDashboard {...props} />;
  else if (kind === 'KANBAN') view = <RunlyKanban {...props} />;
  else if (['TABLE', 'FORM', 'DETAIL', 'PAGE'].includes(kind)) view = <RunlyCrudView ref={ref} {...props} />;
  else view = <ErrorState title="Vista no soportada" description={kind} />;
  return adapters ? <RuntimeAdaptersProvider value={adapters}>{view}</RuntimeAdaptersProvider> : view;
});

export function PreviewHost({ session, blueprints, selection, kind = 'TABLE', ...props }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), [session]);
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  const diagnostics = diagnoseBlueprints(blueprints);
  if (diagnostics.length) return <ErrorState title="Capacidad no soportada en preview" description={diagnostics.map((d) => `${d.path}: ${d.capability}`).join('; ')} />;
  const fields = extractBlueprintFields(selection?.tableBlueprint, selection?.formBlueprint, selection?.detailBlueprint);
  return <QueryClientProvider client={queryClient}><RuntimeAdaptersProvider value={session.adapters}>
    <BlueprintRenderer key={`${session.id}:${kind}`} kind={kind} {...selection} fields={fields} componentRegistry={session.registry} {...props} />
  </RuntimeAdaptersProvider></QueryClientProvider>;
}
