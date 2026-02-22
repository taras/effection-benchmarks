/**
 * Node.js runtime adapter.
 *
 * Uses Node 22+ with --experimental-strip-types for TypeScript.
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
 * Parse Node.js version from `node --version` output.
 * Returns the major version number.
 */
function parseMajorVersion(versionOutput: string): number {
  // Output is like "v22.0.0"
  const match = versionOutput.trim().match(/^v?(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Node.js runtime adapter.
 */
export const nodeAdapter: RuntimeAdapter = {
  id: "node",

  *detect(): Operation<boolean> {
    try {
      const result = yield* exec("node --version").join();
      return result.code === 0;
    } catch {
      return false;
    }
  },

  *version(): Operation<string> {
    const result = yield* exec("node --version").expect();
    // Remove 'v' prefix
    return result.stdout.trim().replace(/^v/, "");
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
        runtime: "node",
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
            avgTime: 10.5,
            minTime: 9.0,
            maxTime: 12.0,
            stdDev: 1.0,
            p50: 10.0,
            p95: 11.5,
            p99: 11.9,
          },
        },
      ],
    };

    return validateBenchmarkResult(mockResult);
  },
};
