# Memory Footprint

How memory-efficient are these libraries at runtime? Three things to know before reading the charts.

## What we measure

For each iteration of every scenario, the harness:

1. Snapshots heap and RSS via `Deno.memoryUsage()` / `process.memoryUsage()` **before** the scoped scenario run.
2. Runs the scenario, then snapshots again — that gives `heapUsedDelta` and `rssDelta`.
3. **Forces a major GC** (`globalThis.gc()` via `--expose-gc` on Node/Deno; `Bun.gc(true)` on Bun) and snapshots heap a third time as `heapUsedAfterGc`.

The forced-GC snapshot is taken outside the timed window, so it doesn't contaminate latency. Each iteration produces six numeric fields plus the post-GC reading.

## The metric that matters: post-GC retained heap

The `heapUsedAfter - heapUsedBefore` delta is contaminated by whether a natural major GC happened to fire mid-iteration, which makes the median oscillate between large positive and large negative values for no library reason — we've seen `+22 MB` p50 next to `-28 MB` p50 on otherwise comparable scenarios.

`heapUsedAfterGc` is taken right after a forced major collection, so it represents what the library actually couldn't reclaim. **That's the steady-state memory cost of running the scenario** and the cleanest comparison we have.

## RSS varies wildly across runtimes

The Median RSS Δ chart looks completely different depending on the runtime, and **most of the difference is allocator behavior, not library behavior**:

- **Node / Deno (V8)**: mostly `0`. V8 hoards memory and grows arenas in 128 KB chunks, so per-iteration RSS deltas are quantized noise.
- **Bun (mimalloc)**: often *negative*. Bun's allocator decommits pages back to the OS via `madvise(MADV_FREE)` after `scoped()` teardown, so RSS literally drops between iterations.
- **Bun heap accounting is sparse**: `process.memoryUsage().heapUsed` doesn't track the JSC heap meaningfully, so on Bun **read RSS instead of heap**; on Node/Deno **read heap instead of RSS**.

The RSS chart is included for completeness; the post-GC heap chart is the one you actually want for cross-library comparison.

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

const parquetResponse = await fetch("/api/benchmarks.parquet");
if (!parquetResponse.ok) {
  throw new Error(`Failed to load benchmarks parquet: ${parquetResponse.status} ${parquetResponse.statusText}`);
}
const parquetBuffer = await parquetResponse.arrayBuffer();
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

