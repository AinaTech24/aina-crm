import type { NextConfig } from "next";

// Build rev: 2025-12 — trigger middleware reload (public form whitelist).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  compiler: {
    // Strip console.* (keep warn/error) from production client bundles.
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    // 50mb so large RTA mailbacks (e.g. a CAMS R9 folio-master zip ~11-25mb)
    // upload without the body being truncated → req.formData() "expected
    // multipart/form-data" failure. Uploads are gated behind an authed,
    // capability-checked route, so the larger ceiling isn't a DoS surface.
    serverActions: { bodySizeLimit: "50mb" },
    // Scale the build's static-analysis workers to available memory instead of
    // spawning one per CPU — prevents the page-data collection phase from
    // OOM-killing a worker on memory-constrained machines. Build-time only.
    memoryBasedWorkersCount: true,
    // Barrel-import tree-shaking. These libs export hundreds of symbols from a
    // single entry; without this, importing one icon/util can pull a large
    // chunk into a route's bundle. lucide-react matters most — the sidebar
    // alone imports ~45 icons and ships on every page.
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-toast",
      "@xyflow/react",
    ],
  },
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
