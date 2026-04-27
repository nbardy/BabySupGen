# Full SupGen Theory And Technical Design

This document is the detailed technical map for a real SupGen-style implementation. It replaces ad hoc target-shape branches with one type-directed generator:

```text
gen_term(goal_type, context, fuel) -> SUP GeneratedTerm<goal_type>
```

The goal is not "sort only." The goal is a typed symbolic synthesizer that can handle functions such as:

```text
sort       : List<Int> -> List<Int>
maxS       : List<Int> -> Int
evens      : List<Int> -> List<Int>
subPrimes  : List<Int> -> List<Int>
flatten    : List<List<Int>> -> List<Int>
mul        : Nat -> Nat -> Nat
```

## Correct Mental Model

The system should not enumerate a flat candidate list.

It should build one superposed typed search graph:

```text
Type holes
Term holes
Helper holes
Recursive calls
Source terms
Runtime values
Proof obligations
```

All of these must be correlated by SUP labels.

```text
same label choice
=> same helper type
=> same helper body
=> same target body
=> same source output
=> same proofs
```

## Type System

The minimum useful type AST:

```text
Type =
  Int
  Nat
  Bool
  Unit
  List(Type)
  Pair(Type, Type)
  Fun(Type, Type)
```

Function types should be curried internally:

```text
Int -> List<Int> -> List<Int>
```

is:

```text
Fun(Int, Fun(List(Int), List(Int)))
```

Nested lists are not special cases:

```text
List(List(Int))
List(List(List(Nat)))
```

are regular applications of `List(Type)`.

## Term IR

The core term AST:

```text
Term =
  Var(name)
  Lam(name, type, body)
  App(fun, arg)
  Let(name, value, body)
  Match(scrutinee, cases)
  If(cond, then, else)
  Nil(element_type)
  Cons(head, tail)
  Pair(fst, snd)
  Fst(pair)
  Snd(pair)
  IntLit(value)
  NatZero
  NatSucc(value)
  BoolLit(value)
  Prim(name, args)
  RecCall(name, args)
  Hole(goal_type)
```

Primitives:

```text
Int:
  + - * / %

Bool:
  == <= < >= > and or not

List:
  [] <> match

Nat:
  succ pred add mul
```

Do not start with every primitive. The primitive set is a search bias, so it should be configurable.

The current implementation exposes this as two dialects:

```text
minimal
  keeps append, filter, fold, min, max, sort, isPrime out of the primitive set

library
  keeps the same runtime primitives, but orders common derived shapes early
```

In the minimal dialect, append and fold-like scans are synthesized as recursive helper programs. In the library dialect, the generator can reuse generic append/filter/fold-like shapes to reduce repeated search.

## Generated Value Representation

Every generated term should carry source and runtime value together:

```text
Generated<T> = {
  type: T
  source: SourceTerm
  value: RuntimeTerm
  size: Nat
  obligations: List<Obligation>
}
```

This prevents a common bug: the runtime branch and printed source branch diverge.

`source` and `value` must share SUP labels.

## Context

The generator runs with a typed context:

```text
Context = [
  x : Int,
  xs : List<Int>,
  aux : Int -> List<Int> -> List<Int>,
  sort : List<Int> -> List<Int>  // recursive self, when allowed
]
```

Context entries include metadata:

```text
Binding = {
  name
  type
  source
  value
  is_recursive
  structural_arg_index?
}
```

For recursive calls, `structural_arg_index` tells which argument must get smaller.

## Type Enumeration

Type generation is first-class:

```text
gen_type(fuel, bias) -> SUP Type
```

Small universe:

```text
Int
Nat
Bool
List<Int>
List<Nat>
List<List<Int>>
Int -> Int
Int -> Bool
Int -> List<Int> -> List<Int>
List<Int> -> Int
List<Int> -> List<Int>
```

Better universe:

```text
gen_type(depth):
  choose:
    Int
    Nat
    Bool
    List(gen_type(depth-1))
    Pair(gen_type(depth-1), gen_type(depth-1))
    Fun(gen_type(depth-1), gen_type(depth-1))
```

With bias:

```text
if target is List<A> -> List<A>:
  prefer helper A -> List<A> -> List<A>
  prefer helper A -> Bool
  prefer helper List<A> -> List<A>

if target is List<A> -> A:
  prefer helper A -> A -> A
  prefer helper A -> Bool
```

Victor's newer SupGen breakthrough is exactly this direction: generated types become values that can be used as the goal for generated terms.

## Term Enumeration

The central generator:

```text
gen_term(goal: Type, ctx: Context, fuel: Nat, mode: Mode) -> SUP Generated<goal>
```

Mode examples:

```text
normal
recursive_body
proof
predicate
```

General rules:

```text
gen_term(Int):
  choose:
    Int variable from context
    Int literal
    Prim(Int -> Int -> Int, gen_term(Int), gen_term(Int))
    If(gen_term(Bool), gen_term(Int), gen_term(Int))
    Match(list_var, nil_case: Int, cons_case: Int)
    RecCall if structurally valid

gen_term(Bool):
  choose:
    Bool variable from context
    equality/comparison over generated terms
    and/or/not
    predicate application

gen_term(List<A>):
  choose:
    [] : List<A>
    Cons(gen_term(A), gen_term(List<A>))
    list variable from context
    If(gen_term(Bool), gen_term(List<A>), gen_term(List<A>))
    Match(list_var, nil_case: List<A>, cons_case: List<A>)
    RecCall if structurally valid

gen_term(Fun(A, B)):
  create fresh x:A
  body = gen_term(B, ctx + x, fuel-1)
  return Lam(x, A, body)
```

Nested lists work naturally:

```text
gen_term(List<List<Int>>):
  []
  gen_term(List<Int>) <> gen_term(List<List<Int>>)
  ...
```

Flatten is just:

```text
goal: List<List<Int>> -> List<Int>
```

The generator can discover `append` as a helper or use it as a primitive.

## Structural Recursion

Unrestricted recursion must not be allowed.

For a recursive function:

```text
f(xs: List<A>) -> R
```

the recursive call:

```text
f(rest)
```

is valid only inside:

```text
match xs:
  [] -> ...
  x <> rest -> ...
```

For multiple arguments:

```text
insert(x: A, xs: List<A>) -> List<A>
```

the recursive call:

```text
insert(x, ys)
```

is valid inside:

```text
match xs:
  [] -> ...
  y <> ys -> ...
```

This makes recursive synthesis finite and prevents the runtime from wandering into nontermination.

## Helper Discovery

For:

```text
def aux = ?
def target(args...) -> Ret: ?
```

the system should do:

```text
aux_type = gen_type(type_fuel, bias_from_target)
aux_body = gen_term(aux_type, ctx, term_fuel)
target_body = gen_term(target_type, ctx + aux, term_fuel)
```

Important: `aux_type`, `aux_body`, and all uses of `aux` must share labels.

For sort, a good path is:

```text
aux_type = Int -> List<Int> -> List<Int>
aux_body = generic structural helper over xs
target_body = generic structural recursion using aux(x, self(rest))
```

For `maxS`, a good path is:

```text
aux_type = Int -> Int -> Int
aux_body = max
target_body = fold over list using aux(x*x, rec)
```

For evens:

```text
aux_type = Int -> Bool
aux_body = is_even
target_body = generic structural recursion using aux(x)
```

For sub-primes:

```text
aux_type = Int -> Bool
aux_body = is_prime
target_body = generic structural recursion using aux(x)
```

## SUP Encoding

Every `choose` is a labelled SUP:

```text
choose(label, [a, b, c])
```

lowers to:

```hvm
&label_0{a; &label_1{b; c}}
```

Label derivation:

```text
root
root.type
root.body
root.body.case_nil
root.body.case_cons
root.body.case_cons.head
root.body.case_cons.tail
```

Rules:

- independent choices get fresh labels
- correlated choices reuse labels
- source and value share labels
- type and body choices share labels where necessary
- helper definition and helper use share labels
- recursive call refers to the same chosen function, not a regenerated one

## Lowering To Runtime

The typed IR lowers to SupVM/HVM terms:

```text
Lam       -> λx.body
App       -> f(x)
If c a b  -> λ{0:b; 1:a}(c)
List      -> [] and <>
Match     -> λ{[]:nil; <>:cons}(xs)
Bool      -> 0/1
Int       -> raw number
```

A generated candidate should lower as:

```text
@value = ...
@source = ...
@main = oracle(@value, @source)
```

The current implementation returns a choice vector. The full implementation should return source terms directly, but still keep a compact path for debugging.

## Oracle

The oracle checks candidates.

Concrete example checks:

```text
target(input) == expected
```

Bounded generated checks:

```text
for xs in lists(values, max_len):
  predicate(target(xs), xs)
```

Semantic checks:

```text
sorted(sort(xs))
permutation(sort(xs), xs)
all(even, evens(xs))
subsequence(evens(xs), xs)
forall y in xs. isPrime(y) iff y in subPrimes(xs)
```

Proof obligations:

```text
forall xs. sorted(sort(xs))
forall xs. permutation(sort(xs), xs)
forall xs. allEven(evens(xs))
```

The practical staging:

1. user examples
2. generated bounded tests
3. semantic predicates on bounded domains
4. proof search/checking

## Proof Layer

There are two implementation strategies:

### Check After Synthesis

First find a candidate with examples and bounded tests.

Then prove:

```text
candidate satisfies property
```

If proof fails, ask for next collapse result.

### Proof-Guided Synthesis

Generate term and proof together:

```text
gen_term(goal)
gen_proof(property(term))
```

This is stronger but harder.

