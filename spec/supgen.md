# How BabySupGen Is Useful

Attribution: the core ideas here come from Victor Taelin's SupGen, HVM, and interaction-net research. Start at Victor's GitHub profile and research index:

```text
https://github.com/VictorTaelin
https://github.com/VictorTaelin#research
```

This repository is an independent browser prototype inspired by that work. It is not Victor's implementation and it is not full HVM4 SupGen.

BabySupGen is useful when you can describe what a program must do and give the system a typed language of possible programs to search. The system builds a superposed program space, evaluates constraints over that whole space, erases failed branches, and collapses a surviving program.

The short version is:

1. Define a typed target and optional holes.
2. Encode choices with labelled `&label{left; right}` superpositions.
3. Generate well-typed terms and helper variants.
4. Run examples and semantic constraints over the superposed program.
5. Return `&{}` for failed branches.
6. Collapse a surviving branch with `-C1`, `-C2`, and so on.

## Is It Input And Output Examples?

Yes, but with one important caveat: examples constrain a generated search space.

BabySupGen does not infer from examples in an unconstrained vacuum. It needs a type system, primitives, recursion rules, helper-type choices, and a finite fuel bound. From those, it generates the space and finds a member that matches the examples and constraints.

This is the same practical shape as many synthesis systems:

```text
typed generator + examples + constraints => surviving_program
```

In this UI, there are several ways to produce that search space:

- write it directly in BabySupVM syntax
- use BabySupGen to generate typed structural choices from `def` / `assert` specs
- fall back to the older FullSupGen/TinySupGen generators for older typed demos

BabySupGen is still much smaller than Victor Taelin's full system, but the active path now does real typed term generation from `def` and `assert` specs.

## A Minimal Search

Here are two candidate functions:

- `λx.x`
- `λx.[x]`

The examples say:

```text
7 => [7]
2 => [2]
```

Program:

```hvm
@op = &op{λx.x; λx.[x]}

@main =
  λ{0:&{}; 1:
    λ{0:&{}; 1:@op}(@op(2) === [2])
  }(@op(7) === [7])
```

Result:

```hvm
λa.[a]
```

The identity function fails because `7` is not equal to `[7]`. The wrapper function survives both examples.

## Why Labelled Choices Matter

The label `op` ties all uses of `@op` to the same decision. If the first occurrence picks the right branch, later occurrences of the same label also pick the right branch. This is what makes candidate testing coherent.

Without correlation, one example could pass with one candidate and another example could pass with a different candidate, which would not be a real solution.

## What Programs Can It Find?

This local runner can search for small symbolic programs built from:

- lambdas and applications
- list constructors and list matchers
- unary nat constructors and nat matchers
- raw signed integer constants
- integer arithmetic: `+`, `-`, `*`, `/`, `%`
- integer comparison: `<=`
- structural equality
- finite binary choices
- erasers for failed branches

Useful targets include:

- small list transformers
- small nat transformers
- integer folds such as max, min, sum, and max-square
- integer filters such as evens and primes
- insertion-style integer sorting
- wrappers and adapters
- finite rule tables
- tiny symbolic classifiers
- pieces of interpreters or evaluators over a small AST
- repair choices inside a hand-written sketch
- config or strategy selection where the options are symbolic

The current UI demonstrates this with helper holes, integer sort, max/min-style scans, even filtering, prime filtering, nested flattening, and the older generated Nat examples.

## What It Is Not Good At Yet

This runner is not a general production SupGen environment. It is not currently suited for:

- large open-ended synthesis
- string-heavy transformations
- IO or side effects
- floating-point or tensor workloads
- proving that a solution generalizes beyond the examples
- running arbitrary HVM4 files without translation

## Practical Mental Model

Think of this as a tiny symbolic lab:

```text
typed grammar + superposed holes + examples => first surviving filled program
```

The hard part is designing the typed generator and oracle. If the right program is in the generated space and the tests distinguish it, this runtime can collapse to it. If the right program is not in the space, no amount of examples will recover it.
