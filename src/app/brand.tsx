import { Link } from "@tanstack/react-router";

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="NoRav layered mark"
    >
      <defs>
        <linearGradient id="norav-top-edge" x1="6" y1="5" x2="35" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0D7FF" />
          <stop offset=".48" stopColor="#AA6DFF" />
          <stop offset="1" stopColor="#72C7FF" />
        </linearGradient>
        <linearGradient id="norav-side" x1="7" y1="17" x2="34" y2="35" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A855F7" />
          <stop offset=".58" stopColor="#6926D9" />
          <stop offset="1" stopColor="#3436B9" />
        </linearGradient>
        <linearGradient id="norav-lower-side" x1="6" y1="25" x2="35" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6E32C9" />
          <stop offset=".58" stopColor="#4D24A8" />
          <stop offset="1" stopColor="#263B9C" />
        </linearGradient>
      </defs>
      <path
        d="M4.8 25.2 18.3 17.6a3.4 3.4 0 0 1 3.4 0l13.5 7.6c1.4.8 1.4 2.1 0 2.9l-13.5 7.6a3.4 3.4 0 0 1-3.4 0L4.8 28.1c-1.4-.8-1.4-2.1 0-2.9Z"
        fill="#101019"
        stroke="#7852DB"
        strokeWidth="1.15"
      />
      <path
        d="M3.9 26.7v3.1c0 1 .6 1.9 1.5 2.4l13 7.3c1 .6 2.2.6 3.2 0l13-7.3c.9-.5 1.5-1.4 1.5-2.4v-3.1l-14.5 8.1a3.4 3.4 0 0 1-3.4 0L3.9 26.7Z"
        fill="url(#norav-lower-side)"
        stroke="#6941C8"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M4.8 11.4 18.3 3.8a3.4 3.4 0 0 1 3.4 0l13.5 7.6c1.4.8 1.4 2.1 0 2.9l-13.5 7.6a3.4 3.4 0 0 1-3.4 0L4.8 14.3c-1.4-.8-1.4-2.1 0-2.9Z"
        fill="#12121B"
        stroke="url(#norav-top-edge)"
        strokeWidth="1.25"
      />
      <path
        d="M3.9 12.8v3.2c0 1 .6 1.9 1.5 2.4l13 7.3c1 .6 2.2.6 3.2 0l13-7.3c.9-.5 1.5-1.4 1.5-2.4v-3.2l-14.5 8.1a3.4 3.4 0 0 1-3.4 0L3.9 12.8Z"
        fill="url(#norav-side)"
        stroke="url(#norav-top-edge)"
        strokeWidth="1.05"
        strokeLinejoin="round"
      />
      <path d="m4.7 11.6 13.7-7.7a3.2 3.2 0 0 1 3.2 0l13.7 7.7" stroke="#F4E8FF" strokeOpacity=".68" strokeWidth=".8" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className={`brand-lockup ${compact ? "brand-lockup-compact" : ""}`} aria-label="NoRav home">
      <LogoMark />
      <span className="brand-word">NoRav</span>
    </Link>
  );
}

export function BootScreen() {
  return (
    <main className="boot-screen">
      <Brand />
      <span className="boot-caption">Connecting to your private gateway</span>
    </main>
  );
}
