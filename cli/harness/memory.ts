/**
 * Cross-runtime memory snapshot helper.
 *
 * Reads RSS and JS heap usage from whichever runtime is hosting the harness.
 * Used by measure() to record retained memory before/after each scenario
 * iteration.
 *
 * @module
 */

declare const process: {
  memoryUsage(): MemorySnapshot;
} | undefined;

/**
 * Normalized memory snapshot. `arrayBuffers` is omitted under Deno.
 */
export interface MemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers?: number;
}

/**
 * Capture a memory snapshot from the host runtime.
 */
export function snapshotMemory(): MemorySnapshot {
  if (typeof Deno !== "undefined" && typeof Deno.memoryUsage === "function") {
    return Deno.memoryUsage();
  }
  if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
    return process.memoryUsage();
  }
  throw new Error("snapshotMemory: no supported runtime memory API");
}
