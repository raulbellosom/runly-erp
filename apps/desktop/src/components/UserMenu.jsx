import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, User, Settings, LogOut, Monitor, Download, X, Smartphone, Share, Sun, Moon, Activity, MessageSquare, Building2 } from "lucide-react";
import { useThemeStore } from "../stores/theme";
import { useChatFloatStore } from "../modules/runly.chat/store/chatFloatStore";
import { useActiveCompany } from "../company/ActiveCompanyProvider";
import { CompanySwitcherModal } from "./CompanySwitcherModal";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@runly/ui";
import { useAuth } from "../auth/AuthProvider";
import { RUNLY_DESKTOP_DOWNLOAD_URL, RUNLY_MOBILE_DOWNLOAD_URL } from "../lib/appConfig.js";
import { getMobilePwaInstallMode } from "../lib/pwaInstallUi.js";

const DESKTOP_REMINDER_KEY = "runly_desktop_reminder_dismissed_at";
const REMINDER_INTERVAL_MS = 2.5 * 24 * 60 * 60 * 1000;

function shouldShowDesktopReminder() {
  try {
    const ts = localStorage.getItem(DESKTOP_REMINDER_KEY);
    if (!ts) return true;
    return Date.now() - Number(ts) > REMINDER_INTERVAL_MS;
  } catch {
    return false;
  }
}

