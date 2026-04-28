# BabySupGen

BabySupGen is a browser-native program-synthesis playground inspired by Victor Taelin's SupGen, HVM, and interaction-net research.

This repository is an independent prototype. The core ideas come from Victor Taelin's work:

- Victor Taelin: https://github.com/VictorTaelin
- Research index: https://github.com/VictorTaelin#research

## What It Does

BabySupGen lets you write small typed synthesis specs:

```text
def inc(x: Nat) -> Nat: ?

assert inc(0n) == 1n
assert inc(1n) == 2n
assert inc(2n) == 3n
```

The UI generates a finite typed search space, runs examples and constraints over that space, and decodes a surviving program.

The current browser path supports:

- Nat and small scalar expression synthesis
- typed `Int[] -> Int[]`, `Int[] -> Int`, and `Int[][] -> Int[]` search presets
- helper holes such as `def aux = ?` and typed helper hints such as `def pred(x: Int) -> Bool: ?`
- a browser BabySupVM runtime with labelled superpositions and collapse
- a WebGPU/FastSearch route for supported compiled searches

## Runtime Modes

`WebGPU/FastSearch` is the default.

- Scalar direct candidate searches run through a real browser WebGPU compute kernel when available.
- Recursive structural searches and selector-pair searches currently run through the compiled CPU evaluator.
- Raw BabySupVM programs run in the browser worker via `Run Program`.

The app is fully static. There is no backend API and no server-side runtime path.

This is not full HVM4 and not Victor's full SupGen implementation.

## Dialects

`Minimal core` searches with:

- variables and constants
- arithmetic and boolean conditions
- conditionals
- list constructors and list match
- helper calls
- guarded structural recursion

`Minimal + generic library` uses the same core plus early generic shapes for common filter, insert, append, and aggregate scans. This keeps practical examples fast without changing the underlying primitive boundary.

## Helper Hints

Untyped helper holes ask BabySupGen to choose a helper type:

```text
def aux = ?
```

Typed helper holes constrain the helper signature but still synthesize the body:

```text
def pickPrime(xs: Int[]) -> Int: ?
def isPrimeLike(x: Int) -> Bool: ?
```

The asserted function is the target. Other typed defs are treated as helper hints.

## Local Development

```bash
npm install
npm start
```

Then open:

```text
http://localhost:5177
```

Useful checks:

```bash
node --check public/compiled-search-runtime.js
node --check public/tiny-supgen.js
node --check public/app.js
node public/compiled-search-runtime.test.mjs
node public/supgen-generic-search.test.mjs
node public/fast-search-ir.test.mjs
node public/generic-supgen-smoke.mjs
```

## GitHub Pages

The app deploys the `public/` directory to the `gh-pages` branch. Markdown docs are loaded from `public/spec/*.md` with static relative `fetch()` calls, so GitHub Pages can host them without a backend.

Once Pages is enabled for this repository, the app is available at:

```text
https://nbardy.github.io/BabySupGen/
```
