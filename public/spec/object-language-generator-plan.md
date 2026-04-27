# Object-Language Generator Plan

This plan explains the deeper SupGen-style integration:

```text
generator lowered into the object language
```

It means the runtime should execute typed generator functions such as `gen_type` and `gen_term` instead of receiving a giant choice tree that JavaScript already expanded.

## Current Approach

Today the JS generator does most of the work:

```text
public/supgen-generic-search.js
  genTermItems(type, ctx, fuel)
    returns JS array of { term, source }

  makeChoice(label, items)
    renders nested &label_i{...} choices

  buildChecks(...)
    renders oracle checks

supVM_full.ts
  evaluates the completed program
```

The emitted program uses real labelled SUPs. But the grammar expansion happened before the runtime saw the program.

That means the runtime can prune candidate branches only after the JS generator has already produced the whole search shape.

Current summary:

```text
SupVM-evaluated search
JS-built generator
JS-decoded source
```

Target summary:

```text
SupVM-built search
SupVM-evaluated search
runtime-returned source/path
```

## Target Approach

Move the typed generator into the evaluated language:

```text
@gen_type(fuel, context) -> superposed Type
@gen_term(goal_type, context, fuel) -> superposed GeneratedTerm
@oracle(generated, examples) -> source/path if examples pass else erased
```

Then generation and evaluation are interleaved:

```text
gen_term emits head constructor
oracle starts applying/checking it
bad branches erase immediately
remaining generator branches keep unfolding
```

This is closer to the architecture shown in Victor Taelin's superposed lambda enumerator gist.

## Lessons From The Gists

Source references:

```text
https://gist.github.com/VictorTaelin/7c4c69a1f07b5c668be613f1032e7d4e
https://gist.github.com/VictorTaelin/fb798a5bd182f8c57dd302380f69777a
https://gist.github.com/VictorTaelin/5776ede998d0039ad1cc9b12fd96811c
```

### Superposed Lambda Enumerator

The important lesson is to enumerate term constructors directly, not binary strings or fully materialized source candidates.

For this repo, that means:

```text
bad:
  JS builds all term strings
  runtime tests finished strings

better:
  object language emits Lam/App/Var/If/Match constructors
  runtime can prune as soon as constructors are observable
```

The gist also emphasizes label forking for branching constructors. In this repo, that means every generated constructor with multiple generated children needs a deterministic label split.

### Optimal Linear Context Passing

The key lesson is that context handling is subtle.

Naively copying a context into both sides of a generated application duplicates work. Threading a context monadically can preserve linearity but accidentally sequentializes generation, delaying constructors and blocking early pruning.

For this repo:

- context values must be shareable under SUP labels
- generated branches must not accidentally reuse linear variables
- generated head constructors must appear before all children are fully generated
- list/helper contexts must support `self(tail)` without arbitrary recursion

### Datatype FFT And Fusion

The FFT gist is less directly about synthesis, but the relevant lesson is representation.

Runtime performance depends on data representations that can fuse. Opaque host operations and boxed object graphs block fusion.

For this repo:

- first-class generated terms should be compact constructors
- source and executable value should share labels
- primitive integers/lists should have predictable representations
- later compiled runtimes should consume the same structural IR

## Object-Language Data Model

Add object-language constructors for generator internals.

Types:

```text
Type =
  #TInt
  #TBool
  #TList{elem}
  #TFun{arg ret}
```

Contexts:

```text
Ctx =
  #CNil
  #CCons{name type value tail}
```

Generated terms:

```text
Generated =
  #Gen{type source value path}
```

Source AST:

```text
Source =
  #SVar{name}
  #SLitInt{value}
  #SLitBool{value}
  #SIf{cond yes no}
  #SPrim2{op left right}
  #SNil
  #SCons{head tail}
  #SMatchList{scrut nilName consName body}
  #SCall{name args}
  #SLam{name type body}
```

Runtime executable value:

```text
value
  actual SupVM lambda/list/int/bool term
```

Path:

```text
Path =
  #PNil
  #PCons{label index tail}
```

The `path` can replace today's JS-side `choice.items` decoding over time.

Obligations:

```text
Obligation =
  #NoOb
  #TypeEq{left right next}
  #Smaller{arg base next}
  #Ensure{predicate next}
```

The first useful obligation is `Smaller`, which enforces that recursive calls use `tail`, `ys`, or another statically smaller value.

## genType

Current JS:

