import { createContext, type Operation, type Task } from "effection";

/**
 * Metadata for a comparison page.
 */
export interface ComparisonPageMeta {
  /** URL slug, e.g., "recursion" */
  slug: string;
  /** Page title, e.g., "Recursion Benchmarks" */
  title: string;
}

/**
 * Context holding the spawned build task.
 *
 * The task resolves to ComparisonPageMeta[] once the Observable Framework
 * build completes. Routes can yield this task to wait for the build
 * and get the page metadata.
 */
export const BuiltAssetsContext = createContext<Task<ComparisonPageMeta[]>>("BuiltAssets");

/**
 * Wait for the build to complete and get page metadata.
 *
 * This yields the build task from context. If the build is still
 * running, it blocks until completion. If already complete, it
 * returns immediately with the cached result.
 */
export function* useBuiltAssets(): Operation<ComparisonPageMeta[]> {
  const task = yield* BuiltAssetsContext.expect();
  return yield* task;
}
