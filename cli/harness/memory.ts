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

/**
 * Per-iteration peak-memory recorder. Each `mark()` snapshots memory and
 * keeps the running max for both heap and RSS. Backed by `snapshotMemory()`.
 *
 * The harness creates one of these per measured iteration and exposes it to
 * the scenario via `ScenarioCtx.markPeak()`.
 */
export interface PeakRecorder {
  /** Snapshot memory now and update running peaks. */
  mark(): void;
  /** Current peak heap and RSS in bytes. */
  current(): { heapUsed: number; rss: number };
}

export function createPeakRecorder(): PeakRecorder {
  let peakHeap = 0;
  let peakRss = 0;
  return {
    mark(): void {
      const m = snapshotMemory();
      if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
      if (m.rss > peakRss) peakRss = m.rss;
    },
    current(): { heapUsed: number; rss: number } {
      return { heapUsed: peakHeap, rss: peakRss };
    },
  };
}