```text
genType(spec, options) -> Type[]
```

Object-language target:

```text
@gen_type(goal fuel ctx) -> superposed Type
```

Example helper type hole:

```text
def aux = ?
```

Should lower to:

```text
@aux_type = @gen_type(target_context fuel)
@aux_body = @gen_term(@aux_type ctx fuel)
```

The selected type must constrain all later helper calls.

For first implementation, keep the universe small:

```text
Int -> Bool
Int -> Int -> Int
Int -> Int[] -> Int[]
Int[] -> Int[] -> Int[]
```

The difference is not the universe size. The difference is that the selected type is a first-class value shared by body generation and target generation.

Helper generation should look like:

```text
@gen_helper(name ctx fuel) =
  ! typ = @gen_type(ctx fuel)
  ! body = @gen_term(typ (@ctx_with_helper name typ ctx) fuel)
  #Helper{name typ body}
```

The selected `typ` must be the same one used by:

- helper body generation
- target body generation
- helper call validation
- source rendering
- path/debug output

## genTerm

Current JS:

```text
genTermItems(type, ctx, fuel) -> [{ term, source }]
```

Object-language target:

```text
@gen_term(goal_type ctx fuel label) -> superposed Generated
```

Generation cases:

```text
if fuel == 0:
  variables and literals only

otherwise choose:
  variable from ctx
  literal
  primitive op
  if expression
  helper call
  self(tail)
  list nil
  list cons
  list match
  lambda when goal is function type
```

Each generated alternative returns:

```text
#Gen{
  type: goal_type
  source: source_ast
  value: executable_term
  path: choice_path
}
```

Constructor emission rule:

```text
emit head constructor first
then recursively generate children
```

For example, `If` should expose `#SIf` and executable conditional before both child branches are fully normalized. This is the pruning-sensitive lesson from Taelin's enumerator.

## Structural Recursion

The object-language generator must enforce the same hard rule:

```text
self may only be called on tail or another statically smaller value
```

List target:

```text
@gen_list_rec(ret_type xs ctx fuel) =
  match xs:
    []:
      @gen_term(ret_type ctx fuel)
    x <> rest:
      let self = @target(rest)
      @gen_term(ret_type ctx+x+rest+self fuel)
```

Helper recursion:

```text
@gen_helper_rec(arg_type ret_type x xs ctx fuel) =
  match xs:
    []:
      @gen_term(ret_type ctx fuel)
    y <> ys:
      let self = @helper(x, ys)
      @gen_term(ret_type ctx+y+ys+self fuel)
```

This is how filter, sort, append, flatten, map, and folds should emerge from one grammar.

## Label Discipline

Labels must be generated structurally.

Bad:

```text
choice label depends on JS array position in a giant emitted tree
```

Good:

```text
label = fork(parent_label, constructor_site, child_index)
```

For binary/multi-field constructors:

```text
If(cond, yes, no)
  cond label = fork(L, 0)
  yes label  = fork(L, 1)
  no label   = fork(L, 2)

App(fun, arg)
  fun label = fork(L, 0)
  arg label = fork(L, 1)

Cons(head, tail)
  head label = fork(L, 0)
  tail label = fork(L, 1)
```

The superposed lambda enumerator gist explicitly calls out label forking for branching constructors. We need the same rule for our typed generator.

Same semantic decision must share the same label across:

- executable value
- source AST
- path
- helper type
- helper body
- target body
- debug vector

This replaces the current `@op` and `@op_id` mirror trick with one generated record whose fields collapse together.

## Context Splitting

For affine/linear term generation, context splitting matters.

Application-like generation:

```text
App(?f, ?x)
```

must avoid accidentally giving the same linear variable to both `?f` and `?x` inside the same universe.

For this repo's first-order SupGen subset, we can start simpler:

- allow unrestricted variables for integer/list synthesis
- track `self` as a restricted binding
- later add linear context discipline for higher-order/lambda synthesis

Do not prematurely build full linear context machinery unless higher-order proof search is active.

Avoid this generator shape:

```text
gen(children) returns pair(ctx, complete_term)
```

if it delays the parent constructor until all children finish. That is the sequentialization issue from the linear-context gist.

Prefer this shape:

```text
emit constructor
split/fork context for children
let children fill holes under distinct labels
```

## Oracle

Current oracle:

```text
λ{0:&{}; 1:next}(target(input) === expected)
```

Keep the erasure contract:

