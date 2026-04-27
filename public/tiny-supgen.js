import { buildFullSearch } from "./full-supgen.js";
import { genericSupGenPresets } from "./generic-supgen-presets.js";
import { buildGenericSupGenSearch } from "./supgen-generic-search.js";

export const tinyPresets = {
  natInc: {
    title: "Nat increment",
    depth: 2,
    spec: `def inc(x: Nat) -> Nat: ?

assert inc(0n) == 1n
assert inc(1n) == 2n
assert inc(2n) == 3n
`,
  },
  auxInc: {
    title: "Discover aux type",
    depth: 2,
    spec: `def aux = ?
def inc(x: Nat) -> Nat: ?

assert inc(0n) == 1n
assert inc(1n) == 2n
assert inc(2n) == 3n
`,
  },
  boolNot: {
    title: "Boolean NOT",
    depth: 2,
    spec: `def not(x: Nat) -> Nat: ?

assert not(0n) == 1n
assert not(1n) == 0n
`,
  },
  listSort2: {
    title: "Generate binary sort",
    depth: 2,
    spec: `def sort(xs: Nat[]) -> Nat[]: ?

assert sort([1,0]) == [0,1]
assert sort([0,1]) == [0,1]
assert sort([1,1]) == [1,1]
assert sort([0,0]) == [0,0]
`,
  },
  intSort: {
    title: "Recursive integer sort",
    depth: 3,
    spec: `def aux = ?
def sort(xs: Int[]) -> Int[]: ?

assert sort([3,1,2]) == [1,2,3]
assert sort([5,-1,5,0]) == [-1,0,5,5]
assert sort([2,1]) == [1,2]
ensure sorted(sort(xs))
ensure permutation(sort(xs), xs)
`,
  },
  maxSquare: {
    title: "Max square in list",
    depth: 3,
    spec: `def aux = ?
def maxS(xs: Int[]) -> Int: ?

assert maxS([3,1,2]) == 9
assert maxS([1,3,2]) == 9
assert maxS([5,-1,5,0]) == 25
assert maxS([2,1]) == 4
`,
  },
  evens: {
    title: "Filter even integers",
    depth: 3,
    spec: `def pred = ?
def evens(xs: Int[]) -> Int[]: ?

assert evens([1,2,3,4]) == [2,4]
assert evens([0,-1,5,6]) == [0,6]
assert evens([1,3,5]) == []
`,
  },
  subPrimes: {
    title: "Filter prime integers",
    depth: 3,
    spec: `def pred = ?
def subPrimes(xs: Int[]) -> Int[]: ?

assert subPrimes([1,2,3,4,5,6,7,8,9,10,11]) == [2,3,5,7,11]
assert subPrimes([-1,0,1,2,4,13]) == [2,13]
assert subPrimes([8,9,10,12]) == []
`,
  },
  genericMinEven: genericSupGenPresets.minEven,
  genericMaxSquareMinusMin: genericSupGenPresets.maxSquareMinusMin,
  genericSort: genericSupGenPresets.sort,
  genericFilterPrimes: genericSupGenPresets.filterPrimes,
  genericNestedFlatten: genericSupGenPresets.nestedFlatten,
};

const MAX_CANDIDATES = 1200;
const MAX_NAT_EXPRS = 280;
const MAX_HELPERS = 32;
const MAX_TARGETS_PER_HELPER = 18;

function cleanLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
}

function splitTopLevel(text, separator = ",") {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      out.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) {
    out.push(tail);
  }
  return out;
}

function normalizeType(type) {
  const clean = type.trim().replace(/\s+/g, " ");
  if (clean.endsWith("[]")) {
    return `${normalizeType(clean.slice(0, -2))}[]`;
  }
  if (clean === "Nat") {
    return "Nat";
  }
  if (clean === "Int") {
    return "Int";
  }
  if (clean === "Bool") {
    return "Bool";
  }
  const genericList = clean.match(/^List<(.+)>$/);
  if (genericList) {
    return `${normalizeType(genericList[1])}[]`;
  }
  if (clean === "List Nat") {
    return "Nat[]";
  }
  if (clean === "List Int") {
    return "Int[]";
  }
  throw new Error(`Unsupported type: ${type}`);
}

