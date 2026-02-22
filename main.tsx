import { main, suspend, type Operation } from "effection";
import { createRevolution, serveDirMiddleware, route as revolutionRoute, type HTTPMiddleware } from "revolution";
import { fromFileUrl } from "@std/path/from-file-url";

import { sitemapPlugin, type SitemapExtension, type RoutePath } from "./plugins/sitemap.ts";
import { currentRequestPlugin } from "./plugins/current-request.ts";
import { etagPlugin } from "./plugins/etag.ts";

const distRoot = fromFileUrl(new URL("./dist/", import.meta.url));

// Create a static file server with sitemap extension
function staticDashboard(): HTTPMiddleware & SitemapExtension {
  const middleware = serveDirMiddleware({
    fsRoot: distRoot,
  });
  
  // Add sitemap extension to the middleware
  return Object.assign(middleware, {
    *sitemapExtension(_request: Request): Operation<RoutePath[]> {
      return [
        {
          pathname: "/",
          changefreq: "weekly" as const,
          priority: 1.0,
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
