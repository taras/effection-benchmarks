/**
 * Type declarations for @effectionx/inline.
 *
 * This package is installed at runtime in the benchmark workspace,
 * not available during development type-checking.
 */
declare module "@effectionx/inline" {
  import type { Operation, Instruction } from "effection";

  /**
   * Wraps an operation to be executed inline without generator frame overhead.
   *
   * Returns an instruction to be yielded (not yield*), which will be
   * processed by the inline-aware runtime. The return type is unknown
   * because the value is extracted at runtime - callers must cast.
   */
  export function inline<T>(operation: Operation<T>): Instruction;
}
