/**
 * Effection Benchmark CLI entry point.
 *
 * Uses Effection's main() to run the entire CLI inside one root scope.
 *
 * @module
 */

import { main, exit } from "effection";
import { dispatch } from "./commands/mod.ts";

main(function* () {
  const code = yield* dispatch(Deno.args);
  yield* exit(code);
});
