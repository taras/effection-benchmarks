/**
 * Type definitions for the benchmark harness.
 *
 * @module
 */

import type { Operation } from "effection";

/**
 * A benchmark scenario function.
 * Takes a depth parameter and runs the benchmark workload.
 */
export type ScenarioFn = (depth: number) => Operation<void>;

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
