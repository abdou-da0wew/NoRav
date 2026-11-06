import { Link } from "@tanstack/react-router";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowUpRight } from "@phosphor-icons/react/ArrowUpRight";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Relay, Router, Vault } from "@lucasmarkes/hairline/react";
import { Brand } from "@/app/brand";
import { useApp } from "@/app/context";
import WayglimBackground from "@/components/wayglim/WayglimBackground.jsx";
import { RouteHairline, SessionHairline } from "./custom-hairlines";
import "./landing.css";

export function LandingPage() {
  const { preferences } = useApp();
  const device = navigator as Navigator & { deviceMemory?: number };
  const lowEndDevice = (device.deviceMemory !== undefined && device.deviceMemory <= 4)
    || (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 4);
  const pauseWayglim = preferences.lowPowerMode || preferences.reduceMotion
    || (preferences.adaptivePerformance && lowEndDevice);

  return (
    <main className="landing-page">
      <section className="landing-hero">
        <WayglimBackground className="landing-wayglim" paused={pauseWayglim} />
        <div className="landing-hero-shade" aria-hidden="true" />
        <header className="landing-header">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </nav>
          <Link to="/unlock" className="landing-header-cta">
            <LockKey size={15} weight="regular" />
            <span>Access gateway</span>
            <ArrowUpRight size={14} />
          </Link>
        </header>

        <div className="landing-hero-content">
          <div className="landing-copy">
            <div className="landing-kicker">
              <span className="landing-kicker-dot" />
              PRIVATE BROWSING GATEWAY
            </div>
            <h1>Your web.<br /><span>On your terms.</span></h1>
            <p>
              A self-hosted gateway for the open web. Route pages through your
              own infrastructure, keep session state server-side, and see
              what your network is actually doing.
            </p>
            <div className="landing-actions">
              <Link to="/unlock" className="landing-primary">
                Open NoRav <ArrowRight size={17} weight="bold" />
              </Link>
              <a href="#features" className="landing-secondary">
                Explore the system <span>↓</span>
              </a>
            </div>
            <div className="landing-proof">
              <span><ShieldCheck size={15} /> Self-hosted by design</span>
              <i />
              <span>No account required</span>
              <i />
              <span>Access-key gated</span>
            </div>
          </div>

          <div className="landing-preview-wrap">
            <div className="landing-preview">
              <div className="preview-topline">
                <div className="preview-lights"><i /><i /><i /></div>
                <span>norav / gateway</span>
                <span className="preview-live"><b /> LIVE</span>
              </div>
              <div className="preview-figure">
                <Router
                  className="landing-hairline landing-hairline-hero"
                  label="A network router connecting incoming requests to the private gateway"
                  theme="dark"
                  intensity={0.64}
                />
              </div>
              <div className="preview-route">
                <span className="preview-route-label">REQUEST PATH</span>
                <div><b>Browser</b><span /><b>NoRav</b><span /><b>Web</b></div>
              </div>
              <div className="preview-bottom">
                <span><span className="preview-status" /> Gateway ready</span>
                <span>SELF-HOSTED · PRIVATE</span>
              </div>
            </div>
            <div className="preview-orbit orbit-one" />
            <div className="preview-orbit orbit-two" />
          </div>
        </div>
        <div className="landing-hero-bottom">
          <span>BUILT FOR CONTROL, NOT COMPLEXITY</span>
          <span>SCROLL TO EXPLORE <span>↓</span></span>
        </div>
      </section>

      <section className="landing-section landing-features" id="features">
        <div className="landing-section-heading">
          <div className="landing-kicker"><span className="landing-kicker-dot" /> THE GATEWAY</div>
          <h2>Small surface.<br /><span>Serious control.</span></h2>
          <p>NoRav keeps the browsing layer focused: route traffic, preserve session state, and make activity observable.</p>
        </div>
        <div className="landing-feature-grid">
          <article className="landing-feature-card">
            <div className="feature-card-top"><span>01 / ROUTING</span><span>↗</span></div>
            <Relay className="landing-hairline" label="Requests relayed through a gateway" theme="dark" intensity={0.58} />
            <h3>Traffic, one controlled path.</h3>
            <p>Send web requests through your own gateway instead of scattering proxy settings across the browser.</p>
          </article>
          <article className="landing-feature-card">
            <div className="feature-card-top"><span>02 / SESSIONS</span><span>↗</span></div>
            <Vault className="landing-hairline" label="A vault representing protected session state" theme="dark" intensity={0.58} />
            <h3>Sessions stay on the server.</h3>
            <p>Upstream cookies live in per-session server-side jars, rather than being handed to the dashboard as raw cookies.</p>
          </article>
          <article className="landing-feature-card">
            <div className="feature-card-top"><span>03 / VISIBILITY</span><span>↗</span></div>
            <Router className="landing-hairline" label="A router representing observable request paths" theme="dark" intensity={0.58} />
            <h3>Know what is happening.</h3>
            <p>Inspect request volume, latency, upstream hosts, client IP activity, and correlated traces from one place.</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-workflow" id="how-it-works">
        <div className="workflow-heading">
          <div className="landing-kicker"><span className="landing-kicker-dot" /> DESIGNED AROUND THE FLOW</div>
          <h2>Your traffic has<br /><span>a clear route.</span></h2>
          <p>Two small custom hairlines, drawn for NoRav rather than borrowed as generic decoration.</p>
        </div>
        <div className="workflow-figures">
          <article className="workflow-figure-card">
            <div><span>01</span><h3>Route with intent.</h3></div>
            <RouteHairline />
            <p>Requests pass through the gateway and out to the destination. Hover or focus the drawing to follow its path.</p>
          </article>
          <article className="workflow-figure-card">
            <div><span>02</span><h3>Keep state contained.</h3></div>
            <SessionHairline />
            <p>Each authenticated browsing session owns its upstream cookie jar and signed dashboard session.</p>
          </article>
        </div>
      </section>

      <section className="landing-final">
        <div className="landing-kicker"><span className="landing-kicker-dot" /> YOUR GATEWAY IS READY</div>
        <h2>Take the long way<br /><span>out of the cloud.</span></h2>
        <p>Bring the gateway closer to your infrastructure. Keep the controls in your hands.</p>
        <Link to="/unlock" className="landing-primary">
          Enter NoRav <ArrowRight size={17} weight="bold" />
        </Link>
      </section>

      <footer className="landing-footer">
        <Brand />
        <span>SELF-HOSTED WEB GATEWAY</span>
        <span>NO ACCOUNT. YOUR INFRASTRUCTURE.</span>
      </footer>
    </main>
  );
}