function typeLabel(type) {
  return type;
}

export function parseTinySpec(text) {
  const defs = [];
  const helpers = [];
  const assertions = [];
  const ensures = [];

  for (const line of cleanLines(text)) {
    const helper = line.match(/^def\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\?\s*$/);
    if (helper) {
      helpers.push({ name: helper[1] });
      continue;
    }

    const def = line.match(
      /^def\s+([A-Za-z_$][A-Za-z0-9_$]*)\((.*)\)\s*->\s*([^:]+)\s*:\s*\?\s*$/,
    );
    if (def) {
      const args = def[2].trim()
        ? splitTopLevel(def[2]).map((arg) => {
            const parts = arg.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(.+)$/);
            if (!parts) {
              throw new Error(`Bad argument syntax: ${arg}`);
            }
            return { name: parts[1], type: normalizeType(parts[2]) };
          })
        : [];
      defs.push({ name: def[1], args, ret: normalizeType(def[3]) });
      continue;
    }

    const assertion = line.match(/^assert\s+([A-Za-z_$][A-Za-z0-9_$]*)\((.*)\)\s*==\s*(.+)$/);
    if (assertion) {
      assertions.push({
        fn: assertion[1],
        args: assertion[2].trim() ? splitTopLevel(assertion[2]) : [],
        expected: assertion[3].trim(),
      });
      continue;
    }

    const ensure = line.match(/^ensure\s+(.+)$/);
    if (ensure) {
      ensures.push(ensure[1].trim());
      continue;
    }

    throw new Error(`Could not parse line: ${line}`);
  }

  if (defs.length !== 1) {
    throw new Error("TinySupGen currently expects exactly one typed target def.");
  }
  const target = defs[0];
  if (assertions.length === 0) {
    throw new Error("Add at least one assert.");
  }
  for (const assertion of assertions) {
    if (assertion.fn !== target.name) {
      throw new Error(`Assert targets ${assertion.fn}, but the typed def is ${target.name}.`);
    }
    if (assertion.args.length !== target.args.length) {
      throw new Error(`Assert ${assertion.fn} has the wrong arity.`);
    }
  }

  return { target, helpers, assertions, ensures };
}

function expr(src, type, size = 1, uses = new Set()) {
  return { src, type, size, uses };
}

function usesWith(base, name) {
  const out = new Set(base);
  out.add(name);
  return out;
}

function uniqueExprs(items, limit) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.src)) {
      continue;
    }
    seen.add(item.src);
    out.push(item);
    if (limit && out.length >= limit) {
      break;
    }
  }
  return out;
}

function uniqueCandidates(items, limit) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.term + "\n" + item.source;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
    if (limit && out.length >= limit) {
      break;
    }
  }
  return out;
}

function allByType(exprs, type) {
  return exprs.filter((item) => item.type === type);
}

function cartesian(lists) {
  let out = [[]];
  for (const list of lists) {
    const next = [];
    for (const prefix of out) {
      for (const item of list) {
        next.push([...prefix, item]);
      }
    }
    out = next;
  }
  return out;
}

function callSources(fn, args) {
  return `${fn.name}(${args.map((arg) => arg.src).join(",")})`;
}

