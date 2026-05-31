import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
    ].join(", "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfjs-dist + yauzl are server-side only; let Next leave them as
  // native node_modules instead of bundling.
  serverExternalPackages: ["pdfjs-dist", "yauzl", "pdf-to-img"],
  webpack: (config, { nextRuntime }) => {
    // instrumentation.ts boots the Node-only folder scanner (chokidar + yauzl +
    // pdfjs). Next also compiles instrumentation for the Edge runtime, where the
    // scanner never runs — it is gated behind NEXT_RUNTIME === "nodejs" — but its
    // third-party deps' bare require("fs")/require("stream")/require("zlib") still
    // fail the build (serverExternalPackages does not cover the Edge compilation).
    // In non-Node bundles, resolve those built-ins to empty modules. Crypto and
    // network built-ins are left intact so Edge middleware/auth is unaffected.
    // Webpack-only; Turbopack dev ignores this config and does not hit the issue.
    if (nextRuntime !== "nodejs") {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        "fs/promises": false,
        stream: false,
        zlib: false,
        path: false,
        os: false,
        util: false,
        events: false,
        child_process: false,
        constants: false,
        assert: false,
        string_decoder: false,
        tty: false,
      };
    }
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
