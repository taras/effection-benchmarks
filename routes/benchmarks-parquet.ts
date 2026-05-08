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
    const tempDir: string = yield* call(() =>
      Deno.makeTempDir({ prefix: "duckdb-" }),
    );
    const tempDbPath = join(tempDir, "work.duckdb");

    const instance: DuckDBInstance = yield* call(() =>
      DuckDBInstance.create(tempDbPath),
    );
    const connection = yield* call(() => instance.connect());

    // Tune for constrained-memory environments (e.g. Deno Deploy). memory_limit
    // governs only the buffer manager; some allocations happen outside it.
    yield* call(() => connection.run(`SET threads = 1`));
    yield* call(() => connection.run(`SET memory_limit = '256MB'`));
    yield* call(() => connection.run(`SET preserve_insertion_order = false`));
    yield* call(() =>
      connection.run(`SET temp_directory = '${tempDir}'`),
    );
    yield* call(() => connection.run(`SET max_temp_directory_size = '1GB'`));

    try {
      yield* provide({
        runQuery: function* (sql: string): Operation<void> {
          yield* call(() => connection.run(sql));
        },
      });
    } finally {
      connection.closeSync();
      instance.closeSync();
      try {
        yield* call(() => Deno.remove(tempDir, { recursive: true }));
      } catch {
        // ignore — best-effort cleanup
      }
    }
  });
}

function* generateParquet(): Operation<Uint8Array> {
  const db = yield* useDuckDB();

  // Step 1: Create table WITHOUT optional branch metadata fields
  // (source, commitHash may not exist in any JSON file yet)
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

  // Step 2: Add optional branch metadata columns with defaults
  yield* db.runQuery(`ALTER TABLE benchmarks ADD COLUMN source VARCHAR DEFAULT 'npm'`);
  yield* db.runQuery(`ALTER TABLE benchmarks ADD COLUMN commitHash VARCHAR`);

  // Step 3: Try to update rows from files that have branch metadata
  // This query will fail if no files have these fields (struct key not found),
  // which is fine — the defaults from Step 2 are correct for npm-only data
  try {
    yield* db.runQuery(`
      UPDATE benchmarks SET
        source = branch_data.source,
        commitHash = branch_data.commitHash
      FROM (
        SELECT 
          filename AS sourceFile,
          COALESCE(metadata.source, 'npm') AS source,
          metadata.commitHash AS commitHash
        FROM read_json_auto('${jsonGlobPath}', filename=true, union_by_name=true)
      ) AS branch_data
      WHERE benchmarks.sourceFile = branch_data.sourceFile
    `);
  } catch {
    // No files have branch metadata yet — defaults are fine
  }

  const tempParquetPath = join(projectRoot, ".cache/benchmarks.parquet");
  yield* call(() => Deno.mkdir(join(projectRoot, ".cache"), { recursive: true }));

  // No global ORDER BY: the browser-side init in routes/comparison-pages.ts
  // registers its own semver() macro and applies ordering per-query, so a
  // blocking sort here only adds memory pressure on cold-cache requests.
  yield* db.runQuery(`
    COPY benchmarks TO '${tempParquetPath}' (FORMAT PARQUET)
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
