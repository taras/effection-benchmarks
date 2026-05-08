# Memory Footprint

How memory-efficient are these libraries at runtime? Three things to know before reading the charts.

## What we measure

For each iteration of every scenario, the harness:

1. Snapshots heap and RSS via `Deno.memoryUsage()` / `process.memoryUsage()` **before** the scoped scenario run.
2. Runs the scenario, then snapshots again — that gives `heapUsedDelta` and `rssDelta`.
3. **Forces a major GC** (`globalThis.gc()` via `--expose-gc` on Node/Deno; `Bun.gc(true)` on Bun) and snapshots heap a third time as `heapUsedAfterGc`.
4. **Peak memory** during the iteration is collected by the scenario itself: each scenario calls `ctx.markPeak()` at its structural high-water moment (the leaf of recursion, the moment after all events have been dispatched but before teardown). The harness combines those marks with the before/after snapshots and stores the max as `heapUsedPeak` / `rssPeak`. Because the marks are placed deterministically, peak capture works equally well for sub-millisecond recursion and longer-running events scenarios — no sampling timer to fight the event loop.

The forced-GC snapshot and peak snapshots are taken outside the timed window, so they don't contaminate latency.

## Two heap metrics, two questions

- **Post-GC retained heap (`heapUsedAfterGc`)** answers "what does the library hold onto when idle?" The forced-GC snapshot strips out unreachable garbage so it only counts live state. `heapUsedAfter - heapUsedBefore` (without forced GC) was contaminated by whether a natural major GC happened to fire mid-iteration — we've seen `+22 MB` p50 next to `-28 MB` p50 on otherwise comparable scenarios — so we don't use the un-GC'd delta for comparison.
- **Peak heap during iteration (`heapUsedPeak`)** answers "what's the working-set high-water mark while the scenario is running?" Since scenarios mark their own peak via `ctx.markPeak()`, this captures the moment when listeners + in-flight events + temporary allocations are all alive — *before* teardown frees most of them. The gap between peak and post-GC retained tells you how much of a library's footprint is transient vs. durable.

## RSS varies wildly across runtimes

The Trimmed-mean RSS Δ chart looks completely different depending on the runtime, and **most of the difference is allocator behavior, not library behavior**:

- **Node / Deno (V8)**: V8 hoards memory and grows arenas in 128 KB chunks, so per-iteration RSS deltas are quantized — any single iteration is either 0 or a 128 KB jump. We use a trimmed mean across iterations because the median is always 0 and the plain average is dominated by cold-start arena commits on the first measured iteration.
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

// cache: 'no-cache' forces the browser to revalidate with the origin on every
// page load (sends If-None-Match with the cached ETag; origin returns 304 if
// unchanged, 200 with new content if it is). Without this, browsers honor the
// max-age=3600 from the parquet response and serve stale parquet data from
// disk cache for up to an hour after a regenerate — including across schema
// upgrades, where the dashboard's chart code references fields the cached
// parquet doesn't have.
const parquetResponse = await fetch("/api/benchmarks.parquet", { cache: "no-cache" });
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

// Trimmed average — sort, drop floor(N/10) from each tail, average the rest.
// Robust to outliers (cold-start V8 arena commits, mid-iteration major GCs)
// without throwing away signal on small sample sets: degrades to plain
// list_avg when N < 10 (trim count is 0).
await conn.query(`
  CREATE OR REPLACE MACRO trimmedAvg(arr) AS (
    list_avg(
      list_slice(
        list_sort(arr),
        CAST(FLOOR(len(arr) / 10.0) AS INTEGER) + 1,
        len(arr) - CAST(FLOOR(len(arr) / 10.0) AS INTEGER)
      )
    )
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

## Median Post-GC Retained Heap (relative)

Per-library, faceted by scenario type. Bars show **how much more memory each library retains compared to the most efficient library in the same scenario type** — the lightest library sits at 0 and others show their cost above it. The absolute floor is around 37-41 MB across the board (V8 + module/runtime + JIT code + scenario state); the differences between libraries (0.1-3 MB) are the actual signal but get visually drowned out when plotted as absolute values.

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
`));

// Subtract the per-scenario-type minimum so each bar shows the library's
// "extra cost" above the lightest implementation in that scenario.
const minByScenario = {};
for (const d of retainedData) {
  const cur = minByScenario[d.scenarioType];
  if (cur === undefined || d.heapAfterGcP50 < cur) minByScenario[d.scenarioType] = d.heapAfterGcP50;
}
const retainedRelative = retainedData.map(d => ({
  ...d,
  heapAboveMinKB: (d.heapAfterGcP50 - minByScenario[d.scenarioType]) / 1024,
  heapAbsoluteMB: d.heapAfterGcP50 / 1024 / 1024,
}));

const retainedRecursion = retainedRelative.filter(d => d.scenarioType === "recursion");
const retainedEvents = retainedRelative.filter(d => d.scenarioType === "events");

