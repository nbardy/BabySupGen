# Current Runtime Plan

This plan keeps the current TypeScript/BabySupVM lane and makes it reliable and fast enough for the active UI. It does not require WebGPU and it does not claim to be HVM4.

The goal is to turn the current interpreter into a practical search backend for the supported SupGen subset:

```text
BabySupGen spec
  -> generated BabySupVM program
  -> browser worker runtime API
  -> bounded collapse
  -> decoded choice vector
```

## Current Path

The browser runs BabySupVM directly today.

```text
public/app.js
  chooses Browser Worker, Server Fallback, or WebGPU/FastSearch

babysupvm-worker.js
  imports babysupvm-runtime.js
  evaluates source in a Web Worker

public/babysupvm-runtime.js
  parses source
  evaluates @main
  collapses one surviving branch
  returns structured JSON
```

`server.mjs` remains as a static file host and local fallback. The normal UI path no longer posts runs to `/api/run`.

The runtime selector is explicit:

```text
Browser Worker
  active default; runs BabySupVM in the browser

Server Fallback
  local Node child-process path; useful for comparing old behavior and hard SIGKILL timeouts

WebGPU/FastSearch
  active for generated BabySupGen `Run Search` calls when the search object exposes compiled variant metadata
  raw BabySupVM source is not run here
  scalar direct candidate searches execute through a browser WebGPU kernel when available
  current recursive searches execute through the compiled CPU structural evaluator
  real recursive GPU kernels are still future work
```

The compiled search path lives in `public/compiled-search-runtime.js`. It bypasses the rendered BabySupVM string for supported generated searches and evaluates the finite search object directly. Structural searches return the same `[choice,...]` vector shape, so the UI still decodes through `decodeChoiceVector(vector)`. Scalar direct TinySupGen searches return the older candidate ID shape so existing candidate formatting still works.

## Current Bottlenecks

- Browser worker startup per run: every UI click starts a new worker and loads the runtime module.
- Compatibility text protocol: the UI still keeps stdout-shaped output for old formatters.
- Object-heavy evaluator: terms, suspensions, values, environments, and choices are JS objects and `Map`s.
- Choice map copying: collapse forks by copying `Choices` maps.
- Repeated evaluation: examples and ensures repeatedly evaluate the same generated functions on the same inputs.
- No forced-suspension update: forced suspensions are not consistently replaced by their value in a way that avoids repeated work.
- Generic searches emit very large nested choice trees before evaluation begins.
- Prime-like predicates evaluate recursive numeric loops for many candidate branches and many list elements.

Observed current behavior:

```text
sort
  about 21k interactions
  completes quickly

filterPrimes
  about 38.9M interactions
  current wall time is in the tens of seconds depending on process, startup, and cache state

generated program size
  can reach hundreds of KB for generic searches
```

The important point is that the slow case is not the browser UI. It is repeated symbolic evaluation under a large choice space.

## Target Architecture

Keep the SupVM semantics, but split the runtime into a callable library plus a CLI wrapper and a worker-thread execution mode:

```text
supvm-core.ts
  parseProgram(source)
  compileProgram(book)
  runMain(compiled, options) -> RunResult
  collapse(job, options) -> CollapseResult

supVM_full.ts
  CLI wrapper around supvm-core.ts

server.mjs
  assigns runId
  sends work to worker thread or child process
  keeps parsed-program cache
  returns JSON runtime contract

public/app.js
  consumes structured result from browser worker first, server fallback second
```

The first implementation can still spawn the CLI. The important change is that the runtime returns structured data and exposes explicit budgets. After that, the server can choose worker-thread, in-process, or child-process execution.

Recommended execution modes:

```text
server-child
  safest runaway isolation
  slowest startup

server-worker
  good default after refactor
  supports cache reuse and cancellation

server-inprocess
  fastest local mode
  risky without hard cancellation

browser-worker
  useful later for offline demos
  should not be the first heavy-runtime target
```

## Decision 1: Structured Run And Collapse API

The runtime should stop treating stdout as the API.

```ts
type RunRequest = {
  source: string;
  collapse: number;
  stats?: boolean;
  budgets?: {
    maxMs?: number;
    maxInteractions?: number;
    maxForks?: number;
    maxLeaves?: number;
    maxStack?: number;
  };
};

type RunResult = {
  ok: boolean;
  valueText: string | null;
  choiceVector: number[] | null;
  candidateId: number | null;
  interactions: number;
  elapsedMs: number;
  collapse: {
    requested: number;
    foundRank: number | null;
    forksVisited: number;
    leavesVisited: number;
    exhausted: boolean;
  };
  timeout: boolean;
  limit: null | "time" | "interactions" | "forks" | "leaves" | "stack";
  error: string | null;
  stdout?: string;
  stderr?: string;
};
```

