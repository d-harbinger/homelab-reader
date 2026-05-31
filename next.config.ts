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
  webpack: (config, { nextRuntime, webpack }) => {
    // instrumentation.ts boots the Node-only folder scanner (chokidar + yauzl +
    // pdfjs + our hash/locations helpers). Next also compiles instrumentation for
    // the Edge runtime, where the scanner never runs — it is gated behind
    // NEXT_RUNTIME === "nodejs" — yet webpack still tries to bundle the chain and
    // chokes on its Node core imports (both bare `require("fs")` AND the
    // `node:`-prefixed `import "node:crypto"`, which is an UnhandledSchemeError).
    // serverExternalPackages does not cover the instrumentation/Edge compilation
    // (next.js#58003). For non-Node bundles only: strip the `node:` scheme so
    // those specifiers resolve as bare built-ins, then stub the built-ins to
    // empty modules. The Node server build is untouched (real built-ins there).
    // next-auth on Edge uses Web Crypto globals, not the `crypto` module, so
    // stubbing it here does not affect middleware/auth. Webpack-only; Turbopack
    // dev ignores this and does not hit the issue.
    if (nextRuntime !== "nodejs") {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:/,
          (resource: { request: string }) => {
            resource.request = resource.request.replace(/^node:/, "");
          },
        ),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        "fs/promises": false,
        stream: false,
        "stream/promises": false,
        zlib: false,
        path: false,
        os: false,
        util: false,
        events: false,
        crypto: false,
        module: false,
        child_process: false,
        net: false,
        tls: false,
        dns: false,
        constants: false,
        assert: false,
        string_decoder: false,
        tty: false,
        perf_hooks: false,
        worker_threads: false,
      };
    }
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
