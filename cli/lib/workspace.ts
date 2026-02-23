/**
 * Benchmark workspace management.
 *
 * Creates isolated directories with specific package versions
 * for running benchmarks against different Effection releases.
 *
 * Supports two modes:
 * - Temporary workspace (default): Fresh npm install, cleaned up on scope exit
 * - Cached workspace (--cache-workspace): Persistent cache, skips npm install if exists
 *
 * @module
 */

import { call, resource, type Operation } from "effection";
import { exec } from "@effectionx/process";

/**
 * Workspace configuration.
 */
export interface WorkspaceConfig {
  /** Effection version to install (e.g., "4.1.0") */
  effectionVersion: string;
  /** Comparison library versions */
  comparisonVersions: {
    rxjs: string;
    effect: string;
    co: string;
  };
  /** Use persistent cache directory instead of temp dir */
  useCache?: boolean;
}

/**
 * A prepared benchmark workspace.
 */
export interface Workspace {
  /** Path to the workspace directory */
  path: string;
}

/**
 * Generate package.json content for the benchmark workspace.
 */
function generatePackageJson(config: WorkspaceConfig): string {
  const pkg = {
    name: "effection-benchmark-workspace",
    type: "module",
    private: true,
    dependencies: {
      effection: config.effectionVersion,
      rxjs: config.comparisonVersions.rxjs,
      effect: config.comparisonVersions.effect,
      co: config.comparisonVersions.co,
    },
  };
  return JSON.stringify(pkg, null, 2);
}

/**
 * Generate deno.json for Deno runtime compatibility.
 * Enables node_modules resolution for bare specifiers.
 */
function generateDenoJson(): string {
  return JSON.stringify({ nodeModulesDir: "auto" }, null, 2);
}

/**
 * Compute cache key from workspace config.
 * Uses a simple hash of the serialized config.
 */
async function computeCacheKey(config: WorkspaceConfig): Promise<string> {
  const data = JSON.stringify({
    effection: config.effectionVersion,
    rxjs: config.comparisonVersions.rxjs,
    effect: config.comparisonVersions.effect,
    co: config.comparisonVersions.co,
  });
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Get the cache directory path.
 */
function getCacheDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "/tmp";
  return `${home}/.cache/effection-bench`;
}

/**
 * Get the source CLI directory (where harness and scenarios live).
 */
function getSourceCliDir(): string {
  // Get the directory containing this file, then go up to cli/
  const thisFile = new URL(import.meta.url).pathname;
  const libDir = thisFile.substring(0, thisFile.lastIndexOf("/"));
  const cliDir = libDir.substring(0, libDir.lastIndexOf("/"));
  return cliDir;
}

/**
 * Files and directories to copy to the workspace.
 * Paths are relative to cli/ directory.
 */
const WORKSPACE_ITEMS = [
  "harness",
  "scenarios", 
  "lib/schema.ts",
  "lib/stats.ts",
];

/**
 * Recursively copy a directory.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile) {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copy workspace files from source CLI directory to workspace.
 */
function* copyWorkspaceFiles(workspaceDir: string): Operation<void> {
  const sourceDir = getSourceCliDir();
  
  // Create cli directory structure in workspace
  yield* call(() => Deno.mkdir(`${workspaceDir}/cli/lib`, { recursive: true }));
  
  for (const item of WORKSPACE_ITEMS) {
    const src = `${sourceDir}/${item}`;
    const dest = `${workspaceDir}/cli/${item}`;
    
    // Ensure parent directory exists
    const parentDir = dest.substring(0, dest.lastIndexOf("/"));
    yield* call(() => Deno.mkdir(parentDir, { recursive: true }));
    
    // Check if source is directory or file
    const stat = yield* call(() => Deno.stat(src));
    
    if (stat.isDirectory) {
      yield* call(() => copyDir(src, dest));
    } else {
      yield* call(() => Deno.copyFile(src, dest));
    }
  }
}

/**
 * Check if node_modules exists and has content.
 */
async function hasNodeModules(dir: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(`${dir}/node_modules`);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Create a benchmark workspace as a resource.
 *
 * The workspace contains:
 * - package.json with specified dependency versions
 * - deno.json for Deno runtime compatibility
 * - node_modules/ after npm install
 * - cli/harness/ and cli/scenarios/ copied from the CLI
 *
 * When useCache is false (default):
 * - Creates a temp directory
 * - Runs npm install
 * - Automatically cleaned up when the scope exits
 *
 * When useCache is true:
 * - Uses persistent cache directory at ~/.cache/effection-bench/<hash>/
 * - Skips npm install if node_modules/ exists
 * - NOT cleaned up (persistent cache)
 */
export function useWorkspace(config: WorkspaceConfig): Operation<Workspace> {
  return resource(function* (provide) {
    let dir: string;
    let shouldCleanup: boolean;
    let needsNpmInstall: boolean;

    if (config.useCache) {
      // Cached mode: use persistent directory
      const cacheKey = yield* call(() => computeCacheKey(config));
      const cacheBaseDir = getCacheDir();
      dir = `${cacheBaseDir}/${cacheKey}`;
      shouldCleanup = false;

      // Create cache directory if needed
      yield* call(() => Deno.mkdir(dir, { recursive: true }));

      // Check if npm install is needed
      needsNpmInstall = !(yield* call(() => hasNodeModules(dir)));
      
      if (!needsNpmInstall) {
        console.log(`    Using cached workspace`);
      }
    } else {
      // Temp mode: use temporary directory
      dir = yield* call(() => Deno.makeTempDir({ prefix: "effection-bench-" }));
      shouldCleanup = true;
      needsNpmInstall = true;
    }

    try {
      // Write package.json (always, in case versions changed in cache)
      yield* call(() => Deno.writeTextFile(`${dir}/package.json`, generatePackageJson(config)));

      // Write deno.json for Deno runtime support
      yield* call(() => Deno.writeTextFile(`${dir}/deno.json`, generateDenoJson()));

      // Run npm install if needed
      if (needsNpmInstall) {
        const { code, stderr } = yield* exec("npm install --silent", { cwd: dir }).join();
        if (code !== 0) {
          throw new Error(`npm install failed (exit code ${code}): ${stderr}`);
        }
      }

      // Always copy fresh harness and scenario files (they may have changed)
      yield* copyWorkspaceFiles(dir);

      yield* provide({ path: dir });
    } finally {
      if (shouldCleanup) {
        // Cleanup temp directory
        yield* call(() => Deno.remove(dir, { recursive: true }).catch(() => {
          // Ignore cleanup errors
        }));
      }
    }
  });
}

/**
 * Clear the workspace cache.
 * Useful for forcing fresh npm install on next run.
 */
export function* clearWorkspaceCache(): Operation<void> {
  const cacheDir = getCacheDir();
  try {
    yield* call(() => Deno.remove(cacheDir, { recursive: true }));
    console.log(`Cleared workspace cache at ${cacheDir}`);
  } catch {
    // Cache dir may not exist
    console.log(`No cache to clear`);
  }
}
