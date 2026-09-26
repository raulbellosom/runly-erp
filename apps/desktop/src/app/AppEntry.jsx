import { AcceptInvitationScreen } from '../company/AcceptInvitationScreen.jsx';
import { SharedResourceScreen } from '../company/SharedResourceScreen.jsx';
import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RunlyOfflineDatabase, createDexiePersister } from "@runly/offline";
import { Toaster, TooltipProvider } from "@runly/ui";
import { AuthProvider } from "../auth/AuthProvider";
import { ActiveCompanyProvider, ActiveCompanyGate } from "../company/ActiveCompanyProvider";
import { RealtimeProvider } from "../providers/RealtimeProvider";
import { OfficeProvider } from "../providers/OfficeProvider";
import { CallsProvider } from "../modules/runly.chat/calls/CallsProvider";
import { RunlyApp } from "./RunlyApp";
import { HomeScreen } from "./HomeScreen";
import { HelpCenterScreen } from "./HelpCenterScreen";
import { ModuleOutlet } from "./ModuleOutlet";
import { ProfileScreen } from "./ProfileScreen";
import { GoogleCalendarCallbackScreen } from "./GoogleCalendarCallbackScreen";
import { runly } from "../lib/runly";
import { applyBrandTheme } from "../lib/brandTheme";
import { registerServiceWorker } from "../lib/webPush";
import { BootLoaderOverlay } from "../components/BootLoaderOverlay";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { BugReportHost } from "../components/BugReportHost";
import { useBootLoader } from "../stores/bootLoader";
import { useBrandingStore } from "../stores/branding";
import { useThemeStore } from "../stores/theme";
import { PublicShell } from "../shell/PublicShell.jsx";
import { PublicModuleOutlet } from "../shell/PublicModuleOutlet.jsx";
import { PublicWebsiteEntry } from "../shell/PublicWebsiteEntry.jsx";
import { PublicClientLogin } from "../shell/PublicClientLogin.jsx";
import { ServerSetup } from "./ServerSetup.jsx";
import { native } from '../native/index.js';
import { NativeHostDiagnostics } from '../native/NativeHostDiagnostics.jsx';
import { AppRouteGuard } from "./AppRouteGuard.jsx";
import { ResetPasswordScreen } from "../auth/ResetPasswordScreen.jsx";
import PublicNoteScreen from "../modules/runly.notes/PublicNoteScreen.jsx";

const GuestCallScreen = lazy(() => import("../modules/runly.chat/calls/guest/GuestCallScreen.jsx"));
import { useCallSoundUnlock } from "../modules/runly.chat/calls/useCallSoundUnlock.js";
import "../styles.css";

useThemeStore.getState().init();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const _offlineDb = new RunlyOfflineDatabase()
const _persister = createDexiePersister(_offlineDb)

function isAtlasInternalPath(pathname) {
  return pathname.startsWith("/app");
}

