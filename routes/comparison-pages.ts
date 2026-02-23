/**
 * Comparison page generation.
 *
 * Generates Observable Framework markdown pages for library comparisons
 * at server startup. Creates 2 comparison pages:
 * - /recursion: effection vs rxjs vs effect vs co vs async-await
 * - /events: effection vs rxjs vs effect vs addEventListener
 *
 * Also generates observablehq.config.js dynamically.
 *
 * @module
 */

import { call, type Operation } from "effection";

/**
 * GitHub base URL for linking to scenario source files.
 */
const GITHUB_BASE =
  "https://github.com/taras/Effection-performance-dashboard-poc/blob/main/cli/scenarios";

/**
 * Comparison page configuration.
 */
interface ComparisonPage {
  slug: string;
  title: string;
  description: string;
  /** Optional detailed explanation rendered below description */
  explanation?: string;
  /** Libraries to compare (benchmarkName values in data) */
  libraries: string[];
  /** Scenario suffix (e.g., "recursion" or "events") */
  scenarioType: string;
  /** Map of library name to scenario file name (without path) */
  sourceFiles: Record<string, string>;
  /** Unit for time display: "ms" or "μs" (default: "ms") */
  unit?: "ms" | "μs";
}

/**
 * Page configurations for the two comparison pages.
 */
const COMPARISON_PAGES: ComparisonPage[] = [
  {
    slug: "recursion",
    title: "Recursion Benchmarks",
    description:
      "Compare structured concurrency overhead for deeply nested async operations across libraries.",
    libraries: ["effection", "rxjs", "effect", "co", "async-await"],
    scenarioType: "recursion",
    sourceFiles: {
      effection: "effection.recursion.ts",
      rxjs: "rxjs.recursion.ts",
      effect: "effect.recursion.ts",
      co: "co.recursion.ts",
      "async-await": "async-await.recursion.ts",
    },
    unit: "μs",
  },
  {
    slug: "events",
    title: "Events Benchmarks",
    description:
      "Compare event handling and subscription management performance across libraries.",
    explanation: `
## What This Benchmark Measures

This benchmark tests **event handling overhead** — how much cost each library adds on top of native \`EventTarget\`.

Each scenario:
1. Creates a recursive chain of \`EventTarget\` listeners (depth configurable, default 100)
2. Dispatches 100 events at the root
3. Each layer forwards events to its child \`EventTarget\`
4. Triggers cancellation to tear down **all** listeners at every level

### Fair Comparison: All Libraries Use Native EventTarget

| Library | Event Source | Subscription API | Cleanup |
|---------|--------------|------------------|---------|
| **addEventListener** | \`EventTarget\` | Native \`addEventListener\` | \`removeEventListener\` on abort |
| **effection** | \`EventTarget\` | \`on()\` + \`each()\` | Structured concurrency (halt) |
| **rxjs** | \`EventTarget\` | \`fromEvent()\` | \`unsubscribe()\` via \`takeUntil\` |
| **effect** | \`EventTarget\` | \`Stream.fromEventListener()\` | Fiber interruption |

The **addEventListener** baseline shows the raw cost of native event handling with manual cleanup. The reactive libraries add abstraction for:
- **Automatic cleanup** — listeners removed when cancelled
- **Subscription tracking** — knowing what's active
- **Composability** — transforming/chaining event streams

The benchmark measures how much overhead each abstraction adds.
`,
    libraries: ["effection", "rxjs", "effect", "addEventListener"],
    scenarioType: "events",
    sourceFiles: {
      effection: "effection.events.ts",
      rxjs: "rxjs.events.ts",
      effect: "effect.events.ts",
      addEventListener: "add-event-listener.events.ts",
    },
    unit: "ms",
  },
];

/**
 * Shared DuckDB initialization code for all pages.
 */
const DUCKDB_INIT = `
\`\`\`js
import * as Plot from "@observablehq/plot";
import * as Inputs from "@observablehq/inputs";
import * as duckdb from "@duckdb/duckdb-wasm";
\`\`\`

\`\`\`js
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
await conn.query(\`
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
      COALESCE(TRY_CAST(regexp_extract(prerelease, '(\\\\d+)$', 1) AS INTEGER), 0)
    ]
    FROM parsed
  )
\`);
\`\`\`

\`\`\`js
async function query(sql) {
  const c = await db.connect();
  try {
    const result = await c.query(sql);
    return result.toArray().map((row) => Object.fromEntries(Object.entries(row.toJSON()).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
  } finally {
    await c.close();
  }
}
\`\`\`
`;

