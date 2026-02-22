# Effection Performance Dashboard

This dashboard tracks benchmark performance across releases, runtimes, and scenarios for the [Effection](https://frontside.com/effection) structured concurrency library compared to other async patterns.

**Benchmarks:**
- [Recursion](/recursion) - Nested async operations overhead
- [Events](/events) - Event handling performance

```js
import * as Plot from "@observablehq/plot";
import * as Inputs from "@observablehq/inputs";
import * as duckdb from "@duckdb/duckdb-wasm";
```

```js
// Initialize DuckDB WASM
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
const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
const worker = new Worker(bundle.mainWorker, { type: "module" });
const db = new duckdb.AsyncDuckDB(logger, worker);
await db.instantiate(bundle.mainModule);
await db.open({});

// Load the parquet file from the API (dynamically generated server-side)
const parquetBuffer = await fetch("/api/benchmarks.parquet").then(r => r.arrayBuffer());
await db.registerFileBuffer("benchmarks.parquet", new Uint8Array(parquetBuffer));
const conn = await db.connect();
await conn.query("CREATE TABLE benchmarks AS SELECT * FROM parquet_scan('benchmarks.parquet')");

// Register semver sorting macro - converts version strings to sortable 6-element integer lists
await conn.query(`
  CREATE OR REPLACE MACRO semver(v) AS (
    WITH parts AS (
      SELECT string_split(ltrim(v, 'v'), '-') AS segments
    ),
    parsed AS (
      SELECT
        string_split(segments[1], '.') AS core,
        CASE 
          WHEN len(segments) > 1 
          THEN list_reduce(segments[2:], (a, b) -> a || '-' || b)
          ELSE NULL 
        END AS prerelease
      FROM parts
    )
    SELECT [
      COALESCE(TRY_CAST(core[1] AS INTEGER), 0),
      COALESCE(TRY_CAST(core[2] AS INTEGER), 0),
      COALESCE(TRY_CAST(core[3] AS INTEGER), 0),
      CASE WHEN prerelease IS NULL THEN 1 ELSE 0 END,
      CASE 
        WHEN prerelease IS NULL THEN 999
        WHEN prerelease LIKE 'alpha%' OR prerelease LIKE 'a.%' THEN 100
        WHEN prerelease LIKE 'beta%' OR prerelease LIKE 'b.%' THEN 200
        WHEN prerelease LIKE 'rc%' THEN 300
        ELSE 250
      END,
      COALESCE(TRY_CAST(regexp_extract(prerelease, '(\\d+)$', 1) AS INTEGER), 0)
    ]
    FROM parsed
  )
`);
```

```js
// Helper to run SQL and get array of objects
async function query(sql) {
  const c = await db.connect();
  try {
    const result = await c.query(sql);
    return result.toArray().map((row) => Object.fromEntries(Object.entries(row.toJSON()).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
  } finally {
    await c.close();
  }
}
```

```js
// Get available runtimes from the data
const runtimes = await query(`SELECT DISTINCT runtime FROM benchmarks ORDER BY runtime`);
const runtimeOptions = runtimes.map(r => r.runtime);
const runtimeInput = Inputs.select(runtimeOptions, {label: "Runtime", value: runtimeOptions[0] || "deno"});
const runtime = Generators.input(runtimeInput);

// Get available Effection releases from the data
const releases = await query(`SELECT DISTINCT releaseTag FROM benchmarks ORDER BY semver(releaseTag) DESC`);
const releaseOptions = releases.map(r => r.releaseTag);
const releaseInput = Inputs.select(releaseOptions, {label: "Effection Release", value: releaseOptions[0]});
const releaseTag = Generators.input(releaseInput);
```

<div class="grid grid-cols-2">
  <div class="card">${runtimeInput}</div>
  <div class="card">${releaseInput}</div>
</div>

## Summary: All Libraries Compared

Average latency for each library across all benchmark scenarios.

```js
const summaryData = await query(`
  SELECT 
    benchmarkName,
    scenario,
    CASE 
      WHEN scenario LIKE '%.recursion' THEN 'recursion'
      WHEN scenario LIKE '%.events' THEN 'events'
      ELSE 'other'
    END AS scenarioType,
    avgTime,
    p50,
    p95,
    p99
  FROM benchmarks
  WHERE runtime = '${runtime}'
    AND releaseTag = '${releaseTag}'
  ORDER BY scenarioType, avgTime ASC
`);
```

<div class="note">Showing data for release <strong>${releaseTag}</strong> on <strong>${runtime}</strong></div>

```js
display(Plot.plot({
  title: `Library Comparison (${runtime})`,
  width,
  height: 400,
  x: {label: "Library"},
  y: {label: "Avg Time (ms)", grid: true},
  fx: {label: "Scenario Type"},
  color: {legend: true, scheme: "tableau10"},
  marks: [
    Plot.barY(summaryData, {
      x: "benchmarkName",
      y: "avgTime",
      fx: "scenarioType",
      fill: "benchmarkName",
      sort: {x: "y"},
      tip: true
    }),
    Plot.ruleY([0]),
  ]
}))
```

---

## Effection Performance Over Releases

Track how Effection's performance has evolved across releases.

```js
const scenarioInput = Inputs.select(["recursion", "events"], {label: "Scenario", value: "recursion"});
const scenario = Generators.input(scenarioInput);
```

<div class="card">${scenarioInput}</div>

```js
const effectionData = await query(`
  SELECT releaseTag, avgTime, p50, p95, p99
  FROM benchmarks
  WHERE benchmarkName = 'effection'
    AND scenario = 'effection.${scenario}'
    AND runtime = '${runtime}'
  ORDER BY semver(releaseTag)
`);
```

```js
display(Plot.plot({
  title: `Effection ${scenario} Latency Over Releases (${runtime})`,
  width,
  height: 400,
  x: {label: "Release", type: "point"},
  y: {label: "Time (ms)", grid: true},
  marks: [
    Plot.line(effectionData, {x: "releaseTag", y: "avgTime", stroke: "steelblue", strokeWidth: 2, tip: true}),
    Plot.dot(effectionData, {x: "releaseTag", y: "avgTime", fill: "steelblue"}),
    Plot.line(effectionData, {x: "releaseTag", y: "p50", stroke: "green", strokeWidth: 2}),
    Plot.line(effectionData, {x: "releaseTag", y: "p95", stroke: "orange", strokeWidth: 2}),
    Plot.line(effectionData, {x: "releaseTag", y: "p99", stroke: "red", strokeWidth: 2}),
  ]
}))
```

<div class="note">
  <strong>Legend:</strong>
  <span style="color: steelblue;">&#9679; avg</span> &middot;
  <span style="color: green;">&#9679; p50</span> &middot;
  <span style="color: orange;">&#9679; p95</span> &middot;
  <span style="color: red;">&#9679; p99</span>
</div>

---

## All Libraries Over Releases

Compare how all libraries perform across Effection releases for the selected scenario.

```js
// Map scenario type to all relevant scenario names
const scenarioNames = scenario === "recursion" 
  ? "'effection.recursion', 'rxjs.recursion', 'effect.recursion', 'co.recursion', 'async-await.recursion'"
  : "'effection.events', 'rxjs.events', 'effect.events', 'add-event-listener.events'";

const allLibrariesData = await query(`
  SELECT releaseTag, benchmarkName, avgTime
  FROM benchmarks
  WHERE scenario IN (${scenarioNames})
    AND runtime = '${runtime}'
  ORDER BY semver(releaseTag), benchmarkName
`);
```

```js
display(Plot.plot({
  title: `All Libraries — ${scenario} (${runtime})`,
  width,
  height: 450,
  x: {label: "Release", type: "point"},
  y: {label: "Avg Time (ms)", grid: true},
  color: {legend: true, scheme: "tableau10"},
  marks: [
    Plot.line(allLibrariesData, {
      x: "releaseTag",
      y: "avgTime",
      stroke: "benchmarkName",
      strokeWidth: 2
    }),
    Plot.dot(allLibrariesData, {
      x: "releaseTag",
      y: "avgTime",
      fill: "benchmarkName",
      tip: true
    }),
  ]
}))
```

---

## Runtime Comparison

Compare performance across runtimes for Effection.

```js
const runtimeComparisonData = await query(`
  SELECT runtime, scenario, avgTime, p50, p95, p99
  FROM benchmarks
  WHERE benchmarkName = 'effection'
    AND releaseTag = '${releaseTag}'
  ORDER BY scenario, runtime
`);
```

```js
display(Plot.plot({
  title: `Effection Runtime Comparison (release ${releaseTag})`,
  width,
  height: 400,
  x: {label: "Runtime"},
  y: {label: "Avg Time (ms)", grid: true},
  fx: {label: "Scenario"},
  color: {legend: true},
  marks: [
    Plot.barY(runtimeComparisonData, {
      x: "runtime",
      y: "avgTime",
      fx: "scenario",
      fill: "runtime",
      tip: true
    }),
    Plot.ruleY([0]),
  ]
}))
```

---

## Explore More

- [Recursion Benchmarks](/recursion) - Deep dive into nested async operations
- [Events Benchmarks](/events) - Deep dive into event handling performance
- [Effection Examples](/examples) - Learn Effection patterns
