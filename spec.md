# Effection Benchmark Observatory — Specification

## Prerequisites

Before implementing this specification, the code agent MUST:

1. Read and understand the Effection AGENTS.md at https://github.com/thefrontside/effection/blob/v4/AGENTS.md — this covers Operations, structured concurrency, scope ownership, streams, channels, and the `each()` pattern
2. Read and understand the effectionx AGENTS.md at https://github.com/thefrontside/effectionx/blob/main/AGENTS.md — this covers coding standards, project structure, and policies
3. Read ALL policies referenced in https://github.com/thefrontside/effectionx/blob/main/.policies/index.md — these are mandatory compliance requirements
4. Read the benchmark scenario files at https://github.com/thefrontside/effection/tree/v4/tasks/bench/scenarios and the types at https://github.com/thefrontside/effection/blob/v4/tasks/bench/types.ts (these are ported downstream)
5. Read the existing benchmark tool at https://github.com/thefrontside/effection/blob/v4/tasks/bench.ts and its supporting files in `tasks/bench/` for background context (the downstream harness intentionally does not execute this file)

All source code produced MUST conform to the effectionx coding standards and policies. This includes TypeScript strict mode, Deno's native module resolution (via `deno.json` imports map — NOT NodeNext which is Node-specific), Effection structured concurrency patterns, proper resource cleanup, explicit return types on public functions, and all policies defined in `.policies/index.md`.

> **Note**: The effectionx policies reference NodeNext module resolution, but that applies only to Node.js projects. This Deno CLI uses Deno's native resolver with `deno.json` imports map and JSR/npm specifiers.

---

## Overview

This is a standalone repository (will be later moved and renamed to `thefrontside/effection-benchmarks`) that tracks Effection's performance across releases and runtime environments. It is fully decoupled from the main Effection repository. On a schedule, it benchmarks specific published npm versions of Effection across multiple JavaScript runtimes using a downstream harness (ported from Effection's benchmark scenarios), stores results as JSON files and serves an Observable Framework dashboard via GitHub Pages.

The system is designed from the start to be operated by both humans and LLM agents using the same CLI interface and documented via an AGENTS.md file.

---

## Component 1: CLI Tool

### Purpose

A single CLI tool that handles the entire benchmark workflow: fetching Effection releases, running benchmarks across runtimes and writing result files.

### Runtime