The CLI can keep text output, but add:

```text
node supVM_full.ts file.hvm -C1 --json
```

The UI should prefer `choiceVector` and `candidateId` fields. Regex over stdout becomes fallback only.

Server endpoints:

```text
POST /api/run
  compatibility endpoint

POST /api/run-json
  structured runtime result

GET /api/run/:runId
  status/progress for long runs

DELETE /api/run/:runId
  cancel long run
```

The current UI can keep `/api/run` while new UI code migrates to `/api/run-json`.

## Decision 2: Bounded Collapse As A First-Class Search

Collapse currently means "walk forked normal forms until the kth leaf is found." That should become an explicit search API with budgets.

Required counters:

- interactions
- forks visited
- leaves visited
- maximum queue length
- elapsed milliseconds
- current collapse rank

Required outcomes:

- found a surviving normal form
- exhausted all branches
- hit a budget
- runtime error

Why this matters:

- The UI can distinguish "no solution" from "timeout" from "budget too small."
- Long searches can report real progress.
- Benchmarks become stable.
- Later CPU/GPU runtimes can implement the same contract.

## Decision 3: Choice-Safe Sharing And Memoization

Memoization is the highest-value change inside the current runtime, but it must respect correlated choices.

A value computed under one choice assignment cannot be reused under an incompatible choice assignment.

### Choice Stamp

Create a canonical choice stamp:

```text
labelA=0,labelB=1,labelC=0
```

For performance, intern stamps:

```ts
type ChoiceStampId = number;
```

The runtime can derive a stamp from the current `Choices` map. Later it can use a persistent choice trie instead of copying maps.

Better long-term structure:

```ts
type ChoiceFrame = {
  parent: ChoiceFrame | null;
  labelId: number;
  pick: 0 | 1;
};

type EnvFrame = {
  parent: EnvFrame | null;
  keyId: number;
  value: Susp;
};
```

This replaces repeated `new Map(...)` cloning in hot lambda, let, and collapse paths.

### Cache Layers

1. Forced suspension cache

```text
SuspTerm(termId, envId, choiceStamp) -> Val
```

Use this where the same suspension is forced multiple times.

A stricter variant returns both value and dependencies:

```ts
type Forced = {
  value: Val;
  deps: Int32Array; // label ids observed while forcing
};
```

Then reuse is valid when the current choice context agrees with the cached dependency picks.

2. Reference call cache

```text
RefName + normalized concrete args + choiceStamp -> Val
```

This is especially useful for:

```text
@target([input])
@helper(x, rest)
@pred(p)
@predAux(d, n)
```

3. Equality cache

```text
equal(valueA, valueB, choiceStamp) -> Bool or SupBool
```

Many assertions compare list outputs repeatedly.

4. Numeric loop cache

```text
predicateLoopChoice + d + n -> Bool
```

Prime filtering benefits immediately because every list element calls the same generated predicate family.

5. Oracle target-output cache

```text
targetChoiceFingerprint + inputLiteral -> output
```

Ensures such as sortedness and permutation should bind `target(input)` once and reuse the output for every check.

### Safe Starting Rule

Only memoize calls when:

- the function name is top-level and pure
- all arguments are concrete normal forms or compact concrete values
- the choice stamp includes every label read during evaluation
- the result is immutable or copied before reuse

This starts conservative and avoids leaking a value from one branch to another.

## Decision 4: Hot Structural Loops

The current evaluator handles generated list recursion through general lambda, matcher, and suspension logic.

The active SupGen subset has predictable structural forms:

```text
Int[] -> Int
Int[] -> Int[]
Int[][] -> Int[]
Int -> Bool
Int -> Int[] -> Int[]
Int[] -> Int[] -> Int[]
```

Add an optional compiled path:

```text
recognized generated program
  -> compact structural evaluator
  -> same choice vector result
```

This is not a new language. It is a specialization for generated programs.

Examples:

- `predAux(d,n)` becomes a bounded while loop.
- `filter(xs)` becomes a for loop over packed input arrays.
- `sort(xs)` becomes generated insertion loops over fixed-size arrays.
- `score(xs)` becomes a scan over two scalar accumulators.

The general SupVM evaluator remains the oracle and fallback.

## Choice Tree Cleanup

