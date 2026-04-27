# WGPU Runtime Plan

This plan builds a fast compiled runtime for the finite generated-search subset. It is not a full HVM evaluator and not a replacement for `supVM_full.ts` as the semantic oracle.

The user-facing goal is SIMD-like execution through JIT-compiled tight loops, typed arrays, lookup tables, and WebGPU kernels.

```text
GenericSupGen search object
  -> typed compiled search IR
  -> CPU typed-array evaluator
  -> WebGPU evaluator
  -> same choice vector and decoded source
```

## Current Status

The UI now has a real `WebGPU/FastSearch` route for `Run Search`. Scalar direct candidate searches can execute inside a browser WebGPU compute kernel. Recursive structural searches are still compiled CPU plans, not recursive GPU kernels yet.

Implemented:

- `public/compiled-search-runtime.js`
- generated search `variantPlans`
- TinySupGen scalar direct candidate metadata
- direct-expression, list-to-list helper, predicate-filter, list-to-int filtered/state, and nested-list evaluators
- same `[choice,...]` vector output as the BabySupVM oracle for structural searches
- same candidate-id output as the older TinySupGen fallback for scalar direct searches
- real WebGPU direct-candidate kernel for scalar `Int` / `Nat` / `Bool` expression candidates
- WebGPU availability probe and CPU fallback in the selected route

Still future work:

- typed-array lowering for recursive structural plans
- WGSL kernels for recursive/list-output plans
- GPU alive-bitset pruning for choice-vector recursive searches
- CPU/GPU survivor-count parity tests across the larger preset matrix
- advanced interaction-net sharing

So the selector is no longer a dead stub. It runs scalar direct candidate searches on WebGPU when the browser supports it, falls back to the compiled CPU direct evaluator when it cannot, and still runs recursive generated searches in the compiled CPU evaluator.

## Why This Is Not Full HVM

The current SupVM runtime supports lambdas, applications, constructors, matches, SUPs, erasers, arithmetic, equality, and collapse. A full GPU implementation of arbitrary lazy higher-order SUP evaluation is a much harder project.

The WGPU lane should target the generated SupGen subset:

- finite choice vectors
- first-order generated helper bodies
- integer arithmetic and predicates
- finite assertions and ensures
- structural recursion over concrete input lists
- bounded numeric helper loops

Unsupported programs fall back to `supVM_full.ts`.

## Target Architecture

```text
buildGenericSupGenSearch(spec)
  returns:
    choices
    assertions
    decodeChoiceVector
    compiledPlan?   <- new internal data
    program         <- existing SupVM fallback

compiledPlan
  choice dimensions
  typed expression DAGs
  function bodies
  assertion DAGs
  list bounds
  runtime support requirements

runtime router
  if compiledPlan supported:
    run CPU typed-array or WebGPU
  else:
    run SupVM fallback
```

The important design choice is to compile choices as dimensions, not as nested `&label{...}` syntax.

## Compiled Search IR

The compiled IR should be built before rendering strings.

```ts
type SearchPlan = {
  kind: "direct" | "listToInt" | "listToList" | "nestedListToList";
  choices: ChoiceDim[];
  functions: FnPlan[];
  assertions: AssertionPlan[];
  ensures: EnsurePlan[];
  valueBounds: Bounds;
  decode: DecodePlan;
};

type ChoiceDim = {
  id: number;
  label: string;
  name: string;
  arity: number;
};

type Expr =
  | { tag: "IntLit"; value: number }
  | { tag: "BoolLit"; value: 0 | 1 }
  | { tag: "Var"; slot: number }
  | { tag: "Choice"; choice: number; alternatives: Expr[] }
  | { tag: "Add" | "Sub" | "Mul" | "Div" | "Mod"; left: Expr; right: Expr }
  | { tag: "Eq" | "Leq"; left: Expr; right: Expr }
  | { tag: "If"; cond: Expr; yes: Expr; no: Expr }
  | { tag: "Call"; fn: number; args: Expr[] }
  | { tag: "ListNil" }
  | { tag: "ListCons"; head: Expr; tail: Expr }
  | { tag: "SelfTail"; fn: number };
```

For the GPU path, expression DAGs should be normalized into SSA instructions:

```ts
type Instr =
  | { op: "load_i32"; dst: Reg; source: InputSlot }
  | { op: "choice"; dst: Reg; choice: ChoiceId }
  | { op: "select_alt"; dst: Reg; choice: ChoiceId; table: InstrRange[] }
  | { op: "add_i32" | "mul_i32" | "mod_i32"; dst: Reg; a: Reg; b: Reg }
  | { op: "leq_i32" | "eq_i32"; dst: Reg; a: Reg; b: Reg }
  | { op: "if_i32"; dst: Reg; cond: Reg; yes: Reg; no: Reg };
```