The CLI runs on Deno. Benchmarks are executed in subprocesses across runtimes. All code must use Effection structured concurrency patterns — no raw async/await.

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
bench run --release <version> --runtime <runtime> [--repeat <n>] [--depth <n>] [--warmup <n>]
```

Options:
- `--release` (required): Effection npm version to benchmark (e.g., `4.1.0`). Do not include the `v` prefix.
- `--runtime` (required, repeatable): Runtime to benchmark against. Valid values: `node`, `deno`, `bun`. Playwright browser runtimes (`playwright-chromium`, `playwright-firefox`, `playwright-webkit`) are deferred to Phase 2.
- `--repeat`: Number of benchmark iterations (default: 10)
- `--depth`: Recursion depth for benchmark scenarios (default: 100)
- `--warmup`: Number of warmup runs to discard (default: 3)
- `--rxjs-version`: RxJS version for comparison benchmarks (default: from `benchmark.config.json`)
- `--effect-version`: Effect version for comparison benchmarks (default: from `benchmark.config.json`)
- `--co-version`: co version for comparison benchmarks (default: from `benchmark.config.json`)

Behavior:
1. Create a temporary benchmark directory
2. Generate `package.json` with:
   - `effection@{release}` (the target Effection version)
   - Comparison libraries (`rxjs`, `effect`, `co`) at configured or specified versions
3. Run `npm install` in the temp directory (fresh install each time, no caching)
4. Copy the benchmark harness and scenario files to the temp directory
5. For each specified runtime, execute via **subprocess** (see Subprocess Strategy below):
   - **Deno**: `deno run -A harness/entry.ts --scenario <name> --json`
   - **Node**: `node --experimental-strip-types harness/entry.ts --scenario <name> --json`
   - **Bun**: `bun run harness/entry.ts --scenario <name> --json`
6. Capture JSON output from stdout and validate against Zod schema
7. Write validated result files to `data/json/`
8. Clean up temporary directory

#### Subprocess Strategy

**All runtimes (including Deno) are invoked via subprocess** for consistency and scope isolation. This ensures:
- Apples-to-apples comparison across runtimes
- No nested Effection scope issues (each process has its own root scope)
- Clean resource boundaries and predictable cleanup

Each runtime invocation spawns a fresh process with its own Effection root scope. The harness runs scenarios **in-process** using `scoped()` for isolation — the subprocess boundary provides the process-level isolation that Workers provided in the original `bench.ts`.

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

Use **bounded parallelism** (e.g., 2-3 concurrent runtime executions) rather than unbounded `all()`. This avoids resource exhaustion and reduces measurement noise. (This becomes essential once Playwright runtimes are added in Phase 2.)

#### `bench list-releases`

Lists available Effection releases that can be benchmarked.
```
bench list-releases [--filter <pattern>]
```

Behavior:
1. Query the npm registry for published Effection versions
2. Optionally filter by pattern
3. Output the list of available versions

Implementation note: `npm view effection versions --json` is a sufficient source for published versions.

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

## Cross-Runtime Benchmark Strategy

This section documents the approach for running benchmarks across Deno, Node, and Bun. It resolves the original research question about adapting `bench.ts` for multiple runtimes.

### Findings from `bench.ts` Analysis (Upstream)

The upstream Effection benchmark tool (`tasks/bench.ts` + `tasks/bench/*`) has these Deno-specific dependencies:

| Dependency | Location | Purpose |
|------------|----------|---------|
| `npm:` specifiers | `bench.ts` | Import zod-opts |
| `jsr:` specifiers | `bench.ts` | Import @cliffy/table, @std/path |
| `Deno.version.deno` | `bench.ts` | Runtime version for metadata |
| `new Worker(url, { type: "module" })` | `bench/worker.ts` | Scenario isolation via Web Workers |
| `import.meta.resolve()` | `bench/scenarios.ts` | Resolve scenario file URLs |

### Chosen Approach (Downstream)

This repository implements a downstream harness that:

1. Installs Effection from npm: `npm install effection@{version}` inside a temporary benchmark directory
2. Installs comparison libraries from npm (RxJS, Effect, co) at versions configured in `benchmark.config.json` (overridable via CLI flags)
3. Runs scenarios in-process using `scoped()` for isolation; subprocess boundaries provide process-level isolation (replacing the Worker isolation in upstream `bench.ts`)
4. Executes each runtime via subprocess:
   - Node 22: `node --experimental-strip-types harness/entry.ts ...`
   - Deno: `deno run -A harness/entry.ts ...`
   - Bun: `bun run harness/entry.ts ...`

This keeps benchmarking decoupled from the Effection git repository and allows benchmarking any published npm version.

### Scenario Porting Rules

Scenarios are ported from upstream `tasks/bench/scenarios/` with these changes:

| Upstream | Downstream |
|---------|------------|
| Worker messaging (`self.postMessage`) | Return values from operations; the harness aggregates results |
| Worker isolation | `scoped()` isolation + subprocess boundary |
| Imports from `../../../mod.ts` | Imports from `effection` (npm) |

### Measurement Pattern

In-process measurement uses `performance.now()` and wraps each run in `scoped()` to ensure cleanup and prevent effects from escaping scope.

### Phase 2

Playwright runtimes (`playwright-chromium`, `playwright-firefox`, `playwright-webkit`) are deferred to Phase 2.

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
  // Phase 1: Server-side runtimes
  const RUNTIMES = ["node", "deno", "bun"] as const;
  // Phase 2 will add: "playwright-chromium", "playwright-firefox", "playwright-webkit"
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
- `releaseTag`: Effection npm version (e.g., `"4.1.0"`)
- `runtime`: Runtime identifier (`"node"`, `"deno"`, `"bun"`). Phase 2 will add `"playwright-chromium"`, `"playwright-firefox"`, `"playwright-webkit"`.
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

Example: `2026-02-22-4.1.0-node-22-recursion.json`

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
- `workflow_dispatch`: Manual trigger with inputs for version and runtimes

#### Configuration

The workflow reads a configuration file (`benchmark.config.json`) that specifies:
- Which Effection npm versions to benchmark (new releases are added manually)
- Default versions of comparison libraries (RxJS, Effect, co)

`benchmark.config.json` format:

```json
{
  "effectionVersions": ["4.0.0", "4.1.0", "4.2.0"],
  "comparisonLibraries": {
    "rxjs": "7.8.1",
    "effect": "3.0.0",
    "co": "4.6.0"
  }
}
```

CLI flags (`--rxjs-version`, `--effect-version`, `--co-version`) override these defaults for ad-hoc runs.

The workflow does not auto-discover releases.

#### Matrix

The workflow uses a matrix strategy to run benchmarks across runtimes:
- Node 22 (LTS, uses `--experimental-strip-types`)
- Deno (latest stable)
- Bun (latest stable)

Playwright browser runtimes (Chromium, Firefox, WebKit) are deferred to Phase 2.

Use `fail-fast: false` so all runtime combinations complete even if one fails.

#### Steps

1. Check out the benchmark repository
2. Install the appropriate runtime for the matrix entry
3. Run `bench run --release <version> --runtime <runtime>`
4. Generate/update Parquet from `data/json/` (e.g., `deno task parquet` or a dedicated CLI command)
5. Commit new JSON result files and updated Parquet to the repository
6. Build and deploy the Observable Framework site to GitHub Pages

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
├── benchmark.config.json            # Effection versions, comparison library versions
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
│   ├── lib/
│   │   ├── schema.ts                # Zod schema + inferred types
│   │   ├── stats.ts                 # calculateStats, percentile (pure functions)
│   │   ├── temp-dir.ts              # Temp directory creation/cleanup
│   │   └── runtimes/
│   │       ├── mod.ts               # RuntimeAdapter interface + registry
│   │       ├── deno.ts              # Deno adapter
│   │       ├── node.ts              # Node adapter
│   │       └── bun.ts               # Bun adapter
│   ├── harness/
│   │   ├── entry.ts                 # Subprocess entry point (universal)
│   │   ├── measure.ts               # In-process measurement logic
│   │   ├── args.ts                  # CLI arg parsing for harness
│   │   └── types.ts                 # Harness type definitions
│   └── scenarios/
│       ├── mod.ts                   # Scenario registry
│       ├── effection.recursion.ts   # Effection recursion benchmark
│       ├── effection.events.ts      # Effection events benchmark
│       ├── async-await.recursion.ts # async/await baseline
│       ├── rxjs.recursion.ts        # RxJS recursion benchmark
│       ├── rxjs.events.ts           # RxJS events benchmark
│       ├── co.recursion.ts          # co recursion benchmark
│       ├── effect.recursion.ts      # Effect recursion benchmark
│       ├── effect.events.ts         # Effect events benchmark
│       └── add-event-listener.events.ts  # Native EventTarget baseline
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
4. **Minimal `lib/` files**: `schema.ts` (Zod + types), `stats.ts` (pure math), `temp-dir.ts` (temp directory ops), and `runtimes/` — avoid premature abstraction
5. **Runtime adapters**: Each adapter implements `RuntimeAdapter` interface and handles its own subprocess setup internally
6. **npm-based versioning**: Effection is installed from npm (`effection@{version}`) rather than cloning the git repo. This allows benchmarking any published version.
7. **In-process measurement with subprocess isolation**: The harness runs scenarios in-process using `scoped()`, while the subprocess boundary provides process-level isolation (replacing the Worker architecture in the original bench.ts)
8. **Comparison libraries included**: Benchmarks compare Effection against RxJS, Effect, co, and async/await to provide context for performance numbers

---

## Effection Patterns

### Subprocess Execution

Use `@effectionx/process` for subprocess spawning. The `exec()` operation runs a command and returns when it exits:

```ts
import { exec } from "@effectionx/process";
import type { Operation } from "effection";
import type { BenchmarkResult } from "../schema.ts";

function* runHarnessInSubprocess(
  runtime: "node" | "deno" | "bun",
  cwd: string,
  args: string[],
): Operation<BenchmarkResult> {
  const command = runtime === "node"
    ? ["node", ["--experimental-strip-types", "harness/entry.ts", ...args]]
    : runtime === "deno"
    ? ["deno", ["run", "-A", "harness/entry.ts", ...args]]
    : ["bun", ["run", "harness/entry.ts", ...args]];

  const result = yield* exec(command[0], command[1], { cwd });

  if (result.code !== 0) {
    throw new Error(`Benchmark failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout) as BenchmarkResult;
}
```

For long-running processes that need to be managed (like Playwright browsers), operations can use `resource()` internally — but from the caller's perspective, it's just an operation that returns a value.

### Runtime Adapter Contract

All runtime adapters implement a uniform interface:

```ts
// cli/lib/runtimes/mod.ts
import type { Operation } from "effection";
import type { BenchmarkResult, RuntimeId } from "../schema.ts";

export interface ScenarioOpts {
  releaseTag: string;        // npm version (e.g., "4.1.0")
  scenario: string;          // scenario name (e.g., "effection.recursion")
  repeat: number;
  warmup: number;
  depth: number;
  comparisonVersions: {      // versions of comparison libraries
    rxjs: string;
    effect: string;
    co: string;
  };
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
    default:
      const _exhaustive: never = id;
      throw new Error(`Unknown runtime: ${id}`);
  }
}
```


---

## Open Research Items

The following items need investigation before or during implementation:

1. **Playwright benchmark accuracy** (Phase 2): Validate that `performance.now()` inside `page.evaluate()` gives sufficient resolution for Effection's benchmark scenarios across all three browser engines. Specifically test Firefox with timer precision disabled and WebKit's actual resolution.

2. **Effection API compatibility across versions**: If Effection v5 introduces breaking API changes, the benchmark scenarios may need version-specific variants. Monitor for API changes in:
   - `spawn()`, `scoped()`, `call()` signatures
   - Stream/channel APIs
   - `main()` entry point

> **Note:** Playwright browser runtimes are deferred to Phase 2. The initial implementation covers Deno, Node 22, and Bun only.
