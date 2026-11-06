import { useState, type FormEvent } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Button } from "@/components/arc/button/button";
import { Badge } from "@/components/arc/badge/badge";
import { Input } from "@/components/arc/input/input";
import ThemeSwitch from "@/components/arc/theme-switch/theme-switch";
import { Brand } from "@/app/brand";
import { useApp } from "@/app/context";

export function UnlockScreen() {
  const { login, loginFriend, preferences, updatePreferences } = useApp();
  const [key, setKey] = useState("");
  const [mode, setMode] = useState<"owner" | "friend">("owner");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const failure = mode === "owner" ? await login(key) : await loginFriend(key);
    if (failure) setError(failure);
    setPending(false);
  }

  return (
    <main className="unlock-screen">
      <div className="unlock-top">
        <Brand />
        <ThemeSwitch theme={preferences.theme} onThemeChange={next => updatePreferences({ theme: next })} iconOnly />
      </div>
      <section className="unlock-card">
        <div className="unlock-emblem"><LockKey size={23} weight="regular" /></div>
        <Badge tone="neutral" color="amber" size="sm" dot>Private gateway</Badge>
        <h1>Welcome back.</h1>
        <p className="muted-copy">{mode === "owner" ? "Enter your owner access key to manage NoRav." : "Enter the friend PIN shared by the owner to start browsing."}</p>
        <div className="unlock-mode" role="tablist" aria-label="Access type"><button type="button" role="tab" aria-selected={mode === "owner"} className={mode === "owner" ? "active" : ""} onClick={() => { setMode("owner"); setError(""); setKey(""); }}>Owner</button><button type="button" role="tab" aria-selected={mode === "friend"} className={mode === "friend" ? "active" : ""} onClick={() => { setMode("friend"); setError(""); setKey(""); }}>Friend</button></div>
        <form className="unlock-form" onSubmit={submit}>
          <label htmlFor="access-key">{mode === "owner" ? "Access key" : "Friend PIN"}</label>
          <Input
            id="access-key" label={mode === "owner" ? "Access key" : "Friend PIN"} type="password" inputMode={mode === "friend" ? "numeric" : undefined} autoComplete="current-password"
            placeholder={mode === "owner" ? "Paste your access key" : "Enter friend PIN"} value={key}
            onChange={event => setKey(event.target.value)} required
          />
          {error && <p className="field-error" role="alert">{error}</p>}
          <Button type="submit" loading={pending} disabled={pending || !key.trim()} className="unlock-submit">
            {mode === "owner" ? "Unlock NoRav" : "Start browsing"} <ArrowRight size={16} />
          </Button>
        </form>
        <div className="unlock-footnote"><ShieldCheck size={15} /> Your access stays in a protected session cookie.</div>
      </section>
      <footer className="unlock-footer">NO ACCOUNT REQUIRED <span /> SELF-HOSTED BY DESIGN</footer>
    </main>
  );
}
