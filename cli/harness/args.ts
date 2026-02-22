/**
 * Argument parsing for the benchmark harness subprocess.
 *
 * Uses simple manual parsing to avoid dependencies that might
 * not work across all runtimes.
 *
 * @module
 */

/**
 * Parsed harness arguments.
 */
export interface HarnessArgs {
  /** Scenario to run (e.g., "effection.recursion") */
  scenario: string;
  /** Recursion depth */
  depth: number;
  /** Number of measured iterations */
  repeat: number;
  /** Number of warmup iterations */
  warmup: number;
  /** Output JSON to stdout */
  json: boolean;
}

/**
 * Parse harness CLI arguments.
 * Simple manual parsing for cross-runtime compatibility.
 */
export function parseHarnessArgs(args: string[]): HarnessArgs {
  const result: HarnessArgs = {
    scenario: "",
    depth: 100,
    repeat: 10,
    warmup: 3,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--scenario":
        result.scenario = next || "";
        i++;
        break;
      case "--depth":
        result.depth = parseInt(next || "100", 10);
        i++;
        break;
      case "--repeat":
        result.repeat = parseInt(next || "10", 10);
        i++;
        break;
      case "--warmup":
        result.warmup = parseInt(next || "3", 10);
        i++;
        break;
      case "--json":
        result.json = true;
        break;
    }
  }

  return result;
}

/**
 * Validate harness arguments.
 */
export function validateHarnessArgs(args: HarnessArgs): string | null {
  if (!args.scenario) {
    return "Missing required --scenario argument";
  }
  if (args.depth <= 0) {
    return "--depth must be positive";
  }
  if (args.repeat <= 0) {
    return "--repeat must be positive";
  }
  if (args.warmup < 0) {
    return "--warmup cannot be negative";
  }
  return null;
}
