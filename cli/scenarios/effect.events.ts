/**
 * Effect events benchmark scenario.
 *
 * Ported from upstream:
 * https://github.com/thefrontside/effection/blob/v4/tasks/bench/scenarios/effect.events.ts
 *
 * @module
 */

import { Deferred, Effect, Queue, Scope } from "effect";
import { call, type Operation } from "effection";
import type { Scenario } from "../harness/types.ts";

/**
 * Run the Effect events benchmark.
 */
const effectRun = (depth: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    const target = yield* Queue.unbounded<void>();

    // Spawn recursive listener
    yield* Effect.fork(recurse(target, depth));

    // Dispatch events
    for (let i = 0; i < 100; i++) {
      yield* Effect.yieldNow();
      yield* Queue.offer(target, undefined);
    }

    yield* Effect.yieldNow();
    yield* Queue.shutdown(target);
  }).pipe(Effect.scoped);

/**
 * Recursive Effect event listener chain.
 */
function recurse(
  target: Queue.Queue<void>,
  depth: number,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    if (depth > 1) {
      const subTarget = yield* Queue.unbounded<void>();
      yield* Effect.fork(recurse(subTarget, depth - 1));

      // Forward events
      yield* Effect.fork(
        Effect.gen(function* () {
          while (true) {
            yield* Queue.take(target);
            yield* Queue.offer(subTarget, undefined);
          }
        }).pipe(Effect.catchAll(() => Effect.void)),
      );
    } else {
      // Bottom - just consume events
      yield* Effect.fork(
        Effect.gen(function* () {
          while (true) {
            yield* Queue.take(target);
          }
        }).pipe(Effect.catchAll(() => Effect.void)),
      );
    }
  });
}

/**
 * Wrapper that runs Effect as an Effection operation.
 */
function* run(depth: number): Operation<void> {
  yield* call(() => Effect.runPromise(effectRun(depth)));
}

/**
 * Effect events scenario.
 */
export const effectEvents: Scenario = {
  name: "effect.events",
  library: "effect",
  type: "events",
  run,
};
