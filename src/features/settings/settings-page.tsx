import { useMemo } from "react";
import { FriendsPanel } from "./friends-panel";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { Gauge } from "@phosphor-icons/react/Gauge";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { Monitor } from "@phosphor-icons/react/Monitor";
import { Moon } from "@phosphor-icons/react/Moon";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { SlidersHorizontal } from "@phosphor-icons/react/SlidersHorizontal";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Sun } from "@phosphor-icons/react/Sun";
import { Badge } from "@/components/arc/badge/badge";
import { Switch } from "@/components/arc/switch/switch";
import { Slider } from "@/components/arc/slider/slider";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import ThemeSwitch from "@/components/arc/theme-switch/theme-switch";
import { PageHeading } from "@/app/page-heading";
import { SettingRow } from "@/app/setting-row";
import { useApp } from "@/app/context";
import type { MediaQuality } from "@/lib/types";

export function SettingsPage() {
  const { preferences, updatePreferences } = useApp();
  const device = navigator as Navigator & { deviceMemory?: number };
  const lowEnd = (device.deviceMemory !== undefined && device.deviceMemory <= 4)
    || (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 4);
  const adaptive = preferences.adaptivePerformance && lowEnd;

  const deviceLabel = useMemo(() => {
    const cores = navigator.hardwareConcurrency || "Unknown";
    const memory = device.deviceMemory ? ` · ${device.deviceMemory} GB reported memory` : "";
    return `${cores} logical cores${memory}`;
  }, [device.deviceMemory]);

  return (
    <section className="settings-page page-section">
      <PageHeading
        title="Settings"
        description="Tune the browsing experience and how NoRav spends your device's resources."
        icon={<SlidersHorizontal size={19} />}
      />
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <span className="settings-sidebar-label">PREFERENCES</span>
          <a href="#performance" className="settings-anchor active"><Gauge size={16} /> Performance</a>
          <a href="#appearance" className="settings-anchor"><Monitor size={16} /> Appearance</a>
          <a href="#privacy" className="settings-anchor"><ShieldCheck size={16} /> Privacy</a>
          <a href="#friends" className="settings-anchor"><ShieldCheck size={16} /> Friend access</a>
        </aside>
        <div className="settings-panels">
          <section id="performance" className="settings-panel">
            <div className="settings-section-intro">
              <div><h2>Performance profile</h2><p>Keep the interface responsive without wasting cycles on decoration.</p></div>
              <Badge tone={adaptive || preferences.lowPowerMode ? "success" : "neutral"} dot>
                {adaptive || preferences.lowPowerMode ? "Efficiency mode" : "Balanced mode"}
              </Badge>
            </div>
            <SettingRow
              icon={<Sparkle size={18} />}
              title="Adapt to this device"
              description={lowEnd
                ? "This device reports limited memory or CPU capacity. NoRav will reduce nonessential motion and effects."
                : "Scale motion and visual effects down automatically on underpowered devices."}
              control={<Switch checked={preferences.adaptivePerformance} onCheckedChange={value => updatePreferences({ adaptivePerformance: value })} aria-label="Adapt to this device" />}
            />
            <SettingRow
              icon={<Lightning size={18} />}
              title="Low-power mode"
              description="Disable decorative animations and use the lightest interface presentation."
              control={<Switch checked={preferences.lowPowerMode} onCheckedChange={value => updatePreferences({ lowPowerMode: value })} aria-label="Low-power mode" />}
            />
            <SettingRow
              icon={<Pulse size={18} />}
              title="Reduce motion"
              description="Respect reduced-motion preferences and remove nonessential movement throughout NoRav."
              control={<Switch checked={preferences.reduceMotion} onCheckedChange={value => updatePreferences({ reduceMotion: value })} aria-label="Reduce motion" />}
            />
            <div className="setting-slider">
              <div className="setting-slider-heading">
                <div><h3>Motion intensity</h3><p>Used only when reduced motion and low-power mode are off.</p></div>
                <span>{preferences.animationIntensity}%</span>
              </div>
              <Slider label="Motion intensity" min={0} max={100} step={1} value={preferences.animationIntensity} onValueChange={value => updatePreferences({ animationIntensity: value })} showValue={false} />
              <div className="slider-labels"><span>Subtle</span><span>Expressive</span></div>
            </div>
            <SettingRow
              icon={<Gauge size={18} />}
              title="Data saver"
              description="Prefer lighter visual assets and avoid extra media in the NoRav interface."
              control={<Switch checked={preferences.dataSaver} onCheckedChange={value => updatePreferences({ dataSaver: value })} aria-label="Data saver" />}
            />
            <div className="setting-slider">
              <div className="setting-slider-heading">
                <div><h3>Media handling</h3><p>Sets resource hints for NoRav's own interface.</p></div>
              </div>
              <SegmentedControl
                value={preferences.mediaQuality}
                onValueChange={value => updatePreferences({ mediaQuality: value as MediaQuality, dataSaver: value === "saver" })}
                options={[
                  { value: "quality", label: "Quality" },
                  { value: "balanced", label: "Balanced" },
                  { value: "saver", label: "Saver" },
                ]}
                label="Media handling"
              />
            </div>
            <div className="device-detection">
              <div className="device-detection-icon"><Monitor size={17} /></div>
              <div><strong>Device profile</strong><p>{deviceLabel}</p></div>
              <Badge tone={lowEnd ? "warning" : "success"}>{lowEnd ? "Low-end profile" : "Standard profile"}</Badge>
            </div>
          </section>

          <section id="appearance" className="settings-panel">
            <div className="settings-section-intro"><div><h2>Appearance</h2><p>A calm interface that stays out of the website's way.</p></div></div>
            <SettingRow
              icon={preferences.theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
              title="Color theme"
              description="Switch the NoRav dashboard between light and dark."
              control={<ThemeSwitch theme={preferences.theme} onThemeChange={next => updatePreferences({ theme: next })} />}
            />
            <div className="appearance-preview">
              <button className={`appearance-tile ${preferences.theme === "dark" ? "selected" : ""}`} onClick={() => updatePreferences({ theme: "dark" })}>
                <div className="preview-dark"><span /><span /><span /></div><strong>Dark</strong><small>Dim, focused surfaces</small>
              </button>
              <button className={`appearance-tile ${preferences.theme === "light" ? "selected" : ""}`} onClick={() => updatePreferences({ theme: "light" })}>
                <div className="preview-light"><span /><span /><span /></div><strong>Light</strong><small>Bright, clear surfaces</small>
              </button>
            </div>
          </section>

          <section id="privacy" className="settings-panel">
            <div className="settings-section-intro"><div><h2>Privacy and safety</h2><p>Controls that apply to the proxy gateway.</p></div></div>
            <div className="privacy-summary">
              <div className="privacy-summary-icon"><ShieldCheck size={20} /></div>
              <div><strong>Destination network guard is active</strong><p>Private, loopback, link-local and reserved address ranges are blocked by the backend.</p></div>
              <Badge tone="success" dot>Enforced</Badge>
            </div>
            <div className="privacy-summary">
              <div className="privacy-summary-icon"><LockKeyIcon /></div>
              <div><strong>Upstream cookies are isolated</strong><p>Website cookies are stored in a NoRav session jar, not the dashboard's browser storage.</p></div>
              <Badge tone="success" dot>Isolated</Badge>
            </div>
          </section>
          <FriendsPanel />
        </div>
      </div>
    </section>
  );
}

function LockKeyIcon() {
  return <ShieldCheck size={19} />;
}
