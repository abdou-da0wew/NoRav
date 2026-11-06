import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Key } from "@phosphor-icons/react/Key";
import { Laptop } from "@phosphor-icons/react/Laptop";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserMinus } from "@phosphor-icons/react/UserMinus";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";

type Session = {
  id: string; role: "owner" | "friend"; ip: string; userAgent: string;
  createdAt: string; lastSeen: string; expiresAt: string;
};

export function FriendsPanel() {
  const [pin, setPin] = useState("");
  const [pinEnabled, setPinEnabled] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/friends", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Could not load access sessions.");
    const result = await response.json() as { pinEnabled: boolean; sessions: Session[] };
    setPinEnabled(result.pinEnabled); setSessions(result.sessions);
  }, []);

  useEffect(() => { void refresh().catch(value => setError(value instanceof Error ? value.message : "Could not load sessions.")); }, [refresh]);

  async function savePIN(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/friend-pin", {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, enabled: true }),
      });
      const result = await response.json() as { error?: string; pinEnabled?: boolean };
      if (!response.ok) throw new Error(result.error || "Could not save the friend PIN.");
      setPinEnabled(Boolean(result.pinEnabled)); setPin(""); setMessage("Friend access PIN updated.");
    } catch (value) { setError(value instanceof Error ? value.message : "Could not save the friend PIN."); }
    finally { setBusy(false); }
  }

  async function disablePIN() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/friend-pin", {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not disable friend access.");
      setPinEnabled(false); setMessage("Friend access is disabled."); await refresh();
    } catch (value) { setError(value instanceof Error ? value.message : "Could not disable friend access."); }
    finally { setBusy(false); }
  }

  async function act(id: string, action: "revoke" | "kick" | "ban-ip" | "ban-device") {
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/sessions/" + encodeURIComponent(id) + "/" + action, { method: "POST", credentials: "include" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The session action failed.");
      setMessage(action === "ban-ip" ? "IP blocked and matching sessions revoked." : action === "ban-device" ? "Device blocked and matching sessions revoked." : action === "kick" ? "Session kicked." : "Session revoked.");
      await refresh();
    } catch (value) { setError(value instanceof Error ? value.message : "The session action failed."); }
  }

  return (
    <section id="friends" className="settings-panel friends-panel">
      <div className="settings-section-intro">
        <div><h2>Friend access</h2><p>Give friends a separate browsing-only PIN. Owner controls stay private.</p></div>
        <span className={"friend-state " + (pinEnabled ? "enabled" : "")}>{pinEnabled ? "Enabled" : "Disabled"}</span>
      </div>
      <form className="friend-pin-form" onSubmit={savePIN}>
        <div className="friend-pin-icon"><Key size={19} /></div>
        <div className="friend-pin-copy"><strong>Friend Access PIN</strong><p>Use 4–12 digits. Friends can browse, but cannot open settings or manage sessions.</p></div>
        <div className="friend-pin-input"><Input label="Friend PIN" type="password" inputMode="numeric" autoComplete="new-password" placeholder={pinEnabled ? "Enter a new PIN" : "Create a PIN"} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))} /></div>
        <Button type="submit" size="sm" loading={busy} disabled={busy || pin.length < 4 || pin.length > 12}>Save PIN</Button>
        {pinEnabled && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void disablePIN()}>Disable</Button>}
      </form>
      {message && <p className="friends-feedback success" role="status">{message}</p>}
      {error && <p className="friends-feedback error" role="alert">{error}</p>}
      <div className="friend-sessions-heading"><div><h3>Sessions</h3><p>Active owner and friend devices connected to NoRav.</p></div><Button variant="ghost" size="sm" onClick={() => void refresh()}>Refresh</Button></div>
      <div className="friend-session-list">
        {sessions.length === 0 && <div className="friend-empty">No active sessions to show.</div>}
        {sessions.map(session => (
          <article className="friend-session" key={session.id}>
            <div className="friend-session-icon">{session.role === "friend" ? <Laptop size={18} /> : <ShieldCheck size={18} />}</div>
            <div className="friend-session-details">
              <div className="friend-session-title"><strong>{session.role === "friend" ? "Friend session" : "Owner session"}</strong><span>{session.ip || "Unknown IP"}</span></div>
              <p>{session.userAgent || "Unknown browser"}</p>
              <small>Connected {new Date(session.createdAt).toLocaleString()} · Last active {new Date(session.lastSeen).toLocaleString()}</small>
            </div>
            <div className="friend-session-actions">
              <Button variant="ghost" size="sm" onClick={() => void act(session.id, "revoke")} aria-label="Revoke session"><UserMinus size={15} /> Revoke</Button>
              <Button variant="ghost" size="sm" onClick={() => void act(session.id, "kick")}>Kick</Button>
              <Button variant="ghost" size="sm" onClick={() => void act(session.id, "ban-ip")}>Ban IP</Button>
              <Button variant="ghost" size="sm" onClick={() => void act(session.id, "ban-device")}>Ban device</Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
