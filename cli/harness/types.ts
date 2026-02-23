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
 * Result from running a single scenario.
 */
export interface ScenarioResult {
  /** Scenario name */
  name: string;
  /** Raw timing samples in milliseconds */
  samples: number[];
}

/**
 * Harness output format (JSON to stdout).
 */
export interface HarnessOutput {
  /** Results from all scenarios run */
  results: ScenarioResult[];
}