The current generator lowers multiway choices into right-nested binary SUP syntax. That is semantically fine but not ideal for parsing, traversal, or diagnostics.

Short-term cleanup:

- keep `choices` as n-ary metadata in JS
- lower to binary SUP only at final render
- include explicit option order in the structured run result
- do not change collapse order without a test

Balanced binary lowering may improve depth but can change the order in which collapse finds survivors. If balanced lowering is used, the decoder must use explicit path metadata rather than assuming old left-to-right nesting.

## Browser Worker Versus Server

There are three execution modes worth supporting:

```text
server-child
  current safe mode
  slow startup
  killable

server-inprocess
  faster
  harder to interrupt safely
  good for trusted local specs

browser-worker
  no local server required after page load
  can run offline
  must avoid freezing UI
  needs bundling and no node fs/process usage
```

Recommended order:

1. Keep `server-child` and add JSON mode.
2. Add `server-inprocess` behind an env flag.
3. Refactor SupVM core so it can run in a Web Worker.
4. Let the UI choose runtime mode.

Heavy SupVM collapse should stay server-side until hard cancellation, memory limits, and worker isolation are solved. Browser workers are good earlier for building and decoding generated searches.

## Benchmarks

Create a benchmark script that uses the same presets as the UI:

```text
direct half
minEven
maxSquareMinusMin
sort
filterPrimes
nestedFlatten
```

For each run, record:

- generated program bytes
- number of choice groups
- choice group arities
- approximate candidate product
- assertion count
- generated ensure count
- interactions
- elapsed ms
- result vector
- decoded source hash

Output both human-readable and JSONL:

```text
bench/supgen-runtime-YYYYMMDD.jsonl
```

Baseline targets:

```text
sort
  should stay sub-second

filterPrimes
  should improve from tens-of-seconds scale

maxSquareMinusMin
  should expose aggregate-state performance
```

## Migration Steps

1. Add JSON CLI mode to `supVM_full.ts`.
2. Split `supVM_full.ts` into core module plus CLI wrapper.
3. Add worker-thread runner behind a new server endpoint.
4. Update `/api/run` to return structured fields.
5. Add runtime budgets and better timeout reporting.
6. Add benchmark script and baseline JSONL.
7. Add parse cache by source hash.
8. Intern labels and variable names to numeric ids.
9. Replace choice-map cloning with persistent choice frames.
10. Replace env-map cloning with persistent env frames.
11. Add conservative call cache for concrete top-level calls.
12. Add forced suspension update/cache.
13. Add numeric predicate loop cache.
14. Share oracle target outputs inside generated checks.
15. Add optional server-inprocess runtime mode.
16. Add structural hot-loop evaluator for `Int[] -> Int`.
17. Add structural hot-loop evaluator for `Int[] -> Int[]`.
18. Add structural hot-loop evaluator for `Int[][] -> Int[]`.
19. Add browser worker build once runtime core no longer depends on Node-only APIs.

## Validation Tests

Use `supVM_full.ts` as the semantic oracle.

Required tests:

- Text CLI output stays compatible.
- JSON CLI output parses and reports the same normal form.
- `/api/run` returns structured result for old examples.
- `Collapse = 1` returns the same vector as before for all presets.
- `Collapse = 2` and later ranks match old collapse ordering where survivors exist.
- Memoized and non-memoized runs produce identical vectors and decoded programs.
- Budget-hit responses do not look like "no solution."
- Prime preset no longer fails under the default UI timeout.

## Acceptance Criteria

Phase 1 acceptance:

- UI never reports timeout as "No surviving choice vector."
- Every run result has structured `interactions`, `elapsedMs`, and `limit`.
- Existing smoke tests pass.
- Prime preset completes under default timeout on the current machine.

Phase 2 acceptance:

- Memoization can be toggled with an env flag.
- Memoized and baseline outputs match on all presets.
- Prime preset is at least 2x faster or has at least 50 percent fewer interactions-equivalent forced calls.

Phase 3 acceptance:

- Structural hot-loop runtime matches SupVM on the supported generated subset.
- Unsupported programs fall back automatically.
- The UI exposes which runtime answered the query.

## Risks

- Choice-sensitive caching can be unsound if the cache key omits a label.
- In-process execution can hang the server if interruption is not handled.
- Hot-loop recognition can drift from SupVM semantics.
- Faster collapse ordering must still match the UI decoder's choice vector order.
- Optimizing the current runtime too far can delay the deeper object-language generator work.

The pragmatic rule is: every optimized path must have a strict fallback to `supVM_full.ts` and a parity test against it.