Concrete `FastSearchIR` tables:

```text
types[]
  Int
  Bool
  List<Int>
  List<List<Int>>

labels[]
  stable choice labels

choices[]
  label_id
  option_count
  option_node_start

nodes[]
  opcode
  type_id
  arg0
  arg1
  arg2
  immediate

stages[]
  target_eval
  helper_eval
  predicate_eval
  assertion
  ensure
  collapse

tests[]
  input_id
  expected_id
  check_kind

decode_map[]
  label_id
  choice metadata index
```

Important opcodes:

```text
CONST_INT
ARG_INT
ARG_LIST
SELF_REST
HELPER_CALL
PRED_CALL
ADD
SUB
MUL
DIV
MOD
EQ
LE
IF
NIL
CONS
LIST_LEN
LIST_EQ
SORTED
COUNT_VALUE
STATE_SCAN
ERASE_IF_FALSE
```

## Candidate Space

Each choice group is a mixed-radix dimension.

```text
choiceArity[i] = number of alternatives in choice i
prefix[i] = product(choiceArity[0..i-1])
candidateCount = product(choiceArity)
choiceIndex(candidate, i) = floor(candidate / prefix[i]) % choiceArity[i]
```

This maps directly to GPU lanes:

```text
global_id = candidate id
choice vector = decode mixed-radix id
alive = all assertions pass
```

Collapse `-Ck` becomes:

```text
alive[candidate] = 1 or 0
rank = prefix_sum(alive)
winner = first candidate where rank == k
choiceVector = mixed_radix_decode(winner)
```

This preserves the current UI model if the candidate ordering is matched to the existing nested choice ordering.

## Memory Layout

Use struct-of-arrays buffers.

```text
choiceArity: u32[numChoices]
choicePrefix: u32[numChoices]
alive: u32[numCandidates]
rank: u32[numCandidates]
winner: atomic<u32>
choiceVectorOut: u32[numChoices]

inputOffsets: u32[numAssertions]
inputLengths: u32[numAssertions]
inputValues: i32[totalInputItems]
expectedOffsets: u32[numAssertions]
expectedLengths: u32[numAssertions]
expectedValues: i32[totalExpectedItems]

tempI32: i32[numCandidates * tempCount]
tempBool: u32[numCandidates * tempBoolCount]
tempListLen: u32[numCandidates * listTempCount]
tempListValues: i32[numCandidates * listTempCount * maxListLen]
```

For first implementation, prefer fixed list capacity:

```text
maxListLen = max input/expected length plus generated-growth allowance
```

If a candidate exceeds capacity, mark it failed or route the spec to fallback.

For very large search spaces, use a survivor list:

```text
candidate_ids: u32[N]
alive: u32[N]
survivors: u32[M]
```

After each assertion, compact survivors so later assertions do not evaluate already-dead candidates.

## Kernel Stages

### Stage 1: Candidate Evaluation

One lane per candidate, or one lane per `(candidate, assertion)` pair.

```text
for assertion in assertions:
  if alive:
    got = eval_target(candidate, input)
    alive &= equal(got, expected)
```

This replaces object-language erasure with a boolean survivor mask.

### Stage 2: Structural Recursion

Compile recursive list functions to loops.

For `Int[] -> Int`:

```text
acc = nil_value
for i from len-1 down to 0:
  x = xs[i]
  acc = cons_body(x, acc)
return acc
```

For filter:

```text
out = []
for i from 0 to len-1:
  x = xs[i]
  if pred(x):
    push(out, x)
```

For insertion sort:

```text
out = []
for x in reverse(xs):
  out = insert(x, out)
```

For flatten:

```text
out = []
for row in xss:
  append row to out
```

These loops preserve the decoded structural programs but avoid lambda/match overhead.

### Stage 3: Predicate And Numeric Loops

Prime-like predicates compile to bounded loops:

```text
d = start
while guard(d, n) and iter < maxIter:
  if test(d, n):
    return hit
  d = step(d)
return done
```

The generated choices still decide:

- guard
- test
- hit value
- step expression
- carried argument
- done value

The loop body is compiled once and parameterized by the choice vector.

Modulo and division must match SupVM exactly, including:

```text
division by zero
modulo by zero
negative values
```

These semantics need golden tests before GPU implementation.

### Stage 4: Collapse Selection

Use parallel prefix sum or chunked CPU reduction:

```text
alive -> rank
winner = first candidate with rank == collapse
choiceVectorOut = decode(winner)
```

For early versions, CPU can read back the alive bitset and find the winner. Later versions keep selection on GPU.

### Stage 5: Debug Trace

Debug builds should optionally return:

```text
survivors_after_each_check
first_dead_check for winner-near candidates
choice vector for first N survivors
```

This is essential because GPU failures are otherwise opaque.

## Handling Current Presets

Direct expression:

