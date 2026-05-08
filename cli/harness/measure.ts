/**
 * Measurement logic for benchmark scenarios.
 *
 * Uses scoped() for isolation between runs.
 *
 * @module
 */

import { scoped, type Operation } from "effection";
import type { MeasureOpts, MemorySample, ScenarioFn } from "./types.ts";
import { snapshotMemory } from "./memory.ts";

export interface MeasureOutput {
  times: number[];
  memorySamples: MemorySample[];
}

/**
 * Measure a scenario's execution time and retained memory.
 *
 * @param scenarioFn - The scenario function to measure
 * @param opts - Measurement options
 * @returns Per-iteration timings (ms) and retained-memory samples (bytes).
 */
export function* measure(
  scenarioFn: ScenarioFn,
  opts: MeasureOpts,
): Operation<MeasureOutput> {
  // Warmup runs (discard results)
  for (let i = 0; i < opts.warmup; i++) {
    yield* scoped(() => scenarioFn(opts.depth));
  }

  const times: number[] = [];
  const memorySamples: MemorySample[] = [];
  for (let i = 0; i < opts.repeat; i++) {
    const memBefore = snapshotMemory();
    const start = performance.now();
    yield* scoped(() => scenarioFn(opts.depth));
    const elapsed = performance.now() - start;
    const memAfter = snapshotMemory();

    times.push(elapsed);
    memorySamples.push({
      rssBefore: memBefore.rss,
      rssAfter: memAfter.rss,
      rssDelta: memAfter.rss - memBefore.rss,
      heapUsedBefore: memBefore.heapUsed,
      heapUsedAfter: memAfter.heapUsed,
      heapUsedDelta: memAfter.heapUsed - memBefore.heapUsed,
    });
  }

  return { times, memorySamples };
}
