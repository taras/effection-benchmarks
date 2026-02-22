import { call, type Operation } from "effection";

type RouteHandler = (request: Request) => Operation<Response>;
type KeyGenerator = (request: Request) => Promise<string>;

/**
 * Wrap a route handler with Cache API lookups.
 *
 * The generated key should be deterministic for the response content.
 */
export function cached(
  cacheName: string,
  handler: RouteHandler,
  keyFn: KeyGenerator,
): RouteHandler {
  return function* (request: Request): Operation<Response> {
    const cache = yield* call(() => caches.open(cacheName));
    const key = yield* call(() => keyFn(request));
    const cacheKey = new Request(key);

    const hit = yield* call(() => cache.match(cacheKey));
    if (hit) {
      console.log(`[cache] HIT ${key}`);
      return hit;
    }

    console.log(`[cache] MISS ${key}`);
    const response = yield* handler(request);

    if (response.ok) {
      yield* call(() => cache.put(cacheKey, response.clone()));
    }

    return response;
  };
}
