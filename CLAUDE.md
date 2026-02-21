# Effection Performance Dashboard

## Project Overview

Static performance dashboard for the Effection structured concurrency library. Benchmark JSON files are converted to Parquet, and an Observable Framework site queries them client-side with DuckDB WASM and renders charts with Observable Plot. No backend — everything is static files deployable to GitHub Pages.

## Architecture

```
scripts/generate-fixtures.js     →  data/json/*.json (30 benchmark files)
scripts/json-to-parquet.sql      →  data/benchmarks.parquet (flattened)
cp to src/data/                  →  src/data/benchmarks.parquet
npm run build                    →  dist/ (static site)
```

All SQL queries run client-side in the browser via DuckDB WASM. The Parquet file is loaded into an in-memory DuckDB instance using `FileAttachment().arrayBuffer()`.

## Commands

```bash
npm run generate          # Create fake benchmark JSON fixtures
npm run parquet           # Convert JSON → Parquet (requires duckdb CLI)
npm run data              # Run generate + parquet + copy to src/data/
npm run build             # Build Observable Framework site (prebuild populates npm cache)
npm run dev               # Start Observable preview server
npm run clean             # Clear Observable cache
```

## Data Schema

### Input JSON structure
```json
{
  "metadata": {
    "releaseTag": "v4.1.0",
    "runtime": "node",
    "runtimeMajorVersion": 22,
    "timestamp": "2025-11-15T14:30:00Z",
    "runner": { "os": "ubuntu-22.04", "arch": "x86_64" },
    "scenario": "recursion",
    "benchmarkParams": { "repeat": 10, "warmup": 3, "depth": 100 }
  },
  "results": [{
    "name": "effection",
    "stats": { "avgTime": 12.45, "minTime": 11.20, "maxTime": 14.80, "stdDev": 1.05, "p50": 12.30, "p95": 14.10, "p99": 14.70 }
  }]
}
```

### Flattened Parquet columns
`releaseTag`, `runtime`, `runtimeMajorVersion`, `timestamp`, `runnerOs`, `runnerArch`, `scenario`, `paramRepeat`, `paramWarmup`, `benchmarkName`, `avgTime`, `minTime`, `maxTime`, `stdDev`, `p50`, `p95`, `p99`, `sourceFile`

### Data dimensions
- **Releases**: v4.0.0 through v4.4.0
- **Runtimes**: node, deno, playwright-chromium
- **Scenarios**: recursion, events

## Known Pitfalls

### Two copies of the parquet file
`data/benchmarks.parquet` is the source of truth (output of the DuckDB conversion). `src/data/benchmarks.parquet` is a copy required by Observable's `FileAttachment`. The `npm run data` script handles the copy, but if you regenerate the parquet manually you must also copy it. They can silently drift — always use `npm run data` to stay in sync.

### Semantic version sorting
The dashboard sorts releases by `releaseTag` string (`ORDER BY releaseTag`). This works for `v4.0.0` through `v4.4.0` because alphabetical order matches version order. **This breaks for `v4.9.0` vs `v4.10.0`** (lexicographic: `v4.1` < `v4.9` but `v4.10` < `v4.9`). For production, either:
- Add a numeric `releaseOrder` column in the Parquet conversion
- Use `timestamp` for ordering instead of `releaseTag`
- Parse versions in SQL: `string_split(releaseTag, '.')` and cast to integers

### Scenario-specific benchmarkParams are lost in flattening
The JSON schema has variable keys in `benchmarkParams` — `depth` for recursion, `listeners` for events. The Parquet conversion only preserves `repeat` and `warmup` (the common fields). If you need scenario-specific params in queries, add them as explicit columns in `json-to-parquet.sql` or store `benchmarkParams` as a JSON string column.

### The `results` array supports multiple entries
The JSON schema allows multiple entries in `results[]` (each with a `name` like `"effection"`). The `unnest(results)` in the SQL handles this correctly, but the dashboard doesn't filter by `benchmarkName`. If you add comparisons against other libraries, add a `benchmarkName` filter to queries and UI.

### `@duckdb/duckdb-wasm` is pinned to a dev release
`package.json` installs `@duckdb/duckdb-wasm@^1.33.1-dev18.0` — a prerelease version. For production, pin to the latest stable release. Check https://www.npmjs.com/package/@duckdb/duckdb-wasm for the current stable version.

### Two different DuckDB WASM versions in play
`populate-npm-cache.js` pins `@duckdb/duckdb-wasm@1.29.0` because that's what Observable Framework's internal stdlib expects (`DUCKDB_WASM_VERSION` in the framework source). The page itself uses whatever version is in `node_modules` (currently `1.33.1-dev18.0`). These serve different purposes and don't conflict, but it's confusing — the cache entry is only to satisfy the framework's bundler for code paths we don't use.

### Observable Framework version sensitivity
The `populate-npm-cache.js` workaround is tightly coupled to Observable Framework v1.13. If the framework is upgraded, the list of `npm:` packages in its client runtime may change, breaking the cache. After upgrading `@observablehq/framework`, run the build and add any new `package@version` entries that appear in `fetch failed` errors.

