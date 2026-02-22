/**
 * Deno runtime adapter.
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
 * Parse Deno version from `deno --version` output.
 * Returns the major version number.
 */
function parseMajorVersion(versionOutput: string): number {
  // Output is like "deno 2.0.0 (...)
  const match = versionOutput.match(/deno\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Deno runtime adapter.
 */
export const denoAdapter: RuntimeAdapter = {
  id: "deno",

  *detect(): Operation<boolean> {
    try {
      const result = yield* exec("deno --version").join();
      return result.code === 0;
    } catch {
      return false;
    }
  },

  *version(): Operation<string> {
    const result = yield* exec("deno --version").expect();
    // Extract version number from "deno X.Y.Z"
    const match = result.stdout.match(/deno\s+([\d.]+)/);
    return match ? match[1] : "unknown";
  },

  *runScenario(opts: ScenarioOpts): Operation<BenchmarkResult> {
    // For now, return a mock result
    // TODO: Actually run the harness subprocess

    const versionStr = yield* this.version();
    const majorVersion = parseMajorVersion(`deno ${versionStr}`);

    const now = new Date().toISOString();

    const mockResult: BenchmarkResult = {
      schemaVersion: SCHEMA_VERSION,
      metadata: {
        releaseTag: opts.releaseTag,
        runtime: "deno",
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
            avgTime: 9.8,
            minTime: 8.5,
            maxTime: 11.2,
            stdDev: 0.9,
            p50: 9.5,
            p95: 10.8,
            p99: 11.0,
          },
        },
      ],
    };

    return validateBenchmarkResult(mockResult);
  },
};
