/**
 * run command implementation.
 *
 * Runs benchmarks for a specific Effection release across runtimes.
 *
 * @module
 */

import type { Operation } from "effection";
import { spawn } from "effection";
import { useTaskBuffer } from "@effectionx/task-buffer";
import { z } from "zod";
import { Configliere } from "configliere";
import {
  RuntimeIdSchema,
  RUNTIMES,
  SCHEMA_VERSION,
  type BenchmarkResult,
  type RuntimeId,
  validateBenchmarkConfig,
} from "../lib/schema.ts";
import { wrapResult, failures, successes, type Result } from "../lib/result.ts";
import { withTempDir } from "../lib/temp-dir.ts";
import { getAdapter } from "../lib/runtimes/mod.ts";

/**
 * Configliere spec for run command options.
 */
const configliere = new Configliere({
  release: {
    schema: z.string().min(1),
    description: "Effection npm version to benchmark",
    cli: { alias: "r" },
  },
  runtime: {
    schema: z.array(RuntimeIdSchema).min(1),
    description: "Runtime(s) to benchmark",
    collection: true,
  },
  repeat: {
    schema: z.number().int().positive(),
    default: 10,
    description: "Benchmark iterations",
  },
  depth: {
    schema: z.number().int().positive(),
    default: 100,
    description: "Recursion depth for scenarios",
  },
  warmup: {
    schema: z.number().int().nonnegative(),
    default: 3,
    description: "Warmup runs to discard",
  },
  "rxjs-version": {
    schema: z.string().optional(),
    description: "RxJS version override",
  },
  "effect-version": {
    schema: z.string().optional(),
    description: "Effect version override",
  },
  "co-version": {
    schema: z.string().optional(),
    description: "co version override",
  },
  "fail-fast": {
    schema: z.boolean(),
    default: false,
    description: "Stop on first failure",
    cli: { switch: true },
  },
});

/**
 * Load benchmark config from benchmark.config.json.
 */
function loadConfig(): {
  rxjs: string;
  effect: string;
  co: string;
} {
  try {
    const text = Deno.readTextFileSync("benchmark.config.json");
    const config = validateBenchmarkConfig(JSON.parse(text));
    return config.comparisonLibraries;
  } catch {
    // Defaults if config doesn't exist
    return {
      rxjs: "7.8.1",
      effect: "3.14.0",
      co: "4.6.0",
    };
  }
}

/**
 * Run benchmarks for a single runtime.
 */
function* runForRuntime(
  runtime: RuntimeId,
  release: string,
  opts: {
    repeat: number;
    depth: number;
    warmup: number;
    comparisonVersions: { rxjs: string; effect: string; co: string };
  },
): Operation<BenchmarkResult[]> {
  const adapter = getAdapter(runtime);

  // Check if runtime is available
  const available = yield* adapter.detect();
  if (!available) {
    throw new Error(`Runtime ${runtime} is not available`);
  }

  // Get runtime version
  const version = yield* adapter.version();
  console.log(`  ${runtime} ${version}: starting benchmarks...`);

  // Run all scenarios for this runtime
  const results: BenchmarkResult[] = [];

  // For now, just run effection.recursion as a smoke test
  // TODO: Run all scenarios
  const result = yield* adapter.runScenario({
    releaseTag: release,
    scenario: "effection.recursion",
    repeat: opts.repeat,
    warmup: opts.warmup,
    depth: opts.depth,
    comparisonVersions: opts.comparisonVersions,
  });

  results.push(result);

  console.log(`  ${runtime} ${version}: completed ${results.length} scenario(s)`);

  return results;
}

/**
 * Write benchmark result to data/json/.
 */
function writeResult(result: BenchmarkResult): void {
  const { metadata } = result;
  const date = metadata.timestamp.split("T")[0];
  const filename = `${date}-${metadata.releaseTag}-${metadata.runtime}-${metadata.runtimeMajorVersion}-${metadata.scenario}.json`;
  const path = `data/json/${filename}`;

  Deno.mkdirSync("data/json", { recursive: true });
  Deno.writeTextFileSync(path, JSON.stringify(result, null, 2));

  console.log(`  Wrote: ${path}`);
}

/**
 * Run benchmarks for an Effection release.
 */
export function* runCommand(args: string[]): Operation<number> {
  // Parse arguments
  const parseResult = configliere.parse({
    args,
    env: Deno.env.toObject(),
  });

  if (!parseResult.ok) {
    console.error("Error parsing arguments:");
    console.error(parseResult.summary);
    return 1;
  }

  const config = parseResult.config;
  const release = config.release;
  const runtimes = config.runtime as RuntimeId[];

  // Load comparison library versions
  const defaultVersions = loadConfig();
  const comparisonVersions = {
    rxjs: config["rxjs-version"] ?? defaultVersions.rxjs,
    effect: config["effect-version"] ?? defaultVersions.effect,
    co: config["co-version"] ?? defaultVersions.co,
  };

  console.log(`\nRunning benchmarks for Effection ${release}`);
  console.log(`Runtimes: ${runtimes.join(", ")}`);
  console.log(`Options: repeat=${config.repeat}, depth=${config.depth}, warmup=${config.warmup}`);
  console.log(`Comparison libs: rxjs@${comparisonVersions.rxjs}, effect@${comparisonVersions.effect}, co@${comparisonVersions.co}`);
  console.log();

  // Run benchmarks with bounded concurrency
  const buffer = yield* useTaskBuffer(2);
  const results: Result<BenchmarkResult[]>[] = [];

  for (const runtime of runtimes) {
    yield* buffer.spawn(function* () {
      const r = yield* wrapResult(
        runtime,
        runForRuntime(runtime, release, {
          repeat: config.repeat,
          depth: config.depth,
          warmup: config.warmup,
          comparisonVersions,
        }),
      );
      results.push(r);
    });
  }

  // Wait for all runtimes to complete
  yield* buffer;

  // Process results
  const successfulResults = successes(results);
  const failedResults = failures(results);

  // Write successful results
  console.log("\nWriting results...");
  for (const runtimeResults of successfulResults) {
    for (const result of runtimeResults) {
      writeResult(result);
    }
  }

  // Report failures
  if (failedResults.length > 0) {
    console.error("\nFailures:");
    for (const { context, error } of failedResults) {
      console.error(`  ${context}: ${error.message}`);
    }
  }

  // Summary
  const totalSuccess = successfulResults.reduce((n, r) => n + r.length, 0);
  console.log(`\nCompleted: ${totalSuccess} result(s) written, ${failedResults.length} runtime(s) failed`);

  return failedResults.length > 0 ? 1 : 0;
}
