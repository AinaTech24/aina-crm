import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavProgress } from "@/components/layout/NavProgress";
import { NumberWheelGuard } from "@/components/layout/NumberWheelGuard";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.ainatech.in";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "AINA CRM — CRM Software for Mutual Fund Distributors (MFD) in India",
    template: "%s · AINA CRM",
  },
  description:
    "AINA CRM is CRM software built for Mutual Fund Distributors in India: leads, clients and families, SIPs and transactions, client reviews, team tasks and business dashboards in one place.",
  applicationName: "AINA CRM",
  authors: [{ name: "Aina Tech Services LLP", url: "https://ainatech.in" }],
  creator: "Aina Tech Services LLP",
  publisher: "Aina Tech Services LLP",
  category: "Business Software",
  keywords: [
    "AINA CRM",
    "CRM for mutual fund distributors",
    "MFD CRM software",
    "mutual fund distributor CRM",
    "mutual fund software for distributors",
    "MFD back office software",
    "SIP tracking software",
    "AMFI DDQ compliance",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "AINA CRM",
    title: "AINA CRM — CRM Software for Mutual Fund Distributors",
    description:
      "Bring your MFD business together: leads, clients, SIPs, meetings, tasks and business tracking in one CRM built for Mutual Fund Distributors.",
    url: SITE_URL,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "AINA CRM — CRM Software for Mutual Fund Distributors",
    description:
      "Bring your MFD business together: leads, clients, SIPs, meetings, tasks and business tracking in one CRM built for Mutual Fund Distributors.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  // Search Console / Bing Webmaster ownership tags — set the env vars to the
  // codes those consoles issue (Settings → Ownership verification → HTML tag).
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } : undefined,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning className={inter.variable}>
      {/* suppressHydrationWarning: browser extensions (ColorZilla's
          `cz-shortcut-listen`, Grammarly, etc.) inject attributes onto <body>
          before React hydrates, which would otherwise log a hydration mismatch. */}
      <body
        suppressHydrationWarning
        className="min-h-screen bg-background text-foreground antialiased scrollbar-none"
      >
        <NavProgress />
        <NumberWheelGuard />
        {children}
      </body>
    </html>
  );
}
