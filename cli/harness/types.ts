/**
 * Type definitions for the benchmark harness.
 *
 * @module
 */

import type { Operation } from "effection";

/**
 * Per-iteration context handed to a scenario, used to record peak memory.
 *
 * The scenario calls `markPeak()` at the moment it knows is the high-water
 * mark of its working set (e.g. inside the deepest recursion frame, or
 * after listeners are registered but before they're torn down). The harness
 * snapshots memory at each mark and keeps the running max alongside the
 * before/after snapshots it already takes.
 */
export interface ScenarioCtx {
  /** Snapshot memory now and update the running peak. Safe to call multiple times. */
  markPeak(): void;
}

/**
 * A benchmark scenario function.
 * Takes a depth parameter and runs the benchmark workload.
 */
export type ScenarioFn = (depth: number, ctx: ScenarioCtx) => Operation<void>;

/**
 * A registered scenario with metadata.
 */
export interface Scenario {
  /** Scenario name (e.g., "effection.recursion") */
  name: string;
  /** The scenario function */
  run: ScenarioFn;
  /** Library being benchmarked (e.g., "effection", "rxjs") */
  library: string;
  /** Scenario type (e.g., "recursion", "events") */
  type: string;
}

/**
 * Options for measuring a scenario.
 */
export interface MeasureOpts {
  /** Number of measured iterations */
  repeat: number;
  /** Number of warmup iterations to discard */
  warmup: number;
  /** Recursion depth */
  depth: number;
}

/**
 * Per-iteration retained-memory measurement. Bytes.
 *
 * Captured by reading the runtime's memory API immediately before and after
 * the scoped scenario invocation; deltas are pre-computed. "Retained" not
 * "peak" — the GC may run between snapshots, so deltas can be negative and
 * are noisier than latency.
 */
export interface MemorySample {
  rssBefore: number;
  rssAfter: number;
  rssDelta: number;
  heapUsedBefore: number;
  heapUsedAfter: number;
  heapUsedDelta: number;
  /**
   * Heap used after forced major GC at the end of the iteration. Present when
   * the runtime exposes a GC trigger (Node/Deno with `--expose-gc`, Bun's
   * `Bun.gc()`); absent otherwise.
   */
  heapUsedAfterGc?: number;
  /**
   * Peak heap observed during the iteration. Computed as the max across the
   * before/after snapshots and any explicit `ScenarioCtx.markPeak()` snapshots
   * the scenario takes. Present in v5 schema and later.
   */
  heapUsedPeak?: number;
  /**
   * Peak RSS observed during the iteration, computed the same way.
   */
  rssPeak?: number;
}

/**
 * Result from running a single scenario.
 */
export interface ScenarioResult {
  /** Scenario name */
  name: string;
  /** Raw timing samples in milliseconds */
  samples: number[];
  /** Retained-memory samples, one per timing sample (same length as `samples`). */
  memorySamples: MemorySample[];
}

/**
 * Harness output format (JSON to stdout).
 */
export interface HarnessOutput {
  /** Results from all scenarios run */
  results: ScenarioResult[];
}
