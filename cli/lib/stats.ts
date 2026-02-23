/**
 * Statistical calculation functions for benchmark results.
 * Pure functions with no Effection dependencies.
 *
 * Ported from upstream Effection benchmark tool:
 * https://github.com/thefrontside/effection/blob/v4/tasks/bench/scenarios/scenario.ts
 *
 * @module
 */

import type { BenchmarkStats } from "./schema.ts";

/**
 * Result of stats calculation including raw times.
 */
export interface StatsResult extends BenchmarkStats {
  reps: number;
  times: readonly number[];
}

/**
 * Calculate statistical metrics from an array of timing samples.
 * All time values are in milliseconds.
 *
 * @param times - Array of timing measurements in milliseconds
 * @returns Computed statistics including avg, min, max, stdDev, and percentiles
 * @throws Error if times array is empty
 */
export function calculateStats(times: number[]): StatsResult {
  if (times.length === 0) {
    throw new Error("Cannot calculate stats from empty array");
  }

  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  const variance =
    times.reduce((acc, t) => acc + (t - avg) ** 2, 0) / times.length;

  return {
    reps: times.length,
    times,
    avgTime: avg,
    minTime: sorted[0],
    maxTime: sorted[sorted.length - 1],
    stdDev: Math.sqrt(variance),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

/**
 * Calculate the p-th percentile from a sorted array.
 *
 * @param sorted - Pre-sorted array of values (ascending)
 * @param p - Percentile to calculate (0-100)
 * @returns The value at the p-th percentile
 * @throws Error if sorted array is empty
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    throw new Error("Cannot calculate percentile from empty array");
  }

  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Extract just the stats fields (without reps and times) for JSON output.
 */
export function toStatsOnly(result: StatsResult): BenchmarkStats {
  return {
    avgTime: result.avgTime,
    minTime: result.minTime,
    maxTime: result.maxTime,
    stdDev: result.stdDev,
    p50: result.p50,
    p95: result.p95,
    p99: result.p99,
  };
}
