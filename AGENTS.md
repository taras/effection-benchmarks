## Effection Benchmarks

This repository tracks Effection performance across releases and runtimes. The `bench` CLI runs a downstream benchmark harness against **npm-published** Effection versions, writes JSON result files to `data/json/`, and the dashboard queries those results.

### Architecture

- **Benchmark CLI**: `cli/main.ts` (Deno)
- **Workspace isolation**: `cli/lib/workspace.ts` creates a workspace with `package.json` + `npm install` and copies `cli/harness/` + `cli/scenarios/` into it
- **Cross-runtime harness**: `cli/harness/entry.ts` runs a single scenario and prints JSON to stdout
- **Runtime adapters**: `cli/lib/runtimes/*.ts` invoke the harness via subprocess (Node, Deno, Bun)
- **Result schema** (authoritative): `cli/lib/schema.ts`
- **Benchmark JSON output**: `data/json/*.json`

### Deployment (Deno Deploy)

This dashboard is served via **Deno Deploy** (integrated CI). There is no GitHub Pages deployment workflow.

- **Entry point**: `main.tsx`
- **Static site**: Observable Framework builds to `dist/`; the Revolution server serves it
- **Benchmark data API**: `/api/benchmarks.parquet` is generated on-demand from `data/json/*.json`

### CLI Reference

Run the CLI via Deno:

```bash
deno run -A cli/main.ts <command> [...args]
```

Commands:

- `bench run`
  - Required:
    - `--release`, `-r` Effection npm version (e.g. `4.0.2`)
    - `--runtime` Runtime to benchmark (`node`, `deno`, `bun`); repeatable
  - Options:
    - `--repeat` iterations (default `10`)
    - `--depth` recursion depth (default `100`)
    - `--warmup` warmup runs discarded (default `3`)
    - `--rxjs-version`, `--effect-version`, `--co-version` comparison library versions (defaults from `benchmark.config.json`)
    - `--cache-workspace` reuse `npm install` between runs (writes to `~/.cache/effection-bench/`)
    - `--fail-fast` stop after the first runtime failure

- `bench list-releases`
  - Options:
    - `--filter`, `-f` glob-like filter (e.g. `4.*`)

- `bench status`
  - Shows files per release/runtime and missing combinations

- `bench help [command]`

Examples:

```bash
deno run -A cli/main.ts list-releases --filter "4.*"
deno run -A cli/main.ts run --release 4.0.2 --runtime deno --runtime node --cache-workspace
deno run -A cli/main.ts status
```

### How To Run Benchmarks Locally

Prereqs:

- `deno` (CLI runner)
- `npm` (workspace installs)
- `node` if you pass `--runtime node`
- `bun` if you pass `--runtime bun`

Workflow:

1. Pick a real npm-published version:
   - `deno run -A cli/main.ts list-releases --filter "4.*"`
2. Run benchmarks:
   - `deno run -A cli/main.ts run --release <version> --runtime deno --runtime node`
3. Check what data you have:
   - `deno run -A cli/main.ts status`

### Data Format

- The authoritative schema is `cli/lib/schema.ts`.
- Result files are written to `data/json/`.
- Filenames are human-readable only:

```
<YYYY-MM-DD>-<releaseTag>-<runtime>-<runtimeMajorVersion>-<scenario>.json
```

### Extending

- Add a scenario:
  - Create a new file in `cli/scenarios/`
  - Register it in `cli/scenarios/mod.ts`
  - Add the scenario name to `SCENARIOS` in `cli/lib/schema.ts`

- Add a runtime:
  - Add an adapter in `cli/lib/runtimes/`
  - Add runtime id to `RUNTIMES` in `cli/lib/schema.ts`

### Policies / References

- Effection patterns: https://github.com/thefrontside/effection/blob/v4/AGENTS.md
- effectionx policies: https://github.com/thefrontside/effectionx/blob/main/.policies/index.md

### For LLM Agents

- Prefer running commands via `deno run -A cli/main.ts ...`.
- Use `list-releases` to avoid `npm error ETARGET` (version not published).
- Use `--cache-workspace` for iteration; omit it in CI for reproducibility.
- If a runtime is missing, the CLI will report it; install the runtime and rerun.
