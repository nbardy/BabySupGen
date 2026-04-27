# Synthesis UI

Attribution: the ideas behind this project come from Victor Taelin's SupGen, HVM, and interaction-net research. See:

```text
https://github.com/VictorTaelin
https://github.com/VictorTaelin#research
```

This UI is an independent browser prototype built from those ideas, not Victor's full implementation.

The default UI path is `BabySupGen` with `WebGPU/FastSearch` selected.

`BabySupGen` is the active typed generator. It lives in `public/supgen-generic-ir.js` and `public/supgen-generic-search.js`, builds typed IR first, lowers to BabySupVM, and decodes the surviving choice vector or candidate ID.

There are now two execution paths for the generated search:

```text
Browser Worker
  runs the rendered BabySupVM program

WebGPU/FastSearch
  runs supported generated searches through `public/compiled-search-runtime.js`
  returns either the same choice vector or the older candidate ID, depending on the generator
  runs scalar direct TinySupGen candidates through a real browser WebGPU kernel when available
  runs recursive generated searches through the compiled CPU evaluator for now
```

The BabySupGen panel has a dialect selector:

```text
Minimal core
  no focused filter/insert/append/aggregate shortcuts

Minimal + generic library
  same core language, but common generic derived shapes are ordered early
```

Use `Minimal core` when checking whether a result is assembled from the smallest primitive boundary. Use `Minimal + generic library` when you want the practical synthesizer to avoid rediscovering the same map/filter/fold/append-like patterns every run.

`TinySupGen` remains as the compatibility layer for older Nat and small-list presets inside the same UI flow. It is not HVM4, but it still emits labelled SUPs, erasers, and collapse-compatible candidate IDs when the generated search is not on the newer choice-vector path.

The UI section is now named `BabySupGen`, but the implementation entrypoint is still `buildTinySearch(...)` for compatibility with the older files.

## Default Flow

1. Choose a BabySupGen preset or edit the spec directly.
2. Keep `Runtime = WebGPU/FastSearch` for the fastest supported route.
3. Click `Generate` to inspect the generated BabySupVM search program.
4. Click `Run Search` to run the search and decode the survivor.
5. Read the `Found` panel for the decoded source and the raw runtime output.

The header `Run Search` button runs this same BabySupGen path. Manual BabySupVM source can still be run from the Program pane with `Run Program`, but raw BabySupVM source is not the default interaction anymore.

## Candidate IDs

The newer generic searches return choice vectors such as `[3,0,4,5,9,0]`. Older TinySupGen-compatible scalar searches return candidate IDs such as `4`. The UI maps both forms back to source.

## BabySupGen Flow

BabySupGen accepts specs like:

```text
def aux = ?
def score(xs: Int[]) -> Int: ?

assert score([3,1,2]) == 8
assert score([1,3,2]) == 8
assert score([5,-1,5,0]) == 26
assert score([2,1]) == 3
```

It also supports direct small `Int` expressions, `Int[] -> Int[]` filters/sorts, and `Int[][] -> Int[]` flattening.

The older TinySupGen fallback supports these target shapes:

- `Nat -> Nat`
- `Nat -> Nat -> Nat` for expression enumeration, with small depth
- `Nat[] -> Nat[]` for two-item list programs

It also supports one helper hole:

```text
def aux = ?
```

For that hole, it enumerates helper types from a small universe:

- `Nat -> Nat`
- `Nat -> Nat -> Nat`

Then it enumerates helper bodies and target bodies that call the helper. The generated BabySupVM program returns a candidate ID, and the UI maps that ID back to the discovered source.

## Generated Examples

`Nat increment` can find:

```text
def inc(x: Nat) -> Nat:
  1n+(x)
```

`Discover aux type` can find:

```text
def aux(h0: Nat) -> Nat:
  1n+(h0)

def inc(x: Nat) -> Nat:
  aux(x)
```

`Generate binary sort` can find a generated two-item binary sort expression, for example:

```text
def sort(xs: Nat[]) -> Nat[]:
  λ{0:[b,a]; 1:xs}(a === 0)
```

That expression is inside a generated two-item-list matcher, so it means: if the first item is `0`, keep the list; otherwise swap the two items.

`Recursive integer sort` is the first non-toy SortGen path. It accepts:

```text
def aux = ?
def sort(xs: Int[]) -> Int[]: ?

assert sort([3,1,2]) == [1,2,3]
assert sort([5,-1,5,0]) == [-1,0,5,5]
assert sort([2,1]) == [1,2]
ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
```

It emits recursive superposed definitions for `aux` and `sort`, plus object-language checks for sortedness and value counts over generated tests. The active path is the generic structural match grammar; insertion sort is not a named top-level schema. It can synthesize:

```text
def aux(x: Int, xs: Int[]) -> Int[]:
  match xs:
    case []:
      return [x]
    case y <> ys:
      return if x <= y then x <> xs else y <> aux(x, ys)

def sort(xs: Int[]) -> Int[]:
  match xs:
    case []:
      return []
    case x <> rest:
      return aux(x, sort(rest))
```

Unlike the older candidate-list panel, this uses SUP choices inside a type-directed recursive `Int[] -> Int[]` grammar, then returns the surviving structural choice vector. There is no active `buildIntSortSearch` special case in the current generator.

