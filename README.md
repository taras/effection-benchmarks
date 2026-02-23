# Effection Benchmark Observatory

Performance dashboard tracking Effection structured concurrency across releases and runtimes.

Live dashboard: https://effection-benchmarks.taras.deno.net

## What It Does

- Runs benchmarks against npm-published Effection releases (not a git checkout)
- Compares against other libraries (RxJS, Effect, co, async/await, and native addEventListener)
- Collects results as JSON files committed to the repo
- Serves an Observable Framework dashboard that queries the data in the browser

## Data Flow

1. Run benchmarks using the CLI
2. CLI writes result files to `data/json/*.json`
3. Server exposes `/api/benchmarks.parquet` by converting JSON -> Parquet on-demand
4. Browser loads that Parquet into DuckDB WASM and runs SQL client-side
5. Charts are rendered with Observable Plot using the query results

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  1) Benchmark CLI (Deno)                                            │
│     deno run -A cli/main.ts run --release 4.0.1 --runtime deno      │
│                                                                     │
│     - Creates an isolated npm workspace                             │
│     - Installs effection@<release> + comparison libs                │
│     - Runs scenarios in subprocesses (node/deno/bun)                │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2) JSON Results                                                    │
│     data/json/*.json                                                │
│                                                                     │
│     - One file per release x runtime x scenario                     │
│     - Includes stats: avgTime, p50, p95, p99, stdDev, etc.          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3) Server (Revolution on Deno Deploy)                              │
│     main.tsx                                                        │
│                                                                     │
│     Startup:                                                       │
│     - Generates comparison pages in src/                            │
│       (routes/comparison-pages.ts)                                  │
│     - Generates observablehq.config.js (gitignored)                 │
│     - Runs Observable build -> dist/                                │
│                                                                     │
│     Runtime:                                                       │
│     - /api/benchmarks.parquet converts JSON -> Parquet on-demand    │
│       (routes/benchmarks-parquet.ts)                                │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4) Browser (Observable Framework)                                  │
│                                                                     │
│     - Fetches /api/benchmarks.parquet                               │
│     - Loads Parquet into DuckDB WASM                                │
│     - Runs SQL in the browser                                       │
│     - Renders charts with Observable Plot                           │
└─────────────────────────────────────────────────────────────────────┘
```

## How The Database Becomes Available

The dashboard does not ship a committed Parquet artifact.

Instead:

- The server route `routes/benchmarks-parquet.ts` uses DuckDB (server-side) to read `data/json/*.json`, flatten the nested JSON, and write a temporary Parquet file.
- The bytes of that Parquet file are returned by `/api/benchmarks.parquet`.
- The dashboard pages fetch `/api/benchmarks.parquet` and register it as a file buffer inside DuckDB WASM (in the browser), then create a `benchmarks` table from it.

Once that table exists in the browser, all charts are driven by SQL queries executed client-side.

## Data Pipeline Example: Adding A New Field

When you add a field that you want to query in charts, it needs to flow through four places:

1) JSON schema and types: `cli/lib/schema.ts`

2) Measurement output: the harness must populate the field in its JSON output

3) Parquet conversion: `routes/benchmarks-parquet.ts` must select the field so it becomes a Parquet column

4) Dashboard queries: `routes/comparison-pages.ts` / `src/index.md` queries must select that column

Example: add a new metadata field `metadata.gitSha` so you can correlate results with a commit.

- Update schema (`cli/lib/schema.ts`) to include `metadata.gitSha`
- Update CLI/harness to write it
- Update Parquet generation (`routes/benchmarks-parquet.ts`) to include:

```sql
metadata.gitSha AS gitSha,
```

- Update a chart query to select and group by it:

```sql
SELECT gitSha, benchmarkName, avgTime
FROM benchmarks
WHERE scenario = 'effection.recursion'
ORDER BY gitSha
```

If you skip step 3, the field can exist in JSON but will not be queryable in the browser.

## Charts: Where They Live

There are two sources of charts:

- `src/index.md` (Overview page): curated summary charts
- `routes/comparison-pages.ts`: generates `src/recursion.md` and `src/events.md` at server startup. These pages contain:
  - SQL strings used by DuckDB WASM
  - JS transforms (e.g. unit scaling)
  - Plot configuration (axes, marks, tooltips)

The comparison pages include:

- Library comparison (avg)
- Percentile comparison (avg/p50/p95/p99)
- Performance over releases
- Runtime comparison

Recursion charts display in microseconds (us); events charts display in milliseconds (ms).

## Caching

### Parquet Response Cache

`/api/benchmarks.parquet` is cached using the Web Cache API via `plugins/cache.ts`.

The cache key includes a hash of the `data/json/` directory contents. When any JSON file changes, the directory hash changes, producing a new cache key. That means:

- cache hits are fast (no regeneration)
- new benchmark data automatically invalidates the previous cache

### Clearing Cache

- Observable build cache (local dev):

```bash
deno task clean
```

- Deno module cache (local dev, only if you need it):

```bash
deno cache --reload main.tsx
```

Server-side Parquet caching is automatically invalidated when `data/json/*.json` changes.

## Semver Sorting

Release ordering is semantic (not lexical). For example, `4.10.0` must sort after `4.2.0`, and prereleases must sort before their final release.

DuckDB queries use a `semver()` macro (defined in both `routes/benchmarks-parquet.ts` and `routes/comparison-pages.ts`) to convert a version string into a sortable integer array.

This is used in:

- Parquet generation ordering (pre-sorted for better defaults)
- Dashboard queries that need releases in correct order

## Quick Start

Prereqs:

- Deno 2.x
- npm (used by the benchmark workspace install)
- Node.js (if you run with `--runtime node`)
- Bun (if you run with `--runtime bun`)

Run the server locally:

```bash
deno task dev
```

Run benchmarks:

```bash
deno run -A cli/main.ts list-releases --filter "4.*"
deno run -A cli/main.ts run --release 4.0.1 --runtime deno --runtime node --cache-workspace
deno run -A cli/main.ts status
```

## Project Structure

```
.
├── cli/                       # Benchmark CLI + harness + scenarios
├── data/json/                 # Benchmark result files (JSON)
├── routes/                    # Server routes (Parquet API + page generation)
├── src/                       # Observable Framework source (includes generated pages)
├── plugins/                   # Server middleware (cache, etag, sitemap)
├── context/                   # Effection contexts
├── main.tsx                   # Server entry point
├── deno.json                  # Tasks + import map
└── AGENTS.md                  # Agent-oriented reference
```

## License

MIT
