-- Convert benchmark JSON files to a single flattened Parquet file
-- Writes directly to src/data/ so Observable's FileAttachment can find it.
COPY (
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
  FROM read_json_auto('data/json/*.json', filename=true, union_by_name=true)
) TO 'src/data/benchmarks.parquet' (FORMAT PARQUET);

-- Verify
SELECT count(*) AS total_rows FROM read_parquet('src/data/benchmarks.parquet');

SELECT releaseTag, runtime, scenario, benchmarkParams, avgTime, p50, p95, p99
FROM read_parquet('src/data/benchmarks.parquet')
ORDER BY releaseTag, runtime, scenario
LIMIT 6;

-- Verify JSON extraction works
SELECT
  json_extract(benchmarkParams, '$.repeat') AS repeat,
  json_extract(benchmarkParams, '$.depth') AS depth,
  json_extract(benchmarkParams, '$.listeners') AS listeners
FROM read_parquet('src/data/benchmarks.parquet')
LIMIT 4;
