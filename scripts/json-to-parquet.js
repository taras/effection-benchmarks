import { Database } from "duckdb-async";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const JSON_GLOB = join(DATA_DIR, "json", "*.json");
const PARQUET_OUT = join(DATA_DIR, "benchmarks.parquet");

const db = await Database.create(":memory:");

// Read all JSON files, unnest the nested structure, and write to Parquet
await db.run(`
  COPY (
    SELECT
      metadata.releaseTag,
      metadata.runtime,
      metadata.runtimeMajorVersion,
      metadata.timestamp,
      metadata.runner.os AS runnerOs,
      metadata.runner.arch AS runnerArch,
      metadata.scenario,
      metadata.benchmarkParams.repeat AS paramRepeat,
      metadata.benchmarkParams.warmup AS paramWarmup,
      unnest(results).name AS benchmarkName,
      unnest(results).stats.avgTime,
      unnest(results).stats.minTime,
      unnest(results).stats.maxTime,
      unnest(results).stats.stdDev,
      unnest(results).stats.p50,
      unnest(results).stats.p95,
      unnest(results).stats.p99,
      filename AS sourceFile
    FROM read_json_auto('${JSON_GLOB}', filename=true, union_by_name=true)
  ) TO '${PARQUET_OUT}' (FORMAT PARQUET);
`);

// Verify the output
const rows = await db.all(
  `SELECT count(*) as cnt FROM read_parquet('${PARQUET_OUT}')`,
);
console.log(`Wrote ${rows[0].cnt} rows to ${PARQUET_OUT}`);

const sample = await db.all(
  `SELECT releaseTag, runtime, scenario, avgTime, p50, p95, p99
   FROM read_parquet('${PARQUET_OUT}')
   ORDER BY releaseTag, runtime, scenario
   LIMIT 6`,
);
console.log("\nSample rows:");
console.table(sample);

await db.close();
