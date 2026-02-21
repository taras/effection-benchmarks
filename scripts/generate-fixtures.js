import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dirname, "..", "data", "json");
mkdirSync(OUTPUT_DIR, { recursive: true });

const releases = ["v4.0.0", "v4.1.0", "v4.2.0", "v4.3.0", "v4.4.0"];
const runtimes = [
  { name: "node", majorVersion: 22 },
  { name: "deno", majorVersion: 2 },
  { name: "playwright-chromium", majorVersion: 131 },
];
const scenarios = ["recursion", "events"];

// Base timestamps starting from 2025-09-01, roughly 1 month apart per release
const baseTimestamps = [
  "2025-09-15T14:30:00Z",
  "2025-10-15T14:30:00Z",
  "2025-11-15T14:30:00Z",
  "2025-12-15T14:30:00Z",
  "2026-01-15T14:30:00Z",
];

// Base performance numbers per scenario (in ms)
const basePerf = {
  recursion: { avgTime: 15.0, minTime: 13.0, maxTime: 18.0, stdDev: 1.5 },
  events: { avgTime: 8.5, minTime: 7.0, maxTime: 11.0, stdDev: 1.2 },
};

// Runtime multipliers — some runtimes are faster/slower
const runtimeMultiplier = {
  node: 1.0,
  deno: 0.92,
  "playwright-chromium": 1.35,
};

// Improvement factor per release index (0 = baseline, 4 = ~12% faster)
function improvementFactor(releaseIdx) {
  return 1.0 - releaseIdx * 0.03;
}

function jitter(value, pct = 0.08) {
  return value * (1 + (Math.random() * 2 - 1) * pct);
}

function generateStats(scenario, runtimeName, releaseIdx) {
  const base = basePerf[scenario];
  const factor = improvementFactor(releaseIdx) * runtimeMultiplier[runtimeName];

  const avgTime = jitter(base.avgTime * factor);
  const minTime = jitter(base.minTime * factor);
  const maxTime = jitter(base.maxTime * factor);
  const stdDev = jitter(base.stdDev * factor, 0.15);
  const p50 = jitter(avgTime * 0.98);
  const p95 = jitter(avgTime * 1.12);
  const p99 = jitter(avgTime * 1.18);

  return {
    avgTime: +avgTime.toFixed(2),
    minTime: +Math.min(minTime, avgTime).toFixed(2),
    maxTime: +Math.max(maxTime, avgTime).toFixed(2),
    stdDev: +stdDev.toFixed(2),
    p50: +p50.toFixed(2),
    p95: +p95.toFixed(2),
    p99: +p99.toFixed(2),
  };
}

let fileCount = 0;

for (let ri = 0; ri < releases.length; ri++) {
  const releaseTag = releases[ri];
  const timestamp = baseTimestamps[ri];
  const dateStr = timestamp.slice(0, 10);

  for (const runtime of runtimes) {
    for (const scenario of scenarios) {
      const data = {
        metadata: {
          releaseTag,
          runtime: runtime.name,
          runtimeMajorVersion: runtime.majorVersion,
          timestamp,
          runner: {
            os: "ubuntu-22.04",
            arch: "x86_64",
          },
          scenario,
          benchmarkParams: {
            repeat: 10,
            warmup: 3,
            ...(scenario === "recursion" ? { depth: 100 } : { listeners: 50 }),
          },
        },
        results: [
          {
            name: "effection",
            stats: generateStats(scenario, runtime.name, ri),
          },
        ],
      };

      const filename = `${dateStr}-${releaseTag}-${runtime.name}-${runtime.majorVersion}-${scenario}.json`;
      writeFileSync(
        join(OUTPUT_DIR, filename),
        JSON.stringify(data, null, 2) + "\n",
      );
      fileCount++;
    }
  }
}

console.log(`Generated ${fileCount} benchmark JSON files in ${OUTPUT_DIR}`);
