import { LayoutGrid, Menu, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Breadcrumbs } from "./Breadcrumbs";
import { useCommandStore } from "../stores/command";
import { ThemeToggle } from "./ThemeToggle";
import { CompanySwitcher } from "./CompanySwitcher";
import { SyncStatusPopover } from "@runly/ui";
import { NotificationBell } from "./NotificationBell";
import { ChatBell } from "./ChatBell";
import { HelpButton } from "./HelpButton";
import { UserMenu } from "./UserMenu";
import { useOfflineStore } from "@runly/offline";

export function Topbar({
  onLauncherOpen,
  onMobileMenuToggle,
  onModuleMenuToggle,
  networkBusy = false,
  activeModuleKey = null,
  canInstall = false,
  manualInstallReady = false,
  onInstall,
}) {
  const { session, userProfile } = useAuth();
  const { openCommand } = useCommandStore();
  const navigate = useNavigate();
  const token = session?.access_token;
  const isOnline     = useOfflineStore((s) => s.isOnline);
  const pendingCount = useOfflineStore((s) => s.pendingCount);
  const isSyncing    = useOfflineStore((s) => s.isSyncing);
  const lastSyncAt   = useOfflineStore((s) => s.lastSyncAt);
  const syncError    = useOfflineStore((s) => s.syncError);
  const canReadNotifications = Boolean(
    userProfile?.isAdmin ||
    (userProfile?.permissions ?? []).includes("notifications.read"),
  );
  const canReadChat = Boolean(
    userProfile?.isAdmin ||
    (userProfile?.permissions ?? []).includes("chat.conversations.read"),
  );
  const canReadActivity = Boolean(
    userProfile?.isAdmin ||
    (userProfile?.permissions ?? []).includes("activity.read"),
  );

  function handleNotificationNavigate(href) {
    if (!href) return;
    if (/^https?:\/\//i.test(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    // Links stored in activity/notification records omit the /app prefix
    const resolved = href.startsWith("/m/") ? `/app${href}` : href;
    navigate(resolved);
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-topbar safe-top glass dark:bg-[rgba(10,17,38,0.88)] border-b border-[hsl(var(--border))] flex flex-col justify-end">
      <div className="h-14 grid grid-cols-[auto_1fr_auto] items-center px-4 gap-2">
        {/* Left section */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Fullscreen module menu trigger — always visible on all breakpoints */}
          {onModuleMenuToggle && (
            <button
              className="h-9 w-9 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer"
              onClick={onModuleMenuToggle}
              aria-label="Abrir navegacion del modulo"
            >
              <Menu size={18} />
            </button>
          )}
          {/* Mobile hamburger — only shown when a regular sidebar is active */}
          {onMobileMenuToggle && !onModuleMenuToggle && (
            <button
              className="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer"
              onClick={onMobileMenuToggle}
              aria-label="Abrir menu"
            >
              <Menu size={18} />
            </button>
          )}

          {/* Logo mark — click to go home */}
          <button
            onClick={() => navigate("/app/home")}
            title="Inicio"
            className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-opacity duration-150 hover:opacity-80 overflow-hidden"
          >
            <img
              src="/runly/runly-isotipo-light.png"
              alt="Runly ERP"
              className="w-full h-full object-contain dark:hidden"
              draggable={false}
            />
            <img
              src="/runly/runly-isotipo-dark.png"
              alt="Runly ERP"
              className="hidden w-full h-full object-contain dark:block"
              draggable={false}
            />
          </button>

          {/* App launcher */}
          <button
            onClick={onLauncherOpen}
            title="Aplicaciones (Ctrl+.)"
            className="h-9 w-9 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer"
          >
            <LayoutGrid size={16} />
          </button>

          {/* Breadcrumb */}
          <Breadcrumbs />
        </div>

        {/* Center section: command-palette bar. Lives in the grid's middle
            `1fr` column, which only ever spans the space left over between
            the left and right clusters — unlike the old `absolute
            left-1/2` centering (relative to the full header width, ignoring
            both siblings), it can never overlap the right cluster when that
            cluster gets wide (company switcher + sync status + bell icons +
            user menu, all at once around the lg breakpoint). `min-w-0` lets
            the column shrink below the button's own width instead of
            forcing an overflow, and `max-w-full` on the button lets it
            actually shrink to fit. `invisible` (not `hidden`) below lg so
            the grid keeps 3 columns at every breakpoint — `hidden` removes
            the element from grid auto-placement entirely, which would push
            the right cluster into this middle column instead of column 3. */}
        <div className="flex items-center justify-center min-w-0 px-2 invisible lg:visible">
          <button
            onClick={openCommand}
            className="flex h-9 w-64 max-w-full items-center gap-2 px-3 rounded-xl glass-subtle hover:brightness-105 border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] transition-all duration-150 cursor-pointer"
          >
            <Search size={13} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate text-xs text-left">
              Buscar o ejecutar...
            </span>
            <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[hsl(var(--border))] text-[10px] font-mono text-[hsl(var(--muted-foreground))] leading-none shrink-0">
              Ctrl+K
            </kbd>
          </button>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-1 justify-self-end min-w-0">
          {/* Command-palette trigger (icon) — below lg only; the full centred
              bar takes over at lg+. */}
          <button
            onClick={openCommand}
            aria-label="Buscar o ejecutar"
            title="Buscar o ejecutar (Ctrl+K)"
            className="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer"
          >
            <Search size={16} />
          </button>
          <SyncStatusPopover
            isOnline={isOnline}
            isSyncing={isSyncing}
            lastSyncAt={lastSyncAt}
            pendingCount={pendingCount}
            syncError={syncError}
            networkBusy={networkBusy}
          />
          {token && (
            <span className="hidden md:contents">
              <CompanySwitcher />
            </span>
          )}
          {/* ThemeToggle — hidden on mobile, accessible via UserMenu */}
          <span className="hidden sm:contents">
            <ThemeToggle />
          </span>
          {token && canReadChat && (
            <ChatBell onOpen={() => navigate("/app/m/runly.chat/chat/inbox")} />
          )}
          {token && canReadNotifications && (
            <NotificationBell
              token={token}
              onNavigate={handleNotificationNavigate}
              onSeeAll={() => navigate("/app/m/runly.notifications")}
            />
          )}
          {token && <HelpButton />}
          {/* Activity + "instalar modulo" live only in UserMenu now, at every
              breakpoint — was two more always-on icons crowding this cluster
              on top of sync/company/notifications/theme, which is what was
              colliding with the centered search bar around the lg
              breakpoint. See UserMenu.jsx. */}
          <UserMenu
            activeModuleKey={activeModuleKey}
            canInstall={canInstall}
            manualInstallReady={manualInstallReady}
            onInstall={onInstall}
            canReadActivity={canReadActivity}
            onActivityOpen={() => navigate("/app/m/runly.activity")}
          />
        </div>
      </div>
    </header>
  );
}
