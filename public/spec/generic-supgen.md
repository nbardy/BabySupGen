# Generic SupGen Search

This is the target shape for a generalized SupGen-style generator in this repo. The point is to search from typed structure, not to add one branch per benchmark target.

The generator exposes:

```js
buildGenericSupGenSearch(spec, { depth, dialect })
```

where `spec` is the parsed TinySupGen-style object:

```js
{
  target: { name, args: [{ name, type }], ret },
  helpers: [{ name }],
  assertions: [{ fn, args, expected }],
  ensures: ["sorted(sort(xs))"]
}
```

The return value follows the existing search contract: a BabySupVM `program`, a list of correlated `choices`, `mode: "choiceVector"`, and a `decodeChoiceVector(vector)` function that maps a surviving collapse vector back to source.

## Search Dialects

There are two explicit dialects now.

```text
minimal
  variables
  small constants
  arithmetic and boolean primitives
  if
  [] and <>
  match over lists
  helper calls
  recursive calls on structurally smaller values

library
  everything in minimal
  plus focused derived-library choices for common filter, insert, append, and aggregate shapes
```

The `library` dialect is not allowed to expose opaque algorithms such as `sort`, `isPrime`, `min`, or `max` as runtime primitives. Its extra choices are just branch-ordering and reusable generic shapes expressed in the same core language. The `minimal` dialect removes those focused shortcuts, so append/filter/insert-style programs must be reached through the generic term grammar.

## Type IR

The generator should parse surface strings into a small structural type IR:

```js
{ tag: "Int" }
{ tag: "Bool" }
{ tag: "List", of: Type }
{ tag: "Fun", from: Type, to: Type }
```

This is enough for the current examples: integers, predicates, flat lists, nested lists, reducers, insertion helpers, append helpers, and first-order helper functions. Type equality must be structural, not string-based.

`genType` owns the helper-hole universe. Given a target type and local constraints, it proposes helper signatures such as:

```text
Int -> Bool
Int -> Int -> Int
Int -> Int[] -> Int[]
Int[] -> Int[] -> Int[]
```

The helper universe is not target-specific. It is derived from available atoms, list depths, and structural recursion contexts.

## Term IR

Terms should be generated as typed IR nodes before rendering to BabySupVM:

```js
Var(name, type)
Lit(value, type)
Lam(arg, body)
App(fn, arg)
If(cond, yes, no)
ListNil(itemType)
ListCons(head, tail)
MatchList(scrutinee, nilCase, headName, tailName, consCase)
Prim(name, args, type)
SelfCall(args, type)
HelperCall(name, args, type)
Choice(label, items, type)
```

Rendering is a final step. This keeps type checking, recursion policy, choice labels, and source decoding independent from BabySupVM syntax strings.

## genType

`genType(goal, context, fuel)` enumerates well-typed helper signatures and local binder shapes. It should be small and deterministic:

1. Start from the target argument and return types.
2. Add base atoms reachable inside those types.
3. Add first-order functions over those atoms and their list forms.
4. Keep only signatures that can be called from the current structural recursion context.

For an `Int[] -> Int[]` target this naturally admits both `Int -> Bool` and `Int -> Int[] -> Int[]`, so the same structural generator can find filters and insertion sort.

For an `Int[][] -> Int[]` target it admits `Int[] -> Int[] -> Int[]`, which gives flatten an append-shaped helper without a flatten-specific top-level schema.

## genTerm

`genTerm(goalType, context, fuel)` enumerates typed terms:

- variables from context
- base literals and list literals
- primitive arithmetic and predicates
- helper calls whose result matches the goal
- structurally smaller self calls
- list construction and list matches
- choice nodes over all surviving alternatives

Every generated term carries a source explanation. The emitted BabySupVM program can return a choice vector, while the UI decodes the vector into readable source using the same term metadata.

## Primitive Boundary

The generator is intentionally not an unbounded universal synthesizer. It searches all programs that fit the current type, structural recursion policy, fuel limit, and primitive set.

The active generic path may use primitive atoms such as:

```text
integer literals
booleans
[]
<>
if / ternary selection
match over lists
structural recursion over a tail
+ - * / %
== <=
derived != < > >=
not / and / or / xor
bounded helper calls
```

It must not use opaque algorithm primitives such as:

```text
isPrime
min
max
sort
noFactorFrom
```

If a result prints something like `predAux`, `auxHigh`, `auxLow`, `insert`, or `append`, that name is just the decoded helper chosen by the search. Its body must also be present and built from the allowed atoms.

## Structural Recursion

Recursive generation is allowed only through a structural destructor. For a list target:

```text
match xs:
  case []:
    nilTerm
  case x <> rest:
    consTerm(self(rest), x, rest)
```

Nested lists use the same rule twice:

```text
match xss:
  case []:
    []
  case xs <> rest:
    append(xs, flatten(rest))
```

The recursive call must consume the tail or another statically smaller component. `genTerm` can reference `self(rest)` as a typed binding, but it should not synthesize arbitrary recursive calls.

The active `Int[] -> Int[]` and `Int[][] -> Int[]` paths now use this generic match grammar directly. Filter, insertion sort, append, and flatten are not selected as named top-level schemas. They emerge as surviving choices inside:

```text
match scrutinee:
  case []:
    genTerm(returnType, ctx)
  case head <> tail:
    genTerm(returnType, ctx + head + tail + self(tail))
```

Helper recursion uses the same rule:

```text
helper(x, xs):
  match xs:
    case []:
      genTerm(ret, ctx)
    case y <> ys:
      genTerm(ret, ctx + y + ys + helper(x, ys))
```

In `library` dialect, the implementation keeps branch-ordering hints for common well-typed structural terms, such as `x <> self(rest)`, `if pred(x) then x <> self(rest) else self(rest)`, and `helper(x, self(rest))`. These are ordering hints inside the generic grammar, not opaque primitives.

In `minimal` dialect, those focused shortcuts are disabled. The same shapes can still appear when `genTerm` builds them from variables, list constructors, helper calls, and recursive self calls, but they are not injected as first choices.

## Discovering Derived Functions

If `append` is not a base primitive, it is discovered as an ordinary helper:

```text
def append(xs: Int[], ys: Int[]) -> Int[]:
  match xs:
    case []:
      return ys
    case x <> rest:
      return x <> append(rest, ys)
```

If `filter` is not a base primitive, it is discovered as a recursive target or helper:

```text
def filter(xs: Int[]) -> Int[]:
  match xs:
    case []:
      return []
    case x <> rest:
      return if pred(x) then x <> filter(rest) else filter(rest)
```

If `fold` is not a base primitive, the current first-order system discovers concrete fold-like scans rather than a polymorphic higher-order `fold` combinator. For example, a max or sum search becomes:

```text
match xs:
  case []:
    base
  case x <> rest:
    combine(x, self(rest))
```

The `library` dialect can put these common shapes early in the search. The `minimal` dialect requires them to be assembled by the grammar.

## Helper Holes

A helper hole such as `def aux = ?` means:

1. `genType` chooses a helper signature.
2. `genTerm` generates a body for that signature.
3. Target generation can call the helper.
4. The helper type choice and helper body choices share stable labels with every use.

This is the SupGen-style part: a helper is not filled by committing early to one type. The emitted search contains all helper-type variants as correlated choices, and failed branches erase under the oracle.

## Oracle

The oracle is a chain of object-language checks:

```text
assert target(input) == expected
ensure sorted(target(xs))
ensure permutation(target(xs), xs)
```

Each check is rendered as:

```hvm
λ{0:&{}; 1:next}(check)
```

Failed branches reduce to `&{}`. Surviving branches return a choice vector. Collapse then selects one surviving program.

Ensures are finite test generators, not proofs. For example, `sorted` and `permutation` can add generated small-list checks; they do not prove correctness for every list.

## Why This Is SupGen-Style

This architecture uses typed generation, labelled superpositions, correlated helper choices, erasure of failed branches, and collapse of surviving branches. It searches a program space instead of selecting from a hand-written per-target candidate list.