- easiest target
- scalar input/output
- no lists
- good first parity test

Minimum even:

- `Int[] -> Int`
- predicate helper plus scalar scan
- useful for `%` and sentinel behavior

Max square minus min:

- aggregate scan
- two scalar state values
- exposes current biased aggregate-state generator

Sort:

- `Int[] -> Int[]`
- list helper recursion
- finite sorted/permutation ensures
- good list-output test

Filter primes:

- predicate helper with numeric loop
- expensive branch divergence
- primary benchmark for loop compilation and memoization

Nested flatten:

- `Int[][] -> Int[]`
- append helper
- good nested input layout test

## CPU Typed-Array Stepping Stone

Do not jump directly to WGSL.

Build a CPU typed-array evaluator first:

```text
compiledPlan -> runCpuPlan(plan, options) -> RunResult
```

Benefits:

- easier debugging
- exact parity tests
- same data layout as GPU
- no shader compile overhead
- useful on browsers without WebGPU

Then lower the same plan to WGSL.

## WebGPU Pipeline Cache

Shader compilation can dominate small runs.

Cache by:

```text
plan kind
choice arities
instruction op sequence
list bounds
assertion shapes
target return type
```

Do not cache by source text alone. Normalize the plan first.

Cache levels:

- in-memory per page session
- optional IndexedDB cache for browser
- optional filesystem cache for server-side WGPU

## Browser Versus Server Deployment

Browser WebGPU:

- best for local interactive UI
- no server process needed after page load
- requires WebGPU availability
- needs Web Worker to avoid blocking UI

Server WGPU:

- can run from Node with GPU bindings if available
- easier to benchmark
- harder to guarantee on every machine

CPU typed-array:

- universal fallback
- same compiled plan
- likely enough for many current examples

Recommended routing:

```text
try browser WebGPU
else try browser CPU typed-array worker
else server current SupVM
```

Server config:

```text
SUPGEN_FAST_RUNTIME=supvm
SUPGEN_FAST_RUNTIME=cpu
SUPGEN_FAST_RUNTIME=webgpu
```

Browser config:

```text
runtime=auto
runtime=cpu
runtime=webgpu
runtime=supvm-server
```

## Parity Tests

Every optimized runtime must match SupVM fallback.

Required parity cases:

- same `choiceVector`
- same decoded source
- same no-solution behavior
- same collapse rank for `-C1`, `-C2`, and later survivors where available
- same timeout/budget status category

Use test matrix:

```text
runtime = supvm | cpu-plan | webgpu-plan
preset = half | minEven | maxSquareMinusMin | sort | filterPrimes | nestedFlatten
collapse = 1 | 2 | 10
```

Additional invariants:

- mixed-radix order matches current `@op_id` order
- survivor counts after each check match between CPU and WebGPU
- modulo/division semantics match SupVM
- list capacity overflow is reported as fallback, not false failure
- decoded source is unchanged for current presets

## Staged Milestones

1. Add compiled plan data to `buildGenericSupGenSearch` without changing emitted SupVM.
2. Add CPU typed-array evaluator for direct expressions.
3. Add CPU typed-array evaluator for `Int[] -> Int[]` filter.
4. Add CPU typed-array evaluator for list-helper sort.
5. Add sorted/permutation finite ensures.
6. Add prime predicate bounded-loop evaluator.
7. Add aggregate-state `Int[] -> Int`.
8. Add CPU typed-array evaluator for `Int[][] -> Int[]`.
9. Add browser worker runtime selection.
10. Add WebGPU direct expression kernel. Done for scalar direct candidate-id searches.
11. Add WebGPU scalar list kernel.
12. Add WebGPU list-output kernel.
13. Add WebGPU predicate-loop kernel.
14. Add GPU collapse prefix-sum.
15. Add pipeline cache and benchmark dashboard.

## Acceptance Criteria

CPU compiled runtime:

- matches SupVM vectors on all current presets
- is at least 5x faster than `supVM_full.ts` on `filterPrimes`
- has deterministic fallback for unsupported plans

WebGPU runtime:

- matches CPU compiled runtime
- handles at least 100k candidate lanes in one or more dispatches
- returns only winner, stats, and optional debug samples
- keeps browser UI responsive

Production routing:

- UI displays selected runtime
- runtime can be forced by query param or config
- unsupported features explain why fallback was used

## Risks

- GPU branch divergence can erase the benefit for prime predicates.
- Fixed list capacity can reject valid generated programs unless bounds are chosen carefully.
- Matching current collapse ordering can be subtle.
- Shader compile overhead can dominate small examples.
- WebGPU lacks recursion, so all recursion must be lowered to loops.
- This runtime only covers generated-search subset, not arbitrary SupVM programs.

The key discipline is to keep SupVM as truth while the compiled runtime earns coverage one shape at a time.