function App({ initialServerUrl = null, requiresServerSetup = false, bootstrapError = '' }) {
  const [brandReady, setBrandReady] = useState(false);
  const setBranding = useBrandingStore((s) => s.setBranding);
  const skipBrandWait = typeof window === 'undefined'
    ? false
    : !isAtlasInternalPath(window.location.pathname);

  useCallSoundUnlock();
  useBootLoader('brand', !requiresServerSetup && !brandReady && !skipBrandWait);

  useEffect(() => {
    if (!requiresServerSetup && (brandReady || skipBrandWait)) native.ready().catch(() => {});
  }, [requiresServerSetup, brandReady, skipBrandWait]);

  useEffect(() => {
    if (requiresServerSetup) return undefined

    // A local/warm API can resolve this in well under the loader's own
    // animation cycle — without a floor, the Runly loader iframe (a heavy,
    // hand-built HTML asset) gets unmounted before it ever paints.
    const MIN_LOADER_MS = 900;
    const startedAt = Date.now();
    let mounted = true;
    runly.instance
      .status()
      .then((data) => {
        applyBrandTheme(data?.branding?.primaryColor);
        if (mounted) setBranding(data?.branding ?? null);
      })
      .catch(() => applyBrandTheme())
      .finally(() => {
        const wait = Math.max(0, MIN_LOADER_MS - (Date.now() - startedAt));
        setTimeout(() => {
          if (mounted) setBrandReady(true);
        }, wait);
      });
    return () => {
      mounted = false;
    };
  }, [requiresServerSetup, setBranding]);

  useEffect(() => {
    if (requiresServerSetup) return undefined
    registerServiceWorker().catch(() => {});
    return undefined
  }, [requiresServerSetup]);

  if (requiresServerSetup) {
    return (
      <TooltipProvider>
        <ServerSetup defaultUrl={initialServerUrl ?? ''} initialError={bootstrapError} />
        <Toaster />
      </TooltipProvider>
    )
  }

  const ready = brandReady || skipBrandWait;

  return (
    <>
      <BootLoaderOverlay />
      {ready && (
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: _persister,
            maxAge: 24 * 60 * 60 * 1000,
            buster: `isolated-v1-${import.meta.env.VITE_APP_VERSION ?? '1'}`,
            // Authenticated data cannot be restored before identity and membership
            // have been checked. Offline business data needs a separate scoped store.
            dehydrateOptions: { shouldDehydrateQuery: () => false, shouldDehydrateMutation: () => false },
          }}
        >
          <TooltipProvider>
            <BrowserRouter>
              <AuthProvider>
                <OfficeProvider>
                <BugReportHost />
                {/* Inner boundary: a render crash anywhere in the routed tree
                    (e.g. a screen crash below) must not unmount BugReportHost
                    too — it sits above this boundary as a sibling. Without
                    this, the outer ErrorBoundary in renderApp() below catches
                    every crash by tearing down the ENTIRE app including
                    BugReportHost, so "Reportar bug" on the resulting
                    ApiErrorScreen calls requestBugReport() with no listener
                    left registered and silently does nothing. */}
                <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<PublicWebsiteEntry />} />
                  <Route path="/app/setup" element={<AppRouteGuard mode="setup" />} />
                  <Route path="/app/login" element={<AppRouteGuard mode="login" />} />
                  <Route path="/app/reset-password" element={<ResetPasswordScreen />} />
                  <Route path="/app/acceso" element={<PublicClientLogin />} />
                  <Route
                    path="/app/google/calendar/callback"
                    element={<GoogleCalendarCallbackScreen />}
                  />
                  {/* Public notes under /app/p/ — accessible without auth, served by same SPA */}
                  <Route path="/app/p" element={<PublicShell />}>
                    <Route path="notes/:slug" element={<PublicNoteScreen />} />
                    <Route path="call/:token" element={<Suspense fallback={null}><GuestCallScreen /></Suspense>} />
                    <Route path="call" element={<Suspense fallback={null}><GuestCallScreen /></Suspense>} />
                  </Route>
                  <Route element={<AppRouteGuard mode="access" />}>
                    <Route path="/app/accept-invitation" element={<AcceptInvitationScreen />} />
                    <Route path="/app/shared/:resourceType/:id" element={<SharedResourceScreen />} />
                    <Route
                      path="/app"
                      element={
                        <ActiveCompanyProvider>
                          <ActiveCompanyGate>
                            <RealtimeProvider>
                              <CallsProvider>
                                <RunlyApp />
                              </CallsProvider>
                            </RealtimeProvider>
                          </ActiveCompanyGate>
                        </ActiveCompanyProvider>
                      }
                    >
                      <Route index element={<Navigate to="home" replace />} />
                      <Route path="home" element={<HomeScreen />} />
                      <Route path="m/:moduleKey/*" element={<ModuleOutlet />} />
                      <Route path="profile" element={<ProfileScreen />} />
                      <Route path="help" element={<HelpCenterScreen />} />
                      <Route path="native-host" element={<NativeHostDiagnostics />} />
                    </Route>
                  </Route>
                  <Route path="/p" element={<PublicShell />}>
                    <Route path="notes/:slug" element={<PublicNoteScreen />} />
                    <Route path="call/:token" element={<Suspense fallback={null}><GuestCallScreen /></Suspense>} />
                    <Route path="call" element={<Suspense fallback={null}><GuestCallScreen /></Suspense>} />
                    <Route path="*" element={<PublicModuleOutlet />} />
                  </Route>
                  <Route path="*" element={<PublicWebsiteEntry />} />
                </Routes>
                </ErrorBoundary>
                </OfficeProvider>
              </AuthProvider>
              <Toaster />
            </BrowserRouter>
          </TooltipProvider>
        </PersistQueryClientProvider>
      )}
    </>
  );
}

export function renderApp(props = {}) {
  createRoot(document.getElementById("root")).render(
    <ErrorBoundary>
      <App {...props} />
    </ErrorBoundary>,
  );
}
