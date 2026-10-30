import Link from "next/link";
import { ArrowLeft, Home } from "lucide-react";

/**
 * Branded 404 with a small animated scene: a magnifier ("the 0") hunting for a
 * page that is not there. Rendered for any unmatched route across the whole app
 * (marketing, dashboard, super-admin) — and for Knowledge Base URLs the viewer
 * may not open, which are deliberately indistinguishable from a missing page.
 *
 * Pure CSS motion (no client JS); every animation stops under
 * prefers-reduced-motion, leaving the still illustration.
 */
export default function NotFound() {
  return (
    <main className="nf min-h-screen grid place-items-center brand-soft p-6 overflow-hidden">
      <style>{CSS}</style>
      <div className="text-center w-full max-w-xl animate-fade-in">
        <Link href="/" className="inline-flex items-center mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aina-wordmark.png" alt="Aina CRM" className="h-8 w-auto" />
        </Link>

        <svg
          viewBox="0 0 540 270"
          role="img"
          aria-label="A magnifying glass searching between the two fours of 404"
          className="w-full h-auto max-w-[34rem] mx-auto"
        >
          <defs>
            <linearGradient id="nf-red" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#d1343b" />
              <stop offset="1" stopColor="#9d1f27" />
            </linearGradient>
            <linearGradient id="nf-teal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2fb4c7" />
              <stop offset="1" stopColor="#1a7f95" />
            </linearGradient>
            <clipPath id="nf-lens">
              <circle cx="265" cy="118" r="50" />
            </clipPath>
          </defs>

          {/* soft backdrop */}
          <ellipse cx="270" cy="132" rx="250" ry="105" className="nf-blob" />

          {/* dashed orbit around the lens */}
          <ellipse cx="265" cy="118" rx="112" ry="46" className="nf-orbit" />

          {/* floating pages */}
          <g className="nf-float nf-d1">
            <g transform="translate(34 28) rotate(-12)">
              <rect width="46" height="58" rx="7" className="nf-card" />
              <rect x="9" y="12" width="28" height="5" rx="2.5" className="nf-line" />
              <rect x="9" y="24" width="20" height="5" rx="2.5" className="nf-line" />
              <rect x="9" y="36" width="24" height="5" rx="2.5" className="nf-line" />
            </g>
          </g>
          <g className="nf-float nf-d2">
            <g transform="translate(330 8) rotate(10)">
              <rect width="42" height="54" rx="7" className="nf-card" />
              <rect x="8" y="12" width="26" height="5" rx="2.5" className="nf-line" />
              <rect x="8" y="24" width="18" height="5" rx="2.5" className="nf-line" />
              <rect x="8" y="36" width="22" height="5" rx="2.5" className="nf-line" />
            </g>
          </g>

          {/* the two fours */}
          <g className="nf-four">
            <path
              d="M150 36 L36 150 H176 M150 36 V210"
              fill="none"
              stroke="url(#nf-red)"
              strokeWidth="28"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <g transform="translate(320 0)">
            <g className="nf-four nf-four2">
            <path
              d="M150 36 L36 150 H176 M150 36 V210"
              fill="none"
              stroke="url(#nf-red)"
              strokeWidth="28"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          </g>

          {/* ground shadow, breathes with the lens */}
          <ellipse cx="265" cy="236" rx="52" ry="8" className="nf-shadow" />

          {/* the magnifier — the "0" */}
          <g className="nf-search">
            <g className="nf-bob">
              <circle cx="265" cy="118" r="50" className="nf-glass" />
              <g clipPath="url(#nf-lens)">
                <g className="nf-bars">
                  <rect x="233" y="118" width="12" height="30" rx="3" />
                  <rect x="253" y="104" width="12" height="44" rx="3" />
                  <rect x="273" y="124" width="12" height="24" rx="3" />
                  <rect x="293" y="112" width="12" height="36" rx="3" />
                </g>
                <rect x="205" y="60" width="120" height="16" className="nf-scan" />
              </g>
              <circle cx="265" cy="118" r="50" fill="none" stroke="url(#nf-teal)" strokeWidth="12" />
              <path d="M301 154 L326 182" stroke="url(#nf-teal)" strokeWidth="14" strokeLinecap="round" />
              <text x="265" y="136" textAnchor="middle" className="nf-q">
                ?
              </text>
            </g>
          </g>

          {/* sparkles */}
          <g className="nf-spark nf-s1">
            <path d="M118 12 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4z" />
          </g>
          <g className="nf-spark nf-s2">
            <path d="M430 188 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" />
          </g>
          <g className="nf-spark nf-s3">
            <path d="M92 214 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" />
          </g>
        </svg>

        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight -mt-2">Page not found</h1>
        <p className="text-muted-foreground mt-3 leading-relaxed max-w-md mx-auto">
          We looked everywhere, but this page isn&apos;t here. It may have moved, the link may be out of date, or
          you may not have access to it.
        </p>

        <div className="mt-7 flex flex-wrap gap-2.5 justify-center">
          <Link href="/dashboard" className="btn-primary">
            <ArrowLeft className="size-4" /> Go to dashboard
          </Link>
          <Link href="/" className="btn-secondary">
            <Home className="size-4" /> Home
          </Link>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Error 404 · If you think this is a mistake, contact your firm&apos;s admin or{" "}
          <Link href="/dashboard/support" className="underline underline-offset-2 hover:text-foreground">
            support
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

const CSS = `
.nf{--nf-card:#fff;--nf-line:#dfe5ee;--nf-blob:rgba(47,180,199,.10);--nf-glass:rgba(255,255,255,.72);--nf-bar:rgba(26,127,149,.28);--nf-scan:rgba(47,180,199,.32);--nf-orbit:rgba(26,127,149,.35);--nf-shadow:rgba(15,23,42,.14);--nf-spark:#e0a526;--nf-q:#1a7f95}
@media (prefers-color-scheme:dark){.nf{--nf-card:#1e293b;--nf-line:#334155;--nf-blob:rgba(47,180,199,.12);--nf-glass:rgba(30,41,59,.7);--nf-bar:rgba(47,180,199,.35);--nf-orbit:rgba(47,180,199,.45);--nf-shadow:rgba(0,0,0,.4)}}
.nf-blob{fill:var(--nf-blob)}
.nf-orbit{fill:none;stroke:var(--nf-orbit);stroke-width:2;stroke-dasharray:3 9;stroke-linecap:round;animation:nf-dash 12s linear infinite}
.nf-card{fill:var(--nf-card);stroke:var(--nf-line);stroke-width:1.5;filter:drop-shadow(0 6px 10px rgba(15,23,42,.12))}
.nf-line{fill:var(--nf-line)}
.nf-glass{fill:var(--nf-glass)}
.nf-bars rect{fill:var(--nf-bar);transform-box:fill-box;transform-origin:bottom;animation:nf-bar 2.6s ease-in-out infinite}
.nf-bars rect:nth-child(2){animation-delay:.3s}.nf-bars rect:nth-child(3){animation-delay:.6s}.nf-bars rect:nth-child(4){animation-delay:.9s}
.nf-scan{fill:var(--nf-scan);animation:nf-scan 2.6s ease-in-out infinite}
.nf-q{font:800 44px/1 ui-sans-serif,system-ui,sans-serif;fill:var(--nf-q);transform-box:fill-box;transform-origin:center;animation:nf-wob 2.6s ease-in-out infinite}
.nf-shadow{fill:var(--nf-shadow);transform-box:fill-box;transform-origin:center;animation:nf-shadow 3.6s ease-in-out infinite}
.nf-search{animation:nf-sweep 7s ease-in-out infinite}
.nf-bob{animation:nf-bob 3.6s ease-in-out infinite}
.nf-float{animation:nf-float 5s ease-in-out infinite}.nf-d2{animation-duration:6.2s;animation-delay:-2s}
.nf-four{transform-box:fill-box;transform-origin:center;animation:nf-pop .9s cubic-bezier(.2,.9,.3,1.3) both}
.nf-four2{animation-delay:.15s}
.nf-spark path{fill:var(--nf-spark);transform-box:fill-box;transform-origin:center;animation:nf-twinkle 3s ease-in-out infinite}
.nf-s2 path{animation-delay:-1s}.nf-s3 path{animation-delay:-2s}
@keyframes nf-dash{to{stroke-dashoffset:-96}}
@keyframes nf-bar{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}
@keyframes nf-scan{0%{transform:translateY(0)}50%{transform:translateY(92px)}100%{transform:translateY(0)}}
@keyframes nf-wob{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg) scale(1.08)}}
@keyframes nf-shadow{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.8);opacity:.6}}
@keyframes nf-sweep{0%,100%{transform:translateX(-14px)}50%{transform:translateX(14px)}}
@keyframes nf-bob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-12px) rotate(3deg)}}
@keyframes nf-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes nf-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes nf-twinkle{0%,100%{transform:scale(.4);opacity:.3}50%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.nf *{animation:none!important}}
`;
