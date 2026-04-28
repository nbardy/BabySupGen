# Current Runtime Plan

BabySupGen is now static-only. GitHub Pages serves the app, JavaScript modules, workers, and Markdown specs directly from `public/`. There is no backend API and no server-side execution path.

## Current Path

```text
public/index.html
  loads public/app.js
  loads public/spec/*.md with static relative fetch()

public/app.js
  chooses WebGPU/FastSearch or Browser Worker

WebGPU/FastSearch
  runs supported generated searches through compiled-search-runtime.js
  uses a browser WebGPU kernel for scalar direct candidate searches when available
  uses compiled CPU evaluators for recursive structural searches

Browser Worker
  runs raw BabySupVM programs in babysupvm-worker.js
  imports babysupvm-runtime.js
  parses source, evaluates @main, collapses branches, returns JSON
```

The old `Server Fallback` route and `/api/run` endpoint were removed. If a browser does not support Web Workers, raw BabySupVM execution reports an in-browser runtime error instead of posting to a backend.

## Runtime Selector

```text
WebGPU/FastSearch
  default for BabySupGen Run Search
  browser-only
  can fall back internally to compiled CPU plans

Browser Worker
  browser-only BabySupVM evaluator
  useful for raw Program pane execution
  also used when a generated search lacks compiled metadata
```

## Static Docs

The spec panel does not require a documentation server. It calls:

```text
fetch("./spec/syntax.md")
fetch("./spec/supgen.md")
...
```

On GitHub Pages those are ordinary static files under `public/spec/`. The local development command only provides static hosting so browser module imports and Markdown fetches work with normal browser security rules.

## Remaining Bottlenecks

- Browser worker startup per raw Program run.
- Compatibility stdout-shaped formatting for old result panes.
- Object-heavy BabySupVM evaluator for raw source.
- Choice-vector searches that still run recursive structural plans on CPU.
- Prime-like predicates that evaluate recursive numeric loops across many candidate branches and list elements.
- No advanced HVM-style graph sharing or interaction-net reducer.

The slow cases are not caused by a missing server. They need better browser-side compiled plans, typed-array lowering, WebGPU kernels for recursive plans, and eventually object-language generation with sharing.

## Static-Only Contract

The repo should keep this invariant:

```text
No backend endpoint is required for the demo.
No generated search posts source code to a server.
No Markdown docs depend on server rendering.
All playable paths work from GitHub Pages.
```

Acceptable local tooling:

```text
npm start
  starts a generic static file server for public/
  does not run synthesis on the server
  does not provide an API route
```

## Future Runtime Work

The next serious runtime work stays browser-side:

1. Normalize more generated searches into `FastSearchIR`.
2. Lower recursive structural plans into typed arrays.
3. Add WebGPU kernels for list-output and list-to-int plans.
4. Add CPU/GPU parity tests over the preset matrix.
5. Move more generator logic into the object language so choices can be shared before rendering huge strings.
6. Study interaction-net style sharing as a future backend, without reintroducing a required server.
