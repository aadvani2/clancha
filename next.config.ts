import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep CJS server packages out of the Turbopack/Webpack bundle so their
  // dynamic require() calls at runtime resolve correctly. Mongoose loads
  // ./lib/types/* lazily; bundling broke those paths after Next.js 16 +
  // npm ci on staging ("Cannot find module './types/arraySubdocument'").
  serverExternalPackages: ["mongoose", "@sendgrid/mail"],
};

export default nextConfig;
