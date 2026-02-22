import type { RevolutionPlugin } from "revolution";
import { normalize } from "@std/path/posix/normalize";
import type { Operation } from "effection";
import { CurrentRequest } from "../context/request.ts";

export function currentRequestPlugin(): RevolutionPlugin {
  return {
    *http(request, next) {
      yield* CurrentRequest.set(request);
      return yield* next(request);
    },
  };
}

/**
 * Convert a non fully qualified url into a fully qualified url, complete
 * with protocol.
 */
export function* useAbsoluteUrl(path: string = "/"): Operation<string> {
  const absolute = yield* useAbsoluteUrlFactory();

  return absolute(path);
}

export function* useAbsoluteUrlFactory(): Operation<(path: string) => string> {
  const request = yield* CurrentRequest.expect();

  return (path) => {
    const normalizedPath = normalize(path);
    if (normalizedPath.startsWith("/")) {
      const url = new URL(request.url);
      url.pathname = normalizedPath;
      url.search = "";
      return url.toString();
    } else {
      return new URL(path, request.url).toString();
    }
  };
}

/**
 * Get the canonical url for the current path.
 */
export function* useCanonicalUrl(options: { base: string }): Operation<string> {
  const request = yield* CurrentRequest.expect();

  const req = new URL(request.url);
  const url = new URL(options.base);
  url.pathname = `${url.pathname}${req.pathname}`;
  return String(url);
}
