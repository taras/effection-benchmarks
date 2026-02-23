import { call, main, spawn, suspend, type Operation } from "effection";
import { createRevolution, serveDirMiddleware, route as revolutionRoute, type HTTPMiddleware } from "revolution";
import { exec } from "@effectionx/process";
import { fromFileUrl } from "@std/path/from-file-url";
import { extname, join } from "@std/path";

import { sitemapPlugin, type SitemapExtension, type RoutePath } from "./plugins/sitemap.ts";
import { currentRequestPlugin } from "./plugins/current-request.ts";
import { etagPlugin } from "./plugins/etag.ts";
import { benchmarksParquetHandler } from "./routes/benchmarks-parquet.ts";
import { generateComparisonPages, type ComparisonPageMeta } from "./routes/comparison-pages.ts";
import { BuiltAssetsContext, useBuiltAssets } from "./context/built-assets.ts";

const distRoot = fromFileUrl(new URL("./dist/", import.meta.url));

/**
 * Generate comparison pages and run Observable build.
 * This runs as a spawned task so the server can start accepting connections
 * before the build completes.
 */
function* buildAndServe(): Operation<ComparisonPageMeta[]> {
  // Generate comparison markdown pages and observablehq.config.js
  const meta = yield* generateComparisonPages();

  // Run Observable Framework build
  console.log("Running Observable Framework build...");
  const { code, stderr } = yield* exec("deno task build").join();
  if (code !== 0) {
    throw new Error(`Observable build failed (exit ${code}): ${stderr}`);
  }
  console.log("Build complete.");

  return meta;
}

// Create a static file server with sitemap extension
// Waits for build to complete before serving, using page metadata for sitemap
function staticDashboard(): HTTPMiddleware & SitemapExtension {
  const staticMiddleware = serveDirMiddleware({
    fsRoot: distRoot,
  });

  const middleware: HTTPMiddleware = function* (request, next): Operation<Response> {
    // Wait for build to complete before serving any static content
    yield* useBuiltAssets();

    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return yield* staticMiddleware(request, next);
    }

    if (pathname.endsWith(".html") && pathname !== "/index.html") {
      const cleanPath = pathname.slice(0, -5);
      return Response.redirect(new URL(cleanPath || "/", url), 308);
    }

    if (pathname !== "/" && !pathname.endsWith("/") && !extname(pathname)) {
      const htmlPath = join(distRoot, `${pathname}.html`);
      const exists = yield* call(async () => {
        try {
          const stat = await Deno.stat(htmlPath);
          return stat.isFile;
        } catch {
          return false;
        }
      });

      if (exists) {
        const rewritten = new URL(url);
        rewritten.pathname = `${pathname}.html`;
        const rewrittenRequest = new Request(rewritten, request);
        return yield* staticMiddleware(rewrittenRequest, next);
      }
    }

    return yield* staticMiddleware(request, next);
  };

  // Add sitemap extension to the middleware
  // Also waits for build to get page metadata for sitemap entries
  return Object.assign(middleware, {
    *sitemapExtension(_request: Request): Operation<RoutePath[]> {
      const pageMeta = yield* useBuiltAssets();

      return [
        {
          pathname: "/",
          changefreq: "weekly" as const,
          priority: 1.0,
        },
        {
          pathname: "/examples",
          changefreq: "monthly" as const,
          priority: 0.7,
        },
        // Add comparison pages (recursion, events)
        ...pageMeta.map((p: ComparisonPageMeta) => ({
          pathname: `/${p.slug}`,
          changefreq: "weekly" as const,
          priority: 0.9,
        })),
      ];
    },
  });
}

if (import.meta.main) {
  await main(function* () {
    // Spawn build task in background - generates pages then runs Observable build
    const buildTask = yield* spawn(function* () {
      return yield* buildAndServe();
    });

    // Store build task in context - routes can yield it to wait for completion
    yield* BuiltAssetsContext.set(buildTask);

    const revolution = createRevolution({
      app: [
        // Health check endpoint - responds immediately, doesn't wait for build
        revolutionRoute("/healthz", function* () {
          return new Response("ok", { status: 200 });
        }),
        // Dynamic Parquet generation from JSON benchmark files
        revolutionRoute("/api/benchmarks.parquet", benchmarksParquetHandler),
        // Serve all static assets from dist/ - waits for build via useBuiltAssets()
        staticDashboard(),
      ],
      plugins: [
        currentRequestPlugin(),
        etagPlugin(),
        sitemapPlugin(),
      ],
    });

    const server = yield* revolution.start();
    const hostname = server.hostname === "0.0.0.0" ? "localhost" : server.hostname;
    console.log(`Dashboard → http://${hostname}:${server.port}`);

    yield* suspend();
  });
}
