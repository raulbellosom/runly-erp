import { useMemo } from "react";
import { getLegacyModuleKey } from '@runly/core';
import { useQuery } from "@tanstack/react-query";
import { runly } from "../lib/runly";
import { getAvailableModules, mergeRuntimeModules } from "../lib/runtimeModules";
import { useAuth } from "../auth/AuthProvider";
import { useBrandingStore } from "../stores/branding.js";

export function useRuntimeModules() {
  const { session } = useAuth();
  const token = session?.access_token;
  const authUserId = session?.user?.id ?? "anonymous";
  const companyPrimaryColor = useBrandingStore((s) => s.branding?.primaryColor);

  const modulesQuery = useQuery({
    queryKey: ["runtime-modules", authUserId],
    queryFn: () => runly.runtime.modules(token),
    enabled: Boolean(token),
    staleTime: 60000,
    // A failed refetch (API restart, expired token before refresh, company
    // switch) must heal on its own instead of leaving the home screen stuck.
    retry: 2,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.status === "error" ? 15000 : false),
  });

  const runtimeModules = useMemo(
    () =>
      mergeRuntimeModules(modulesQuery.data, {
        includeManifestFallback: false,
        preferApiNavigation: true,
      }),
    [modulesQuery.data],
  );

  // runly.company's color is always the live company primary color so every
  // consumer (cards, sidebar, home screen, module outlet) stays in sync.
  const runtimeModulesResolved = useMemo(() => {
    if (!companyPrimaryColor) return runtimeModules;
    return runtimeModules.map((m) =>
      getLegacyModuleKey(m.key) === "runly.company" ? { ...m, color: companyPrimaryColor } : m,
    );
  }, [runtimeModules, companyPrimaryColor]);

  const availableModules = useMemo(
    () => getAvailableModules(runtimeModulesResolved),
    [runtimeModulesResolved],
  );

  const moduleMap = useMemo(
    () => new Map(runtimeModulesResolved.map((module) => [module.key, module])),
    [runtimeModulesResolved],
  );

  return {
    ...modulesQuery,
    runtimeModules: runtimeModulesResolved,
    availableModules,
    moduleMap,
  };
}
