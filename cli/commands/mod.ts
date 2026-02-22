/**
 * Command dispatcher for the benchmark CLI.
 *
 * Manual dispatch layer on top of configliere.
 * Each command uses its own Configliere instance for options.
 *
 * @module
 */

import type { Operation } from "effection";
import { helpCommand } from "./help.ts";
import { runCommand } from "./run.ts";
import { listReleasesCommand } from "./list-releases.ts";
import { statusCommand } from "./status.ts";

/**
 * Command handler signature.
 * Takes remaining args after the command name, returns exit code.
 */
export type CommandHandler = (args: string[]) => Operation<number>;

/**
 * Registry of available commands.
 */
const commands: Record<string, CommandHandler> = {
  run: runCommand,
  "list-releases": listReleasesCommand,
  status: statusCommand,
  help: helpCommand,
};

/**
 * Dispatch to the appropriate command handler.
 *
 * @param args - CLI arguments (e.g., ["run", "--release", "4.0.0"])
 * @returns Exit code
 */
export function* dispatch(args: string[]): Operation<number> {
  const [command, ...rest] = args;

  // No command or help flags
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return yield* helpCommand(rest);
  }

  // Check for help flag on any command
  if (rest.includes("--help") || rest.includes("-h")) {
    return yield* helpCommand([command]);
  }

  // Lookup and execute command
  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.log();
    return yield* helpCommand([]);
  }

  return yield* handler(rest);
}
