// Pre-populate the Observable Framework npm version cache
// so the build doesn't need to fetch from registry.npmjs.org
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const cacheDir = join(import.meta.dirname, "..", "src", ".observablehq", "cache", "_npm");

// All npm: specifiers referenced in the framework's client code
// that aren't covered by the builtins map.
// Format: "package@version"
const packages = [
  // From recommendedLibraries.js
  "lodash@4.17.21",
  "arquero@5.4.1",
  "apache-arrow@17.0.0",
  "d3@7.9.0",
  "@duckdb/duckdb-wasm@1.29.0",
  "echarts@5.5.1",
  "htl@0.3.1",
  "leaflet@1.9.4",
  "mapbox-gl@3.8.0",
  "@observablehq/plot@0.6.17",
  "react@18.3.1",
  "react-dom@18.3.1",
  "topojson-client@3.1.0",

  // From sampleDatasets.js
  "@observablehq/sample-datasets@1.0.0",
  "d3-dsv@3.0.1",

  // From fileAttachment.js (stdlib)
  "parquet-wasm@0.6.1",

  // From main.js displayJsx
  // react-dom already listed above

  // Transitive dependencies that might be needed
  "isoformat@0.2.1",
  "d3-array@3.2.4",
  "d3-scale@4.0.2",
  "d3-shape@3.2.0",
  "d3-time@3.1.0",
  "d3-time-format@4.1.0",
  "d3-format@3.1.2",
  "d3-interpolate@3.0.1",
  "d3-color@3.1.0",
  "internmap@2.0.3",
];

for (const spec of packages) {
  const dir = join(cacheDir, spec);
  mkdirSync(dir, { recursive: true });
  console.log(`Created: ${dir}`);
}

console.log(`\nPre-populated ${packages.length} npm cache entries.`);
