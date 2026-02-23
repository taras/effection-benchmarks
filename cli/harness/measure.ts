/**
 * Measurement logic for benchmark scenarios.
 *
 * Uses scoped() for isolation between runs.
 *
 * @module
 */

import { scoped, type Operation } from "effection";
import type { ScenarioFn, MeasureOpts } from "./types.ts";

/**
 * Measure a scenario's execution time.
 *
 * @param scenarioFn - The scenario function to measure
 * @param opts - Measurement options
 * @returns Raw timing samples in milliseconds
 */
export function* measure(
  scenarioFn: ScenarioFn,
  opts: MeasureOpts,
): Operation<number[]> {
  // Warmup runs (discard results)
  for (let i = 0; i < opts.warmup; i++) {
    yield* scoped(() => scenarioFn(opts.depth));
  }

  // Measured runs
  const times: number[] = [];
  for (let i = 0; i < opts.repeat; i++) {
    const start = performance.now();
    yield* scoped(() => scenarioFn(opts.depth));
    const elapsed = performance.now() - start;
    times.push(elapsed);
  }

  return times;
}