// Render two independent plots so each scenario type gets its own y-scale.
// (Plot's fx faceting always shares the y axis, which crushes recursion bars
// when events bars are 50× taller.)
function retainedPlot(rows, label) {
  if (rows.length === 0) return null;
  return Plot.plot({
    title: `${label} — Post-GC Retained Heap above min (${runtime} / ${releaseTag})`,
    width,
    height: 320,
    marginTop: 30,
    x: {label: "Library"},
    y: {label: "Heap above scenario min (KB)", grid: true},
    color: {legend: true, scheme: "tableau10"},
    marks: [
      Plot.barY(rows, {
        x: "benchmarkName",
        y: "heapAboveMinKB",
        fill: "benchmarkName",
        sort: {x: "y"},
        tip: true,
        channels: {
          "absolute (MB)": d => d.heapAbsoluteMB.toFixed(2),
        },
      }),
      // Absolute-MB label above each bar so the baseline (0-height) bar
      // still tells you the library's actual heap floor.
      Plot.text(rows, {
        x: "benchmarkName",
        y: "heapAboveMinKB",
        text: d => `${d.heapAbsoluteMB.toFixed(2)} MB`,
        textAnchor: "middle",
        dy: -8,
        fontSize: 10,
      }),
      Plot.ruleY([0]),
    ],
  });
}
```

```js
display(retainedRelative.length === 0
  ? html`<div class="warning">No post-GC heap data for release <strong>${releaseTag}</strong> on <strong>${runtime}</strong>. The forced-GC measurement was added in schema v4 — pick a release that's been benchmarked since then.</div>`
  : html`<div>${retainedPlot(retainedRecursion, "Recursion")}${retainedPlot(retainedEvents, "Events")}</div>`)
```

> The bar height shows each library's heap above the most efficient one in the same scenario type — the lightest library sits at 0 by definition. The number above each bar is its absolute median post-GC heap in MB, so you can read the baseline value without hunting through the data.

## Median Peak Heap During Iteration (relative)

Median high-water-mark of heap usage **during** each iteration, again shown above the lightest library in the same scenario type. Schema v5 added a `ScenarioCtx.markPeak()` hook that scenarios call at their structural peak (the leaf of recursion, the moment after all events are dispatched but before teardown). Peaks are deterministic snapshots, not sampled — the harness combines explicit marks with the before/after snapshots and keeps the max.

This answers a different question than the post-GC chart above: **what's the working-set high-water mark while the scenario is running**, vs. what's left over after a major GC. Events scenarios should show much higher peaks than retained heap because their listener chain is alive during dispatch and freed at teardown; short recursion scenarios should look similar to their retained heap because there's barely any time between peak and end.

```js
const peakHeapData = (await query(`
  SELECT
    benchmarkName,
    CASE
      WHEN scenario LIKE '%.recursion' THEN 'recursion'
      WHEN scenario LIKE '%.events' THEN 'events'
    END AS scenarioType,
    pctl(list_transform(memorySamples, s -> s.heapUsedPeak), 50) AS heapPeakP50
  FROM benchmarks
  WHERE runtime = '${runtime}'
    AND releaseTag = '${releaseTag}'
    AND memorySamples IS NOT NULL
    AND len(list_filter(memorySamples, s -> s.heapUsedPeak IS NOT NULL)) > 0
  ORDER BY scenarioType, heapPeakP50 ASC
`));

const peakMinByScenario = {};
for (const d of peakHeapData) {
  const cur = peakMinByScenario[d.scenarioType];
  if (cur === undefined || d.heapPeakP50 < cur) peakMinByScenario[d.scenarioType] = d.heapPeakP50;
}
const peakHeapRelative = peakHeapData.map(d => ({
  ...d,
  heapPeakAboveMinKB: (d.heapPeakP50 - peakMinByScenario[d.scenarioType]) / 1024,
  heapPeakAbsoluteMB: d.heapPeakP50 / 1024 / 1024,
}));

const peakHeapRecursion = peakHeapRelative.filter(d => d.scenarioType === "recursion");
const peakHeapEvents = peakHeapRelative.filter(d => d.scenarioType === "events");