The first serious implementation should use check-after-synthesis.

## Example: Full Sort

Spec:

```text
def aux = ?
def sort(xs: List<Int>) -> List<Int>: ?

ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
```

Search:

```text
aux_type candidates:
  Int -> List<Int> -> List<Int>
  List<Int> -> List<Int>
  Int -> Bool

target candidates:
  match xs:
    [] -> []
    x <> rest -> aux(x, sort(rest))
```

Helper candidates:

```text
insert(x, xs):
  match xs:
    [] -> [x]
    y <> ys ->
      if x <= y then x <> xs
      else y <> insert(x, ys)
```

Oracle:

```text
examples
bounded list tests
sorted predicate
permutation/count predicate
proof obligations
```

## Example: Max Square

Spec:

```text
def aux = ?
def maxS(xs: List<Int>) -> Int: ?

assert maxS([3,1,2]) == 9
assert maxS([1,3,2]) == 9
assert maxS([5,-1,5,0]) == 25
```

Search:

```text
aux_type candidates:
  Int -> Int -> Int

target:
  match xs:
    [] -> 0
    x <> rest -> aux(x*x, maxS(rest))
```

Helper:

```text
aux(a,b) = max(a,b)
```

Important: without `[1,3,2]`, a wrong head-only program passes:

```text
case x <> rest:
  x * x
```

The oracle needs either stronger examples or a semantic property:

```text
maxS(xs) == max(map(square, xs))
```

## Example: Evens

Spec:

```text
def pred = ?
def evens(xs: List<Int>) -> List<Int>: ?

ensure all(pred, evens(xs))
ensure subsequence(evens(xs), xs)
ensure forall x in xs. pred(x) -> member(x, evens(xs))
```

Search:

```text
pred_type = Int -> Bool
pred_body = x % 2 == 0

evens(xs):
  match xs:
    [] -> []
    x <> rest ->
      if pred(x)
      then x <> evens(rest)
      else evens(rest)
```

## Example: Sub-Primes

Spec:

```text
def pred = ?
def subPrimes(xs: List<Int>) -> List<Int>: ?

ensure all(pred, subPrimes(xs))
ensure subsequence(subPrimes(xs), xs)
```

If `isPrime` is a primitive, this is filter synthesis.

If `isPrime` must be synthesized, the system needs:

```text
modulo
bounded divisor search
Nat recursion or range folds
```

This is a larger search than evens.

The active GenericSupGen path follows this second route. It does not expose `isPrime` as a primitive; it assembles the divisor helper from generated arithmetic expressions, generated comparisons, bounded numeric recursion, and conditionals.

## Mapping To Taelin Demo

Taelin demo:

```text
def aux = ?
def mul(x: Nat, y: Nat) -> Nat: ?

assert mul(2n,3n) == 6n
assert mul(3n,3n) == 9n
```

Required internal behavior:

```text
aux_type = gen_type(...)
aux_body = gen_term(aux_type)
mul_body = gen_term(Nat -> Nat -> Nat, ctx + aux)
oracle = examples
collapse survivor
```

A likely discovered helper:

```text
aux : List<Nat> -> Nat
aux = sum
mul(x,y) = aux([x repeated y times])
```

or:

```text
aux : Nat -> Nat -> Nat
aux = add
mul = repeated add
```

The important point is not which helper wins. The important point is that helper type is generated, then helper body is generated from that generated type, then target body uses it.

## Current Implementation Gap

Current active project:

```text
supVM_full.ts:
  runtime with SUP, lists, nats, ints, arithmetic, <=

tiny-supgen.js:
  spec parser, presets, old Nat fallback generator

supgen-generic-search.js:
  JS-side Type AST and genTerm
  direct expression search for small non-Nat targets
  Int[] -> Int fold-style recursion
  Int[] -> Int[] generic structural recursion with helper-type variants:
    Int -> Bool
    Int -> Int[] -> Int[]
  Int[][] -> Int[] generic nested structural recursion
  examples: integer sort, max-square, evens, sub-primes
```

Missing:

```text
generic gen_type
first-class Term AST
more generic aggregate-state generation
helper type SUP values, not just explicit variants
proof layer
general oracle DSL
in-runtime generator
```

## Implementation Plan

The next real implementation should be:

1. Add Type AST and parser:

```text
Int
Bool
Nat
List<T>
T -> U
```

2. Add Term AST separate from emitted SupVM strings.

3. Implement generic `genTerm(goal, ctx, fuel)` in JS first.

4. Support nested `List<T>`.

5. Lower generated Term AST to SupVM_full.

6. Add helper generation:

```text
genHelper(target_type, ctx, fuel)
```

7. Add oracle predicates:

```text
sorted
permutation
all
subsequence
member
```

8. Move generator into SupVM/HVM once semantics are correct.

The order matters. First make the type-directed generator correct in JS. Then move it into the VM for sharing and speed.
