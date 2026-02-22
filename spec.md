# Effection Benchmark Observatory — Specification

## Prerequisites

Before implementing this specification, the code agent MUST:

1. Read and understand the Effection AGENTS.md at https://github.com/thefrontside/effection/blob/v4/AGENTS.md — this covers Operations, structured concurrency, scope ownership, streams, channels, and the `each()` pattern
2. Read and understand the effectionx AGENTS.md at https://github.com/thefrontside/effectionx/blob/main/AGENTS.md — this covers coding standards, project structure, and policies
3. Read ALL policies referenced in https://github.com/thefrontside/effectionx/blob/main/.policies/index.md — these are mandatory compliance requirements
4. Read the existing benchmark tool at https://github.com/thefrontside/effection/blob/v4/tasks/bench.ts and its supporting files in `tasks/bench/` to understand what it measures and how
5. Read the benchmark scenario files at https://github.com/thefrontside/effection/tree/v4/tasks/bench/scenarios and the types at https://github.com/thefrontside/effection/blob/v4/tasks/bench/types.ts

All source code produced MUST conform to the effectionx coding standards and policies. This includes TypeScript strict mode, Deno's native module resolution (via `deno.json` imports map — NOT NodeNext which is Node-specific), Effection structured concurrency patterns, proper resource cleanup, explicit return types on public functions, and all policies defined in `.policies/index.md`.

> **Note**: The effectionx policies reference NodeNext module resolution, but that applies only to Node.js projects. This Deno CLI uses Deno's native resolver with `deno.json` imports map and JSR/npm specifiers.

---

## Overview

This is a standalone repository (will be later moved and renamed to `thefrontside/effection-benchmarks`) that tracks Effection's performance across releases and runtime environments. It is fully decoupled from the main Effection repository. On a schedule, it pulls specific released versions of Effection, runs the existing `bench.ts` benchmark tool across multiple JavaScript runtimes, stores results as JSON files and serves an Observable Framework dashboard via GitHub Pages.

The system is designed from the start to be operated by both humans and LLM agents using the same CLI interface and documented via an AGENTS.md file.

---

## Component 1: CLI Tool

### Purpose

A single CLI tool that handles the entire benchmark workflow: fetching Effection releases, running benchmarks across runtimes and writing result files.

### Runtime

