/**
 * status command implementation.
 *
 * Shows the current state of collected benchmark data.
 *
 * @module
 */

import type { Operation } from "effection";
import { RUNTIMES, type RuntimeId } from "../lib/schema.ts";

/**
 * File info extracted from a benchmark result filename.
 */
interface FileInfo {
  date: string;
  release: string;
  runtime: RuntimeId;
  runtimeVersion: number;
  scenario: string;
}

/**
 * Parse a benchmark filename into its components.
 * Format: YYYY-MM-DD-<release>-<runtime>-<version>-<scenario>.json
 */
function parseFilename(filename: string): FileInfo | null {
  // Remove .json extension
  const base = filename.replace(/\.json$/, "");

  // Pattern: YYYY-MM-DD-vX.Y.Z-runtime-version-scenario
  const match = base.match(
    /^(\d{4}-\d{2}-\d{2})-(v?[\d.]+(?:-[a-z]+\.\d+)?)-([a-z]+)-(\d+)-(.+)$/i,
  );

  if (!match) return null;

  const [, date, release, runtime, version, scenario] = match;

  if (!RUNTIMES.includes(runtime as RuntimeId)) {
    return null;
  }

  return {
    date,
    release,
    runtime: runtime as RuntimeId,
    runtimeVersion: parseInt(version, 10),
    scenario,
  };
}

/**
 * Show benchmark data status.
 */
export function* statusCommand(_args: string[]): Operation<number> {
  const dataDir = "data/json";

  let files: string[];
  try {
    files = Array.from(Deno.readDirSync(dataDir))
      .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
  } catch {
    console.log("No benchmark data found (data/json directory missing)");
    return 0;
  }

  if (files.length === 0) {
    console.log("No benchmark result files found in data/json/");
    return 0;
  }

  // Parse all files
  const parsed = files
    .map((f) => ({ filename: f, info: parseFilename(f) }))
    .filter((p) => p.info !== null) as { filename: string; info: FileInfo }[];

  if (parsed.length === 0) {
    console.log("No valid benchmark result files found");
    return 0;
  }

  // Collect statistics
  const releases = new Set<string>();
  const runtimes = new Set<RuntimeId>();
  const scenarios = new Set<string>();
  const dates: string[] = [];
  const byRelease = new Map<string, Map<RuntimeId, number>>();

  for (const { info } of parsed) {
    releases.add(info.release);
    runtimes.add(info.runtime);
    scenarios.add(info.scenario);
    dates.push(info.date);

    if (!byRelease.has(info.release)) {
      byRelease.set(info.release, new Map());
    }
    const runtimeCounts = byRelease.get(info.release)!;
    runtimeCounts.set(info.runtime, (runtimeCounts.get(info.runtime) || 0) + 1);
  }

  dates.sort();

  console.log("\nBenchmark Data Status\n");
  console.log(`Total files: ${parsed.length}`);
  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`Releases: ${Array.from(releases).sort().join(", ")}`);
  console.log(`Runtimes: ${Array.from(runtimes).sort().join(", ")}`);
  console.log(`Scenarios: ${Array.from(scenarios).sort().join(", ")}`);

  console.log("\nFiles per release/runtime:\n");

  // Sort releases by semver
  const sortedReleases = Array.from(releases).sort((a, b) => {
    const aParts = a.replace(/^v/, "").split(".").map((p) => parseInt(p, 10) || 0);
    const bParts = b.replace(/^v/, "").split(".").map((p) => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (aParts[i] || 0) - (bParts[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  // Header
  const runtimeList = Array.from(runtimes).sort();
  console.log(`  ${"Release".padEnd(20)} ${runtimeList.map((r) => r.padEnd(8)).join(" ")}`);
  console.log(`  ${"-".repeat(20)} ${runtimeList.map(() => "-".repeat(8)).join(" ")}`);

  for (const release of sortedReleases) {
    const counts = byRelease.get(release)!;
    const cells = runtimeList.map((r) => {
      const count = counts.get(r) || 0;
      return count > 0 ? String(count).padEnd(8) : "-".padEnd(8);
    });
    console.log(`  ${release.padEnd(20)} ${cells.join(" ")}`);
  }

  // Find missing combinations
  const missing: string[] = [];
  for (const release of sortedReleases) {
    for (const runtime of runtimeList) {
      const counts = byRelease.get(release)!;
      if (!counts.has(runtime)) {
        missing.push(`${release} / ${runtime}`);
      }
    }
  }

  if (missing.length > 0) {
    console.log("\nMissing combinations:");
    for (const m of missing) {
      console.log(`  - ${m}`);
    }
  }

  return 0;
}