function natExprs(ctx, funcs, maxDepth, options = {}) {
  const constants = options.constants || ["0n", "1n", "2n"];
  let pool = [
    ...ctx.filter((item) => item.type === "Nat").map((item) => expr(item.name, "Nat", 1)),
    ...constants.map((item) => expr(item, "Nat", 1)),
  ];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next = [];
    const natPool = allByType(pool, "Nat");

    for (const item of natPool.slice(0, 80)) {
      next.push(expr(`1n+(${item.src})`, "Nat", item.size + 1, item.uses));
      next.push(expr(`λ{0n:0n; 1n+:λp.p}(${item.src})`, "Nat", item.size + 1, item.uses));
    }

    for (const fn of funcs) {
      if (fn.ret !== "Nat") {
        continue;
      }
      const argChoices = fn.args.map((type) => allByType(pool, type).slice(0, 36));
      if (argChoices.some((choices) => choices.length === 0)) {
        continue;
      }
      for (const args of cartesian(argChoices).slice(0, 100)) {
        const uses = args.reduce((acc, arg) => new Set([...acc, ...arg.uses]), new Set([fn.name]));
        next.push(expr(callSources(fn, args), "Nat", 1 + args.reduce((sum, arg) => sum + arg.size, 0), uses));
      }
    }

    const branchPool = allByType(pool, "Nat").slice(0, 20);
    const condVars = ctx.filter((item) => item.type === "Nat").slice(0, 2);
    for (const condVar of condVars) {
      for (const test of ["0n", "1n"]) {
        for (const thenExpr of branchPool) {
          for (const elseExpr of branchPool) {
            const uses = new Set([...thenExpr.uses, ...elseExpr.uses]);
            next.push(
              expr(
                `λ{0:${elseExpr.src}; 1:${thenExpr.src}}(${condVar.name} === ${test})`,
                "Nat",
                1 + thenExpr.size + elseExpr.size,
                uses,
              ),
            );
          }
        }
      }
    }

    pool = uniqueExprs([...pool, ...next].sort((a, b) => a.size - b.size || a.src.length - b.src.length), MAX_NAT_EXPRS);
  }

  return allByType(pool, "Nat");
}

function listBodyExprs(maxDepth) {
  const atoms = [
    expr("[a,b]", "Nat[]", 1),
    expr("[b,a]", "Nat[]", 1),
    expr("xs", "Nat[]", 1),
    expr("[]", "Nat[]", 1),
    expr("[0,1]", "Nat[]", 1),
    expr("[1,0]", "Nat[]", 1),
    expr("[a]", "Nat[]", 1),
    expr("[b]", "Nat[]", 1),
  ];
  let pool = atoms;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next = [];
    const branchPool = pool.slice(0, depth === 1 ? 10 : 80);
    for (const cond of ["a === 0", "b === 0"]) {
      for (const thenExpr of branchPool) {
        for (const elseExpr of branchPool) {
          next.push(
            expr(
              `λ{0:${elseExpr.src}; 1:${thenExpr.src}}(${cond})`,
              "Nat[]",
              1 + thenExpr.size + elseExpr.size,
            ),
          );
        }
      }
    }
    pool = uniqueExprs([...pool, ...next].sort((a, b) => a.size - b.size || a.src.length - b.src.length), MAX_CANDIDATES);
  }

  return pool;
}

function list2FunctionCandidates(target, maxDepth) {
  if (target.args.length !== 1 || target.args[0].type !== "Nat[]" || target.ret !== "Nat[]") {
    return [];
  }
  const arg = target.args[0].name;
  return listBodyExprs(maxDepth).map((body, index) => {
    const src =
      `λ${arg}.` +
      `λ{[]: []; <>: λa,tail. λ{[]: [a]; <>: λb,rest. ${body.src}}(tail)}(${arg})`;
    return {
      name: `generated list expr ${index}`,
      term: src,
      source: `def ${target.name}(${arg}: Nat[]) -> Nat[]:\n  ${body.src}`,
    };
  });
}

function lambdaFor(args, body) {
  if (args.length === 0) {
    return body;
  }
  return `λ${args.map((arg) => arg.name).join(",")}.${body}`;
}

function natFunctionCandidates(target, helpers, maxDepth) {
  if (target.ret !== "Nat" || target.args.some((arg) => arg.type !== "Nat")) {
    return [];
  }

  if (helpers.length > 0) {
    return helperBackedNatCandidates(target, helpers[0], maxDepth);
  }

  const ctx = target.args;
  return natExprs(ctx, [], maxDepth).map((body, index) => ({
    name: `generated Nat expr ${index}`,
    term: lambdaFor(target.args, body.src),
    body: body.src,
    compiled: {
      kind: "scalarDirect",
      ret: "Nat",
      args: target.args.map((arg) => arg.type),
      body: body.src,
    },
    source: `def ${target.name}(${target.args.map((arg) => `${arg.name}: ${typeLabel(arg.type)}`).join(", ")}) -> Nat:\n  ${body.src}`,
  }));
}

