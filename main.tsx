import { call, main, suspend, type Operation } from "effection";
import { createRevolution, serveDirMiddleware, route as revolutionRoute, type HTTPMiddleware } from "revolution";
import { fromFileUrl } from "@std/path/from-file-url";
import { extname, join } from "@std/path";

import { sitemapPlugin, type SitemapExtension, type RoutePath } from "./plugins/sitemap.ts";
import { currentRequestPlugin } from "./plugins/current-request.ts";
import { etagPlugin } from "./plugins/etag.ts";
import { benchmarksParquetHandler } from "./routes/benchmarks-parquet.ts";

const distRoot = fromFileUrl(new URL("./dist/", import.meta.url));

// Create a static file server with sitemap extension
function staticDashboard(): HTTPMiddleware & SitemapExtension {
  const staticMiddleware = serveDirMiddleware({
    fsRoot: distRoot,
  });

  const middleware: HTTPMiddleware = function* (request, next): Operation<Response> {
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
  return Object.assign(middleware, {
    *sitemapExtension(_request: Request): Operation<RoutePath[]> {
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
      ];
    },
  });
}

if (import.meta.main) {
  await main(function* () {
    const revolution = createRevolution({
      app: [
        // Health check endpoint
        revolutionRoute("/healthz", function* () {
          return new Response("ok", { status: 200 });
        }),
        // Dynamic Parquet generation from JSON benchmark files
        revolutionRoute("/api/benchmarks.parquet", benchmarksParquetHandler),
        // Serve all static assets from dist/ with sitemap entry
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
