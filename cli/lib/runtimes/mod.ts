/**
 * Runtime adapter interface and registry.
 *
 * Each adapter handles detection, version retrieval, and
 * subprocess-based benchmark execution for a specific runtime.
 *
 * @module
 */

import type { Operation } from "effection";
import type { BenchmarkResult, RuntimeId } from "../schema.ts";
import { nodeAdapter } from "./node.ts";
import { denoAdapter } from "./deno.ts";
import { bunAdapter } from "./bun.ts";

/**
 * Options for running a benchmark scenario.
 */
export interface ScenarioOpts {
  /** Effection npm version (e.g., "4.0.0") */
  releaseTag: string;
  /** Scenario name (e.g., "effection.recursion") */
  scenario: string;
  /** Number of measured iterations */
  repeat: number;
  /** Number of warmup iterations to discard */
  warmup: number;
  /** Recursion depth for benchmark scenarios */
  depth: number;
  /** Versions of comparison libraries */
  comparisonVersions: {
    rxjs: string;
    effect: string;
    co: string;
  };
}

/**
 * Runtime adapter interface.
 * Each runtime (node, deno, bun) implements this interface.
 */
export interface RuntimeAdapter {
  /** Runtime identifier */
  id: RuntimeId;

  /**
   * Check if this runtime is available on the system.
   * @returns true if the runtime can be invoked
   */
  detect(): Operation<boolean>;

  /**
   * Get the runtime version string.
   * @returns Version string (e.g., "22.0.0", "2.0.0")
   */
  version(): Operation<string>;

  /**
   * Run a benchmark scenario in this runtime via subprocess.
   * @param opts - Scenario options
   * @returns Benchmark result
   */
  runScenario(opts: ScenarioOpts): Operation<BenchmarkResult>;
}

/**
 * Get the adapter for a specific runtime.
 * Uses exhaustive switch for type safety.
 */
export function getAdapter(id: RuntimeId): RuntimeAdapter {
  switch (id) {
    case "node":
      return nodeAdapter;
    case "deno":
      return denoAdapter;
    case "bun":
      return bunAdapter;
    default: {
      // Exhaustive check
      const _exhaustive: never = id;
      throw new Error(`Unknown runtime: ${id}`);
    }
  }
}
