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

declare const Bun: {
  gc(force?: boolean): number;
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

/**
 * Force a major GC, if the runtime exposes one. Returns true on success.
 *
 * - Node/Deno: `globalThis.gc` is exposed via `--expose-gc` /
 *   `--v8-flags=--expose-gc`. Calling it triggers a full major GC.
 * - Bun: `Bun.gc(true)` is always available; the `true` arg requests a
 *   synchronous full GC.
 */
export function forceGc(): boolean {
  // deno-lint-ignore no-explicit-any
  const gc = (globalThis as any).gc as (() => void) | undefined;
  if (typeof gc === "function") {
    gc();
    return true;
  }
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
    return true;
  }
  return false;
}
