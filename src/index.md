# Effection Performance Dashboard

This dashboard tracks benchmark performance across releases, runtimes, and scenarios for the [Effection](https://frontside.com/effection) structured concurrency library. All data is queried client-side using DuckDB WASM from a static Parquet file.

```js
import * as Plot from "@observablehq/plot";
import * as Inputs from "@observablehq/inputs";
import * as duckdb from "@duckdb/duckdb-wasm";
import * as arrow from "apache-arrow";
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
const scenarioInput = Inputs.select(["recursion", "events"], {label: "Scenario", value: "recursion"});
const scenario = Generators.input(scenarioInput);
```

```js
const runtimeInput = Inputs.select(["node", "deno", "playwright-chromium"], {label: "Runtime", value: "node"});
const runtime = Generators.input(runtimeInput);
```

<div class="grid grid-cols-2">
  <div class="card">${scenarioInput}</div>
  <div class="card">${runtimeInput}</div>
</div>

## Performance Over Releases

Average, p50, p95, and p99 latency for **${scenario}** on **${runtime}** across all releases.

```js
const perfOverReleases = await query(`
  SELECT releaseTag, avgTime, p50, p95, p99
  FROM benchmarks
  WHERE scenario = '${scenario}' AND runtime = '${runtime}'
  ORDER BY semver(releaseTag)
`);
```

```js
display(Plot.plot({
  title: `Latency by Release (${scenario}, ${runtime})`,
  width,
  height: 400,
  x: {label: "Release", type: "point"},
  y: {label: "Time (ms)", grid: true},
  marks: [
    Plot.line(perfOverReleases, {x: "releaseTag", y: "avgTime", stroke: "steelblue", strokeWidth: 2, tip: true}),
    Plot.dot(perfOverReleases, {x: "releaseTag", y: "avgTime", fill: "steelblue"}),
    Plot.line(perfOverReleases, {x: "releaseTag", y: "p50", stroke: "green", strokeWidth: 2, tip: true}),
    Plot.dot(perfOverReleases, {x: "releaseTag", y: "p50", fill: "green"}),
    Plot.line(perfOverReleases, {x: "releaseTag", y: "p95", stroke: "orange", strokeWidth: 2, tip: true}),
    Plot.dot(perfOverReleases, {x: "releaseTag", y: "p95", fill: "orange"}),
    Plot.line(perfOverReleases, {x: "releaseTag", y: "p99", stroke: "red", strokeWidth: 2, tip: true}),
    Plot.dot(perfOverReleases, {x: "releaseTag", y: "p99", fill: "red"}),
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

## Runtime Comparison (Latest Release)

Comparing average latency across runtimes for **${scenario}** on the latest release.

```js
const runtimeComparison = await query(`
  SELECT runtime, avgTime, minTime, maxTime, p50, p95, p99
  FROM benchmarks
  WHERE scenario = '${scenario}'
    AND releaseTag = (SELECT releaseTag FROM benchmarks ORDER BY semver(releaseTag) DESC LIMIT 1)
  ORDER BY runtime
`);
```

```js
display(Plot.plot({
  title: `Runtime Comparison — ${scenario} (latest release)`,
  width,
  height: 400,
  x: {label: "Runtime"},
  y: {label: "Time (ms)", grid: true},
  marks: [
    Plot.barY(runtimeComparison, {x: "runtime", y: "avgTime", fill: "steelblue", tip: true}),
    Plot.barY(runtimeComparison, {x: "runtime", y: "p95", fill: "orange", fillOpacity: 0.5, tip: true}),
    Plot.barY(runtimeComparison, {x: "runtime", y: "p99", fill: "red", fillOpacity: 0.3, tip: true}),
    Plot.ruleY([0]),
  ]
}))
```

## Detailed Data

```js
const allData = await query(`
  SELECT releaseTag, runtime, scenario, avgTime, minTime, maxTime, stdDev, p50, p95, p99
  FROM benchmarks
  WHERE scenario = '${scenario}'
  ORDER BY semver(releaseTag), runtime
`);
```

```js
display(Inputs.table(allData))
```

## All Runtimes Over Releases

Average latency for **${scenario}** across all runtimes and releases.

```js
const allRuntimes = await query(`
  SELECT releaseTag, runtime, avgTime
  FROM benchmarks
  WHERE scenario = '${scenario}'
  ORDER BY semver(releaseTag), runtime
`);
```

```js
display(Plot.plot({
  title: `All Runtimes — ${scenario}`,
  width,
  height: 400,
  x: {label: "Release", type: "point"},
  y: {label: "Avg Time (ms)", grid: true},
  color: {legend: true},
  marks: [
    Plot.line(allRuntimes, {x: "releaseTag", y: "avgTime", stroke: "runtime", strokeWidth: 2, tip: true}),
    Plot.dot(allRuntimes, {x: "releaseTag", y: "avgTime", fill: "runtime"}),
  ]
}))
```
