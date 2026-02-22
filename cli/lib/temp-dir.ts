/**
 * Temporary directory resource for benchmark isolation.
 *
 * Policy-compliant: uses resource() for lifecycle management
 * instead of inline try/finally.
 *
 * @module
 */

import { resource, type Operation } from "effection";

/**
 * Create a temporary directory as a resource.
 * The directory is automatically cleaned up when the scope exits.
 *
 * Uses `resource()` pattern per composable-units policy.
 *
 * @param prefix - Prefix for the temp directory name
 * @returns The path to the created temp directory
 */
export function useTempDir(prefix = "effection-bench-"): Operation<string> {
  return resource(function* (provide) {
    const dir = Deno.makeTempDirSync({ prefix });
    try {
      yield* provide(dir);
    } finally {
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch {
        // Ignore cleanup errors (directory may already be gone)
      }
    }
  });
}

/**
 * Convenience wrapper for callback-style usage.
 *
 * @param fn - Function to execute with the temp directory path
 * @returns Result of the function
 */
export function* withTempDir<T>(
  fn: (dir: string) => Operation<T>,
): Operation<T> {
  const dir = yield* useTempDir();
  return yield* fn(dir);
}
