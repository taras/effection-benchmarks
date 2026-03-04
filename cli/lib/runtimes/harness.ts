/**
 * Shared harness subprocess invocation helper.
 *
 * All runtime adapters use this to invoke the harness entry point
 * and parse the JSON output into a BenchmarkResult.
 *
 * @module
 */

import { exec } from "@effectionx/process";
import type { Operation } from "effection";
import { z } from "zod";
import {
  SamplesSchema,
  type BenchmarkResult,
  type RuntimeId,
  SCHEMA_VERSION,
  validateBenchmarkResult,
} from "../schema.ts";
import { toError } from "../result.ts";
import type { ScenarioOpts } from "./mod.ts";

/**
 * Schema for harness JSON output.
 * The harness outputs { results: [{ name, samples }] }.
 */
const HarnessOutputSchema = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      samples: SamplesSchema,
    })
  ).min(1),
});

type HarnessOutput = z.infer<typeof HarnessOutputSchema>;

/**
 * Options for invoking the harness subprocess.
 */
export interface HarnessInvokeOpts {
  /** The runtime command (e.g., "node", "deno", "bun") */
  command: string;
  /** Additional arguments before the harness entry path */
  runtimeArgs: string[];
  /** Runtime identifier */
  runtimeId: RuntimeId;
  /** Runtime major version */
  runtimeMajorVersion: number;
  /** Scenario options */
  scenarioOpts: ScenarioOpts;
  /** Working directory for subprocess (workspace path) */
  cwd: string;
}

/**
 * Get the harness entry point path relative to current working directory.
 * The harness is at cli/harness/entry.ts.
 */
function getHarnessEntryPath(): string {
  // Get the path to the harness entry point
  // This assumes we're running from the repo root
  return "cli/harness/entry.ts";
}

/**
 * Build harness arguments from scenario options.
 */
function buildHarnessArgs(opts: ScenarioOpts): string[] {
  return [
    "--scenario", opts.scenario,
    "--repeat", String(opts.repeat),
    "--warmup", String(opts.warmup),
    "--depth", String(opts.depth),
    "--json",
  ];
}

/**
 * Parse harness JSON output.
 * Returns the parsed output or throws with a descriptive error.
 */
function parseHarnessOutput(stdout: string, scenario: string): HarnessOutput {
  // Find the JSON in stdout (harness outputs JSON on a single line)
  const lines = stdout.trim().split("\n");
  const jsonLine = lines.find((line) => line.startsWith("{"));
  
  if (!jsonLine) {
    throw new Error(
      `Harness did not output JSON for scenario ${scenario}. Output:\n${stdout}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch (e) {
    const err = toError(e);
    throw new Error(
      `Failed to parse harness JSON output for scenario ${scenario}: ${err.message}\nOutput:\n${stdout}`
    );
  }

  const result = HarnessOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid harness output format for scenario ${scenario}: ${result.error.message}\nOutput:\n${stdout}`
    );
  }

  return result.data;
}

/**
 * Invoke the harness subprocess and return a BenchmarkResult.
 *
 * This is the main entry point used by all runtime adapters.
 */
export function* invokeHarness(opts: HarnessInvokeOpts): Operation<BenchmarkResult> {
  const harnessPath = getHarnessEntryPath();
  const harnessArgs = buildHarnessArgs(opts.scenarioOpts);
  
  // Build full command
  // e.g., "node --experimental-strip-types cli/harness/entry.ts --scenario effection.recursion ..."
  const fullArgs = [...opts.runtimeArgs, harnessPath, ...harnessArgs];
  const command = `${opts.command} ${fullArgs.join(" ")}`;

  // Execute the harness subprocess in the workspace directory
  const result = yield* exec(command, { cwd: opts.cwd }).expect();

  // Parse JSON output
  const harnessOutput = parseHarnessOutput(result.stdout, opts.scenarioOpts.scenario);

  // Build the full BenchmarkResult with metadata
  const now = new Date().toISOString();
  
  const benchmarkResult: BenchmarkResult = {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      releaseTag: opts.scenarioOpts.releaseTag,
      runtime: opts.runtimeId,
      runtimeMajorVersion: opts.runtimeMajorVersion,
      timestamp: now,
      runner: {
        os: Deno.build.os,
        arch: Deno.build.arch,
      },
      scenario: opts.scenarioOpts.scenario,
      benchmarkParams: {
        repeat: opts.scenarioOpts.repeat,
        warmup: opts.scenarioOpts.warmup,
        depth: opts.scenarioOpts.depth,
      },
    },
    results: harnessOutput.results,
  };

  // Validate before returning
  return validateBenchmarkResult(benchmarkResult);
}