### `docs/` is a manual snapshot
The `docs/` directory is committed for GitHub Pages but is not automatically rebuilt. After changing source code, you must run `npm run build` and copy `dist/` to `docs/` again. In production, use GitHub Actions to automate this — don't commit `docs/` at all, deploy `dist/` directly.

### FileAttachment only accepts string literals
Observable's `FileAttachment("data/benchmarks.parquet")` is analyzed at compile time. You cannot dynamically construct paths like `` FileAttachment(`data/${name}.parquet`) ``. If you need multiple parquet files, each must be referenced with a literal string in the source.

## Key Technical Decisions & Gotchas

### Observable Framework offline builds

Observable Framework v1.13 fetches package metadata from `registry.npmjs.org` at build time — even for packages the page doesn't use. This is because the framework's own client runtime (`recommendedLibraries.js`, `sampleDatasets.js`, `fileAttachment.js`) contains dynamic `import("npm:...")` calls that the rollup bundler resolves during the build step.

**Workaround**: `scripts/populate-npm-cache.js` pre-creates empty directories in `src/.observablehq/cache/_npm/` matching the expected `package@version` format. The framework's version resolver (`resolveNpmVersion`) checks this cache first and skips the network call when it finds a match. This runs automatically via the `prebuild` npm hook.

**If you add new Observable Framework features that pull in additional `npm:` packages**, the build will fail with `fetch failed` errors. Add the missing `package@version` entries to `populate-npm-cache.js`.

### Avoiding `npm:` protocol imports

Observable Framework's built-in globals (`Plot`, `Inputs`, `DuckDBClient`, `sql`) are loaded via `npm:` protocol which requires network. To avoid this:

1. **Use explicit imports from node_modules** instead of implicit globals:
   ```js
   import * as Plot from "@observablehq/plot";       // resolves from node_modules
   import * as Inputs from "@observablehq/inputs";
   import * as duckdb from "@duckdb/duckdb-wasm";
   ```
2. **Do NOT use `sql` fenced code blocks** — they trigger `DuckDBClient` from the stdlib which imports `npm:@duckdb/duckdb-wasm` internally.
3. **Do NOT use the `sql:` YAML front matter** — same reason.
4. **Initialize DuckDB WASM manually** in a JavaScript code block instead.

The builtins map in the framework resolves some `npm:` specifiers locally (e.g., `npm:@observablehq/inputs` → `/_observablehq/stdlib/inputs.js`), but `npm:@observablehq/plot` and `npm:@duckdb/duckdb-wasm` are NOT builtins and always trigger network fetches.

### DuckDB WASM initialization pattern

```js
import * as duckdb from "@duckdb/duckdb-wasm";

const DUCKDB_BUNDLES = {
  mvp: {
    mainModule: import.meta.resolve("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm"),
    mainWorker: import.meta.resolve("@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js"),
  },
  eh: {
    mainModule: import.meta.resolve("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm"),
    mainWorker: import.meta.resolve("@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js"),
  },
};

const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
const worker = await duckdb.createWorker(bundle.mainWorker);
const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
await db.instantiate(bundle.mainModule);
await db.open({});

// Load parquet via FileAttachment
const buf = await FileAttachment("data/benchmarks.parquet").arrayBuffer();
await db.registerFileBuffer("benchmarks.parquet", new Uint8Array(buf));
const conn = await db.connect();
await conn.query("CREATE TABLE benchmarks AS SELECT * FROM parquet_scan('benchmarks.parquet')");
```

### BigInt conversion

DuckDB WASM may return `BigInt` values for integer columns. When converting query results to plain objects for Plot, convert them:
```js
row.toJSON() // may contain BigInts
// Fix: map values
Object.fromEntries(
  Object.entries(row.toJSON()).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])
);
```

### Observable reactivity model

Each ` ```js ``` ` code block in `.md` files is an independent reactive cell. Variables defined in one cell are available in other cells. When an input changes (via `Generators.input()`), all downstream cells re-execute automatically.

- `FileAttachment`, `Generators`, `width` are provided by Observable's stdlib (no import needed)
- `display()` must be called explicitly to render output when using explicit imports (the implicit global behavior only works with the `npm:` protocol globals)
- `Inputs.select(...)` creates a DOM element; wrap it with `Generators.input()` to get the reactive value

### JSON to Parquet conversion

DuckDB's `unnest()` with nested field access doesn't automatically alias column names. You must use explicit `AS` aliases:
```sql
-- BAD: column name becomes "((unnest(results)).stats).avgTime"
unnest(results).stats.avgTime

-- GOOD: explicit alias
unnest(results).stats.avgTime AS avgTime
```

### GitHub Pages deployment

- The `base` option in `observablehq.config.js` must match the deployment path (e.g., `/repo-name/` for project sites)
- A `.nojekyll` file is required in the deployed root — GitHub's Jekyll processor ignores directories starting with `_` (like `_node/`, `_observablehq/`)
- The built site lives in `docs/` for serving via GitHub Pages "Deploy from branch" with `/docs` folder
- Observable Framework uses relative paths (`./`) in the HTML output, so the `base` config mainly affects the framework's internal routing

