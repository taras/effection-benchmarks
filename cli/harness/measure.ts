/**
 * Measurement logic for benchmark scenarios.
 *
 * Uses scoped() for isolation between runs.
 *
 * @module
 */

import { scoped, type Operation } from "effection";
import type { MeasureOpts, MemorySample, ScenarioCtx, ScenarioFn } from "./types.ts";
import { createPeakRecorder, forceGc, snapshotMemory } from "./memory.ts";

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
  // Warmup runs (discard results). Pass a no-op ctx so scenarios that call
  // ctx.markPeak() during warmup don't crash; we just don't record anything.
  const noopCtx: ScenarioCtx = { markPeak() {} };
  for (let i = 0; i < opts.warmup; i++) {
    yield* scoped(() => scenarioFn(opts.depth, noopCtx));
  }

  const times: number[] = [];
  const memorySamples: MemorySample[] = [];
  for (let i = 0; i < opts.repeat; i++) {
    const peak = createPeakRecorder();
    const ctx: ScenarioCtx = { markPeak: peak.mark };
    const memBefore = snapshotMemory();
    const start = performance.now();
    yield* scoped(() => scenarioFn(opts.depth, ctx));
    const elapsed = performance.now() - start;
    const memAfter = snapshotMemory();

    // Force a major GC outside the timed window so heapUsedAfterGc reflects
    // genuine retained memory rather than yet-to-be-collected garbage. If
    // the runtime doesn't expose a GC trigger, we omit the field.
    const gcAvailable = forceGc();
    const heapUsedAfterGc = gcAvailable ? snapshotMemory().heapUsed : undefined;

    // Combine the explicit ctx peak with the before/after snapshots — start
    // and end are valid peak observations too. Scenarios that don't call
    // markPeak still get a sensible peak from these boundary samples.
    const peakNow = peak.current();
    const heapUsedPeak = Math.max(peakNow.heapUsed, memBefore.heapUsed, memAfter.heapUsed);
    const rssPeak = Math.max(peakNow.rss, memBefore.rss, memAfter.rss);

    times.push(elapsed);
    memorySamples.push({
      rssBefore: memBefore.rss,
      rssAfter: memAfter.rss,
      rssDelta: memAfter.rss - memBefore.rss,
      heapUsedBefore: memBefore.heapUsed,
      heapUsedAfter: memAfter.heapUsed,
      heapUsedDelta: memAfter.heapUsed - memBefore.heapUsed,
      heapUsedPeak,
      rssPeak,
      ...(heapUsedAfterGc !== undefined ? { heapUsedAfterGc } : {}),
    });
  }

  return { times, memorySamples };
}
