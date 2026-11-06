import type { ReactNode, Dispatch, SetStateAction } from "react";

export type Theme = "light" | "dark";
export type MediaQuality = "quality" | "balanced" | "saver";

export interface Preferences {
  theme: Theme;
  reduceMotion: boolean;
  adaptivePerformance: boolean;
  lowPowerMode: boolean;
  dataSaver: boolean;
  animationIntensity: number;
  mediaQuality: MediaQuality;
}

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  time: string;
  read?: boolean;
  tone?: "info" | "success" | "warning";
}

export interface IPStat {
  ip: string;
  requests: number;
  errors: number;
  bytesIn: number;
  bytesOut: number;
  lastSeen: string;
}

export interface RequestEvent {
  time: string;
  requestId: string;
  traceId: string;
  clientIp: string;
  method: string;
  path: string;
  host?: string;
  status: number;
  durationMs: number;
  bytesIn: number;
  bytesOut: number;
}

export interface AnalyticsSnapshot {
  uptimeSeconds: number;
  requests: number;
  errors: number;
  bytesIn: number;
  bytesOut: number;
  averageLatencyMs: number;
  methods: Record<string, number>;
  statuses: Record<string, number>;
  topHosts: { host: string; requests: number }[];
  topIPs: IPStat[];
  recentRequests: RequestEvent[];
  ioUring: boolean;
  ioUringDial: boolean;
}

export interface AppContextValue {
  authenticated: boolean;
  role: "owner" | "friend" | null;
  checkingAuth: boolean;
  login: (key: string) => Promise<string | null>;
  loginFriend: (pin: string) => Promise<string | null>;
  logout: () => Promise<void>;
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
  notifications: NotificationItem[];
  setNotifications: Dispatch<SetStateAction<NotificationItem[]>>;
  openCommandPalette: () => void;
}

export interface SettingRowProps {
  icon: ReactNode;
  title: string;
  description: string;
  control: ReactNode;
}
