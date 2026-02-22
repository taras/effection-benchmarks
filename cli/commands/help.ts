/**
 * Help command implementation.
 *
 * @module
 */

import type { Operation } from "effection";

const MAIN_HELP = `
Effection Benchmark CLI

Usage: bench <command> [options]

Commands:
  run             Run benchmarks for an Effection release
  list-releases   List available Effection npm releases
  status          Show benchmark data status
  help            Show this help message

Run 'bench help <command>' for command-specific help.

Examples:
  bench run --release 4.0.0 --runtime node --runtime deno
  bench list-releases --filter "4.*"
  bench status
`.trim();

const RUN_HELP = `
bench run - Run benchmarks for an Effection release

Usage:
  bench run --release <version> --runtime <runtime> [options]

Required:
  --release, -r     Effection npm version to benchmark (e.g., 4.0.0)
  --runtime         Runtime to benchmark (node, deno, bun). Can be repeated.

Options:
  --repeat          Number of benchmark iterations (default: 10)
  --depth           Recursion depth for scenarios (default: 100)
  --warmup          Warmup runs to discard (default: 3)
  --rxjs-version    RxJS version for comparison (default: from config)
  --effect-version  Effect version for comparison (default: from config)
  --co-version      co version for comparison (default: from config)
  --fail-fast       Stop on first runtime failure (default: false)

Examples:
  bench run --release 4.0.0 --runtime node
  bench run -r 4.1.0 --runtime node --runtime deno --runtime bun
  bench run --release 4.0.0 --runtime node --repeat 20 --depth 50
`.trim();

const LIST_RELEASES_HELP = `
bench list-releases - List available Effection npm releases

Usage:
  bench list-releases [options]

Options:
  --filter, -f    Filter versions by pattern (e.g., "4.*", "3.0.*")

Examples:
  bench list-releases
  bench list-releases --filter "4.*"
  bench list-releases -f "4.0.*"
`.trim();

const STATUS_HELP = `
bench status - Show benchmark data status

Usage:
  bench status

Shows:
  - Number of result files per release and runtime
  - Missing release/runtime combinations
  - Date range of collected data

Examples:
  bench status
`.trim();

const COMMAND_HELP: Record<string, string> = {
  run: RUN_HELP,
  "list-releases": LIST_RELEASES_HELP,
  status: STATUS_HELP,
  help: MAIN_HELP,
};

/**
 * Display help for a command or general usage.
 */
export function* helpCommand(args: string[]): Operation<number> {
  const subcommand = args[0];

  if (subcommand && COMMAND_HELP[subcommand]) {
    console.log(COMMAND_HELP[subcommand]);
  } else if (subcommand) {
    console.error(`Unknown command: ${subcommand}`);
    console.log();
    console.log(MAIN_HELP);
    return 1;
  } else {
    console.log(MAIN_HELP);
  }

  return 0;
}
