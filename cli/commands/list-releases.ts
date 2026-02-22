/**
 * list-releases command implementation.
 *
 * Lists available Effection npm releases.
 *
 * @module
 */

import type { Operation } from "effection";
import { exec } from "@effectionx/process";
import { z } from "zod";
import { Configliere } from "configliere";

const configliere = new Configliere({
  filter: {
    schema: z.string().optional(),
    description: "Filter versions by pattern",
    cli: { alias: "f" },
  },
});

/**
 * List available Effection npm releases.
 */
export function* listReleasesCommand(args: string[]): Operation<number> {
  const result = configliere.parse({ args });

  if (!result.ok) {
    console.error("Error parsing arguments:");
    console.error(result.summary);
    return 1;
  }

  const { filter } = result.config;

  console.log("Fetching Effection versions from npm...");

  const { stdout, code } = yield* exec(
    "npm view effection versions --json",
  ).join();

  if (code !== 0) {
    console.error("Failed to fetch versions from npm");
    return 1;
  }

  let versions: string[];
  try {
    versions = JSON.parse(stdout) as string[];
  } catch {
    console.error("Failed to parse npm response");
    return 1;
  }

  // Apply filter if provided
  if (filter) {
    const pattern = new RegExp(
      "^" + filter.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
    );
    versions = versions.filter((v) => pattern.test(v));
  }

  // Sort by semver (simple lexical sort works for most cases)
  versions.sort((a, b) => {
    const aParts = a.split(".").map((p) => parseInt(p, 10) || 0);
    const bParts = b.split(".").map((p) => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (aParts[i] || 0) - (bParts[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  if (versions.length === 0) {
    console.log("No versions found matching filter");
    return 0;
  }

  console.log(`\nFound ${versions.length} version(s):\n`);
  for (const version of versions) {
    console.log(`  ${version}`);
  }

  return 0;
}