function helperBackedNatCandidates(target, helper, maxDepth) {
  const out = [];
  const helperTypes = [
    { args: ["Nat"], ret: "Nat" },
    { args: ["Nat", "Nat"], ret: "Nat" },
  ];

  for (const helperType of helperTypes) {
    const helperArgs = helperType.args.map((type, index) => ({ name: `h${index}`, type }));
    const helperBodies = natExprs(helperArgs, [], Math.max(1, maxDepth - 1)).slice(0, MAX_HELPERS);
    const helperFn = { name: helper.name, args: helperType.args, ret: helperType.ret };
    const directCalls = target.args.length === helperType.args.length
      ? `${helper.name}(${target.args.map((arg) => arg.name).join(",")})`
      : "";
    const targetBodies = natExprs(target.args, [helperFn], maxDepth)
      .filter((body) => body.uses.has(helper.name))
      .sort((a, b) => {
        if (a.src === directCalls) {
          return -1;
        }
        if (b.src === directCalls) {
          return 1;
        }
        return a.size - b.size || a.src.length - b.src.length;
      })
      .slice(0, MAX_TARGETS_PER_HELPER);

    for (const targetBody of targetBodies) {
      for (const helperBody of helperBodies) {
        const helperLambda = lambdaFor(helperArgs, helperBody.src);
        const term = lambdaFor(target.args, `!${helper.name} = ${helperLambda}; ${targetBody.src}`);
        const helperSig = `${helper.name}(${helperArgs.map((arg) => `${arg.name}: ${arg.type}`).join(", ")}) -> ${helperType.ret}`;
        out.push({
          name: `generated ${helper.name}: ${helperType.args.join(" -> ")} -> ${helperType.ret}`,
          term,
          source:
            `def ${helperSig}:\n  ${helperBody.src}\n\n` +
            `def ${target.name}(${target.args.map((arg) => `${arg.name}: ${arg.type}`).join(", ")}) -> ${target.ret}:\n  ${targetBody.src}`,
        });
      }
    }
  }

  return uniqueCandidates(out, MAX_CANDIDATES);
}

function generatedCandidates(spec, depth) {
  const listCandidates = list2FunctionCandidates(spec.target, depth);
  if (listCandidates.length > 0) {
    return listCandidates;
  }
  const natCandidates = natFunctionCandidates(spec.target, spec.helpers, depth);
  if (natCandidates.length > 0) {
    return natCandidates;
  }
  throw new Error(`No enumerator for ${spec.target.args.map((arg) => arg.type).join(",")} -> ${spec.target.ret}`);
}

function buildChoice(label, values, index = 0) {
  if (values.length === 0) {
    throw new Error("No candidates were generated.");
  }
  if (index === values.length - 1) {
    return values[index];
  }
  return `&${label}_${index}{${values[index]}; ${buildChoice(label, values, index + 1)}}`;
}

function callTarget(assertion) {
  return `@op(${assertion.args.join(",")})`;
}

function buildFilter(assertions) {
  let body = "@op_id";
  for (let index = assertions.length - 1; index >= 0; index -= 1) {
    const assertion = assertions[index];
    body = `λ{0:&{}; 1:${body}}(${callTarget(assertion)} === ${assertion.expected})`;
  }
  return body;
}

function choiceTerm(label, options) {
  function go(index) {
    if (index === options.length - 1) {
      return options[index];
    }
    return `&${label}_${index}{${options[index]}; ${go(index + 1)}}`;
  }
  return go(0);
}

function encodedIntName(value) {
  return value < 0 ? `m${Math.abs(value)}` : `p${value}`;
}

function intsInList(source) {
  return Array.from(source.matchAll(/-?\d+/g), (match) => Number(match[0]));
}

function hvmList(items) {
  return `[${items.join(",")}]`;
}