It is not full HVM4 SupGen. The generator still runs on the JS side, the type system is small, effects and dependent types are absent, and recursion is restricted to structurally smaller calls. The BabySupVM program evaluates the superposed search, but it does not yet synthesize its own grammar internally.

## Limitations

- The search is finite and fuel-bounded.
- Generalization depends on the grammar and oracle quality.
- Ensures are compiled into finite checks.
- Only pure first-order terms are in scope.
- Nested data is supported only where structural list recursion and helper signatures can express it.
- Performance depends on avoiding duplicate terms before rendering choices.
- This does not run arbitrary HVM4 files.

## Current Non-Cheating Boundary

The generic path does not expose `isPrime`, `min`, or `max` as opaque runtime primitives.

Prime-like predicates are generated from:

```text
%
<=
+
structural recursion over a divisor counter
```

The divisor scan itself is assembled from independent generated choices:

```text
def predAux(d: Int, n: Int) -> Bool:
  return if d * d <= n then (if n % d == 0 then false else predAux(d + 1, n)) else true
```

`predAux` is not supplied as a primitive. The bounded `Int -> Int -> Bool` helper grammar chooses each slot from generated expressions. For the prime example, the surviving branch is:

```text
guard: d * d <= n
test: n % d == 0
hit: false
next counter: d + 1
carried argument: n
done: true
```

Here `d * d`, `n % d`, `d + 1`, and the comparisons are generated from the primitive expression grammar.

The schema is bounded for two reasons:

1. The expression grammar has a finite fuel limit, so `val`, `val op val`, and nested arithmetic trees do not expand forever.
2. Recursive helpers must follow a terminating loop shape. For numeric loops, the counter advances and the carried bound stays invariant.

Without those bounds the search space is infinite and the runtime can spend all its time on nonterminating branches before reaching a valid program.

The intended generic shape is:

```text
val := variable | literal | val op val
cmp := val == val | val <= val | derived < > >= !=
bool := cmp | not bool | bool and/or/xor bool
loop := if bool then (if bool then hit else self(next, bound)) else done
```

The current implementation has this shape for small integer expressions, bounded numeric predicate loops, and generic structural list recursion. It does not claim to enumerate all integer programs, only all programs inside the current fuel-bounded grammar and structural recursion policy.

Ordered high/low reducers are generated as ordinary `Int -> Int -> Int` helpers using conditionals over `<=`, for example:

```text
if a <= b then b else a
if a <= b then a else b
```

Those are still grammar choices, not proofs. The system can only find programs expressible inside the bounded typed grammar.

## Example Specs

Minimum even integer:

```text
def pred = ?
def minEven(xs: Int[]) -> Int: ?

assert minEven([5,4,8,3]) == 4
assert minEven([9,2,6]) == 2
assert minEven([7,11,14]) == 14
ensure selects(xs, minEven(xs))
ensure pred(minEven(xs))
```

Max square minus minimum:

```text
def aux = ?
def score(xs: Int[]) -> Int: ?

assert score([3,1,2]) == 8
assert score([1,3,2]) == 8
assert score([5,-1,5,0]) == 26
assert score([2,1]) == 3
ensure aggregate(xs)
```

Sort:

```text
def insert = ?
def sort(xs: Int[]) -> Int[]: ?

assert sort([3,1,2]) == [1,2,3]
assert sort([5,-1,5,0]) == [-1,0,5,5]
assert sort([2,1]) == [1,2]
ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
```

Filter primes:

```text
def pred = ?
def primes(xs: Int[]) -> Int[]: ?

assert primes([1,2,3,4,5,6,7,8,9,10,11]) == [2,3,5,7,11]
assert primes([-1,0,1,2,4,13]) == [2,13]
assert primes([8,9,10,12]) == []
```

Nested list flatten:

```text
def append = ?
def flatten(xss: Int[][]) -> Int[]: ?

assert flatten([[1,2],[3],[]]) == [1,2,3]
assert flatten([[],[-1,0],[5]]) == [-1,0,5]
assert flatten([]) == []
ensure concat_order(flatten(xss), xss)
```
