/**
 * Node.js runtime adapter.
 *
 * Uses Node 22+ with --experimental-strip-types for TypeScript.
 *
 * @module
 */

import { exec } from "@effectionx/process";
import type { Operation } from "effection";
import type { BenchmarkResult } from "../schema.ts";
import type { RuntimeAdapter, ScenarioOpts } from "./mod.ts";
import { invokeHarness } from "./harness.ts";

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
    const versionStr = yield* this.version();
    const majorVersion = parseMajorVersion(versionStr);

    // Node 22+ supports --experimental-strip-types for TypeScript
    return yield* invokeHarness({
      command: "node",
      runtimeArgs: [
        "--experimental-strip-types",
        "--no-warnings",
      ],
      runtimeId: "node",
      runtimeMajorVersion: majorVersion,
      scenarioOpts: opts,
    });
  },
};
