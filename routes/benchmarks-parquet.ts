import { call, resource, type Operation } from "effection";
import { DuckDBInstance } from "@duckdb/node-api";
import { fromFileUrl } from "@std/path/from-file-url";
import { join } from "@std/path/join";
import { hashElement } from "folder-hash";
import { cached } from "../plugins/cache.ts";

const projectRoot = fromFileUrl(new URL("../", import.meta.url));
const jsonDirPath = join(projectRoot, "data/json");
const jsonGlobPath = join(projectRoot, "data/json/*.json");

function* useDuckDB(): Operation<{
  runQuery: (sql: string) => Operation<void>;
}> {
  return yield* resource(function* (provide) {
    const instance: DuckDBInstance = yield* call(() =>
      DuckDBInstance.create(":memory:"),
    );
    const connection = yield* call(() => instance.connect());

    try {
      yield* provide({
        runQuery: function* (sql: string): Operation<void> {
          yield* call(() => connection.run(sql));
        },
      });
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });
}

function* generateParquet(): Operation<Uint8Array> {
  const db = yield* useDuckDB();

  yield* db.runQuery(`
    CREATE TABLE benchmarks AS
    SELECT
      metadata.releaseTag AS releaseTag,
      metadata.runtime AS runtime,
      metadata.runtimeMajorVersion AS runtimeMajorVersion,
      metadata.timestamp AS timestamp,
      metadata.runner.os AS runnerOs,
      metadata.runner.arch AS runnerArch,
      metadata.scenario AS scenario,
      to_json(metadata.benchmarkParams)::VARCHAR AS benchmarkParams,
      unnest(results).name AS benchmarkName,
      unnest(results).stats.avgTime AS avgTime,
      unnest(results).stats.minTime AS minTime,
      unnest(results).stats.maxTime AS maxTime,
      unnest(results).stats.stdDev AS stdDev,
      unnest(results).stats.p50 AS p50,
      unnest(results).stats.p95 AS p95,
      unnest(results).stats.p99 AS p99,
      filename AS sourceFile
    FROM read_json_auto('${jsonGlobPath}', filename=true, union_by_name=true)
  `);

  const tempParquetPath = join(projectRoot, ".cache/benchmarks.parquet");
  yield* call(() => Deno.mkdir(join(projectRoot, ".cache"), { recursive: true }));

  yield* db.runQuery(`COPY benchmarks TO '${tempParquetPath}' (FORMAT PARQUET)`);

  try {
    return yield* call(() => Deno.readFile(tempParquetPath));
  } finally {
    try {
      yield* call(() => Deno.remove(tempParquetPath));
    } catch {
      // ignore
    }
  }
}

async function parquetCacheKey(_request: Request): Promise<string> {
  const hash = await hashElement(jsonDirPath, {
    files: { include: ["*.json"] },
    folders: { exclude: [".*"] },
  });

  return `http://cache.local/api/benchmarks.parquet?v=${hash.hash}`;
}

function* generateParquetResponse(_request: Request): Operation<Response> {
  try {
    const parquetBytes = yield* generateParquet();
    return new Response(parquetBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="benchmarks.parquet"',
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to generate Parquet file",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const benchmarksParquetHandler = cached(
  "benchmarks-parquet-v1",
  generateParquetResponse,
  parquetCacheKey,
);
