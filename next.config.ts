import type { NextConfig } from "next";

/**
 * API-only Next app. There is no UI here, so none of the monolith's image or
 * font configuration carries over.
 *
 * `output: "standalone"` is what makes the Render Docker build small — it
 * emits a self-contained server with only the files actually imported, rather
 * than needing the whole node_modules tree at runtime.
 */
const nextConfig: NextConfig = {
  // `output: "standalone"` is deliberately NOT set.
  //
  // It emits a self-contained server at .next/standalone/server.js, which is
  // what you want for a small Docker image — but `next start` refuses to run
  // alongside it ("next start does not work with output: standalone"), and
  // `next start` is exactly what render.yaml's startCommand uses for a native
  // Node service.
  //
  // If you switch to a Docker deploy on Render, add it back and change the
  // start command to `node .next/standalone/server.js`.

  // This service answers to another origin, so the browser's own CORS checks
  // are the only thing standing in front of it. Those headers are set per
  // response in lib/api/cors.ts (echoing the Origin, which a static header
  // here could not do), so nothing is configured globally.

  // Keep the API's error bodies as JSON envelopes rather than Next's HTML
  // error pages — see `handler()` in lib/api/http.ts.
  poweredByHeader: false,

  // Nothing in this project is a page, so React strict-mode double-rendering
  // has nothing to catch, and the dev-time double invocation of route handlers
  // it causes is actively confusing when reading logs.
  reactStrictMode: false,
};

export default nextConfig;
