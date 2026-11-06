import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from "react";
import { MotionConfig } from "motion/react";
import { checkSession, loginWithKey, loginWithPIN, logoutSession } from "@/lib/api";
import type { AppContextValue, NotificationItem, Preferences } from "@/lib/types";

const defaults: Preferences = {
  theme: "dark",
  reduceMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  adaptivePerformance: true, lowPowerMode: false, dataSaver: false,
  animationIntensity: 58, mediaQuality: "balanced",
};

function readPreferences(): Preferences {
  try {
    const raw = localStorage.getItem("norav.preferences");
    return raw ? { ...defaults, ...JSON.parse(raw) } as Preferences : defaults;
  } catch {
    return defaults;
  }
}

const AppContext = createContext<AppContextValue | null>(null);
const PaletteContext = createContext<{ open: boolean; setOpen: (value: boolean) => void } | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("NoRav app context is unavailable.");
  return value;
}

export function usePalette() {
  const value = useContext(PaletteContext);
  if (!value) throw new Error("Command palette state is unavailable.");
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<"owner" | "friend" | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    { id: "runtime", title: "NoRav runtime ready", description: "Your private browsing gateway is responding.", time: "This session", tone: "success", read: false },
    { id: "guard", title: "Destination guard enabled", description: "Private and link-local network destinations are blocked.", time: "This session", tone: "info", read: false },
  ]);
  const device = navigator as Navigator & { deviceMemory?: number };
  const lowEndDevice = (device.deviceMemory !== undefined && device.deviceMemory <= 4)
    || (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 4);
  const forceReducedMotion = preferences.reduceMotion || preferences.lowPowerMode
    || (preferences.adaptivePerformance && lowEndDevice);

  useEffect(() => {
    let active = true;
    checkSession()
      .then(result => { if (active) { setAuthenticated(result.authenticated); setRole(result.role); } })
      .catch(() => { if (active) { setAuthenticated(false); setRole(null); } })
      .finally(() => { if (active) setCheckingAuth(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const valid = await checkSession();
        setAuthenticated(valid.authenticated);
        setRole(valid.role);
      } catch {
        // A temporary network failure must not log out a still-valid session.
      } finally {
        refreshing = false;
      }
    };

    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authenticated]);

  useEffect(() => {
    localStorage.setItem("norav.preferences", JSON.stringify(preferences));
    const root = document.documentElement;
    const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const lowEnd = (device.deviceMemory !== undefined && device.deviceMemory <= 4)
      || (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 4);
    const reduced = preferences.reduceMotion || preferences.lowPowerMode;
    const adaptive = preferences.adaptivePerformance && lowEnd;
    root.dataset.theme = preferences.theme;
    root.dataset.motion = reduced || adaptive ? "reduced" : "full";
    root.dataset.performance = preferences.lowPowerMode || adaptive ? "low" : "auto";
    root.dataset.dataSaver = String(preferences.dataSaver || device.connection?.saveData === true);
    root.style.setProperty("--norav-motion-scale", reduced || adaptive ? "0" : String(preferences.animationIntensity / 100));
  }, [preferences]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences(current => ({ ...current, ...patch }));
  }, []);

  const login = useCallback(async (key: string) => {
    try {
      const failure = await loginWithKey(key);
      if (!failure) { setAuthenticated(true); setRole("owner"); }
      return failure;
    } catch {
      return "NoRav could not reach the local gateway.";
    }
  }, []);

  const loginFriend = useCallback(async (pin: string) => {
    try {
      const error = await loginWithPIN(pin);
      if (error) return error;
      setAuthenticated(true);
      setRole("friend");
      return null;
    } catch {
      return "NoRav could not reach the gateway.";
    }
  }, []);

  const logout = useCallback(async () => {
    await logoutSession().catch(() => undefined);
    setAuthenticated(false);
    setRole(null);
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    authenticated, role, checkingAuth, login, loginFriend, logout, preferences, updatePreferences,
    notifications,
    setNotifications: setNotifications as Dispatch<SetStateAction<NotificationItem[]>>,
    openCommandPalette: () => setPaletteOpen(true),
  }), [authenticated, role, checkingAuth, login, loginFriend, logout, preferences, updatePreferences, notifications]);

  return (
    <MotionConfig reducedMotion={forceReducedMotion ? "always" : "user"}>
      <AppContext.Provider value={value}>
        <PaletteContext.Provider value={{ open: paletteOpen, setOpen: setPaletteOpen }}>
          {children}
        </PaletteContext.Provider>
      </AppContext.Provider>
    </MotionConfig>
  );
}