function generatedSortedListAssertions(targetName, userAssertions) {
  const out = userAssertions.slice();
  const seen = new Set(out.map((item) => item.args[0]));
  const values = [-1, 0, 1, 2];
  const lists = [[], ...values.map((a) => [a])];
  for (const a of values) {
    for (const b of values) {
      lists.push([a, b]);
    }
  }
  for (const xs of lists) {
    const input = hvmList(xs);
    if (seen.has(input)) {
      continue;
    }
    seen.add(input);
    out.push({
      fn: targetName,
      args: [input],
      expected: hvmList(xs.slice().sort((a, b) => a - b)),
      generated: true,
    });
  }
  return out;
}

function countDef(value) {
  const name = `count_${encodedIntName(value)}`;
  return `@${name} = λxs. λ{[]:0n; <>:λh,t. λ{0:@${name}(t); 1:1n+@${name}(t)}(h === ${value})}(xs)`;
}

function maxExpr(a, b) {
  return `λ{0:${a}; 1:${b}}(${a} <= ${b})`;
}

function minExpr(a, b) {
  return `λ{0:${b}; 1:${a}}(${a} <= ${b})`;
}

function buildChecks(finalBody, assertions) {
  let body = finalBody;
  for (let index = assertions.length - 1; index >= 0; index -= 1) {
    body = `λ{0:&{}; 1:${body}}(${assertions[index]})`;
  }
  return body;
}

function buildGenericListToIntSearch(spec, depth) {
  if (spec.target.args.length !== 1 || spec.target.args[0].type !== "Int[]" || spec.target.ret !== "Int") {
    return null;
  }
  const targetName = spec.target.name;
  const helperName = spec.helpers[0]?.name || "combine";
  const helperBodies = [
    "a",
    "b",
    "a + b",
    "a * b",
    maxExpr("a", "b"),
    minExpr("a", "b"),
    "a - b",
  ];
  const nilBodies = ["0", "1", "-1"];
  const rec = `@${targetName}(rest)`;
  const consBodies = [
    "x",
    "x * x",
    rec,
    `@${helperName}(x,${rec})`,
    `@${helperName}(x * x,${rec})`,
    `x + ${rec}`,
    `x * x + ${rec}`,
    maxExpr("x", rec),
    maxExpr("x * x", rec),
  ];

  const helperTerm = choiceTerm("fold_int_aux", helperBodies);
  const nilTerm = choiceTerm("fold_int_nil", nilBodies);
  const consTerm = choiceTerm("fold_int_cons", consBodies);
  const helperId = choiceTerm("fold_int_aux", helperBodies.map((_, index) => String(index)));
  const nilId = choiceTerm("fold_int_nil", nilBodies.map((_, index) => String(index)));
  const consId = choiceTerm("fold_int_cons", consBodies.map((_, index) => String(index)));
  const checks = spec.assertions.map((assertion) => `@${targetName}(${assertion.args[0]}) === ${assertion.expected}`);
  const lines = [
    "// Generated by Generic Recursive ListGen.",
    "// Shape: Int[] -> Int structural fold with optional Int/Int helper.",
    `@${helperName} = λa,b.${helperTerm}`,
    `@${targetName} = λxs. λ{[]:${nilTerm}; <>:λx,rest.${consTerm}}(xs)`,
    `@op_id = [${helperId},${nilId},${consId}]`,
    `@main = ${buildChecks("@op_id", checks)}`,
    "",
  ];

  return {
    mode: "choiceVector",
    spec,
    depth,
    program: lines.join("\n"),
    candidates: [],
    choices: { helperName, helperBodies, nilBodies, consBodies, kind: "Int[] -> Int" },
    assertions: spec.assertions,
    decodeChoiceVector(vector) {
      const [helperIdx, nilIdx, consIdx] = vector;
      return (
        `def ${helperName}(a: Int, b: Int) -> Int:\n` +
        `  return ${helperBodies[helperIdx] || "?"}\n\n` +
        `def ${targetName}(xs: Int[]) -> Int:\n` +
        `  match xs:\n` +
        `    case []:\n` +
        `      return ${nilBodies[nilIdx] || "?"}\n` +
        `    case x <> rest:\n` +
        `      return ${consBodies[consIdx] || "?"}`
      );
    },
  };
}