The CLI runs on Deno (to match the Effection repo's `bench.ts` which uses Deno APIs and workers). All code must use Effection structured concurrency patterns — no raw async/await.

#### Entry Point Pattern

The CLI entry point uses Effection's `main()` to run the entire CLI inside one root scope:

```ts
// cli/main.ts
import { main, exit } from "effection";
import { parseArgs, dispatch } from "./commands/mod.ts";

main(function* () {
  const args = parseArgs(Deno.args);
  const code = yield* dispatch(args);
  yield* exit(code);
});
```

Each command handler is an `Operation<number>` that returns an exit code. Keep argument parsing at the edge; command handlers are pure orchestration.

### Commands

#### `bench run`

Runs benchmarks for a specific Effection release across one or more runtimes.
```
bench run --release <git-tag> --runtime <runtime> [--repeat <n>] [--depth <n>] [--warmup <n>]
```

Options:
- `--release` (required): Effection git tag to benchmark (e.g., `v4.1.0`)
- `--runtime` (required, repeatable): Runtime to benchmark against. Valid values: `node`, `deno`, `bun`, `playwright-chromium`, `playwright-firefox`, `playwright-webkit`
- `--repeat`: Number of benchmark iterations (default: 10)
- `--depth`: Recursion depth for benchmark scenarios (default: 100)
- `--warmup`: Number of warmup runs to discard (default: 3)

Behavior:
1. Clone or fetch the Effection repository at the specified git tag into a local cache
2. For each specified runtime, execute the benchmark scenarios via **subprocess** (see Subprocess Strategy below)
3. For Deno: spawn `deno run bench.ts --json`
4. For Node and Bun: spawn the appropriate runtime with adapted benchmark code
5. For Playwright runtimes: load the benchmark code into a browser context via Playwright's `page.evaluate()`, running the measurement loop entirely inside the browser. For Firefox, disable timer precision reduction (`privacy.reduceTimerPrecision: false`, `privacy.resistFingerprinting: false`). For all engines, ensure JIT warmup of 1000+ iterations before measurement
6. Capture the JSON output and validate it against the Zod schema before writing
7. Write a validated result file to the `data/json/` directory with embedded metadata

#### Subprocess Strategy

**All runtimes (including Deno) are invoked via subprocess** for consistency and scope isolation. This ensures:
- Apples-to-apples comparison across runtimes
- No nested Effection scope issues (each process has its own root scope)
- Clean resource boundaries and predictable cleanup

Do NOT import and execute `tasks/bench.ts` directly from the CLI. Each runtime invocation spawns a fresh process.

#### Concurrency & Error Handling

The CLI supports two modes for multi-runtime execution:

- **Best-effort mode** (default): If one runtime fails, others continue. Partial results are written. Exit code is non-zero if any runtime failed.
- **Strict mode** (`--fail-fast`): First failure aborts all remaining benchmarks.

Implementation pattern:
```ts
// Wrap each runtime op to collect success/failure without collapsing the whole run
type Result<T> = { ok: true; value: T } | { ok: false; error: Error; runtime: string };

const results = yield* all(runtimes.map((r) => wrapResult(r, runBenchmark(r))));
const successes = results.filter((r) => r.ok);
const failures = results.filter((r) => !r.ok);
```

Use **bounded parallelism** (e.g., 2-3 concurrent runtime executions) rather than unbounded `all()`. This prevents resource exhaustion when running multiple Playwright browsers.

#### `bench list-releases`

Lists available Effection releases that can be benchmarked.
```
bench list-releases [--filter <pattern>]
```

Behavior:
1. Query the Effection repository for git tags
2. Optionally filter by pattern
3. Output the list of available release tags

#### `bench status`

Shows the current state of collected benchmark data.
```
bench status
```

Behavior:
1. List how many result files exist per release and runtime
2. Show which release/runtime combinations are missing data
3. Report the date range of collected data

### Help Output

Every command and subcommand must have comprehensive `--help` output that fully describes what it does, what arguments it takes, and provides usage examples. This help text serves as documentation for both humans and LLM agents.

---

## Component 2: Data Storage

### Data Schema

#### Schema Definition

The agent MUST create a Zod schema (`cli/lib/schema.ts`) that defines the complete structure of a benchmark result JSON file. This schema is the single source of truth for the file format.

The schema must:
- Include a `schemaVersion` field (integer, starting at 1) for migration safety
- Define the full metadata structure (releaseTag, runtime, runtimeMajorVersion, timestamp, runner, scenario, benchmarkParams)
- Define the results array structure (name, stats with all timing fields)
- Derive runtime identifiers from a `const` tuple to avoid drift between enum and type:
  ```ts
  const RUNTIMES = ["node", "deno", "bun", "playwright-chromium", "playwright-firefox", "playwright-webkit"] as const;
  const RuntimeIdSchema = z.enum(RUNTIMES);
  type RuntimeId = z.infer<typeof RuntimeIdSchema>;
  ```
- Validate that `results` array is non-empty (`.min(1)`)
- Validate that all timing stats are finite, non-negative numbers
- Validate that `runtimeMajorVersion` is a non-negative integer
- Validate that timestamp is ISO 8601 format with timezone
- Export both the schema and the inferred TypeScript type (`z.infer<typeof BenchmarkResultSchema>`)

#### Schema Usage

The schema must be used in the following places:
- **CLI `bench run`**: Validate every JSON result before writing to disk. If validation fails, the CLI must error with a clear message showing which fields failed
- **Tests**: Use the schema to generate test fixtures and validate test output
- **AGENTS.md**: The schema file path must be referenced as the authoritative definition of the data format. Any prose description of the format in AGENTS.md must direct the reader to the schema for the definitive structure

### File Format

Each benchmark run produces one JSON file containing both metadata and results. The structure is defined by the Zod schema in `cli/lib/schema.ts`. The following is a prose description for reference — the schema is authoritative.

#### Metadata fields

- `schemaVersion`: Integer version of the schema format (starting at 1, increment on breaking changes)
- `releaseTag`: Effection git tag (e.g., `"v4.1.0"`)
- `runtime`: Runtime identifier (`"node"`, `"deno"`, `"bun"`, `"playwright-chromium"`, `"playwright-firefox"`, `"playwright-webkit"`)
- `runtimeMajorVersion`: Major version number of the runtime (e.g., `22` for Node 22)
- `timestamp`: ISO 8601 timestamp of when the benchmark ran (with timezone)
- `runner`: Object describing the execution environment
  - `os`: Operating system (e.g., `"ubuntu-22.04"`)
  - `arch`: CPU architecture (e.g., `"x86_64"`)
- `scenario`: Name of the benchmark scenario (e.g., `"recursion"`, `"events"`)
- `benchmarkParams`: Full benchmark parameters as an object (preserved as JSON string column in Parquet). Includes `repeat`, `warmup`, `depth`, and any scenario-specific params

#### Results fields

- `results`: Array of result entries, each containing:
  - `name`: Name of the library or implementation being benchmarked
  - `stats`: Object with timing statistics in milliseconds:
    - `avgTime`, `minTime`, `maxTime`, `stdDev`, `p50`, `p95`, `p99`

### File Naming

Files are named with human-readable metadata for quick identification:
```
<YYYY-MM-DD>-<releaseTag>-<runtime>-<runtimeMajorVersion>-<scenario>.json
```

Example: `2026-02-22-v4.1.0-node-22-recursion.json`

The filename is for human readability only. All metadata for querying is embedded in the file content. If metadata fields are added later, filenames do not need to change.

### File Location

JSON result files are stored in `data/json/` in the benchmark repository. The Parquet file is written directly to `src/data/benchmarks.parquet`.

### Parquet Schema

The Parquet conversion flattens the JSON structure into these columns:

- `releaseTag` (string)
- `runtime` (string)
- `runtimeMajorVersion` (integer)
- `timestamp` (timestamp)
- `runnerOs` (string)
- `runnerArch` (string)
- `scenario` (string)
- `benchmarkParams` (string — JSON-encoded, queryable via `json_extract()`)
- `benchmarkName` (string — from `results[].name`)
- `avgTime`, `minTime`, `maxTime`, `stdDev`, `p50`, `p95`, `p99` (double)
- `sourceFile` (string — original JSON filename)

---

## Component 3: GitHub Actions Workflow

### Scheduled Benchmark Workflow

A scheduled GitHub Actions workflow that runs benchmarks on a cron schedule.

#### Trigger

- `schedule`: Weekly cron job (configurable)
- `workflow_dispatch`: Manual trigger with inputs for release tag and runtimes

#### Configuration

The workflow reads a configuration file (`benchmark.config.json` or similar) that specifies which Effection release tags to benchmark. New releases are added to this config file — the workflow does not auto-discover releases.

#### Matrix

The workflow uses a matrix strategy to run benchmarks across runtimes:
- Node (latest LTS major version)
- Deno (latest stable)
- Bun (latest stable)
- Playwright Chromium (V8)
- Playwright Firefox (SpiderMonkey)
- Playwright WebKit (JavaScriptCore)

Use `fail-fast: false` so all runtime/browser combinations complete even if one fails.

#### Steps

1. Check out the benchmark repository
2. Install the appropriate runtime for the matrix entry
3. For Playwright runtimes: install browser with `npx playwright install --with-deps <browser>`, cache `~/.cache/ms-playwright`
4. Run `bench run --release <tag> --runtime <runtime>`
6. Commit new JSON result files and updated Parquet to the repository
7. Build and deploy the Observable Framework site to GitHub Pages

#### Variance Mitigation

Shared GitHub Actions runners have 5–15% timing variance. To manage this:
- Run 10–30 iterations per benchmark (configurable via `--repeat`)
- Report median (p50) as the primary metric, not mean
- Use `taskset -c 0` on Linux to pin to a single CPU core where possible
- Stop unnecessary background services

---

## Component 4: AGENTS.md

The repository must include an `AGENTS.md` file at the root that serves as the entry point for both humans and LLM agents.

### Required Sections

#### Project Overview
- What the repository does: historical performance tracking for Effection
- Architecture: JSON files → Parquet → Observable Framework + DuckDB WASM
- Relationship to the Effection repository (decoupled, reads released versions)

#### CLI Reference
- Complete documentation of all `bench` CLI commands with examples
- This should mirror the `--help` output but in Markdown form

#### How to Run Benchmarks
- Step-by-step instructions for running benchmarks locally
- How to add a new Effection release to track
- How to add a new runtime

#### How to Extend
- How to add new benchmark scenarios
- How to add new metrics or metadata fields (directs reader to the Zod schema as the source of truth)
- How to add new SQL queries for the dashboard
- How to modify the dashboard visualizations

#### Data Format
- Reference to the Zod schema (`cli/lib/schema.ts`) as the authoritative definition
- Brief prose description of the JSON file format and Parquet schema for quick orientation
- How to query the data with DuckDB

#### Policies
- Reference to effectionx policies that all code must conform to
- Link to https://github.com/thefrontside/effectionx/blob/main/.policies/index.md
- Link to https://github.com/thefrontside/effection/blob/v4/AGENTS.md for Effection patterns

#### For LLM Agents
- Explicit instructions for how an LLM agent should interact with this repository
- Which CLI commands to use and in what order
- How to interpret benchmark results
- How to diagnose and fix common issues (build failures, missing data, etc.)

---

## Repository Structure
```
effection-benchmark/
├── AGENTS.md                        # Agent and human entry point
├── benchmark.config.json            # Which releases and runtimes to benchmark
├── deno.json                        # Deno config with imports map (JSR/npm pins)
├── deno.lock                        # Lockfile for reproducibility
├── .github/
│   └── workflows/
│       ├── benchmark.yml            # Scheduled benchmark runner
│       └── deploy.yml               # Dashboard deployment
├── cli/
│   ├── main.ts                      # CLI entry point (uses Effection main())
│   ├── mod.ts                       # Library exports for testing
│   ├── commands/
│   │   ├── mod.ts                   # Command dispatcher
│   │   ├── run.ts                   # bench run command
│   │   ├── list-releases.ts         # bench list-releases command
│   │   └── status.ts                # bench status command
│   └── lib/
│       ├── schema.ts                # Zod schema + inferred types
│       ├── repo.ts                  # Git clone/fetch operations for release cache
│       └── runtimes/
│           ├── mod.ts               # RuntimeAdapter interface + registry
│           ├── deno.ts              # Deno adapter (uses @effectionx/process)
│           ├── node.ts              # Node adapter (uses @effectionx/process)
│           ├── bun.ts               # Bun adapter (uses @effectionx/process)
│           └── playwright.ts        # Playwright adapter (all 3 browser engines)
├── data/
│   └── json/                        # Accumulated benchmark result files
├── src/                             # Observable Framework site
│   ├── data/
│   │   └── benchmarks.parquet       # Generated Parquet file
│   └── index.md                     # Dashboard page
├── queries/                         # SQL query files for analysis
│   ├── performance-over-time.sql
│   ├── runtime-comparison.sql
│   └── regression-detection.sql
└── observablehq.config.js
```

### Key Architecture Decisions

1. **`cli/main.ts` vs `cli/mod.ts`**: `main.ts` is the executable entry point (calls `main()`), `mod.ts` exports library functions for testing
2. **No `resources/` directory**: Operations that use `resource()` internally are just operations from the consumer's perspective — no need to segregate them
3. **Use `@effectionx/process`**: For subprocess spawning, use the existing package directly rather than wrapping it
4. **Minimal `lib/` files**: Only `schema.ts` (Zod + types), `repo.ts` (git cache), and `runtimes/` — avoid premature abstraction
5. **Runtime adapters**: Each adapter implements `RuntimeAdapter` interface and handles its own subprocess/browser setup internally

---

## Effection Patterns

### Subprocess Execution

Use `@effectionx/process` for subprocess spawning. The `exec()` operation runs a command and returns when it exits:

```ts
import { exec } from "@effectionx/process";

function* runDenoBenchmark(repoPath: string): Operation<BenchmarkResult> {
  const result = yield* exec("deno", ["run", "-A", "tasks/bench.ts", "--json"], {
    cwd: repoPath,
  });
  
  if (result.code !== 0) {
    throw new Error(`Benchmark failed: ${result.stderr}`);
  }
  
  return JSON.parse(result.stdout);
}
```

For long-running processes that need to be managed (like Playwright browsers), operations can use `resource()` internally — but from the caller's perspective, it's just an operation that returns a value.

### Runtime Adapter Contract

All runtime adapters implement a uniform interface:

```ts
// cli/lib/runtimes/mod.ts
import type { Operation } from "effection";
import type { BenchmarkResult } from "../schema.ts";

// Derived from const tuple to keep enum and type in sync
const RUNTIMES = ["node", "deno", "bun", "playwright-chromium", "playwright-firefox", "playwright-webkit"] as const;
export type RuntimeId = typeof RUNTIMES[number];

export interface ScenarioOpts {
  repoPath: string;
  scenario: string;
  repeat: number;
  warmup: number;
  depth: number;
}

export interface RuntimeAdapter {
  id: RuntimeId;
  detect(): Operation<boolean>;           // Is this runtime available?
  version(): Operation<string>;           // Get runtime version
  runScenario(opts: ScenarioOpts): Operation<BenchmarkResult>;
}

// Discriminated union for adapter selection
export function getAdapter(id: RuntimeId): RuntimeAdapter {
  switch (id) {
    case "node": return nodeAdapter;
    case "deno": return denoAdapter;
    case "bun": return bunAdapter;
    case "playwright-chromium":
    case "playwright-firefox":
    case "playwright-webkit":
      return playwrightAdapter(id);
    default:
      const _exhaustive: never = id;
      throw new Error(`Unknown runtime: ${id}`);
  }
}
```

---

## Open Research Items

The following items need investigation before or during implementation:

1. **Adapting bench.ts for Node and Bun**: The existing benchmark tool uses Deno-specific APIs (workers, `Deno.version`). Determine the minimal changes needed to run the same benchmark scenarios under Node and Bun. Options include transpiling, using a compatibility layer, or maintaining separate entry points per runtime.

2. **Playwright benchmark accuracy**: Validate that `performance.now()` inside `page.evaluate()` gives sufficient resolution for Effection's benchmark scenarios across all three engines. Specifically test Firefox with timer precision disabled and WebKit's actual resolution.

3. **Effection version switching mechanism**: Review how effectionx manages Effection version changes during test execution for design inspiration. The repositories are available locally at `~/Repositories/frontside/effectionx` and `~/Repositories/frontside/effection`. Key questions:
   - How does effectionx isolate different Effection versions?
   - Is there a package resolution or import map technique being used?
   - Can this approach be adapted for benchmarking multiple releases in sequence?