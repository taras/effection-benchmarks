# Effection Examples

Live operation-first demos for [Effection](https://frontside.com/effection). Each example demonstrates a structured concurrency pattern — click the button to run and observe the timing behavior.

```js
import * as Inputs from "@observablehq/inputs";
import { all, call, race, resource, run, sleep } from "npm:effection@4.0.2";
```

```js
async function runToResult(operation) {
  const task = run(function* () {
    return yield* operation;
  });
  return await task;
}

function formatElapsed(ms) {
  return `+${ms.toString().padStart(4, " ")}ms`;
}
```

---

## 1) Retry with Backoff

Automatically retry failed operations with exponential backoff. Each retry waits longer than the previous one, reducing pressure on struggling services.

**What to observe:** Watch the elapsed time column — each retry waits twice as long as the previous. Adjust "Fail first N attempts" to see more retries.

```js echo
function* retryWithBackoff(action, maxAttempts = 5, baseMs = 100, logs = [], startTime = 0) {
  let attempt = 0;
  let delay = baseMs;

  while (true) {
    try {
      const elapsed = Math.round(performance.now() - startTime);
      logs.push({ elapsed, event: `attempt ${attempt + 1}` });
      return yield* call(action);
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts) throw error;
      const elapsed = Math.round(performance.now() - startTime);
      logs.push({ elapsed, event: `failed, waiting ${delay}ms before retry` });
      yield* sleep(delay);
      delay *= 2;
    }
  }
}
```

```js
const retryFailCountInput = Inputs.range([0, 4], {
  step: 1,
  value: 2,
  label: "Fail first N attempts",
});
const retryBaseMsInput = Inputs.range([25, 300], {
  step: 25,
  value: 75,
  label: "Base backoff (ms)",
});
const retryRunInput = Inputs.button("Run Retry Demo", { value: 0, reduce: (n) => n + 1 });

const retryFailCount = Generators.input(retryFailCountInput);
const retryBaseMs = Generators.input(retryBaseMsInput);
const retryRun = Generators.input(retryRunInput);
```

<div class="grid grid-cols-3">
  <div class="card">${retryFailCountInput}</div>
  <div class="card">${retryBaseMsInput}</div>
  <div class="card">${retryRunInput}</div>
</div>

```js
const retryRows = retryRun === 0
  ? [{ elapsed: "—", event: "Click 'Run Retry Demo' to start" }]
  : await (async () => {
      try {
        return await runToResult((function* () {
          const startTime = performance.now();
          let logs = [];
          let attempts = 0;

          const action = () => {
            attempts += 1;
            if (attempts <= retryFailCount) {
              return Promise.reject(new Error("transient failure"));
            }
            return Promise.resolve(`success`);
          };

          const value = yield* retryWithBackoff(action, 6, retryBaseMs, logs, startTime);
          const elapsed = Math.round(performance.now() - startTime);
          logs.push({ elapsed, event: `✓ ${value} on attempt ${attempts}` });
          return logs.map(r => ({ elapsed: formatElapsed(r.elapsed), event: r.event }));
        })());
      } catch (error) {
        return [{ elapsed: "—", event: `✗ ${error.message}` }];
      }
    })();
```

<div class="note">Run #${retryRun}</div>

```js
Inputs.table(retryRows, { layout: "auto" })
```

---

## 2) Timeout Wrapper

Race an operation against a timer. If the work takes too long, the timeout wins and the operation is cancelled.

**What to observe:** When work duration > timeout, the operation times out. When work duration < timeout, you see the result. The loser of the race is automatically cancelled.

```js echo
function* withTimeout(ms, operation, logs, startTime) {
  const timeout = Symbol("timeout");
  const result = yield* race([
    (function* () {
      const value = yield* operation;
      return { type: "value", value };
    })(),
    (function* () {
      yield* sleep(ms);
      const elapsed = Math.round(performance.now() - startTime);
      logs.push({ elapsed, event: `timeout fired at ${ms}ms` });
      return { type: "timeout" };
    })(),
  ]);

  if (result.type === "timeout") {
    throw new Error(`timed out after ${ms}ms`);
  }

  return result.value;
}
```

```js
const timeoutMsInput = Inputs.range([100, 1200], {
  step: 50,
  value: 400,
  label: "Timeout (ms)",
});
const workMsInput = Inputs.range([50, 1200], {
  step: 50,
  value: 650,
  label: "Work duration (ms)",
});
const timeoutRunInput = Inputs.button("Run Timeout Demo", { value: 0, reduce: (n) => n + 1 });

const timeoutMs = Generators.input(timeoutMsInput);
const workMs = Generators.input(workMsInput);
const timeoutRun = Generators.input(timeoutRunInput);
```

<div class="grid grid-cols-3">
  <div class="card">${timeoutMsInput}</div>
  <div class="card">${workMsInput}</div>
  <div class="card">${timeoutRunInput}</div>
</div>

```js
const timeoutRows = timeoutRun === 0
  ? [{ elapsed: "—", event: "Click 'Run Timeout Demo' to start" }]
  : await (async () => {
      try {
        return await runToResult((function* () {
          const startTime = performance.now();
          let logs = [];
          try {
            logs.push({ elapsed: 0, event: `work started (will take ${workMs}ms)` });
            logs.push({ elapsed: 0, event: `timeout set for ${timeoutMs}ms` });

            let value = yield* withTimeout(
              timeoutMs,
              (function* () {
                yield* sleep(workMs);
                const elapsed = Math.round(performance.now() - startTime);
                logs.push({ elapsed, event: "work completed" });
                return "done";
              })(),
              logs,
              startTime
            );

            const elapsed = Math.round(performance.now() - startTime);
            logs.push({ elapsed, event: `✓ result: ${value}` });
          } catch (error) {
            const elapsed = Math.round(performance.now() - startTime);
            logs.push({ elapsed, event: `✗ ${error.message}` });
          }

          return logs.map(r => ({ elapsed: formatElapsed(r.elapsed), event: r.event }));
        })());
      } catch (error) {
        return [{ elapsed: "—", event: `✗ ${error.message}` }];
      }
    })();
```

<div class="note">Run #${timeoutRun} — ${workMs > timeoutMs ? "work > timeout → will timeout" : "work < timeout → will complete"}</div>

```js
Inputs.table(timeoutRows, { layout: "auto" })
```

---

## 3) Resource Lifecycle (setup/cleanup)

Resources encapsulate setup and cleanup in one scope. The `finally` block runs when the resource is no longer needed — whether the operation succeeds, fails, or is cancelled.

**What to observe:** The connection is acquired, used, and released automatically. You don't need to remember to call `.close()`.

```js echo
function* useMockConnection(state, logs, startTime) {
  return yield* resource(function* (provide) {
    state.acquired += 1;
    const elapsed = Math.round(performance.now() - startTime);
    logs.push({ elapsed, event: "connection acquired" });

    const conn = {
      query(sql) {
        return Promise.resolve([{ sql, ok: true }]);
      },
    };

    try {
      yield* provide(conn);
    } finally {
      state.released += 1;
      const elapsed = Math.round(performance.now() - startTime);
      logs.push({ elapsed, event: "connection released (cleanup)" });
    }
  });
}
```

```js
const resourceRunInput = Inputs.button("Run Resource Demo", { value: 0, reduce: (n) => n + 1 });
const resourceRun = Generators.input(resourceRunInput);
```

<div class="card">${resourceRunInput}</div>

```js
const resourceRows = resourceRun === 0
  ? [{ elapsed: "—", event: "Click 'Run Resource Demo' to start" }]
  : await (async () => {
      try {
        return await runToResult((function* () {
          const startTime = performance.now();
          const logs = [];
          const state = { acquired: 0, released: 0 };

          logs.push({ elapsed: 0, event: "requesting connection..." });
          const conn = yield* useMockConnection(state, logs, startTime);

          const elapsed1 = Math.round(performance.now() - startTime);
          logs.push({ elapsed: elapsed1, event: "running query: SELECT 1" });

          const rows = yield* call(() => conn.query("SELECT 1"));

          const elapsed2 = Math.round(performance.now() - startTime);
          logs.push({ elapsed: elapsed2, event: `query returned: ${JSON.stringify(rows)}` });

          // Resource cleanup happens automatically when scope ends
          return logs;
        })());
      } catch (error) {
        return [{ elapsed: "—", event: `✗ ${error.message}` }];
      }
    })().then(logs => logs.map(r => ({ elapsed: formatElapsed(r.elapsed), event: r.event })));
```

<div class="note">Run #${resourceRun}</div>

```js
Inputs.table(resourceRows, { layout: "auto" })
```

---

## 4) Fan-out Work Concurrently

Run multiple operations in parallel and wait for all to complete. Total time equals the slowest task, not the sum of all tasks.

**What to observe:** The TOTAL time is approximately equal to the longest individual task. Tasks A, B, and C run concurrently, not sequentially.

```js echo
function* runTask(name, ms, logs, startTime) {
  const startElapsed = Math.round(performance.now() - startTime);
  logs.push({ elapsed: startElapsed, event: `${name} started (${ms}ms)` });
  yield* sleep(ms);
  const endElapsed = Math.round(performance.now() - startTime);
  logs.push({ elapsed: endElapsed, event: `${name} completed` });
  return { name, ms };
}

function* fanOutWork(msA, msB, msC, logs, startTime) {
  return yield* all([
    runTask("A", msA, logs, startTime),
    runTask("B", msB, logs, startTime),
    runTask("C", msC, logs, startTime),
  ]);
}
```

```js
const fanAInput = Inputs.range([50, 800], { step: 50, value: 250, label: "Task A (ms)" });
const fanBInput = Inputs.range([50, 800], { step: 50, value: 500, label: "Task B (ms)" });
const fanCInput = Inputs.range([50, 800], { step: 50, value: 350, label: "Task C (ms)" });
const fanRunInput = Inputs.button("Run Fan-out Demo", { value: 0, reduce: (n) => n + 1 });

const fanA = Generators.input(fanAInput);
const fanB = Generators.input(fanBInput);
const fanC = Generators.input(fanCInput);
const fanRun = Generators.input(fanRunInput);
```

<div class="grid grid-cols-4">
  <div class="card">${fanAInput}</div>
  <div class="card">${fanBInput}</div>
  <div class="card">${fanCInput}</div>
  <div class="card">${fanRunInput}</div>
</div>

```js
const maxTask = Math.max(fanA, fanB, fanC);
const sumTasks = fanA + fanB + fanC;
```

```js
const fanRows = fanRun === 0
  ? [{ elapsed: "—", event: "Click 'Run Fan-out Demo' to start" }]
  : await (async () => {
      try {
        return await runToResult((function* () {
          const startTime = performance.now();
          const logs = [];
          logs.push({ elapsed: 0, event: `starting 3 tasks in parallel...` });

          const results = yield* fanOutWork(fanA, fanB, fanC, logs, startTime);

          const elapsed = Math.round(performance.now() - startTime);
          logs.push({ elapsed, event: `✓ all tasks complete` });
          logs.push({ elapsed, event: `TOTAL: ${elapsed}ms (sequential would be ${sumTasks}ms)` });

          return logs.map(r => ({ elapsed: formatElapsed(r.elapsed), event: r.event }));
        })());
      } catch (error) {
        return [{ elapsed: "—", event: `✗ ${error.message}` }];
      }
    })();
```

<div class="note">Run #${fanRun} — max(${fanA}, ${fanB}, ${fanC}) = ${maxTask}ms expected</div>

```js
Inputs.table(fanRows, { layout: "auto" })
```

---

## 5) Cancellation-friendly Loop

Long-running loops can be cancelled cleanly. The `finally` block runs even when cancelled, ensuring cleanup happens.

**What to observe:** The heartbeat ticks until auto-stop, then "cleanup: heartbeat halted" appears. The `finally` block ran because Effection cancelled the loop.

```js echo
function* heartbeat(intervalMs, logs, startTime) {
  let tick = 0;
  try {
    while (true) {
      tick += 1;
      const elapsed = Math.round(performance.now() - startTime);
      logs.push({ elapsed, event: `tick ${tick}` });
      yield* sleep(intervalMs);
    }
  } finally {
    const elapsed = Math.round(performance.now() - startTime);
    logs.push({ elapsed, event: "cleanup: heartbeat halted" });
  }
}
```

```js
const beatIntervalInput = Inputs.range([50, 500], {
  step: 25,
  value: 125,
  label: "Tick interval (ms)",
});
const beatStopAfterInput = Inputs.range([200, 2000], {
  step: 100,
  value: 700,
  label: "Auto-stop after (ms)",
});
const beatRunInput = Inputs.button("Run Cancellation Demo", { value: 0, reduce: (n) => n + 1 });

const beatInterval = Generators.input(beatIntervalInput);
const beatStopAfter = Generators.input(beatStopAfterInput);
const beatRun = Generators.input(beatRunInput);
```

<div class="grid grid-cols-3">
  <div class="card">${beatIntervalInput}</div>
  <div class="card">${beatStopAfterInput}</div>
  <div class="card">${beatRunInput}</div>
</div>

```js
const expectedTicks = Math.floor(beatStopAfter / beatInterval);
```

```js
const cancelRows = beatRun === 0
  ? [{ elapsed: "—", event: "Click 'Run Cancellation Demo' to start" }]
  : await (async () => {
      try {
        return await runToResult((function* () {
          const startTime = performance.now();
          let logs = [];
          logs.push({ elapsed: 0, event: `heartbeat started, interval=${beatInterval}ms` });
          logs.push({ elapsed: 0, event: `will auto-stop after ${beatStopAfter}ms` });

          yield* race([
            heartbeat(beatInterval, logs, startTime),
            (function* () {
              yield* sleep(beatStopAfter);
              const elapsed = Math.round(performance.now() - startTime);
              logs.push({ elapsed, event: `stop signal sent` });
              return true;
            })(),
          ]);

          return logs.map(r => ({ elapsed: formatElapsed(r.elapsed), event: r.event }));
        })());
      } catch (error) {
        return [{ elapsed: "—", event: `✗ ${error.message}` }];
      }
    })();
```

<div class="note">Run #${beatRun} — expecting ~${expectedTicks} ticks before stop</div>

```js
Inputs.table(cancelRows, { layout: "auto" })
```

---

## Why Effection?

These patterns are possible with Promises, but Effection makes them **composable** and **predictable**:

| Pattern | Promise approach | Effection approach |
|---------|------------------|-------------------|
| Retry | Manual loop + catch | `yield*` composition |
| Timeout | `Promise.race` + manual cleanup | `race([...])` with auto-cancel |
| Resource | try/finally + remember to close | `resource()` guarantees cleanup |
| Fan-out | `Promise.all` | `all([...])` with cancellation |
| Cancel | AbortController + signal checking | Automatic via structured scope |

**Key insight:** When any operation is cancelled in Effection, all child operations are cancelled too, and all `finally` blocks run. This is "structured concurrency" — no orphaned operations, no leaked resources.