The active list-to-list generator searches generic structural recursion with helper-type variants:

```text
Int -> Bool
Int -> Int[] -> Int[]
```

That is why the same code path can discover both filters and insertion-style sorting. The old filter/sort-specific list-returning variants are no longer in the active top-level plan. In `Minimal + generic library` mode, common insert/filter branch bodies may be placed early in a generic choice list; in `Minimal core` mode they must be assembled from `if`, `<>`, helper calls, and structurally smaller recursion.

`Max square in list` uses the same generic recursive list synthesizer for an `Int[] -> Int` target:

```text
def aux = ?
def maxS(xs: Int[]) -> Int: ?

assert maxS([3,1,2]) == 9
assert maxS([1,3,2]) == 9
assert maxS([5,-1,5,0]) == 25
assert maxS([2,1]) == 4
```

It can synthesize:

```text
def maxS(xs: Int[]) -> Int:
  match xs:
    case []:
      return -1
    case x <> rest:
      return max(x * x, maxS(rest))
```

The extra `[1,3,2] => 9` example matters. Without it, the original three examples are under-specified because the first element is always the maximum. A trivial `x * x` head-only program passes them.

With a helper hole, the active search can also decode the helper:

```text
def aux(a: Int, b: Int) -> Int:
  return max(a, b)

def maxS(xs: Int[]) -> Int:
  match xs:
    case []:
      return -1
    case x <> rest:
      return aux(x * x, maxS(rest))
```

If the empty-list behavior matters, add an explicit assertion such as:

```text
assert maxS([]) == 0
```

## Filter Examples

`Minimum even integer` is an `Int[] -> Int` filtered fold:

```text
def pred = ?
def evens(xs: Int[]) -> Int: ?

assert evens([1,2,3,4]) == 2
assert evens([0,-1,5,6]) == 0
assert evens([1,3,5,88]) == 88
```

BabySupGen can synthesize:

```text
def pred(p: Int) -> Bool:
  return p % 2 == 0

def evens(xs: Int[]) -> Int:
  match xs:
    case []:
      return -1
    case x <> rest:
      return if pred(x) then (if evens(rest) == -1 then x else if x <= evens(rest) then x else evens(rest)) else evens(rest)
```

The sentinel `-1` is part of the discovered finite-domain behavior. A stronger real spec should also define the empty/no-match case explicitly.

`Filter even integers` uses the same generic `Int[] -> Int[]` structural recursion as sort, but the surviving helper type is `Int -> Bool`:

```text
def pred = ?
def evens(xs: Int[]) -> Int[]: ?

assert evens([1,2,3,4]) == [2,4]
assert evens([0,-1,5,6]) == [0,6]
assert evens([1,3,5]) == []
```

It can synthesize:

```text
def pred(x: Int) -> Bool:
  return x % 2 == 0

def evens(xs: Int[]) -> Int[]:
  match xs:
    case []:
      return []
    case x <> rest:
      return if pred(x) then x <> evens(rest) else evens(rest)
```

`Filter prime integers` uses the same generic structural recursion, but now synthesizes the divisibility predicate from lower arithmetic and recursion:

```text
def pred = ?
def subPrimes(xs: Int[]) -> Int[]: ?

assert subPrimes([1,2,3,4,5,6,7,8,9,10,11]) == [2,3,5,7,11]
assert subPrimes([-1,0,1,2,4,13]) == [2,13]
assert subPrimes([8,9,10,12]) == []
```

It can synthesize:

```text
def pred(p: Int) -> Bool:
  def predAux(d: Int, n: Int) -> Bool:
    return if d * d <= n then (if n % d == 0 then false else predAux(d + 1, n)) else true
  return if 2 <= p then predAux(2, p) else false

def subPrimes(xs: Int[]) -> Int[]:
  match xs:
    case []:
      return []
    case x <> rest:
      return if pred(x) then x <> subPrimes(rest) else subPrimes(rest)
```

`predAux` is not a primitive and is not a hidden library function. The generic search assembles it from separate bounded-loop choices: guard, divisor test, hit value, next counter, carried argument, and done value.

## What Counts As A Successful Search

A search succeeds when one generated branch passes all examples and finite ensures. If several branches pass, `Collapse = 1` returns the first surviving choice vector in breadth-first collapse order. Increase `Collapse` to inspect later survivors.

## Current Limitations

- BabySupGen generation lives in `public/supgen-generic-search.js`.
- TinySupGen fallback candidate generation lives in `public/tiny-supgen.js`.
- Examples are inserted as BabySupVM syntax, so invalid terms fail at runtime.
- BabySupGen and TinySupGen still use small fixed type and expression grammars.
- Recursive list synthesis is generic over the supported list-returning shapes `Int[] -> Int[]` and `Int[][] -> Int[]`.
- `Int[] -> Int` still has extra aggregate-state variants for multi-aggregate scores.
- The direct type-directed expression search covers small non-Nat targets.
- This project does not implement full dependent types or proof search.
- It does not prove generalization beyond the examples.

The next substantial step is moving more of the typed enumerator into BabySupVM itself, so the superposed program space is shared at expression-constructor level rather than emitted as a large whole-candidate choice.
