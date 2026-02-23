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

// Semver sorting macro - converts version strings to sortable 6-element integer lists
// Elements: [major, minor, patch, prerelease_flag (0=pre, 1=release), prerelease_type, prerelease_num]
const SEMVER_MACRO = `
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
`;

function* generateParquet(): Operation<Uint8Array> {
  const db = yield* useDuckDB();

  // Register semver macro for sorting
  yield* db.runQuery(SEMVER_MACRO);

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
      unnest(results).samples AS samples,
      filename AS sourceFile
    FROM read_json_auto('${jsonGlobPath}', filename=true, union_by_name=true)
  `);

  const tempParquetPath = join(projectRoot, ".cache/benchmarks.parquet");
  yield* call(() => Deno.mkdir(join(projectRoot, ".cache"), { recursive: true }));

  // Pre-sort by semver for optimal default ordering and compression
  yield* db.runQuery(`
    COPY (SELECT * FROM benchmarks ORDER BY semver(releaseTag), runtime, scenario) 
    TO '${tempParquetPath}' (FORMAT PARQUET)
  `);

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
