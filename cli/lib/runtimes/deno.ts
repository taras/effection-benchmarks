/**
 * Deno runtime adapter.
 *
 * @module
 */

import { exec } from "@effectionx/process";
import type { Operation } from "effection";
import type { BenchmarkResult } from "../schema.ts";
import type { RuntimeAdapter, ScenarioOpts } from "./mod.ts";
import { invokeHarness } from "./harness.ts";

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
    const versionStr = yield* this.version();
    const majorVersion = parseMajorVersion(`deno ${versionStr}`);

    // Deno needs -A for all permissions and runs TypeScript natively
    return yield* invokeHarness({
      command: "deno",
      runtimeArgs: ["run", "-A"],
      runtimeId: "deno",
      runtimeMajorVersion: majorVersion,
      scenarioOpts: opts,
    });
  },
};