function buildGenericListToListSearch(spec, depth) {
  if (spec.target.args.length !== 1 || spec.target.args[0].type !== "Int[]" || spec.target.ret !== "Int[]") {
    return null;
  }

  const targetName = spec.target.name;
  const helperName = spec.helpers[0]?.name || "aux";
  const nilBodies = ["[]", "xs"];
  const rec = `@${targetName}(rest)`;
  const consBodies = [
    "x <> rest",
    `x <> ${rec}`,
    rec,
    `@${helperName}(x,rest)`,
    `@${helperName}(x,${rec})`,
    "rest",
  ];
  const auxNil = ["[]", "[x]", "xs"];
  const auxCons = [
    "xs",
    "x <> xs",
    `y <> @${helperName}(x,ys)`,
    `λ{0:y <> @${helperName}(x,ys); 1:x <> xs}(x <= y)`,
    `λ{0:x <> xs; 1:y <> @${helperName}(x,ys)}(y <= x)`,
    "y <> ys",
  ];

  const nilTerm = choiceTerm("fold_list_nil", nilBodies);
  const consTerm = choiceTerm("fold_list_cons", consBodies);
  const auxNilTerm = choiceTerm("fold_list_aux_nil", auxNil);
  const auxConsTerm = choiceTerm("fold_list_aux_cons", auxCons);
  const nilId = choiceTerm("fold_list_nil", nilBodies.map((_, index) => String(index)));
  const consId = choiceTerm("fold_list_cons", consBodies.map((_, index) => String(index)));
  const auxNilId = choiceTerm("fold_list_aux_nil", auxNil.map((_, index) => String(index)));
  const auxConsId = choiceTerm("fold_list_aux_cons", auxCons.map((_, index) => String(index)));

  const wantsSorted = spec.ensures.some((ensure) => ensure.includes("sorted"));
  const wantsPermutation = spec.ensures.some((ensure) => ensure.includes("permutation"));
  const allAssertions = wantsSorted || wantsPermutation
    ? generatedSortedListAssertions(targetName, spec.assertions)
    : spec.assertions;
  const values = Array.from(
    new Set(allAssertions.flatMap((assertion) => [...intsInList(assertion.args[0]), ...intsInList(assertion.expected)])),
  ).sort((a, b) => a - b);
  const checks = [];
  for (const assertion of allAssertions) {
    const input = assertion.args[0];
    checks.push(`@${targetName}(${input}) === ${assertion.expected}`);
    if (wantsSorted) {
      checks.push(`@sorted(@${targetName}(${input})) === 1`);
    }
    if (wantsPermutation) {
      for (const value of values) {
        const count = `@count_${encodedIntName(value)}`;
        checks.push(`${count}(@${targetName}(${input})) === ${count}(${input})`);
      }
    }
  }

  const lines = [
    "// Generated by Generic Recursive ListGen.",
    "// Shape: Int[] -> Int[] structural recursion with optional Int/List helper.",
    `@${helperName} = λx,xs. λ{[]:${auxNilTerm}; <>:λy,ys.${auxConsTerm}}(xs)`,
    `@${targetName} = λxs. λ{[]:${nilTerm}; <>:λx,rest.${consTerm}}(xs)`,
    "@sorted = λxs. λ{[]:1; <>:λx,tail. λ{[]:1; <>:λy,ys. λ{0:0; 1:@sorted(tail)}(x <= y)}(tail)}(xs)",
    ...values.map(countDef),
    `@op_id = [${nilId},${consId},${auxNilId},${auxConsId}]`,
    `@main = ${buildChecks("@op_id", checks)}`,
    "",
  ];

  return {
    mode: "choiceVector",
    spec,
    depth,
    program: lines.join("\n"),
    candidates: [],
    choices: { helperName, nilBodies, consBodies, auxNil, auxCons, kind: "Int[] -> Int[]" },
    assertions: allAssertions,
    decodeChoiceVector(vector) {
      const [nilIdx, consIdx, auxNilIdx, auxConsIdx] = vector;
      const prettyAuxCons = [
        "xs",
        "x <> xs",
        `${helperName}(x, ys) with y kept in front`,
        `if x <= y then x <> xs else y <> ${helperName}(x, ys)`,
        `if y <= x then y <> ${helperName}(x, ys) else x <> xs`,
        "y <> ys",
      ];
      return (
        `def ${helperName}(x: Int, xs: Int[]) -> Int[]:\n` +
        `  match xs:\n` +
        `    case []:\n` +
        `      return ${auxNil[auxNilIdx] || "?"}\n` +
        `    case y <> ys:\n` +
        `      return ${prettyAuxCons[auxConsIdx] || auxCons[auxConsIdx] || "?"}\n\n` +
        `def ${targetName}(xs: Int[]) -> Int[]:\n` +
        `  match xs:\n` +
        `    case []:\n` +
        `      return ${nilBodies[nilIdx] || "?"}\n` +
        `    case x <> rest:\n` +
        `      return ${consBodies[consIdx] || "?"}`
      );
    },
  };
}