```text
failed branch -> &{}
successful branch -> generated source/path
```

Object-language oracle:

```text
@check(gen input expected next) =
  let got = (gen.value input)
  if got == expected:
    next
  else:
    *
```

Longer term:

```text
@oracle(gen examples ensures) -> gen.source
```

The generator should carry source along with value so the runtime can return a program directly, not just a JS-decoded vector.

## Migration Phases

### Phase 1: JS AST Discipline

Stop adding raw string generators.

Make all generated alternatives carry:

```text
typed AST
source AST
lowered SupVM term
choice metadata
```

This prepares both object-language lowering and WGPU compilation.

### Phase 2: Constructor Syntax

Ensure `supVM_full.ts` can parse and print the data constructors needed for:

```text
#TInt
#TList{...}
#Gen{...}
#SIf{...}
```

If parser support is too heavy, emit constructor functions as ordinary lambdas first.

The current runtime has internal constructor values. The question is mostly surface syntax, printing, and ergonomic generated-source support.

### Phase 3: In-SupVM Direct Expression Generator

Move the smallest case first:

```text
Int -> Int
```

Implement object-language generators for:

- integer literals
- variables
- `+ - * / %`
- `== <=`
- if

Keep JS oracle and decoding as fallback.

### Phase 4: In-SupVM Predicate Generator

Move `Int -> Bool` predicate generation:

- even predicate
- comparison predicate
- bounded divisor-loop predicate

This attacks the prime example and removes another JS-side special family.

### Phase 5: In-SupVM Structural List Generator

Move:

```text
Int[] -> Int[]
Int[][] -> Int[]
```

This is where filter, sort, append, and flatten should emerge from object-language `match` generation.

### Phase 6: First-Class Helper Type

Replace explicit JS variants with:

```text
aux_type = gen_type(...)
aux_body = gen_term(aux_type, ...)
target_body = gen_term(target_type, ctx + aux, ...)
```

This is the Taelin-demo direction: the helper type itself is generated and then used as the goal for body generation.

This phase should remove the current explicit JS branch pattern:

```text
if list target:
  use predicate variant or list-helper variant
```

and replace it with:

```text
aux_type = generated Type
target generation checks whether aux_type can be called in context
```

### Phase 7: Source Return Without JS Decode

Return source AST or source text from the runtime.

The UI should no longer need:

```text
decodeChoiceVector(vector)
```

It can still show the vector for debugging.

### Phase 8: Proof Layer

After examples find a candidate:

```text
synthesize candidate
try proof/finite stronger oracle
if proof fails, collapse next survivor
```

This is separate from the generator migration.

## Tests

Object-language generator tests:

- `gen_type` includes expected helper types.
- `gen_term(Int, ctx, fuel)` can produce `x + 1`.
- Direct expression search matches current JS generator for small depths.
- Predicate generator can find `p % 2 == 0`.
- Predicate generator can find bounded prime predicate.
- Structural list generator can find filter.
- Structural list generator can find insertion sort.
- Nested structural generator can find append/flatten.
- Source AST prints the same decoded program as current UI.

Parity tests:

```text
JS generator vector -> decoded source
object-language generator source -> same behavior on examples
SupVM fallback -> same oracle result
```

Label/context tests:

- same label selects same source and value branch
- sibling child labels do not collide
- helper type label is observed by helper body and target body
- `self(xs)` is rejected when `xs` is not smaller
- monadic context-passing version and direct constructor-emitting version produce same terms on tiny fuel, but direct version emits prunable constructors earlier

## Acceptance Criteria

Phase 1:

- generated terms are represented as typed AST before string lowering
- no new search family is implemented only as ad hoc strings

Phase 3:

- direct `Int -> Int` expression synthesis can be generated inside SupVM
- source/path is returned or reconstructable

Phase 5:

- filter/sort/flatten list-returning programs are generated by object-language structural recursion
- JS no longer pre-expands every list-returning branch

Phase 6:

- `def aux = ?` chooses a first-class helper type
- helper body and target call sites are constrained by that selected type

## Risks

- In-runtime generation can be slower before it becomes faster.
- Host-side deduplication is currently useful; object-language dedupe is harder.
- Source carrying can bloat runtime values.
- Label bugs can break correlation.
- Context splitting is subtle for higher-order programs.
- Full dependent typing is out of scope for early phases.

The correct implementation stance is incremental: make the object-language generator real for one small expression family, prove parity, then move structural recursion and helper type generation.