function dismissDesktopReminder() {
  try {
    localStorage.setItem(DESKTOP_REMINDER_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

function getDevicePlatform() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPhone|iPod/i.test(ua)) return "ios";
  if (/iPad/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  if (/Windows NT/i.test(ua)) return "windows";
  return "desktop";
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function getInitials(firstName, lastName) {
  const f = (firstName ?? "").charAt(0).toUpperCase();
  const l = (lastName ?? "").charAt(0).toUpperCase();
  const result = (f + l).trim();
  return result || (firstName ?? "").charAt(0).toUpperCase() || "U";
}

export function UserMenu({
  activeModuleKey = null,
  canInstall = false,
  manualInstallReady = false,
  onInstall,
  canReadActivity = false,
  onActivityOpen,
}) {
  const { userProfile, logout } = useAuth();
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const { hidden: chatHubHidden, show: showChatHub } = useChatFloatStore();
  const { activeCompany } = useActiveCompany();
  const navigate = useNavigate();
  const [showReminder, setShowReminder] = useState(() => shouldShowDesktopReminder());
  const [companyModalOpen, setCompanyModalOpen] = useState(false);

  const platform = getDevicePlatform();
  const standalone = isStandaloneMode();
  const isWindows = platform === "windows";
  const mobileInstallMode = getMobilePwaInstallMode({
    platform,
    standalone,
    activeModuleKey,
    canInstall,
    manualInstallReady,
  });

  function handleDesktopDownload() {
    window.open(RUNLY_DESKTOP_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
    dismissDesktopReminder();
    setShowReminder(false);
  }

  function handleDismissReminder(e) {
    e.stopPropagation();
    dismissDesktopReminder();
    setShowReminder(false);
  }

  const initials = getInitials(userProfile?.firstName, userProfile?.lastName);
  const displayName =
    (userProfile?.displayName ??
      `${userProfile?.firstName ?? ""} ${userProfile?.lastName ?? ""}`.trim()) ||
    "Usuario";
  const email = userProfile?.email ?? "";
  const firstName = userProfile?.firstName ?? "Usuario";

  // Show install section:
  // - Mobile: always (unless already in standalone), show platform-appropriate UI
  // - Windows desktop: show if reminder not dismissed
  const showMobileInstall = mobileInstallMode !== null;
  const showWindowsApp = isWindows && showReminder;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 h-9 pl-1 pr-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer outline-none">
          <Avatar className="h-7 w-7">
            {userProfile?.avatarUrl && (
              <AvatarImage src={userProfile.avatarUrl} alt={displayName} />
            )}
            <AvatarFallback
              className="text-[11px] font-bold"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "var(--brand-primary-foreground)",
              }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-[hsl(var(--foreground))] max-w-20 truncate hidden sm:block">
            {firstName}
          </span>
          <ChevronDown
            size={13}
            className="text-[hsl(var(--muted-foreground))]"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* User info header */}
        <div className="px-2 py-2.5 border-b border-[hsl(var(--border))] mb-1">
          <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
            {displayName}
          </p>
          {email && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
              {email}
            </p>
          )}
        </div>

        <DropdownMenuItem
          onClick={() => navigate("/app/profile")}
          className="gap-2 cursor-pointer"
        >
          <User size={14} />
          Mi perfil
        </DropdownMenuItem>
        {(userProfile?.isAdmin ||
          userProfile?.permissions?.includes("platform.settings.manage")) && (
          <DropdownMenuItem
            onClick={() => navigate("/app/m/runly.core/settings")}
            className="gap-2 cursor-pointer"
          >
            <Settings size={14} />
            Configuración
          </DropdownMenuItem>
        )}

        {/* ── Mobile PWA install section ── */}
        {showMobileInstall && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Smartphone size={12} className="text-[hsl(var(--muted-foreground))] shrink-0" />
                <p className="text-xs font-medium text-[hsl(var(--foreground))]">Instalar app</p>
              </div>

              {mobileInstallMode === "prompt" ? (
                /* Android Chrome — browser offered install prompt */
                <button
                  type="button"
                  onClick={onInstall}
                  className="flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
                >
                  <Download size={11} />
                  Agregar a pantalla de inicio
                </button>
              ) : mobileInstallMode === "prepare" ? (
                <button
                  type="button"
                  onClick={onInstall}
                  className="flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
                >
                  <Download size={11} />
                  Preparar este módulo
                </button>
              ) : platform === "ios" ? (
                /* iOS Safari — manual flow */
                <p className="text-xs text-[hsl(var(--muted-foreground))] leading-snug">
                  En Safari, toca <Share size={10} className="inline-block align-middle mx-0.5" /> y selecciona{" "}
                  <span className="font-medium text-[hsl(var(--foreground))]">Añadir a pantalla de inicio</span>.
                </p>
              ) : (
                /* Android Chrome — criteria not met yet */
                <p className="text-xs text-[hsl(var(--muted-foreground))] leading-snug">
                  En Chrome, toca{" "}
                  <span className="font-medium text-[hsl(var(--foreground))]">⋮ → Añadir a pantalla de inicio</span>.
                </p>
              )}

              {platform === "android" && (
                <a
                  href={RUNLY_MOBILE_DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 w-full text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors pt-0.5"
                >
                  <Download size={11} />
                  o descarga la app nativa (.apk)
                </a>
              )}
            </div>
          </>
        )}

        {/* ── Windows desktop app section ── */}
        {showWindowsApp && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Monitor size={12} className="text-[hsl(var(--muted-foreground))] shrink-0" />
                  <p className="text-xs font-medium text-[hsl(var(--foreground))]">App de escritorio</p>
                </div>
                <button
                  onClick={handleDismissReminder}
                  className="flex items-center justify-center h-4 w-4 rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0"
                  aria-label="Descartar"
                >
                  <X size={10} />
                </button>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] leading-snug">
                Descarga la app nativa para Windows y conéctala a esta instancia.
              </p>
              <button
                onClick={handleDesktopDownload}
                className="flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
              >
                <Download size={11} />
                Descargar para Windows
              </button>
            </div>
          </>
        )}

        {/* Mobile-only: company switcher (hidden on md+ where CompanySwitcher
            lives inline in the topbar — see Topbar.jsx's `hidden md:contents`).
            Opens a modal (CompanySwitcherModal) rather than a nested dropdown,
            which is awkward on touch. Shown whenever there's at least one
            company to display or the user could create one. */}
        {(activeCompany || userProfile?.isAdmin) && (
          <div className="md:hidden">
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setCompanyModalOpen(true)}
              className="gap-2 cursor-pointer"
            >
              <Building2 size={14} />
              <span className="flex-1 truncate">
                {activeCompany?.name ?? "Cambiar empresa"}
              </span>
            </DropdownMenuItem>
          </div>
        )}

        {/* Activity + "instalar modulo": live here at every breakpoint (used
            to be always-on topbar icons; moved in to free up space in a
            crowded right-hand cluster that was colliding with the centered
            search bar around the lg breakpoint — see Topbar.jsx). */}
        {(canReadActivity || (canInstall && activeModuleKey)) && (
          <>
            <DropdownMenuSeparator />
            {canReadActivity && (
              <DropdownMenuItem
                onClick={onActivityOpen}
                className="gap-2 cursor-pointer"
              >
                <Activity size={14} />
                Actividad
              </DropdownMenuItem>
            )}
            {canInstall && activeModuleKey && (
              <DropdownMenuItem
                onClick={onInstall}
                className="gap-2 cursor-pointer"
              >
                <Download size={14} />
                Instalar modulo como app
              </DropdownMenuItem>
            )}
          </>
        )}

        {/* Mobile-only: theme (hidden on sm+ where ThemeToggle lives in topbar) */}
        <div className="sm:hidden">
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={toggleTheme}
            className="gap-2 cursor-pointer"
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            {isDark ? "Modo claro" : "Modo oscuro"}
          </DropdownMenuItem>
        </div>

        {chatHubHidden && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={showChatHub} className="gap-2 cursor-pointer">
              <MessageSquare size={14} />
              Mostrar chat flotante
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="gap-2 cursor-pointer text-red-500 focus:text-red-500 focus:bg-red-500/10"
        >
          <LogOut size={14} />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
      {companyModalOpen && (
        <CompanySwitcherModal onClose={() => setCompanyModalOpen(false)} />
      )}
    </DropdownMenu>
  );
}
