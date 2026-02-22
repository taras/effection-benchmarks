/**
 * Bun runtime adapter.
 *
 * @module
 */

import { exec } from "@effectionx/process";
import type { Operation } from "effection";
import type { BenchmarkResult } from "../schema.ts";
import type { RuntimeAdapter, ScenarioOpts } from "./mod.ts";
import { invokeHarness } from "./harness.ts";

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
    const versionStr = yield* this.version();
    const majorVersion = parseMajorVersion(versionStr);

    // Bun runs TypeScript natively with `bun run`
    return yield* invokeHarness({
      command: "bun",
      runtimeArgs: ["run"],
      runtimeId: "bun",
      runtimeMajorVersion: majorVersion,
      scenarioOpts: opts,
    });
  },
};
