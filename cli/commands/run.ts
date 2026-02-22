/**
 * run command implementation.
 *
 * Runs benchmarks for a specific Effection release across runtimes.
 * Creates isolated workspaces with npm-installed packages for each runtime.
 *
 * @module
 */

import type { Operation } from "effection";
import { z } from "zod";
import { Configliere } from "configliere";
import {
  RuntimeIdSchema,
  SCENARIOS,
  type BenchmarkResult,
  type RuntimeId,
  type ScenarioName,
  validateBenchmarkConfig,
} from "../lib/schema.ts";
import { wrapResult, failures, successes, type Result } from "../lib/result.ts";
import { getAdapter } from "../lib/runtimes/mod.ts";
import { useWorkspace, type Workspace } from "../lib/workspace.ts";

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
  "cache-workspace": {
    schema: z.boolean(),
    default: false,
    description: "Cache npm install between runs (faster dev iteration)",
    cli: { switch: true },
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
 * Run all scenarios for a single runtime with a pre-created workspace.
 */
function* runForRuntime(
  runtime: RuntimeId,
  release: string,
  workspace: Workspace,
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
  console.log(`  ${runtime} ${version}: running ${SCENARIOS.length} scenarios...`);

  const results: BenchmarkResult[] = [];

  // Run ALL scenarios
  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i] as ScenarioName;

    const result = yield* adapter.runScenario({
      releaseTag: release,
      scenario,
      repeat: opts.repeat,
      warmup: opts.warmup,
      depth: opts.depth,
      comparisonVersions: opts.comparisonVersions,
      workspace,
    });

    results.push(result);
    console.log(`    [${i + 1}/${SCENARIOS.length}] ${scenario}`);
  }

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
  const useCache = config["cache-workspace"] as boolean;

  // Load comparison library versions
  const defaultVersions = loadConfig();
  const comparisonVersions = {
    rxjs: config["rxjs-version"] ?? defaultVersions.rxjs,
    effect: config["effect-version"] ?? defaultVersions.effect,
    co: config["co-version"] ?? defaultVersions.co,
  };

  console.log(`\nRunning benchmarks for Effection ${release}`);
  console.log(`Runtimes: ${runtimes.join(", ")}`);
  console.log(`Scenarios: ${SCENARIOS.length} total`);
  console.log(`Options: repeat=${config.repeat}, depth=${config.depth}, warmup=${config.warmup}`);
  console.log(`Comparison libs: rxjs@${comparisonVersions.rxjs}, effect@${comparisonVersions.effect}, co@${comparisonVersions.co}`);
  if (useCache) {
    console.log(`Workspace caching: enabled`);
  }
  console.log();

  // Create workspace ONCE before running runtimes in parallel
  // This avoids race conditions when multiple runtimes try to create the same cache
  console.log(`Creating workspace for Effection ${release}...`);
  const workspace = yield* useWorkspace({
    effectionVersion: release,
    comparisonVersions,
    useCache,
  });
  console.log(`Workspace ready at: ${workspace.path}\n`);

  // Run runtimes sequentially for accurate benchmark measurements
  // (parallel execution causes CPU contention and measurement noise)
  const results: Result<BenchmarkResult[]>[] = [];

  for (const runtime of runtimes) {
    const r = yield* wrapResult(
      runtime,
      runForRuntime(runtime, release, workspace, {
        repeat: config.repeat,
        depth: config.depth,
        warmup: config.warmup,
        comparisonVersions,
      }),
    );
    results.push(r);
  }

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
