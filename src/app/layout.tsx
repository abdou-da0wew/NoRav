import { lazy, Suspense, useEffect, useMemo } from "react";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { Command } from "@phosphor-icons/react/Command";
import { House } from "@phosphor-icons/react/House";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { Moon } from "@phosphor-icons/react/Moon";
import { SlidersHorizontal } from "@phosphor-icons/react/SlidersHorizontal";
import { Sun } from "@phosphor-icons/react/Sun";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/arc/button/button";
import ThemeSwitch from "@/components/arc/theme-switch/theme-switch";
import type { CommandItem } from "@/components/arc/command-palette/command-palette";
import { BootScreen, Brand } from "@/app/brand";
import { useApp, usePalette } from "@/app/context";
import { getProxyOrigin } from "@/lib/utils";

const UnlockScreen = lazy(() => import("@/features/auth/unlock-screen").then(module => ({ default: module.UnlockScreen })));
const LandingPage = lazy(() => import("@/features/landing/landing-page").then(module => ({ default: module.LandingPage })));
const NotificationCenter = lazy(() => import("@/components/arc/notification-center/notification-center"));
const CommandPalette = lazy(() => import("@/components/arc/command-palette/command-palette"));

export function RootLayout() {
  const { authenticated, checkingAuth } = useApp();
  const pathname = useRouterState({ select: state => state.location.pathname });
  if (checkingAuth) return <BootScreen />;
  if (!authenticated) {
    return <Suspense fallback={<BootScreen />}>
      {pathname === "/unlock" ? <UnlockScreen /> : <LandingPage />}
    </Suspense>;
  }
  return <Workspace />;
}

function Workspace() {
  const {
    role, preferences, updatePreferences, notifications, setNotifications, logout,
  } = useApp();
  const { open, setOpen } = usePalette();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: state => state.location.pathname });

  useEffect(() => {
    if (role === "friend" && pathname !== "/") void navigate({ to: "/" });
  }, [role, pathname, navigate]);

  const commands = useMemo<CommandItem[]>(() => [
    { id: "home", label: "Open browser", description: "Return to NoRav browser", group: "Navigate", keywords: ["home", "browse"], icon: <House size={16} />, shortcut: "G H" },
    { id: "analytics", label: "Open analytics", description: "Traffic, latency and request traces", group: "Navigate", keywords: ["metrics", "logs", "requests"], icon: <Pulse size={16} /> },
    { id: "settings", label: "Open settings", description: "Performance, privacy and appearance", group: "Navigate", keywords: ["preferences", "motion"], icon: <SlidersHorizontal size={16} />, shortcut: "G S" },
    { id: "theme", label: "Toggle appearance", description: "Switch between light and dark", group: "Actions", icon: preferences.theme === "dark" ? <Sun size={16} /> : <Moon size={16} /> },
    { id: "logout", label: "Lock NoRav", description: "End this browsing session", group: "Account", icon: <LockKey size={16} /> },
  ].filter(item => role === "owner" || !["analytics", "settings"].includes(item.id)), [preferences.theme, role]);

  function selectCommand(item: CommandItem) {
    setOpen(false);
    if (item.id === "home") void navigate({ to: "/" });
    if (item.id === "analytics") void navigate({ to: "/analytics" });
    if (item.id === "settings") void navigate({ to: "/settings" });
    if (item.id === "theme") updatePreferences({ theme: preferences.theme === "dark" ? "light" : "dark" });
    if (item.id === "logout") void logout();
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>(".website-frame");
      if (event.origin !== getProxyOrigin() || event.source !== frame?.contentWindow) return;
      if (event.data?.type !== "norav:navigation" || typeof event.data.url !== "string") return;
      window.dispatchEvent(new CustomEvent("norav:navigation", { detail: event.data.url }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-left">
          <Brand />
        </div>
        <nav className="top-nav" aria-label="Main navigation">
          <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "nav-link active" }} className="nav-link">
            <House size={16} /> Browser
          </Link>
          <Link to="/analytics" activeProps={{ className: "nav-link active" }} className="nav-link">
            <Pulse size={16} /> Activity
          </Link>
          <Link to="/settings" activeProps={{ className: "nav-link active" }} className="nav-link">
            <SlidersHorizontal size={16} /> Settings
          </Link>
        </nav>
        <div className="topbar-actions">
          {role === "owner" && <Button variant="ghost" size="sm" className="command-trigger" onClick={() => setOpen(true)}>
            <Command size={15} /><span>Quick actions</span><kbd>⌘ K</kbd>
          </Button>}
          {role === "owner" && <Suspense fallback={<span className="notification-placeholder" />}>
            <NotificationCenter
              notifications={notifications}
              label="Notifications"
              onReadChange={(notification, read) => setNotifications(items => items.map(item => item.id === notification.id ? { ...item, read } : item))}
              onDismiss={notification => setNotifications(items => items.filter(item => item.id !== notification.id))}
            />
          </Suspense>}
          <ThemeSwitch theme={preferences.theme} onThemeChange={next => updatePreferences({ theme: next })} iconOnly />
          <Button variant="ghost" size="sm" className="avatar-button" aria-label="Lock NoRav" onClick={() => void logout()}>
            <LockKey size={17} />
          </Button>
        </div>
      </header>

      <main className="workspace-content"><Outlet /></main>
      {role === "owner" && open && <Suspense fallback={null}><CommandPalette items={commands} placeholder="Search NoRav or run a command..." onSelect={selectCommand} onClose={() => setOpen(false)} autoFocus /></Suspense>}
    </div>
  );
}
