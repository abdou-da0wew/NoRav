import type { AnalyticsSnapshot } from "./types";

export async function checkSession(): Promise<{ authenticated: boolean; role: "owner" | "friend" | null }> {
  const response = await fetch("/api/auth/session", { credentials: "include" });
  if (!response.ok) throw new Error("Session check failed.");
  const result = await response.json() as { authenticated: boolean; role?: "owner" | "friend" };
  return { authenticated: result.authenticated, role: result.authenticated ? result.role ?? "owner" : null };
}

export async function loginWithKey(accessKey: string): Promise<string | null> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  const result = await response.json() as { error?: string; authenticated?: boolean };
  if (!response.ok || !result.authenticated) {
    return result.error || "Unable to unlock NoRav.";
  }
  return null;
}


export async function loginWithPIN(pin: string): Promise<string | null> {
  const response = await fetch("/api/auth/friend", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const result = await response.json() as { error?: string; authenticated?: boolean };
  if (!response.ok || !result.authenticated) return result.error || "Unable to open friend access.";
  return null;
}

export async function createProxySession(url: string): Promise<string> {
  const response = await fetch("/api/proxy/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const result = await response.json() as { url?: string; error?: string };
  if (!response.ok || !result.url) {
    throw new Error(result.error || "The proxy engine could not open this website.");
  }
  return result.url;
}

export async function logoutSession(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}

export async function fetchAnalytics(): Promise<AnalyticsSnapshot> {
  const response = await fetch("/api/analytics", { credentials: "include" });
  if (!response.ok) throw new Error("Analytics are unavailable.");
  return response.json() as Promise<AnalyticsSnapshot>;
}

export async function checkGateway(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
