# Recursion Benchmarks

Compare structured concurrency overhead for deeply nested async operations across libraries.

**Libraries compared:** `effection`, `rxjs`, `effect`, `co`, `async-await`

## Source Code

View the benchmark implementations on GitHub:

- [effection](https://github.com/taras/Effection-performance-dashboard-poc/blob/main/cli/scenarios/effection.recursion.ts)
- [rxjs](https://github.com/taras/Effection-performance-dashboard-poc/blob/main/cli/scenarios/rxjs.recursion.ts)
- [effect](https://github.com/taras/Effection-performance-dashboard-poc/blob/main/cli/scenarios/effect.recursion.ts)
- [co](https://github.com/taras/Effection-performance-dashboard-poc/blob/main/cli/scenarios/co.recursion.ts)
- [async-await](https://github.com/taras/Effection-performance-dashboard-poc/blob/main/cli/scenarios/async-await.recursion.ts)

---


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

const parquetBuffer = await fetch("/api/benchmarks.parquet").then(r => r.arrayBuffer());
await db.registerFileBuffer("benchmarks.parquet", new Uint8Array(parquetBuffer));
const conn = await db.connect();
await conn.query("CREATE TABLE benchmarks AS SELECT * FROM parquet_scan('benchmarks.parquet')");

// Register semver sorting macro
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
const runtimes = await query(`
  SELECT DISTINCT runtime FROM benchmarks 
  WHERE scenario IN ('effection.recursion', 'rxjs.recursion', 'effect.recursion', 'co.recursion', 'async-await.recursion')
  ORDER BY runtime
`);
const runtimeOptions = runtimes.map(r => r.runtime);
const runtimeInput = Inputs.select(runtimeOptions, {label: "Runtime", value: runtimeOptions[0] || "deno"});
const runtime = Generators.input(runtimeInput);

// Get available Effection releases from the data
const releases = await query(`
  SELECT DISTINCT releaseTag FROM benchmarks 
  WHERE scenario IN ('effection.recursion', 'rxjs.recursion', 'effect.recursion', 'co.recursion', 'async-await.recursion')
  ORDER BY semver(releaseTag) DESC
`);
const releaseOptions = releases.map(r => r.releaseTag);
const releaseInput = Inputs.select(releaseOptions, {label: "Effection Release", value: releaseOptions[0]});
const releaseTag = Generators.input(releaseInput);
```

<div class="grid grid-cols-2">
  <div class="card">${runtimeInput}</div>
  <div class="card">${releaseInput}</div>
</div>

## Library Comparison

Average latency comparison across all libraries for the selected Effection release.

```js
const comparisonData = await query(`
  SELECT benchmarkName, avgTime, p50, p95, p99, stdDev
  FROM benchmarks
  WHERE scenario IN ('effection.recursion', 'rxjs.recursion', 'effect.recursion', 'co.recursion', 'async-await.recursion')
    AND runtime = '${runtime}'
    AND releaseTag = '${releaseTag}'
  ORDER BY avgTime ASC
`);
```

<div class="note">Showing data for release <strong>${releaseTag}</strong> on <strong>${runtime}</strong></div>

```js
display(Plot.plot({
  title: `Average Latency by Library (${runtime})`,
  width,
  height: 400,
  x: {label: "Library"},
  y: {label: "Time (ms)", grid: true},
  color: {legend: true, scheme: "tableau10"},
  marks: [
    Plot.barY(comparisonData, {
      x: "benchmarkName",
      y: "avgTime",
      fill: "benchmarkName",
      sort: {x: "y"},
      tip: true
    }),
    Plot.ruleY([0]),
  ]
}))
```

### Percentile Comparison

```js
// Reshape data for grouped bar chart
const percentileData = comparisonData.flatMap(d => [
  {library: d.benchmarkName, metric: "avg", value: d.avgTime},
  {library: d.benchmarkName, metric: "p50", value: d.p50},
  {library: d.benchmarkName, metric: "p95", value: d.p95},
  {library: d.benchmarkName, metric: "p99", value: d.p99},
]);
```

```js
display(Plot.plot({
  title: `Percentile Comparison (${runtime})`,
  width,
  height: 400,
  x: {label: "Library"},
  y: {label: "Time (ms)", grid: true},
  fx: {label: "Metric"},
  color: {legend: true, scheme: "tableau10"},
  marks: [
    Plot.barY(percentileData, {
      x: "library",
      y: "value",
      fx: "metric",
      fill: "library",
      tip: true
    }),
    Plot.ruleY([0]),
  ]
}))
```

---

## Performance Over Releases

How each library's performance has changed across Effection releases.

```js
const releaseData = await query(`
  SELECT releaseTag, benchmarkName, avgTime, p50, p95, p99
  FROM benchmarks
  WHERE scenario IN ('effection.recursion', 'rxjs.recursion', 'effect.recursion', 'co.recursion', 'async-await.recursion')
    AND runtime = '${runtime}'
  ORDER BY semver(releaseTag), benchmarkName
`);
```

```js
display(Plot.plot({
  title: `Latency Over Releases (${runtime})`,
  width,
  height: 450,
  x: {label: "Release", type: "point"},
  y: {label: "Avg Time (ms)", grid: true},
  color: {legend: true, scheme: "tableau10"},
  marks: [
    Plot.line(releaseData, {
      x: "releaseTag",
      y: "avgTime",
      stroke: "benchmarkName",
      strokeWidth: 2
    }),
    Plot.dot(releaseData, {
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

Compare performance across runtimes for each library.

```js
const runtimeCompData = await query(`
  SELECT benchmarkName, runtime, avgTime, p50, p95, p99
  FROM benchmarks
  WHERE scenario IN ('effection.recursion', 'rxjs.recursion', 'effect.recursion', 'co.recursion', 'async-await.recursion')
    AND releaseTag = '${releaseTag}'
  ORDER BY benchmarkName, runtime
`);
```

```js
display(Plot.plot({
  title: `Runtime Comparison (release ${releaseTag})`,
  width,
  height: 400,
  x: {label: "Library"},
  y: {label: "Avg Time (ms)", grid: true},
  fx: {label: "Runtime"},
  color: {legend: true, scheme: "tableau10"},
  marks: [
    Plot.barY(runtimeCompData, {
      x: "benchmarkName",
      y: "avgTime",
      fx: "runtime",
      fill: "benchmarkName",
      tip: true
    }),
    Plot.ruleY([0]),
  ]
}))
```

---

## Detailed Data

```js
const allData = await query(`
  SELECT releaseTag, runtime, benchmarkName, scenario, avgTime, minTime, maxTime, stdDev, p50, p95, p99
  FROM benchmarks
  WHERE scenario IN ('effection.recursion', 'rxjs.recursion', 'effect.recursion', 'co.recursion', 'async-await.recursion')
  ORDER BY semver(releaseTag), runtime, benchmarkName
`);
```

<div style="max-height: 500px; overflow-y: auto; margin-bottom: 1rem;">

```js
display(Inputs.table(allData, { layout: "auto" }))
```

</div>

---

[&larr; Back to Overview](/)
