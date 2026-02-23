/**
 * Benchmark harness entry point.
 *
 * This file is executed as a subprocess by each runtime adapter.
 * It must work across Node 22, Deno, and Bun.
 *
 * @module
 */

import { main } from "effection";
import { parseHarnessArgs, validateHarnessArgs } from "./args.ts";
import { measure } from "./measure.ts";
import { getScenario, listScenarios } from "../scenarios/mod.ts";
import type { HarnessOutput, ScenarioResult } from "./types.ts";

// Declare process for Node.js/Bun compatibility
declare const process: {
  argv: string[];
  exit(code: number): never;
} | undefined;

/**
 * Get command line arguments in a cross-runtime way.
 */
function getArgs(): string[] {
  // Deno
  if (typeof Deno !== "undefined") {
    return Deno.args;
  }
  // Node.js / Bun
  if (typeof process !== "undefined") {
    return process.argv.slice(2);
  }
  return [];
}

/**
 * Exit the process in a cross-runtime way.
 */
function exitProcess(code: number): never {
  // Deno
  if (typeof Deno !== "undefined") {
    Deno.exit(code);
  }
  // Node.js / Bun
  if (typeof process !== "undefined") {
    process.exit(code);
  }
  throw new Error(`Exit with code ${code}`);
}

/**
 * Main harness entry point.
 */
main(function* () {
  const args = parseHarnessArgs(getArgs());

  // Validate arguments
  const validationError = validateHarnessArgs(args);
  if (validationError) {
    console.error(`Error: ${validationError}`);
    console.error(`\nAvailable scenarios: ${listScenarios().join(", ")}`);
    exitProcess(1);
  }

  // Get scenario
  const scenario = getScenario(args.scenario);
  if (!scenario) {
    console.error(`Unknown scenario: ${args.scenario}`);
    console.error(`\nAvailable scenarios: ${listScenarios().join(", ")}`);
    exitProcess(1);
  }

  // Run the scenario
  const stats = yield* measure(scenario.run, {
    repeat: args.repeat,
    warmup: args.warmup,
    depth: args.depth,
  });

  // Build result
  const result: ScenarioResult = {
    name: scenario.library,
    stats,
  };

  // Output
  if (args.json) {
    const output: HarnessOutput = {
      results: [result],
    };
    console.log(JSON.stringify(output));
  } else {
    console.log(`Scenario: ${scenario.name}`);
    console.log(`Library: ${scenario.library}`);
    console.log(`Stats:`);
    console.log(`  avgTime: ${stats.avgTime.toFixed(3)} ms`);
    console.log(`  minTime: ${stats.minTime.toFixed(3)} ms`);
    console.log(`  maxTime: ${stats.maxTime.toFixed(3)} ms`);
    console.log(`  stdDev: ${stats.stdDev.toFixed(3)} ms`);
    console.log(`  p50: ${stats.p50.toFixed(3)} ms`);
    console.log(`  p95: ${stats.p95.toFixed(3)} ms`);
    console.log(`  p99: ${stats.p99.toFixed(3)} ms`);
  }

  exitProcess(0);
});
