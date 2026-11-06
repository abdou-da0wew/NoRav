export function normalizeDestination(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/\s/.test(value) && !/^[a-z]+:\/\//i.test(value)) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  const parsed = new URL(candidate);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS websites can be opened.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Website addresses cannot contain embedded credentials.");
  }
  return parsed.href;
}

export function getProxyOrigin(): string {
  const configured = import.meta.env.VITE_NORAV_PROXY_ORIGIN as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  const host = window.location.hostname.includes(":")
    ? `[${window.location.hostname}]`
    : window.location.hostname;
  return `${window.location.protocol}//${host}:7846`;
}

export function makeProxyURL(target: string): string {
  const route = new URL("/proxy", getProxyOrigin());
  route.searchParams.set("url", target);
  return route.href;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds.toFixed(0)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function shortHost(target: string): string {
  try {
    return new URL(target).hostname.replace(/^www\./, "");
  } catch {
    return "New tab";
  }
}
