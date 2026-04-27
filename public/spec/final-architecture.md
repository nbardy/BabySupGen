# Final SupGen Architecture

This is the target architecture for a real SupGen-style system: not a candidate-list demo, and not a JavaScript loop that tests programs one by one. The system should synthesize programs by generating typed superposed terms inside the runtime, pruning them with examples and semantic constraints, and decoding a surviving program.

The target benchmark is not binary two-element sort. The target is a real integer-list sort.

## Core Claim

The right architecture is:

```text
typed spec
=> typed superposed type and term enumerator
=> interaction-net runtime reduction
=> semantic oracle pruning
=> collapse surviving program and helpers
=> decode to readable source
```

Examples are useful, but examples alone are not enough for a real integer sort. A finite example set can be satisfied by memorization. A serious sort task needs semantic constraints such as:

```text
sorted(sort(xs))
permutation(sort(xs), xs)
```

Examples should be used as fast pruning. Semantic predicates and proof obligations should be used to prevent fake solutions.

## User-Facing Spec

The frontend should accept code like:

```text
data List<A> = [] | A <> List<A>

def sort(xs: List<Int>) -> List<Int>: ?

assert sort([3,1,2]) == [1,2,3]
assert sort([5,-1,5,0]) == [-1,0,5,5]
ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
```

For helper discovery:

```text
def aux = ?
def sort(xs: List<Int>) -> List<Int>: ?

ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
```

The system should be allowed to discover:

```text
def insert(x: Int, xs: List<Int>) -> List<Int>
def sort(xs: List<Int>) -> List<Int>
```

or another correct sorting architecture.

## Required Components

### 1. Runtime Layer

The current UI does not need a new runtime for the examples we are running now. It uses `supVM_full.ts`, which is enough for the current typed searches.

The final large-scale system needs a real interaction-net/HVM-like runtime with:

- lambdas and applications
- constructors and pattern matching
- erasers
- duplicators
- labelled SUP nodes
- integers and integer comparison
- recursive functions or structurally recursive fixpoints
- source/value correlation
- collapse over surviving branches
- interaction counters and trace hooks

The runtime must evaluate one superposed graph, not a loop of separate candidate programs.

Current status:

```text
supVM_full.ts has SUPs, erasers, collapse, lists, nats, signed ints,
arithmetic, comparison, lambdas, matchers, and recursion.

It is not HVM4 and does not implement the full parallel interaction-net backend.
```

### 2. Core Typed IR

The search language should be small and pure:

```text
Type :=
  Int
  Bool
  Nat
  List Type
  Type -> Type

Term :=
  Var
  Lam
  App
  Let
  Match
  Cons
  Nil
  IntLit
  BoolLit
  If
  RecCall
  PrimOp
```

The IR must carry both executable value and source representation:

```text
Candidate<T> = {
  src : SourceTerm
  val : T
  proof? : optional evidence
}
```

Every SUP choice must correlate `src`, `val`, helper type, helper body, and final body.

### 3. Type Enumerator

The type enumerator generates possible hole types:

```text
gen_type(depth) : SUP Type
```

It should be biased, not random. For sorting, useful helper types include:

```text
Int -> List<Int> -> List<Int>
List<Int> -> List<Int>
List<Int> -> Int
Int -> Int -> Bool
```

The enumerator must support first-class type results, so a generated type can become the goal for another term enumeration:

```text
aux_type = gen_type(...)
aux_body = gen_term(aux_type, ...)
target_body = gen_term(List<Int> -> List<Int>, context + aux)
```

This is the key difference between old signature-guided synthesis and helper-discovery synthesis.

### 4. Typed Term Enumerator

The term enumerator should live inside the SUP runtime:

```text
gen_term(goal_type, context, fuel) : SUP Candidate<goal_type>
```

It must generate well-typed terms directly. Do not generate strings and parse them. Do not generate untyped junk and filter later.

For a goal `List<Int> -> List<Int>`, the enumerator emits choices like:

```text
λxs. xs
λxs. []
λxs. match xs with
  [] -> []
  x <> rest -> ...
```

For an `Int -> List<Int> -> List<Int>` helper, it emits choices like:

```text
λx,xs. match xs with
  [] -> [x]
  y <> ys ->
    if x <= y then x <> xs
    else y <> helper(x, ys)
```

The generator should emit head constructors early. That allows the oracle to reject impossible branches before the rest of the term is fully generated.

### 5. Structural Recursion Discipline

Full integer sort needs recursion. Unrestricted recursion destroys the search space. The final architecture should synthesize structurally recursive programs only:

```text
sort(xs):
  match xs:
    [] -> ...
    x <> rest -> ... sort(rest) ...
```

For helpers:

```text
insert(x, xs):
  match xs:
    [] -> ...
    y <> ys -> ... insert(x, ys) ...
```

The type checker should only expose recursive calls on structurally smaller arguments.

This keeps the search finite and prevents nontermination during candidate testing.

### 6. Superposed Grammar, Not Whole-Candidate Choice

The older TinySupGen fallback emits:

```text
@op = &a{whole_candidate_0; whole_candidate_1}
```

The final system should emit choices at every AST constructor:

```text
gen_list_fn(ctx, fuel) =
  &choice{
    λxs. xs;
    &choice{
      λxs. [];
      λxs. match xs with ...
    }
  }
```

Better:

```text
gen_term(goal, ctx, fuel) =
  choose constructor compatible with goal
  recursively generate child terms
```

That lets candidates share subterms, contexts, recursive structure, source rendering, and tests.

### 7. Label Discipline

