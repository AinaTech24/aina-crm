import type { NextConfig } from "next";

// Build rev: 2025-12 — trigger middleware reload (public form whitelist).
const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
