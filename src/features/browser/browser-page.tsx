import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { Command } from "@phosphor-icons/react/Command";
import { Globe } from "@phosphor-icons/react/Globe";
import { House } from "@phosphor-icons/react/House";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { WifiHigh } from "@phosphor-icons/react/WifiHigh";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { motion } from "motion/react";
import { Button } from "@/components/arc/button/button";
import { AddressField } from "./address-field";
import { useApp } from "@/app/context";
import { createProxySession } from "@/lib/api";
import { normalizeDestination, shortHost } from "@/lib/utils";

const quickLinks = [
  {
    label: "Search",
    host: "duckduckgo.com",
    url: "https://duckduckgo.com/",
    icon: <MagnifyingGlass size={18} />,
  },
  {
    label: "Wikipedia",
    host: "wikipedia.org",
    url: "https://www.wikipedia.org/",
    icon: <Globe size={18} />,
  },
  {
    label: "GitHub",
    host: "github.com",
    url: "https://github.com/",
    icon: <Command size={18} />,
  },
  {
    label: "MDN",
    host: "developer.mozilla.org",
    url: "https://developer.mozilla.org/",
    icon: <Globe size={18} />,
  },
];

export function BrowserPage() {
  const { openCommandPalette } = useApp();
  const [address, setAddress] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [frameURL, setFrameURL] = useState("");
  const navigationRequest = useRef(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [notice, setNotice] = useState("");

  const navigateTo = useCallback(
    async (target: string, push = true) => {
      const requestId = ++navigationRequest.current;
      setNotice("");
      setFrameURL("");
      setFrameLoaded(false);
      setLoading(true);
      if (push) {
        setHistory((items) => {
          const next = items.slice(0, historyIndex + 1);
          if (next[next.length - 1] !== target) next.push(target);
          setHistoryIndex(next.length - 1);
          return next;
        });
      }
      setCurrentUrl(target);
      setAddress(target);
      try {
        const proxyURL = await createProxySession(target);
        if (requestId !== navigationRequest.current) return;
        setFrameURL(proxyURL);
      } catch (error) {
        if (requestId !== navigationRequest.current) return;
        setLoading(false);
        setNotice(
          error instanceof Error ? error.message : "The website could not be opened.",
        );
      }
    },
    [historyIndex],
  );

  useEffect(() => {
    if (!frameURL || !loading) return;
    const timeout = window.setTimeout(() => setLoading(false), 12_000);
    return () => window.clearTimeout(timeout);
  }, [frameURL, loading]);

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const target = normalizeDestination(address);
      if (target) navigateTo(target);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "That address could not be opened.",
      );
    }
  }

  function goBack() {
    if (historyIndex <= 0) return;
    const index = historyIndex - 1;
    setHistoryIndex(index);
    void navigateTo(history[index], false);
  }

  function goForward() {
    if (historyIndex < 0 || historyIndex >= history.length - 1) return;
    const index = historyIndex + 1;
    setHistoryIndex(index);
    void navigateTo(history[index], false);
  }

  function reload() {
    if (!currentUrl) return;
    void navigateTo(currentUrl, false);
  }

  useEffect(() => {
    const focusAddress = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>(".address-form input");
        input?.focus();
        input?.select();
      }
    };
    window.addEventListener("keydown", focusAddress);
    return () => window.removeEventListener("keydown", focusAddress);
  }, []);

  useEffect(() => {
    const onNavigation = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      if (typeof url !== "string" || !/^https?:\/\//i.test(url) || url === currentUrl)
        return;
      setCurrentUrl(url);
      setAddress(url);
      setHistory((items) => {
        const next = items.slice(0, historyIndex + 1);
        if (next[next.length - 1] !== url) next.push(url);
        setHistoryIndex(next.length - 1);
        return next;
      });
      setLoading(true);
      setFrameLoaded(false);
    };
    window.addEventListener("norav:navigation", onNavigation);
    return () => window.removeEventListener("norav:navigation", onNavigation);
  }, [currentUrl, historyIndex]);

  const openQuickLink = (url: string) => void navigateTo(url);

  return (
    <section className={`browser-page ${currentUrl ? "browser-page-active" : ""}`}>
      <div className="browser-toolbar">
        <div className="browser-nav-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={historyIndex <= 0}
            aria-label="Go back"
            onClick={goBack}
          >
            <ArrowLeft size={17} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={historyIndex < 0 || historyIndex >= history.length - 1}
            aria-label="Go forward"
            onClick={goForward}
          >
            <ArrowRight size={17} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!currentUrl}
            aria-label="Reload website"
            onClick={reload}
          >
            <ArrowClockwise size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Go home"
            onClick={() => {
              navigationRequest.current++;
              setCurrentUrl("");
              setFrameURL("");
              setAddress("");
              setNotice("");
              setLoading(false);
            }}
          >
            <House size={16} />
          </Button>
        </div>
        <form className="address-form" onSubmit={submit}>
          <div className="address-security">
            <ShieldCheck size={15} />
          </div>
          <AddressField
            className="toolbar-address-field"
            variant="toolbar"
            label="Website address"
            value={address}
            onValueChange={setAddress}
            placeholder="Search or enter a website address"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="submit"
            size="sm"
            className="address-go"
            disabled={!address.trim()}
          >
            Go <ArrowRight size={15} />
          </Button>
        </form>
        <div className="browser-tools">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Quick commands"
            onClick={openCommandPalette}
          >
            <Command size={17} />
          </Button>
          {currentUrl && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open website in a new tab"
              onClick={() => window.open(frameURL, "_blank", "noopener,noreferrer")}
            >
              <ArrowSquareOut size={17} />
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <div className="browser-notice" role="alert">
          <ShieldCheck size={15} /> {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {currentUrl ? (
        <div className="browser-viewport">
          <div className="page-info">
            <div className="page-info-left">
              <span className="page-favicon">
                <Globe size={15} />
              </span>
              <span className="page-host">{shortHost(currentUrl)}</span>
              <span className="page-path">{new URL(currentUrl).pathname}</span>
            </div>
            <div className="page-info-right">
              {loading && (
                <span className="loading-label">
                  <span className="mini-spinner" /> Loading
                </span>
              )}
              <span className="page-info-divider" />
              <span className="page-info-label">Through NoRav</span>
            </div>
          </div>
          <div className="iframe-wrap">
            {loading && (
              <div className="frame-loading">
                <span className="loader-orbit" />
                <span>Connecting to {shortHost(currentUrl)}</span>
              </div>
            )}
            <iframe
              className={`website-frame ${frameLoaded ? "is-loaded" : ""}`}
              src={frameURL || "about:blank"}
              title={`NoRav proxy for ${shortHost(currentUrl)}`}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads allow-modals allow-presentation allow-top-navigation-by-user-activation"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-read; clipboard-write"
              referrerPolicy="same-origin"
              onLoad={() => {
                if (frameURL) {
                  setLoading(false);
                  setFrameLoaded(true);
                }
              }}
              onError={() => {
                if (frameURL) {
                  setLoading(false);
                  setNotice("The website could not be loaded through this proxy.");
                }
              }}
            />
          </div>
        </div>
      ) : (
        <div className="browser-home">
          <motion.div
            className="home-content"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="home-emblem" aria-hidden="true">
              <svg viewBox="0 0 80 80" role="presentation" focusable="false">
                <defs>
                  <linearGradient id="norav-proton-orbit" x1="12" y1="14" x2="68" y2="66" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#F2B95D" />
                    <stop offset="1" stopColor="#A875FF" />
                  </linearGradient>
                </defs>
                <g fill="none" stroke="url(#norav-proton-orbit)" strokeWidth="1.35">
                  <ellipse cx="40" cy="40" rx="28" ry="11" />
                  <ellipse cx="40" cy="40" rx="28" ry="11" transform="rotate(60 40 40)" />
                  <ellipse cx="40" cy="40" rx="28" ry="11" transform="rotate(120 40 40)" />
                </g>
                <circle cx="40" cy="40" r="5.2" fill="var(--nr-amber)" />
                <circle cx="68" cy="40" r="2.2" fill="#F2B95D" />
                <circle cx="26" cy="16" r="2.2" fill="#C49AFF" />
                <circle cx="26" cy="64" r="2.2" fill="#A875FF" />
              </svg>
            </div>
            <h1>
              Go <em>wherever</em>
              <br />
              you need.
            </h1>
            <p className="home-description">
              The web, routed through your own server.
              <br />
              One address. Your own way through.
            </p>
            <form className="home-search" onSubmit={submit}>
              <AddressField
                className="home-address-field"
                variant="hero"
                leadingIcon={<MagnifyingGlass size={18} />}
                label="Search or enter a website address"
                value={address}
                onValueChange={setAddress}
                placeholder="Search or enter a website address"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                size="lg"
                disabled={!address.trim()}
                aria-label="Open website"
              >
                <ArrowRight size={19} />
              </Button>
            </form>
            <div className="quick-access">
              <span className="quick-access-label">QUICK ACCESS</span>
              <div className="quick-links">
                {quickLinks.map((link) => (
                  <button
                    key={link.host}
                    className="quick-link"
                    onClick={() => openQuickLink(link.url)}
                  >
                    <span className="quick-icon">{link.icon}</span>
                    <span>
                      <strong>{link.label}</strong>
                      <small>{link.host}</small>
                    </span>
                    <ArrowSquareOut className="quick-arrow" size={14} />
                  </button>
                ))}
              </div>
            </div>
            <div className="home-trust">
              <span>
                <ShieldCheck size={14} /> Isolated proxy origin
              </span>
              <span>
                <WifiHigh size={14} /> Destination TLS
              </span>
              <span>
                <Lightning size={14} /> Faster page delivery
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </section>
  );
}