/**
 * Render a comparison page markdown.
 */
function renderComparisonPage(page: ComparisonPage): string {
  const librariesList = page.libraries.map((lib) => `\`${lib}\``).join(", ");
  const sourceLinks = page.libraries
    .map((lib) => `- [${lib}](${GITHUB_BASE}/${page.sourceFiles[lib]})`)
    .join("\n");

  // Build scenario name pattern for SQL: "effection.recursion", "rxjs.recursion", etc.
  const scenarioNames = page.libraries
    .map((lib) => {
      // Map benchmarkName to scenario name
      if (lib === "addEventListener") return "add-event-listener.events";
      return `${lib}.${page.scenarioType}`;
    })
    .map((s) => `'${s}'`)
    .join(", ");

  // Unit scaling for Y-axis (μs for sub-millisecond values, ms for larger)
  const unit = page.unit || "ms";
  const scale = unit === "μs" ? 1000 : 1;

  return `# ${page.title}

${page.description}
${page.explanation ? `\n${page.explanation}` : ""}
**Libraries compared:** ${librariesList}

## Source Code

View the benchmark implementations on GitHub:

${sourceLinks}

---

${DUCKDB_INIT}

\`\`\`js
// Get available runtimes from the data
const runtimes = await query(\`
  SELECT DISTINCT runtime FROM benchmarks 
  WHERE scenario IN (${scenarioNames})
  ORDER BY runtime
\`);
const runtimeOptions = runtimes.map(r => r.runtime);
const runtimeInput = Inputs.select(runtimeOptions, {label: "Runtime", value: runtimeOptions[0] || "deno"});
const runtime = Generators.input(runtimeInput);

// Get available Effection releases from the data
const releases = await query(\`
  SELECT DISTINCT releaseTag FROM benchmarks 
  WHERE scenario IN (${scenarioNames})
  ORDER BY semver(releaseTag) DESC
\`);
const releaseOptions = releases.map(r => r.releaseTag);
const releaseInput = Inputs.select(releaseOptions, {label: "Effection Release", value: releaseOptions[0]});
const releaseTag = Generators.input(releaseInput);
\`\`\`

<div class="grid grid-cols-2">
  <div class="card">\${runtimeInput}</div>
  <div class="card">\${releaseInput}</div>
</div>

## Library Comparison

Average latency comparison across all libraries for the selected Effection release.

\`\`\`js
// Scale factor for Y-axis display (${scale} = ${unit})
const scale = ${scale};
const unit = "${unit}";

const comparisonData = (await query(\`
  SELECT benchmarkName, avgTime, p50, p95, p99, stdDev
  FROM benchmarks
  WHERE scenario IN (${scenarioNames})
    AND runtime = '\${runtime}'
    AND releaseTag = '\${releaseTag}'
  ORDER BY avgTime ASC
\`)).map(d => ({
  ...d,
  avgTime: d.avgTime * scale,
  p50: d.p50 * scale,
  p95: d.p95 * scale,
  p99: d.p99 * scale,
}));
\`\`\`

<div class="note">Showing data for release <strong>\${releaseTag}</strong> on <strong>\${runtime}</strong></div>

\`\`\`js
display(Plot.plot({
  title: \`Average Latency by Library (\${runtime})\`,
  width,
  height: 400,
  x: {label: "Library"},
  y: {label: \`Time (\${unit})\`, grid: true},
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
\`\`\`

### Percentile Comparison

\`\`\`js
// Reshape data for grouped bar chart
const percentileData = comparisonData.flatMap(d => [
  {library: d.benchmarkName, metric: "avg", value: d.avgTime},
  {library: d.benchmarkName, metric: "p50", value: d.p50},
  {library: d.benchmarkName, metric: "p95", value: d.p95},
  {library: d.benchmarkName, metric: "p99", value: d.p99},
]);
\`\`\`

\`\`\`js
display(Plot.plot({
  title: \`Percentile Comparison (\${runtime})\`,
  width,
  height: 400,
  x: {label: "Library"},
  y: {label: \`Time (\${unit})\`, grid: true},
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
\`\`\`

---

## Performance Over Releases

How each library's performance has changed across Effection releases.

\`\`\`js
const releaseData = (await query(\`
  SELECT releaseTag, benchmarkName, avgTime, p50, p95, p99
  FROM benchmarks
  WHERE scenario IN (${scenarioNames})
    AND runtime = '\${runtime}'
  ORDER BY semver(releaseTag), benchmarkName
\`)).map(d => ({
  ...d,
  avgTime: d.avgTime * scale,
  p50: d.p50 * scale,
  p95: d.p95 * scale,
  p99: d.p99 * scale,
}));
\`\`\`

\`\`\`js
display(Plot.plot({
  title: \`Latency Over Releases (\${runtime})\`,
  width,
  height: 450,
  x: {label: "Release", type: "point"},
  y: {label: \`Time (\${unit})\`, grid: true},
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
\`\`\`

---

## Runtime Comparison

Compare performance across runtimes for each library.

\`\`\`js
const runtimeCompData = (await query(\`
  SELECT benchmarkName, runtime, avgTime, p50, p95, p99
  FROM benchmarks
  WHERE scenario IN (${scenarioNames})
    AND releaseTag = '\${releaseTag}'
  ORDER BY benchmarkName, runtime
\`)).map(d => ({
  ...d,
  avgTime: d.avgTime * scale,
  p50: d.p50 * scale,
  p95: d.p95 * scale,
  p99: d.p99 * scale,
}));
\`\`\`

\`\`\`js
display(Plot.plot({
  title: \`Runtime Comparison (release \${releaseTag})\`,
  width,
  height: 400,
  x: {label: "Library"},
  y: {label: \`Time (\${unit})\`, grid: true},
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
\`\`\`

---

## Detailed Data

\`\`\`js
const allData = await query(\`
  SELECT releaseTag, runtime, benchmarkName, scenario, avgTime, minTime, maxTime, stdDev, p50, p95, p99
  FROM benchmarks
  WHERE scenario IN (${scenarioNames})
  ORDER BY semver(releaseTag), runtime, benchmarkName
\`);
\`\`\`

<div style="max-height: 500px; overflow-y: auto; margin-bottom: 1rem;">

\`\`\`js
display(Inputs.table(allData, { layout: "auto" }))
\`\`\`

</div>

---

[&larr; Back to Overview](/)
`;
}

