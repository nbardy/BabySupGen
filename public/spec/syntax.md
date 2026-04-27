# BabySupVM Subset Syntax

This UI runs the BabySupVM evaluator in a browser Web Worker by default. It is not a full HVM4 parser. It accepts a small HVM-like subset that is enough to express symbolic searches with binary superpositions, tests, erasers, lists, nats, signed ints, lambdas, and matchers.

## Program Shape

Every program is a list of top-level definitions. Evaluation starts at `@main`.

```hvm
@name = term
@main = term
```

Line comments start with `//`.

```hvm
// This is ignored.
@main = [1,2,3]
```

## Names

Names and labels must match:

```text
[A-Za-z_$][A-Za-z0-9_$]*
```

Examples:

```hvm
x
foo
$tmp
choice_0
```

## Terms

Variables:

```hvm
x
```

Top-level references:

```hvm
@foo
```

Raw numbers:

```hvm
0
42
-1
```

Unary natural numbers:

```hvm
0n
3n
2n+rest
```

Lists:

```hvm
[]
[1,2,3]
x <> xs
```

Lambdas:

```hvm
λx. x
λx,y. x
```

Function calls are postfix and curried:

```hvm
f(x)
f(x,y,z)
```

Parentheses group expressions:

```hvm
(λx.x)(7)
```

Lazy lets:

```hvm
!x = value; body
```

The parser also accepts `!&x = value; body` as a name-binding form, but explicit DUP syntax is not supported.

## Matchers

Matchers are lambdas over cases. Constructor fields are passed to the selected case body as function arguments.

Number matcher:

```hvm
λ{0: zero_case; 1: one_case}
```

Nat matcher:

```hvm
λ{0n: zero_case; 1n+: succ_case}
```

List matcher:

```hvm
λ{[]: nil_case; <>: cons_case}
```

Example:

```hvm
@head = λxs. λ{[]: 0; <>: λx,xs. x}(xs)
@main = @head([7,8])
```

This returns `7`.

## Superpositions

A superposition is a labelled binary choice:

```hvm
&label{left; right}
```

Commas are also accepted:

```hvm
&label{left, right}
```

Every occurrence of the same label shares the same branch decision during collapse. That correlation is what lets tests constrain a candidate consistently.

```hvm
@bit = &choice{0;1}
@main = [@bit, @bit]
```

The first surviving collapse branch is `[0,0]`; the second is `[1,1]`.

Captured SUP syntax is accepted and charged as interaction work:

```hvm
&label[x,y]{left; right}
```

The capture names are parsed for compatibility with the target file, but this runtime does not implement general explicit DUP machinery.

## Erasers

`&{}` is an erased or failed branch:

```hvm
@main = &{}
```

SupGen-style filters usually return `&{}` when a candidate fails a test.

## Equality

Structural equality returns `1` for equal and `0` for not equal:

```hvm
@main = [1,2] === [1,2]
```

Equality works over numbers, constructors, lists, nats, and variables. It does not prove extensional equality of functions. To test a candidate function, apply it to examples and compare outputs.

Numeric less-than-or-equal returns `1` or `0` over raw signed numbers:

```hvm
@main = -1 <= 2
```

This is used by the recursive integer sort search.

## Raw Integer Arithmetic

The active runtime for the UI is `public/babysupvm-runtime.js` inside `babysupvm-worker.js`. It supports raw signed integer arithmetic:

```hvm
@main = 3 * 3 + 1
```

Supported operators:

```text
+  numeric addition
-  numeric subtraction
*  numeric multiplication
/  integer division, truncates toward zero; divide by zero returns 0
%  modulo, normalized to a non-negative remainder
<= less-than-or-equal, returns 1 or 0
=== structural equality, returns 1 or 0
```

Boolean conditions are represented as raw numbers:

```hvm
0 = false
1 = true
```

Conditionals are encoded with number matchers:

```hvm
λ{0:else_case; 1:then_case}(condition)
```

Example:

```hvm
@max = λa,b. λ{0:a; 1:b}(a <= b)
@main = @max(3, 9)
```

## Filtering Pattern

Use a number matcher on an equality result:

```hvm
@bit = &choice{0;1}
@main = λ{0: &{}; 1: @bit}(@bit === 1)
```

This collapses to `1`, because the `0` branch fails.

Multiple tests can be nested:

```hvm
@op = &op{λx.x; λx.[x]}

@main =
  λ{0:&{}; 1:
    λ{0:&{}; 1:@op}(@op(2) === [2])
  }(@op(7) === [7])
```

This returns `λa.[a]`.

## Supported Output Forms

The pretty-printer can display:

- numbers
- nats
- lists
- lambdas
- matchers
- applications
- constructor terms
- variables

## Not Supported

This runner does not support full HVM4/SupGen source syntax. Notable missing features:

- explicit DUP lets
- strict lets
- strings
- IO
- full custom constructor syntax
- full HVM interaction-net syntax
- textual boolean operators such as AND/OR/XOR; the generator lowers these through numeric conditionals
- unbounded synthesis without an encoded candidate space