function buildGenericRecursiveListSearch(spec, depth) {
  return buildGenericListToIntSearch(spec, depth) || buildGenericListToListSearch(spec, depth);
}

export function buildTinySearch(specText, options = {}) {
  const depth = Math.max(0, Math.min(4, Number(options.depth ?? 2)));
  const spec = parseTinySpec(specText);
  const genericSearch = buildGenericSupGenSearch(spec, {
    depth,
    dialect: options.dialect || options.searchDialect || options.library,
  });
  if (genericSearch) {
    return genericSearch;
  }
  const fullSearch = buildFullSearch(spec, { depth });
  if (fullSearch) {
    return fullSearch;
  }
  const recursiveListSearch = buildGenericRecursiveListSearch(spec, depth);
  if (recursiveListSearch) {
    return recursiveListSearch;
  }
  const candidates = generatedCandidates(spec, depth).slice(0, MAX_CANDIDATES);
  const terms = candidates.map((candidate) => candidate.term);
  const ids = candidates.map((_, index) => String(index));
  const lines = [
    "// Generated by TinySupGen.",
    `// Target: ${spec.target.name}(${spec.target.args.map((arg) => `${arg.name}: ${arg.type}`).join(", ")}) -> ${spec.target.ret}`,
    `// Candidates: ${candidates.length}`,
    `@op = ${buildChoice("gen", terms)}`,
    `@op_id = ${buildChoice("gen", ids)}`,
    `@main = ${buildFilter(spec.assertions)}`,
    "",
  ];

  const scalarDirect = candidates.every((candidate) => candidate.compiled?.kind === "scalarDirect");
  const compiledBits = scalarDirect
    ? {
        mode: "candidateId",
        engine: "TinySupGen",
        choices: [
          {
            name: "generated scalar candidate",
            label: "tiny_scalar_candidate",
            items: candidates.map((candidate, index) => ({
              index,
              source: candidate.body,
              term: candidate.term,
              candidateSource: candidate.source,
            })),
          },
        ],
        variantPlans: [
          {
            index: 0,
            source: "TinySupGen scalar direct candidate list",
            direct: true,
            candidateId: true,
            choices: [
              {
                name: "generated scalar candidate",
                label: "tiny_scalar_candidate",
                items: candidates.map((candidate, index) => ({
                  index,
                  source: candidate.body,
                  term: candidate.term,
                  candidateSource: candidate.source,
                })),
              },
            ],
          },
        ],
      }
    : {};

  return { spec, depth, candidates, program: lines.join("\n"), ...compiledBits };
}

export function parseTinyCandidateId(result) {
  const firstLine = (result.stdout || "").trim().split(/\r?\n/)[0] || "";
  const match = firstLine.match(/^(\d+)\s*(?:#|$)/);
  return match ? Number(match[1]) : null;
}
