import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      // blob: — epub.js injects each EPUB's own stylesheets as blob: URLs into
      // the reader iframe (same pattern as img-src/worker-src below). Without it
      // the book's CSS (code-block formatting, syntax highlighting) is blocked,
      // which matters most for the technical books this server targets. Strictly
      // narrower than the 'unsafe-inline' already present.
      "style-src 'self' 'unsafe-inline' blob:",
      "connect-src 'self'",
      "img-src 'self' data: blob:",
      // blob: — EPUBs embed their own fonts (often monospace faces for code
      // blocks); epub.js exposes them to the reader iframe as blob: URLs, same
      // as its stylesheets above. Without it those fonts fall back and code
      // samples lose their intended face.
      "font-src 'self' data: blob:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "worker-src 'self' blob:",
      // No `upgrade-insecure-requests`: homelab-reader is served over plain HTTP
      // (localhost or a LAN IP / hostname via docker-compose). Browsers only
      // auto-exempt localhost from that directive — LAN IPs and bare hostnames
      // still get every subresource upgraded to https://, which has no listener
      // here, so the page loads unstyled (HTML arrives, all /_next/static CSS+JS
      // fail). Matches the chimera / chef-calc-pro siblings. Put TLS in front
      // (Caddy/Traefik/nginx) before re-adding this.
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
  // native node_modules instead of bundling. @napi-rs/canvas ships a native
  // .node addon (used by pdf.ts for the pdfjs DOMMatrix/ImageData/Path2D
  // polyfill and cover rendering); without externalizing it webpack tries to
  // parse the binary and fails the build ("Module parse failed" /
  // next-error-browser-binary-loader). pdf-to-img wraps canvas too and is
  // already here for the same reason.
  serverExternalPackages: ["pdfjs-dist", "yauzl", "pdf-to-img", "@napi-rs/canvas"],
  // Standalone dep-tracing (@vercel/nft) copies pdfjs's main entry (pdf.mjs) but
  // NOT its worker: pdfjs loads pdf.worker.mjs through a runtime-resolved
  // "fake worker" path that static tracing can't follow. Without the worker in
  // the standalone output, getDocument() throws at runtime in the container
  // ("Setting up fake worker failed: Cannot find module ...pdf.worker.mjs"), so
  // every PDF fails to import while EPUBs (no worker) import fine. Force the
  // worker into the traced output. pdf-to-img (cover rendering) additionally
  // does require.resolve("pdfjs-dist/package.json") to locate the package, which
  // tracing also drops — without it covers fail (non-fatal: that path is
  // try/caught and degrades to the format placeholder, but include it so covers
  // render). Verified by reproducing both failures under Alpine musl against the
  // trimmed standalone tree, then confirming the fix.
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/package.json",
    ],
  },
  // The inverse case: keep typescript OUT of the trace (8.7 MB pulled in
  // because next.config.ts is TypeScript; the standalone server never
  // compiles TS at runtime). Ship-check boot-verified.
  outputFileTracingExcludes: {
    "*": ["node_modules/typescript/**"],
  },
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
        // @napi-rs/canvas's load-image path requires http/https/url for remote
        // image loading; the scanner never loads remote images (and never runs
        // off the Node runtime anyway), so stub them for the non-Node compile.
        http: false,
        https: false,
        url: false,
        constants: false,
        assert: false,
        string_decoder: false,
        tty: false,
        perf_hooks: false,
        worker_threads: false,
      };
      // @napi-rs/canvas resolves to a prebuilt native `.node` binary
      // (skia.*.node) that the browser binary loader rejects. serverExternalPackages
      // only externalizes it for the Node server build, not this non-Node compile,
      // where the scanner chain still gets walked. Alias the package to an empty
      // module here; pdf.ts only `await import()`s it under the Node runtime, so the
      // stub is never invoked off-Node.
      config.resolve.alias = {
        ...config.resolve.alias,
        "@napi-rs/canvas": false,
      };
    }
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
