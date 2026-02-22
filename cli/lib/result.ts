/**
 * Result type for collecting successes and failures without
 * collapsing the entire operation.
 *
 * @module
 */

import type { Operation } from "effection";

/**
 * A discriminated union representing success or failure.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error; context: string };

/**
 * Safely convert an unknown caught value to an Error.
 * Policy-compliant: narrows unknown instead of assertion.
 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Wrap an operation to catch errors and return a Result instead of throwing.
 * This allows collecting results from multiple operations even when some fail.
 *
 * @param context - Identifier for error reporting (e.g., runtime name)
 * @param op - The operation to execute
 * @returns Result indicating success or failure
 */
export function* wrapResult<T>(
  context: string,
  op: Operation<T>,
): Operation<Result<T>> {
  try {
    const value = yield* op;
    return { ok: true, value };
  } catch (error: unknown) {
    return { ok: false, error: toError(error), context };
  }
}

/**
 * Check if a result is successful.
 */
export function isOk<T>(result: Result<T>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Check if a result is a failure.
 */
export function isErr<T>(
  result: Result<T>,
): result is { ok: false; error: Error; context: string } {
  return !result.ok;
}

/**
 * Extract successful results from an array of Results.
 */
export function successes<T>(results: Result<T>[]): T[] {
  return results.filter(isOk).map((r) => r.value);
}

/**
 * Extract failed results from an array of Results.
 */
export function failures<T>(
  results: Result<T>[],
): { error: Error; context: string }[] {
  return results.filter(isErr).map((r) => ({
    error: r.error,
    context: r.context,
  }));
}