function peakHeapPlot(rows, label) {
  if (rows.length === 0) return null;
  return Plot.plot({
    title: `${label} — Peak Heap above min (${runtime} / ${releaseTag})`,
    width,
    height: 320,
    marginTop: 30,
    x: {label: "Library"},
    y: {label: "Peak heap above scenario min (KB)", grid: true},
    color: {legend: true, scheme: "tableau10"},
    marks: [
      Plot.barY(rows, {
        x: "benchmarkName",
        y: "heapPeakAboveMinKB",
        fill: "benchmarkName",
        sort: {x: "y"},
        tip: true,
        channels: {
          "absolute (MB)": d => d.heapPeakAbsoluteMB.toFixed(2),
        },
      }),
      Plot.text(rows, {
        x: "benchmarkName",
        y: "heapPeakAboveMinKB",
        text: d => `${d.heapPeakAbsoluteMB.toFixed(2)} MB`,
        textAnchor: "middle",
        dy: -8,
        fontSize: 10,
      }),
      Plot.ruleY([0]),
    ],
  });
}
```

```js
display(peakHeapRelative.length === 0
  ? html`<div class="warning">No peak-heap data for release <strong>${releaseTag}</strong> on <strong>${runtime}</strong>. <code>heapUsedPeak</code> was added in schema v5 — pick a release that's been benchmarked since then.</div>`
  : html`<div>${peakHeapPlot(peakHeapRecursion, "Recursion")}${peakHeapPlot(peakHeapEvents, "Events")}</div>`)
```

> Peak ≥ post-GC retained for any given scenario. The gap between them is the per-iteration "working" allocation — temporary objects allocated during the scenario and reclaimed by the time the forced GC runs.

## Trimmed-mean RSS Δ per Iteration

Process-wide RSS change from start to end of each iteration, with a **10% trimmed mean** across all measured iterations: sort, drop the highest and lowest, average the rest. We can't use the median because V8's allocator grows arenas in 128 KB chunks — per-iteration deltas are quantized to either 0 or +128 KB and the median collapses to 0. We can't use a plain average because cold-start arena commits on the first measured iteration can be tens of MB and dominate the result for the rest of the run. The trimmed mean is the middle ground: discards the cold-start outlier and any one-off GC reclaim, keeps the steady-state signal.

Note Bun runs negative on this chart for many scenarios because mimalloc decommits pages back to the OS after `scoped()` teardown.

```js
const rssData = (await query(`
  SELECT
    benchmarkName,
    CASE
      WHEN scenario LIKE '%.recursion' THEN 'recursion'
      WHEN scenario LIKE '%.events' THEN 'events'
    END AS scenarioType,
    trimmedAvg(list_transform(memorySamples, s -> s.rssDelta)) AS rssDeltaAvg
  FROM benchmarks
  WHERE runtime = '${runtime}'
    AND releaseTag = '${releaseTag}'
    AND memorySamples IS NOT NULL
  ORDER BY scenarioType, rssDeltaAvg ASC
`)).map(d => ({
  ...d,
  rssDeltaKB: d.rssDeltaAvg / 1024,
}));

const rssRecursion = rssData.filter(d => d.scenarioType === "recursion");
const rssEvents = rssData.filter(d => d.scenarioType === "events");

// Independent plots per scenario type so events bars (often 100s of KB) don't
// crush recursion bars (often single-digit KB) into invisibility.
function rssPlot(rows, label) {
  if (rows.length === 0) return null;
  return Plot.plot({
    title: `${label} — Trimmed-mean RSS Δ per Iteration (${runtime} / ${releaseTag})`,
    width,
    height: 320,
    marginTop: 30,
    x: {label: "Library"},
    y: {label: "RSS delta trimmed-mean (KB)", grid: true},
    color: {legend: true, scheme: "tableau10"},
    marks: [
      Plot.barY(rows, {
        x: "benchmarkName",
        y: "rssDeltaKB",
        fill: "benchmarkName",
        sort: {x: "y"},
        tip: true,
      }),
      // Absolute-KB label above each bar. For negative bars (Bun decommit)
      // we anchor the label at the bar end via dy that flips with sign.
      Plot.text(rows, {
        x: "benchmarkName",
        y: "rssDeltaKB",
        text: d => `${d.rssDeltaKB.toFixed(0)} KB`,
        textAnchor: "middle",
        dy: d => d.rssDeltaKB >= 0 ? -8 : 14,
        fontSize: 10,
      }),
      Plot.ruleY([0]),
    ],
  });
}
```

```js
display(rssData.length === 0
  ? html`<div class="warning">No memory data for release <strong>${releaseTag}</strong> on <strong>${runtime}</strong>.</div>`
  : html`<div>${rssPlot(rssRecursion, "Recursion")}${rssPlot(rssEvents, "Events")}</div>`)
```

---

## Caveats

- **Retained, not peak.** We don't sample heap during the scenario, only at the boundaries. Peak working-set during execution can be substantially higher than what shows here.
- **Median across 10 iterations** is robust to single-iteration GC events but can hide slow growth across a run. `heapUsedAfter - heapUsedBefore` (the un-GC'd delta) is available in the underlying data if you want to dig in.
- **`effect-v4` is beta** (`4.0.0-beta.64`); these numbers will move as the beta evolves.
- **`effection-inline.recursion` doesn't run on Effection 3.6.0 / 3.6.1** because the inline plugin requires v4. Bars for that combination are absent by design.

[&larr; Back to Overview](/)