Labels are not incidental. They are how one synthesized program remains coherent across all examples, source output, helper definitions, and proofs.

The generator needs deterministic label splitting:

```text
label
label.left
label.right
label.body
label.arg
label.helper_type
label.helper_body
```

Rules:

- same decision must use same label
- independent subterms must fork labels
- source and value must share labels
- helper type and helper body must remain correlated
- recursive calls must reuse the chosen helper definition, not re-enumerate it

Bad labels produce impossible hybrids where one test uses one program and another test uses a different program.

### 8. Oracle Layer

The oracle is where examples and semantic constraints prune the graph.

Example oracle:

```text
sort([3,1,2]) == [1,2,3]
```

Semantic oracle:

```text
sorted(sort(xs))
permutation(sort(xs), xs)
```

For practical speed, use a staged oracle:

1. concrete examples over small lists
2. bounded exhaustive tests over lists up to length N
3. symbolic predicates such as sorted/permutation
4. inductive proof obligations when possible

The semantic checks should also be written in the object language so they participate in SUP pruning.

### 9. Proof And Generalization Layer

For full sort, a found program should not be trusted just because it passes examples.

The final system should generate or check obligations:

```text
forall xs. sorted(sort(xs))
forall xs. permutation(sort(xs), xs)
```

There are two viable routes:

1. bounded search first, then proof search
2. refinement-guided synthesis where proof obligations prune during generation

Route 1 is easier:

```text
find candidate by examples and bounded tests
then synthesize/check proof
```

Route 2 is stronger:

```text
only generate terms that can satisfy refinements
```

### 10. Decoder

Collapse should return a compact choice path or source term:

```text
choice_path -> SourceTerm
```

The decoder must reconstruct:

- generated helper type
- helper body
- target body
- chosen recursion scheme
- proof artifacts, if present

Output should look like:

```text
def insert(x: Int, xs: List<Int>) -> List<Int>:
  match xs:
    case []:
      return [x]
    case y <> ys:
      if x <= y:
        return x <> xs
      else:
        return y <> insert(x, ys)

def sort(xs: List<Int>) -> List<Int>:
  match xs:
    case []:
      return []
    case x <> rest:
      return insert(x, sort(rest))
```

## Full Integer Sort Search Shape

The desired search should be able to discover insertion sort without being handed `insert`.

Spec:

```text
def aux = ?
def sort(xs: List<Int>) -> List<Int>: ?

assert sort([2,1]) == [1,2]
assert sort([3,1,2]) == [1,2,3]
assert sort([5,-1,5,0]) == [-1,0,5,5]
ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
```

Type enumeration should consider:

```text
aux : Int -> List<Int> -> List<Int>
aux : List<Int> -> List<Int>
aux : Int -> Int -> Bool
```

Term enumeration should discover:

```text
aux = insert
sort = match xs:
  [] -> []
  x <> rest -> aux(x, sort(rest))
```

Then `aux` synthesis should discover:

```text
insert(x, xs) =
  match xs:
    [] -> [x]
    y <> ys ->
      if x <= y then x <> xs
      else y <> insert(x, ys)
```

The important part is that `insert` is not a candidate listed by the user. It is a generated helper term whose type was generated first.

## Runtime Data Model

A useful internal representation:

```text
SearchState = {
  goal_type
  context
  recursion_context
  label_seed
  fuel
  constraints
}

Generated = {
  type
  source
  value
  size
  obligations
}
```

Core generator functions:

```text
gen_type(fuel) -> SUP Type
gen_term(goal_type, state) -> SUP Generated
gen_match(scrutinee, cases, state) -> SUP Generated
gen_rec_call(goal_type, state) -> SUP Generated
gen_helper(state) -> SUP HelperDef
```

Oracle functions:

```text
check_examples(candidate, examples) -> Bool/SUP
check_sorted(candidate) -> Bool/SUP
check_permutation(candidate) -> Bool/SUP
prove_obligation(candidate, obligation) -> Proof/SUP
```

## Performance Requirements

The architecture is only worthwhile if it keeps these properties:

- generation is typed
- generation emits constructors early
- choices are represented as SUPs, not arrays of strings
- evaluation is shared by interaction-net reduction
- failed branches erase as early as possible
- recursive calls are structurally bounded
- helper types are generated from a biased type grammar
- source and value are correlated by labels
- collapse does not materialize all candidates

## Current Implementation Gap

The current project has:

- `supVM_full.ts` subset runtime
- signed integer literals, `%`, arithmetic, equality, and numeric `<=`
- local UI and API runner
- GenericSupGen JS typed enumerator
- generated SupVM searches
- small helper type enumeration
- binary two-item list sort demo
- generic recursive ListGen for `Int[] -> Int` and `Int[] -> Int[]`
- insertion-sort structure discovered through the generic `Int[] -> Int[]` branch
- max-square-over-list discovered through the generic `Int[] -> Int` branch
- nested flatten discovered through the generic `Int[][] -> Int[]` branch
- `%`-based predicates and prime-like divisor loops assembled from bounded generated subchoices

The final architecture still needs:

- richer runtime primitives and/or derived frontend operators
- typed term enumerator inside SupVM/HVM
- first-class type enumeration inside the search graph
- broader semantic oracle predicates
- proof/generalization layer for universal sortedness/permutation
- decoder for generated helper definitions

## Non-Negotiable Design Rule

Do not build a bigger candidate-list demo.

The final system must generate the program space structurally:

```text
type-directed generator
=> superposed AST constructors
=> shared evaluation and pruning
```

Only that architecture can plausibly scale from toy binary sort to full integer-list sort.