/**
 * Render the observablehq.config.js content.
 */
function renderObservableConfig(): string {
  return `export default {
  title: "Effection Performance Dashboard",
  root: "src",
  base: "/",
  theme: "dashboard",
  pages: [
    { name: "Overview", path: "/" },
    { name: "Recursion", path: "/recursion" },
    { name: "Events", path: "/events" },
    { name: "Examples", path: "/examples" },
  ],
};
`;
}

/**
 * Metadata returned from page generation.
 * Simplified from ScenarioMeta since we just need page info for sitemap.
 */
export interface ComparisonPageMeta {
  slug: string;
  title: string;
}

/**
 * Generate comparison pages and Observable config.
 *
 * Writes:
 * - src/recursion.md
 * - src/events.md
 * - observablehq.config.js
 *
 * Returns metadata for sitemap generation.
 */
export function* generateComparisonPages(): Operation<ComparisonPageMeta[]> {
  console.log("Generating comparison pages...");

  const pages: ComparisonPageMeta[] = [];

  // Generate each comparison page
  for (const page of COMPARISON_PAGES) {
    const content = renderComparisonPage(page);
    yield* call(() => Deno.writeTextFile(`src/${page.slug}.md`, content));
    console.log(`  Generated: /${page.slug}`);
    pages.push({ slug: page.slug, title: page.title });
  }

  // Generate observablehq.config.js
  const configContent = renderObservableConfig();
  yield* call(() => Deno.writeTextFile("observablehq.config.js", configContent));
  console.log("  Generated: observablehq.config.js");

  console.log(`Generated ${pages.length} comparison pages.`);

  return pages;
}