// Register percentile macro for computing percentiles from sample arrays
// Uses 1-based ceiling index (same logic as cli/lib/stats.ts)
await conn.query(`
  CREATE OR REPLACE MACRO pctl(arr, p) AS (
    list_sort(arr)[GREATEST(1, CAST(CEIL(len(arr) * p / 100.0) AS INTEGER))]
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
const allRuntimes = await query(`
  SELECT DISTINCT runtime FROM benchmarks
  WHERE memorySamples IS NOT NULL
  ORDER BY runtime
`);
const runtimeOptions = allRuntimes.map(r => r.runtime);
const runtimeInput = Inputs.select(runtimeOptions, {label: "Runtime", value: runtimeOptions[0] || "deno"});
const runtime = Generators.input(runtimeInput);

const allReleases = await query(`
  SELECT DISTINCT releaseTag FROM benchmarks
  WHERE memorySamples IS NOT NULL
  ORDER BY semver(releaseTag) DESC
`);
const releaseOptions = allReleases.map(r => r.releaseTag);
const releaseInput = Inputs.select(releaseOptions, {label: "Effection Release", value: releaseOptions[0]});
const releaseTag = Generators.input(releaseInput);
```

<div class="grid grid-cols-2">
  <div class="card">${runtimeInput}</div>
  <div class="card">${releaseInput}</div>
</div>

## Median Post-GC Retained Heap

Per-library, faceted by scenario type. This is the steady-state heap floor when running each scenario.

```js
const retainedData = (await query(`
  SELECT
    benchmarkName,
    CASE
      WHEN scenario LIKE '%.recursion' THEN 'recursion'
      WHEN scenario LIKE '%.events' THEN 'events'
    END AS scenarioType,
    pctl(list_transform(memorySamples, s -> s.heapUsedAfterGc), 50) AS heapAfterGcP50
  FROM benchmarks
  WHERE runtime = '${runtime}'
    AND releaseTag = '${releaseTag}'
    AND memorySamples IS NOT NULL
    AND len(list_filter(memorySamples, s -> s.heapUsedAfterGc IS NOT NULL)) > 0
  ORDER BY scenarioType, heapAfterGcP50 ASC
`)).map(d => ({
  ...d,
  heapAfterGcMB: d.heapAfterGcP50 / 1024 / 1024,
}));
```

```js
display(retainedData.length === 0
  ? html`<div class="warning">No post-GC heap data for release <strong>${releaseTag}</strong> on <strong>${runtime}</strong>. The forced-GC measurement was added in schema v4 — pick a release that's been benchmarked since then.</div>`
  : Plot.plot({
      title: `Median Post-GC Retained Heap — ${runtime} / ${releaseTag}`,
      width,
      height: 420,
      x: {label: "Library"},
      y: {label: "Heap (MB)", grid: true},
      fx: {label: "Scenario type"},
      color: {legend: true, scheme: "tableau10"},
      marks: [
        Plot.barY(retainedData, {
          x: "benchmarkName",
          y: "heapAfterGcMB",
          fx: "scenarioType",
          fill: "benchmarkName",
          sort: {x: "y"},
          tip: true,
        }),
        Plot.ruleY([0]),
      ],
    }))
```

## Median RSS Δ per Iteration

Process-wide RSS change from start to end of each iteration. **This chart is mostly meaningful on Bun**; on Node/Deno bars will sit near 0 because V8 doesn't return pages between iterations.

```js
const rssData = (await query(`
  SELECT
    benchmarkName,
    CASE
      WHEN scenario LIKE '%.recursion' THEN 'recursion'
      WHEN scenario LIKE '%.events' THEN 'events'
    END AS scenarioType,
    pctl(list_transform(memorySamples, s -> s.rssDelta), 50) AS rssDeltaP50
  FROM benchmarks
  WHERE runtime = '${runtime}'
    AND releaseTag = '${releaseTag}'
    AND memorySamples IS NOT NULL
  ORDER BY scenarioType, rssDeltaP50 ASC
`)).map(d => ({
  ...d,
  rssDeltaKB: d.rssDeltaP50 / 1024,
}));
```

```js
display(rssData.length === 0
  ? html`<div class="warning">No memory data for release <strong>${releaseTag}</strong> on <strong>${runtime}</strong>.</div>`
  : Plot.plot({
      title: `Median RSS Δ per Iteration — ${runtime} / ${releaseTag}`,
      width,
      height: 420,
      x: {label: "Library"},
      y: {label: "RSS delta (KB)", grid: true},
      fx: {label: "Scenario type"},
      color: {legend: true, scheme: "tableau10"},
      marks: [
        Plot.barY(rssData, {
          x: "benchmarkName",
          y: "rssDeltaKB",
          fx: "scenarioType",
          fill: "benchmarkName",
          sort: {x: "y"},
          tip: true,
        }),
        Plot.ruleY([0]),
      ],
    }))
```

---

## Caveats

- **Retained, not peak.** We don't sample heap during the scenario, only at the boundaries. Peak working-set during execution can be substantially higher than what shows here.
- **Median across 10 iterations** is robust to single-iteration GC events but can hide slow growth across a run. `heapUsedAfter - heapUsedBefore` (the un-GC'd delta) is available in the underlying data if you want to dig in.
- **`effect-v4` is beta** (`4.0.0-beta.64`); these numbers will move as the beta evolves.
- **`effection-inline.recursion` doesn't run on Effection 3.6.0 / 3.6.1** because the inline plugin requires v4. Bars for that combination are absent by design.

[&larr; Back to Overview](/)
