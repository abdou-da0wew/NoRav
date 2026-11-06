import type { Proxy as HammerheadProxy } from "testcafe-hammerhead";
import { NoRavSession } from "./session.js";

export interface SessionEntry {
  readonly session: NoRavSession;
  readonly engineId: string;
  lastUsed: number;
}

type SessionProxy = Pick<HammerheadProxy, "closeSession">;

export class SessionRegistry {
  private readonly sessionsByOwner = new Map<string, SessionEntry>();
  private readonly sessionsByEngine = new Map<string, SessionEntry>();

  constructor(private readonly proxy: SessionProxy) {}

  get size(): number {
    return this.sessionsByOwner.size;
  }

  createOrGet(ownerSession: string): SessionEntry {
    let entry = this.sessionsByOwner.get(ownerSession);

    if (!entry) {
      const session = new NoRavSession();
      session.disableCrossDomainForNoRav();
      entry = {
        session,
        engineId: session.id,
        lastUsed: Date.now(),
      };

      this.sessionsByOwner.set(ownerSession, entry);
      this.sessionsByEngine.set(entry.engineId, entry);
    }

    this.touch(entry);
    return entry;
  }

  touchByProxyUrl(url: string | undefined): void {
    const firstSegment = (url ?? "").split("?")[0]?.split("/").filter(Boolean)[0];

    if (!firstSegment) {
      return;
    }

    const engineId = firstSegment.split("!")[0] ?? "";
    const entry = this.sessionsByEngine.get(engineId);

    if (entry) {
      this.touch(entry);
    }
  }

  remove(ownerSession: string): boolean {
    const entry = this.sessionsByOwner.get(ownerSession);

    if (!entry) {
      return false;
    }

    this.sessionsByOwner.delete(ownerSession);
    this.sessionsByEngine.delete(entry.engineId);
    this.proxy.closeSession(entry.session);
    return true;
  }

  removeExpired(lifetimeMs: number, now = Date.now()): number {
    const cutoff = now - lifetimeMs;
    let removed = 0;

    for (const [ownerSession, entry] of this.sessionsByOwner) {
      if (entry.lastUsed < cutoff && this.remove(ownerSession)) {
        removed += 1;
      }
    }

    return removed;
  }

  closeAll(): void {
    for (const ownerSession of this.sessionsByOwner.keys()) {
      this.remove(ownerSession);
    }
  }

  private touch(entry: SessionEntry): void {
    entry.lastUsed = Date.now();
  }
}
