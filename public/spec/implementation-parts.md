# Implementation Parts

This project now has the right split for the current scope:

```text
UI spec -> typed generator/oracle -> SupVM_full runtime -> collapse result -> source decoder
```

We do not need a brand-new HVM just to synthesize and run the current examples. We do need the active `supVM_full.ts` runtime because the generator emits real SUP choices, recursive definitions, lists, signed integers, arithmetic, comparisons, and erasers.

A new HVM or a deeper interaction-net runtime becomes necessary when the generator itself moves into the object language and we want HVM-style parallel graph reduction over huge first-class type and term spaces.

## What Exists Now

Runtime:

```text
supVM_full.ts
  lambdas and applications
  top-level refs
  constructors for lists and unary nats
  raw signed ints
  + - * / % <= ===
  labelled SUP choices
  erasers
  collapse search
```

Server:

```text
server.mjs
  serves the UI
  POST /api/run
  runs supVM_full.ts by default
```

Generator:

```text
public/supgen-generic-ir.js
  Type IR: Int, Bool, List<T>, Fun<T,U>
  term/source metadata
  lower generated terms to SupVM strings

public/supgen-generic-search.js
  typed primitive expression generation
  direct expression search for small non-list targets
  List<Int> -> Int fold/filter/state recursion
  List<Int> -> List<Int> generic structural recursion
  List<List<Int>> -> List<Int> generic nested structural recursion
  bounded numeric helper loops for generated predicates
```

The `List<Int> -> List<Int>` branch is no longer a hard-coded integer-sort search and no longer selects named filter/sort schemas. It searches generic structural recursion with helper-type choices:

```text
Int -> Bool                  predicate helper available in cons case
Int -> List<Int> -> List<Int> structural helper over a smaller tail
```

That is why the same generator can find:

```text
sort       : Int[] -> Int[]
evens      : Int[] -> Int[]
subPrimes  : Int[] -> Int[]
```

The `List<Int> -> Int` branch can find fold-like programs such as:

```text
maxS(xs) = fold max over x*x
sum(xs)  = fold + over x
```

The predicate branch can now discover `%`-based predicates and assemble a bounded divisor loop from subchoices instead of using `isPrime` or a hidden `noFactorFrom` helper.

For list-returning targets, the active grammar is:

```text
match scrutinee:
  [] -> genTerm(returnType, ctx)
  head <> tail -> genTerm(returnType, ctx + head + tail + self(tail))
```

Helper recursion follows the same discipline:

```text
helper(x, xs):
  match xs:
    [] -> genTerm(ret, ctx)
    y <> ys -> genTerm(ret, ctx + y + ys + helper(x, ys))
```

The hard rule is that generated recursive calls must use `tail`, `ys`, or another statically smaller value. Branch-order hints put common structural terms early, but the active plan is still the generic match grammar.

## Required Parts For Full SupGen

These are the parts needed to get from examples to a program without hand-supplying candidate programs.

1. Runtime

```text
execute generated programs
preserve correlated SUP choices
erase failing branches
collapse surviving branches
print normal forms
```

Current status: implemented in `supVM_full.ts` for the subset we need.

2. Type Frontend

```text
parse def holes
parse concrete target signatures
represent helper type holes
normalize List<T>, T[], and function types
```

Current status: implemented for the active subset in `tiny-supgen.js`, `supgen-generic-ir.js`, and `supgen-generic-search.js`.

3. Type Generator

```text
genType(fuel, bias) -> SUP Type
```

This is the big Taelin-demo feature. A hole like:

```text
def aux = ?
```

must not mean "use a fixed aux shape." It must search possible helper types, then use the selected type as the goal for helper-body generation.

Current status: implemented as explicit helper-type variants for list recursion, not yet as first-class SUP type values.

4. Term Generator

```text
genTerm(goal_type, context, fuel) -> SUP GeneratedTerm
```

It must generate variables, literals, primitive applications, lambdas, applications, conditionals, list constructors, match expressions, structurally valid recursive calls, and helper calls.

Current status: implemented as a JS-side generator with typed terms emitted as SupVM strings.

5. Structural Recursion

Recursive synthesis needs termination discipline:

```text
match xs:
  [] -> ...
  x <> rest -> f(rest)
```

Allowed recursion is no longer "pick the filter schema" or "pick the sort schema" for list-returning targets. The generator picks a typed structural match and then fills each branch with `genTerm`.

Current status: generic structural recursion is active for `Int[] -> Int[]` and `Int[][] -> Int[]`. `Int[] -> Int` still has extra aggregate-state variants for multi-aggregate results such as `hi * hi - low`.

6. Oracle

The oracle turns the user spec into checks:

```text
target(input) == expected
```

It can also add bounded semantic checks:

```text
sorted(sort(xs))
permutation(sort(xs), xs)
all(pred, evens(xs))
subsequence(evens(xs), xs)
```

Current status: examples are active; generated sorted/permutation checks are active for the sort spec.

7. Decoder

The runtime returns a compact choice vector:

```text
[variant, choice0, choice1, ...]
```

The UI decodes it back into readable source.

Current status: active for BabySupGen choice-vector searches and the older FullSupGen fallback searches. Supported generated searches can now return the vector through `compiled-search-runtime.js` without running the rendered BabySupVM program.

8. Proof Layer

A full theorem-proving path needs proof search or proof checking after synthesis:

```text
synthesize candidate
prove candidate satisfies property
if proof fails, ask collapse for next survivor
```

Current status: not implemented.

9. Interaction-Net Backend

This is the future speed path:

```text
generated types as runtime values
generated terms as runtime values
SUP-labelled source/value/proof triples
parallel graph reduction
optimal sharing through DUP/ERA/SUP
```

Current status: not implemented here. The project uses a small interpreter that preserves SUP correlation, but it is not HVM4.

## Direct Answer

For the current UI:

```text
Need a new runtime?  Partly done. BabySupVM remains the semantic fallback; compiled-search-runtime.js is the fast generated-search lane.
Need a new HVM?      No, unless we want real HVM4-scale parallel search.
Need a new generator? Yes. That remains the main long-term work.
```

The correct next major build is:

```text
first-class genType
first-class Term AST
more generic aggregate-state generation
oracle predicates
proof-after-synthesis loop
then in-runtime/HVM lowering for speed
```
