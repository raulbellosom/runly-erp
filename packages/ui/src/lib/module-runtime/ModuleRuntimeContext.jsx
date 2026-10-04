import { createContext, useContext, useMemo } from "react";

// Module runtime for CUSTOM screens (spec 2026-10-03-rme3-module-platform-v2
// §5.4): the session, API base and the module's own blueprints, so screens use
// useEntity*/EntityForm/EntityTable without threading token/companyId props.
// Provided by the desktop host around every CUSTOM component.
const ModuleRuntimeContext = createContext(null);

export function ModuleRuntimeProvider({ moduleKey, token, companyId, apiBaseUrl, navigate, blueprints, transport, sessionId, children }) {
  const value = useMemo(
    () => ({ moduleKey, token, companyId, apiBaseUrl, navigate, transport, sessionId, blueprints: blueprints ?? [] }),
    [moduleKey, token, companyId, apiBaseUrl, navigate, blueprints, transport, sessionId],
  );
  return <ModuleRuntimeContext.Provider value={value}>{children}</ModuleRuntimeContext.Provider>;
}

export function useModuleRuntime() {
  const runtime = useContext(ModuleRuntimeContext);
  if (!runtime) {
    throw new Error("useModuleRuntime debe usarse dentro de una pantalla de módulo (ModuleRuntimeProvider).");
  }
  return runtime;
}
