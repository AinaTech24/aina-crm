import { ImageResponse } from "next/og";

/**
 * Branded social-share card (og:image + twitter:image via twitter-image.tsx
 * re-export). Generated at build/request time with next/og so links shared in
 * WhatsApp / LinkedIn render a real preview instead of nothing.
 */
export const runtime = "nodejs";
export const alt = "AINA CRM — CRM software for Mutual Fund Distributors";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const red = "#B71A20";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f7f2ea",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* top: wordmark + eyebrow */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 64, fontWeight: 800, color: red, letterSpacing: -1 }}>AINA</span>
            <span style={{ fontSize: 64, fontWeight: 800, color: "#032b2b", letterSpacing: -1, marginLeft: 14 }}>CRM</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "#5b6472", marginTop: 8, letterSpacing: 2, textTransform: "uppercase" }}>
            CRM software for Mutual Fund Distributors
          </div>
        </div>

        {/* middle: headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0 16px", fontSize: 58, fontWeight: 800, color: "#032b2b", lineHeight: 1.15, maxWidth: 1000 }}>
            <span>Your MFD business is growing.</span>
            <span style={{ color: red }}>Are your systems keeping up?</span>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 36, flexWrap: "wrap" }}>
            {["Leads", "Clients & families", "SIP tracking", "Reviews & tasks", "Business dashboards"].map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  fontSize: 22,
                  fontWeight: 600,
                  color: "#3a414e",
                  background: "#fffdf9",
                  border: "1px solid #e7ddcf",
                  borderRadius: 999,
                  padding: "10px 22px",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* bottom: footer bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: red }}>crm.ainatech.in</div>
          <div style={{ fontSize: 20, color: "#7a828f" }}>by Aina Tech Services LLP</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