### DuckDB CLI for Parquet conversion

The project uses DuckDB CLI (`duckdb`) for the JSON-to-Parquet conversion step, not the Node.js bindings. The Node.js `duckdb` / `duckdb-async` packages have native binding issues on some platforms. The CLI is more reliable:
```bash
duckdb < scripts/json-to-parquet.sql
```
Install: download from https://github.com/duckdb/duckdb/releases

## File Structure

```
├── data/
│   ├── json/                    # Generated benchmark JSON files
│   │   └── YYYY-MM-DD-vX.Y.Z-runtime-ver-scenario.json
│   └── benchmarks.parquet       # Flattened Parquet (all benchmarks)
├── docs/                        # Built site for GitHub Pages
├── scripts/
│   ├── generate-fixtures.js     # Fake data generator
│   ├── json-to-parquet.sql      # DuckDB conversion (used by npm run parquet)
│   ├── json-to-parquet.js       # Alternative Node.js conversion (requires duckdb-async)
│   └── populate-npm-cache.js    # Offline build workaround
├── src/
│   ├── data/
│   │   └── benchmarks.parquet   # Copy of parquet for Observable FileAttachment
│   └── index.md                 # Dashboard page (all charts and queries)
├── observablehq.config.js       # Observable Framework config
└── package.json
```

## Production Migration Notes

### Replace fixture data with real benchmarks
The `generate-fixtures.js` script produces synthetic data. In production, replace this with actual benchmark output from CI. The JSON schema should remain the same — the Parquet conversion and dashboard will work without changes as long as the JSON structure matches.

### Scaling considerations
- DuckDB WASM loads the entire Parquet file into browser memory. For <100MB this is fine. Beyond that, consider partitioned Parquet files or server-side query execution.
- The current single-page dashboard works for a few hundred benchmark runs. For thousands, add pagination or date-range filtering to limit query scope.

### GitHub Actions integration
When adding CI automation:
1. Run benchmarks and output JSON files
2. Run `duckdb < scripts/json-to-parquet.sql` to create the Parquet file
3. Copy to `src/data/benchmarks.parquet`
4. Run `npm run build`
5. Deploy `dist/` to GitHub Pages

### Multi-page dashboards
Observable Framework supports file-based routing. Add more `.md` files to `src/` for additional pages (e.g., `src/trends.md`, `src/compare.md`). Configure navigation in `observablehq.config.js`:
```js
export default {
  pages: [
    { name: "Overview", path: "/" },
    { name: "Trends", path: "/trends" },
  ],
};
```

### SQL parameterization
The POC interpolates JavaScript variables directly into SQL strings. This is safe because the inputs are controlled dropdowns, but for production with user-typed inputs, use DuckDB's prepared statement API:
```js
const stmt = await conn.prepare("SELECT * FROM benchmarks WHERE scenario = ?");
const result = await stmt.query(scenario);
```

### DuckDB connection management
The `query()` helper in `index.md` creates a new connection per query and closes it in a `finally` block. This is correct — DuckDB WASM connections are lightweight. Don't try to reuse a single connection across reactive cells because Observable may re-execute cells concurrently when inputs change.

### Error handling
The POC has no error handling for DuckDB WASM initialization failures or missing parquet files. In production, wrap the initialization in try/catch and show a user-friendly message. Common failure modes:
- Browser doesn't support WebAssembly (very old browsers)
- Parquet file fails to load (404, CORS issues on GitHub Pages)
- DuckDB WASM bundle fails to download (ad blockers sometimes block `.wasm` files)

### Incremental data updates
Currently the parquet file is rebuilt from scratch via `read_json_auto('data/json/*.json')`. This is fine for hundreds of files but scales poorly. For production with thousands of benchmark runs, consider:
- Partitioned parquet files by release or date range
- Appending new rows instead of full rebuild: `INSERT INTO ... SELECT FROM read_json_auto('new_file.json')`
- Using DuckDB's `UNION ALL` across multiple parquet files

### Observable cell execution order
Observable cells execute in dependency order, not document order. The DuckDB initialization cell defines `db`, and all `query()` calls reference `db`, so Observable ensures init completes first. This is automatic — you don't need explicit awaits between cells. However, if you split initialization across multiple cells, ensure each subsequent cell references a variable from the previous one to maintain the dependency chain.

### Adding new runtimes or scenarios
When real benchmarks add new runtimes or scenarios beyond the POC's fixtures:
1. The Parquet conversion (`json-to-parquet.sql`) needs no changes — it reads whatever JSON files exist
2. The `Inputs.select()` dropdown options in `index.md` are hardcoded — update them or query the parquet for distinct values:
   ```js
   const scenarios = (await query("SELECT DISTINCT scenario FROM benchmarks ORDER BY scenario")).map(r => r.scenario);
   const runtimes = (await query("SELECT DISTINCT runtime FROM benchmarks ORDER BY runtime")).map(r => r.runtime);
   ```
