/**
 * Zod schemas for benchmark result validation.
 * This is the single source of truth for the benchmark data format.
 *
 * @module
 */

import { z } from "zod";

/**
 * Schema version for migration safety.
 * Increment when making breaking changes to the schema.
 *
 * Version 2: Store raw timing samples instead of pre-computed aggregates.
 *            Aggregates are computed at query time in DuckDB.
 */
export const SCHEMA_VERSION = 2;

/**
 * Phase 1 runtimes (server-side).
 * Phase 2 will add: "playwright-chromium", "playwright-firefox", "playwright-webkit"
 */
export const RUNTIMES = ["node", "deno", "bun"] as const;

/**
 * Runtime identifier schema.
 */
export const RuntimeIdSchema = z.enum(RUNTIMES);

/**
 * Runtime identifier type.
 */
export type RuntimeId = z.infer<typeof RuntimeIdSchema>;

/**
 * Scenario names that can be benchmarked.
 */
export const SCENARIOS = [
  "effection.recursion",
  "effection.events",
  "rxjs.recursion",
  "rxjs.events",
  "effect.recursion",
  "effect.events",
  "co.recursion",
  "async-await.recursion",
  "add-event-listener.events",
] as const;

/**
 * Scenario name schema.
 */
export const ScenarioNameSchema = z.enum(SCENARIOS);

/**
 * Scenario name type.
 */
export type ScenarioName = z.infer<typeof ScenarioNameSchema>;

/**
 * Raw timing samples from a benchmark run.
 * All time values are in milliseconds.
 * Aggregates (avg, min, max, percentiles) are computed at query time.
 */
export const SamplesSchema = z.array(z.number().nonnegative().finite()).min(1);

/**
 * Samples type.
 */
export type Samples = z.infer<typeof SamplesSchema>;

/**
 * A single result entry (one library/implementation).
 * Stores raw timing samples instead of pre-computed statistics.
 */
export const ResultEntrySchema = z.object({
  name: z.string().min(1),
  samples: SamplesSchema,
});

/**
 * Computed statistics (derived at query time, not stored).
 * All time values are in milliseconds.
 */
export interface BenchmarkStats {
  avgTime: number;
  minTime: number;
  maxTime: number;
  stdDev: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Result entry type.
 */
export type ResultEntry = z.infer<typeof ResultEntrySchema>;

/**
 * Runner environment information.
 */
export const RunnerSchema = z.object({
  os: z.string().min(1),
  arch: z.string().min(1),
});

/**
 * Runner type.
 */
export type Runner = z.infer<typeof RunnerSchema>;

/**
 * Benchmark parameters.
 */
export const BenchmarkParamsSchema = z.object({
  repeat: z.number().int().positive(),
  warmup: z.number().int().nonnegative(),
  depth: z.number().int().positive(),
});

/**
 * Benchmark parameters type.
 */
export type BenchmarkParams = z.infer<typeof BenchmarkParamsSchema>;

/**
 * Metadata for a benchmark run.
 */
export const MetadataSchema = z.object({
  releaseTag: z.string().min(1),
  runtime: RuntimeIdSchema,
  runtimeMajorVersion: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  runner: RunnerSchema,
  scenario: z.string().min(1),
  benchmarkParams: BenchmarkParamsSchema,
});

/**
 * Metadata type.
 */
export type Metadata = z.infer<typeof MetadataSchema>;

/**
 * Complete benchmark result file schema.
 * This is validated before writing any JSON result file.
 */
export const BenchmarkResultSchema = z.object({
  schemaVersion: z.number().int().min(1),
  metadata: MetadataSchema,
  results: z.array(ResultEntrySchema).min(1),
});

/**
 * Benchmark result type.
 */
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;

/**
 * Configuration file schema (benchmark.config.json).
 */
export const BenchmarkConfigSchema = z.object({
  effectionVersions: z.array(z.string().min(1)).min(1),
  comparisonLibraries: z.object({
    rxjs: z.string().min(1),
    effect: z.string().min(1),
    co: z.string().min(1),
  }),
});

/**
 * Benchmark config type.
 */
export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

/**
 * Validate a benchmark result and return typed result.
 * Throws ZodError if validation fails.
 */
export function validateBenchmarkResult(data: unknown): BenchmarkResult {
  return BenchmarkResultSchema.parse(data);
}

/**
 * Safe validation that returns a result object instead of throwing.
 */
export function safeParseBenchmarkResult(
  data: unknown,
): z.SafeParseReturnType<unknown, BenchmarkResult> {
  return BenchmarkResultSchema.safeParse(data);
}

/**
 * Validate benchmark config file.
 */
export function validateBenchmarkConfig(data: unknown): BenchmarkConfig {
  return BenchmarkConfigSchema.parse(data);
}
