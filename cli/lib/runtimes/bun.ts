/**
 * Bun runtime adapter.
 *
 * @module
 */

import { exec } from "@effectionx/process";
import type { Operation } from "effection";
import {
  SCHEMA_VERSION,
  type BenchmarkResult,
  validateBenchmarkResult,
} from "../schema.ts";
import type { RuntimeAdapter, ScenarioOpts } from "./mod.ts";

/**
 * Parse Bun version from `bun --version` output.
 * Returns the major version number.
 */
function parseMajorVersion(versionOutput: string): number {
  // Output is like "1.0.0"
  const match = versionOutput.trim().match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Bun runtime adapter.
 */
export const bunAdapter: RuntimeAdapter = {
  id: "bun",

  *detect(): Operation<boolean> {
    try {
      const result = yield* exec("bun --version").join();
      return result.code === 0;
    } catch {
      return false;
    }
  },

  *version(): Operation<string> {
    const result = yield* exec("bun --version").expect();
    return result.stdout.trim();
  },

  *runScenario(opts: ScenarioOpts): Operation<BenchmarkResult> {
    // For now, return a mock result
    // TODO: Actually run the harness subprocess

    const versionStr = yield* this.version();
    const majorVersion = parseMajorVersion(versionStr);

    const now = new Date().toISOString();

    const mockResult: BenchmarkResult = {
      schemaVersion: SCHEMA_VERSION,
      metadata: {
        releaseTag: opts.releaseTag,
        runtime: "bun",
        runtimeMajorVersion: majorVersion,
        timestamp: now,
        runner: {
          os: Deno.build.os,
          arch: Deno.build.arch,
        },
        scenario: opts.scenario,
        benchmarkParams: {
          repeat: opts.repeat,
          warmup: opts.warmup,
          depth: opts.depth,
        },
      },
      results: [
        {
          name: "effection",
          stats: {
            avgTime: 8.2,
            minTime: 7.0,
            maxTime: 9.5,
            stdDev: 0.8,
            p50: 8.0,
            p95: 9.2,
            p99: 9.4,
          },
        },
      ],
    };

    return validateBenchmarkResult(mockResult);
  },
};
