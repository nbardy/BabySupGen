import {
  parseType,
  sameType,
  showType,
  intType,
  boolType,
  listType,
  funType,
  rawTerm,
  lowerTerm,
} from "./supgen-generic-ir.js";

const SMALL_INTS = [-1, 0, 1, 2, 3, 5, 999];
const MAX_ITEMS = 72;
const MAX_LIST_ITEMS = 240;

export const genericSearchDialects = Object.freeze({
  minimal: {
    id: "minimal",
    label: "Minimal core",
    description: "Variables, constants, arithmetic, bools, if, list constructors, match, helper calls, and guarded recursion.",
  },
  library: {
    id: "library",
    label: "Minimal + generic library",
    description: "Minimal core plus focused derived-library choices for common filter/insert/append/aggregate shapes.",
  },
});

const INT = intType();
const BOOL = boolType();
const INT_LIST = listType(INT);

function item(term, source = term, extra = {}) {
  return { term, source, ...extra };
}

function normalizeDialect(value) {
  const id = String(value || "library");
  return genericSearchDialects[id] ? id : "library";
}

function usesLibrary(dialect) {
  return normalizeDialect(dialect) === "library";
}

function coreOrLibrary(coreItems, libraryItems, dialect) {
  return usesLibrary(dialect) ? unique([...libraryItems, ...coreItems]) : unique(coreItems);
}

function choose(label, options) {
  if (!options.length) {
    throw new Error(`empty generic choice: ${label}`);
  }
  function go(index) {
    if (index === options.length - 1) {
      return options[index].term;
    }
    return `&${label}_${index}{${options[index].term}; ${go(index + 1)}}`;
  }
  return go(0);
}

function makeChoice(label, items, name = label, limit = MAX_ITEMS) {
  const options = unique(items).slice(0, limit);
  return {
    label,
    name,
    items: options,
    term: choose(label, options),
    id: choose(label, options.map((_, index) => item(String(index)))),
  };
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const entry of items) {
    const key = entry.term;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function maxTerm(left, right) {
  return `λ{0:${left}; 1:${right}}(${left} <= ${right})`;
}

function minTerm(left, right) {
  return `λ{0:${right}; 1:${left}}(${left} <= ${right})`;
}

function ifTerm(cond, yes, no) {
  return `λ{0:${no}; 1:${yes}}(${cond})`;
}

function notTerm(cond) {
  return ifTerm(cond, "0", "1");
}

function andTerm(left, right) {
  return ifTerm(left, right, "0");
}

function orTerm(left, right) {
  return ifTerm(left, "1", right);
}

function xorTerm(left, right) {
  return ifTerm(left, notTerm(right), right);
}

function listLiteral(values) {
  return `[${values.join(",")}]`;
}

function typeFromArg(arg) {
  return parseType(arg.type);
}

function targetArgs(spec) {
  return spec.target.args.map((arg) => ({ name: arg.name, type: typeFromArg(arg) }));
}

function targetReturn(spec) {
  return parseType(spec.target.ret);
}

function isInt(type) {
  return sameType(type, INT);
}

function isBool(type) {
  return sameType(type, BOOL);
}

function isList(type) {
  return type.tag === "List";
}

function isIntList(type) {
  return sameType(type, INT_LIST);
}

function functionType(args, ret) {
  return args.reduceRight((tail, arg) => funType(arg, tail), ret);
}

function helperName(spec, fallback = "aux") {
  return spec.helpers[0]?.name || fallback;
}

function splitTopLevelText(text, separator = ",") {
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

function helperNamesBySignature(spec, argTypes, retType) {
  return (spec.helpers || [])
    .filter((helper) => helper.typed)
    .filter((helper) => {
      if (!helper.args || helper.args.length !== argTypes.length || helper.ret !== retType) {
        return false;
      }
      return helper.args.every((arg, index) => arg.type === argTypes[index]);
    })
    .map((helper) => helper.name);
}

function helperNamesUntyped(spec) {
  return (spec.helpers || []).filter((helper) => !helper.typed).map((helper) => helper.name);
}

function selectorPairNames(spec) {
  const selectors = helperNamesBySignature(spec, ["Int[]"], "Int");
  const typedPreds = helperNamesBySignature(spec, ["Int"], "Bool");
  const untyped = helperNamesUntyped(spec);
  return {
    selectorA: selectors[0] || "select1",
    selectorB: selectors[1] || "select2",
    predA: typedPreds[0] || untyped[0] || "pred1",
    predB: typedPreds[1] || untyped[1] || "pred2",
  };
}

function intBindings(ctx) {
  return ctx.filter((entry) => isInt(entry.type)).map((entry) => item(entry.name, entry.source || entry.name));
}

function literalIntItems(values = SMALL_INTS) {
  return values.map((value) => item(String(value), String(value)));
}

function primitiveIntGroups(ctx) {
  const vars = intBindings(ctx);
  const constants = literalIntItems([0, 1, 2, -1, 3, 5]);
  const squares = vars.map((entry) => item(`${entry.term} * ${entry.term}`, `${entry.source} * ${entry.source}`));
  const shifts = [];
  for (const entry of vars) {
    for (const step of [1, 2, 3]) {
      shifts.push(item(`${entry.term} + ${step}`, `${entry.source} + ${step}`));
      shifts.push(item(`${entry.term} - ${step}`, `${entry.source} - ${step}`));
    }
  }
  const varPairs = [];
  for (const left of vars) {
    for (const right of vars) {
      if (left.term === right.term) {
        continue;
      }
      varPairs.push(item(`${left.term} + ${right.term}`, `${left.source} + ${right.source}`));
      varPairs.push(item(`${left.term} - ${right.term}`, `${left.source} - ${right.source}`));
      varPairs.push(item(`${left.term} * ${right.term}`, `${left.source} * ${right.source}`));
      varPairs.push(item(`${left.term} / ${right.term}`, `${left.source} / ${right.source}`));
      varPairs.push(item(`${left.term} % ${right.term}`, `${left.source} % ${right.source}`));
    }
  }
  const varConstMods = [];
  const varConst = [];
  for (const left of vars) {
    for (const right of constants) {
      if (right.term !== "0") {
        varConstMods.push(item(`${left.term} % ${right.term}`, `${left.source} % ${right.source}`));
      }
      varConst.push(item(`${left.term} + ${right.term}`, `${left.source} + ${right.source}`));
      varConst.push(item(`${left.term} - ${right.term}`, `${left.source} - ${right.source}`));
      varConst.push(item(`${left.term} * ${right.term}`, `${left.source} * ${right.source}`));
      varConst.push(item(`${left.term} / ${right.term}`, `${left.source} / ${right.source}`));
    }
  }
  return {
    vars,
    constants,
    squares: unique(squares),
    shifts: unique(shifts),
    varPairs: unique(varPairs),
    varConstMods: unique(varConstMods),
    varConst: unique(varConst),
  };
}

function primitiveIntItems(ctx, fuel = 1) {
  const groups = primitiveIntGroups(ctx);
  const out = unique([
    ...groups.vars,
    ...groups.constants,
    ...groups.squares,
    ...groups.varPairs,
    ...groups.varConstMods,
    ...groups.shifts,
    ...groups.varConst,
  ]);
  if (fuel > 1) {
    const base = out.slice(0, 16);
    for (const left of base) {
      for (const right of base) {
        if (left.term === right.term) {
          continue;
        }
        out.push(item(`${left.term} + ${right.term}`, `${left.source} + ${right.source}`));
        out.push(item(`${left.term} - ${right.term}`, `${left.source} - ${right.source}`));
        out.push(item(`${left.term} * ${right.term}`, `${left.source} * ${right.source}`));
        out.push(item(`${left.term} / ${right.term}`, `${left.source} / ${right.source}`));
        if (right.term !== "0") {
          out.push(item(`${left.term} % ${right.term}`, `${left.source} % ${right.source}`));
        }
      }
    }
  }
  return unique(out).slice(0, MAX_ITEMS);
}

export function genType(spec, options = {}) {
  const args = targetArgs(spec);
  const ret = targetReturn(spec);
  const out = [];
  const listArg = args.find((arg) => isList(arg.type));
  const elem = listArg?.type.of;
  const fuel = Number(options.fuel ?? 3);

  if (fuel <= 0) {
    return out;
  }
  if (elem && isInt(elem)) {
    out.push(functionType([INT], BOOL));
    out.push(functionType([INT, INT], INT));
    out.push(functionType([INT, INT, INT], INT_LIST));
    out.push(functionType([INT, INT_LIST], INT_LIST));
  }
  if (elem && isIntList(elem) && isIntList(ret)) {
    out.push(functionType([INT_LIST, INT_LIST], INT_LIST));
  }
  return unique(out.map((type) => item(showType(type), showType(type)))).map((entry) => parseType(entry.term));
}

function boolItems(ctx, fuel = 1) {
  const bools = ctx.filter((entry) => isBool(entry.type)).map((entry) => item(entry.name, entry.source || entry.name));
  const out = [
    item("1", "true"),
    item("0", "false"),
    ...bools,
  ];
  const varInts = intBindings(ctx);
  for (const left of varInts) {
    for (const right of varInts) {
      if (left.term === right.term) {
        continue;
      }
      out.push(item(`${left.term} <= ${right.term}`, `${left.source} <= ${right.source}`));
      out.push(item(notTerm(`${right.term} <= ${left.term}`), `${left.source} < ${right.source}`));
      out.push(item(notTerm(`${left.term} <= ${right.term}`), `${left.source} > ${right.source}`));
      out.push(item(`${left.term} === ${right.term}`, `${left.source} == ${right.source}`));
      out.push(item(notTerm(`${left.term} === ${right.term}`), `${left.source} != ${right.source}`));
    }
  }
  const ints = primitiveIntItems(ctx, Math.max(1, fuel - 1));
  for (const expr of ints.slice(0, 24)) {
    out.push(item(`${expr.term} === 0`, `${expr.source} == 0`));
    out.push(item(notTerm(`${expr.term} === 0`), `${expr.source} != 0`));
    out.push(item(`${expr.term} <= 0`, `${expr.source} <= 0`));
    out.push(item(`0 <= ${expr.term}`, `0 <= ${expr.source}`));
  }
  for (const left of ints.slice(0, 16)) {
    for (const right of ints.slice(0, 16)) {
      if (left.term === right.term) {
        continue;
      }
      out.push(item(`${left.term} <= ${right.term}`, `${left.source} <= ${right.source}`));
      out.push(item(notTerm(`${right.term} <= ${left.term}`), `${left.source} < ${right.source}`));
      out.push(item(notTerm(`${left.term} <= ${right.term}`), `${left.source} > ${right.source}`));
      out.push(item(`${left.term} === ${right.term}`, `${left.source} == ${right.source}`));
      out.push(item(notTerm(`${left.term} === ${right.term}`), `${left.source} != ${right.source}`));
    }
  }
  if (fuel > 1) {
    const base = unique(out).slice(0, 12);
    for (const left of base) {
      out.push(item(notTerm(left.term), `not(${left.source})`));
    }
    for (let i = 0; i < base.length; i += 1) {
      for (let j = i + 1; j < base.length; j += 1) {
        const left = base[i];
        const right = base[j];
        out.push(item(andTerm(left.term, right.term), `(${left.source}) and (${right.source})`));
        out.push(item(orTerm(left.term, right.term), `(${left.source}) or (${right.source})`));
        out.push(item(xorTerm(left.term, right.term), `(${left.source}) xor (${right.source})`));
      }
    }
  }
  return unique(out).slice(0, MAX_ITEMS);
}

function numericGuardItems(ctx) {
  const groups = primitiveIntGroups(ctx);
  const counter = groups.vars[0] || item("d", "d");
  const invariant = groups.vars[1] || item("n", "n");
  const lefts = unique([
    counter,
    item(`${counter.term} * ${counter.term}`, `${counter.source} * ${counter.source}`),
    item(`${counter.term} + 1`, `${counter.source} + 1`),
    item(`${counter.term} + 2`, `${counter.source} + 2`),
    item(`${counter.term} + 3`, `${counter.source} + 3`),
  ]);
  const rights = unique([
    invariant,
    ...groups.constants,
  ]);
  const out = [];
  for (const left of lefts) {
    for (const right of rights) {
      if (left.term === right.term) {
        continue;
      }
      out.push(item(`${left.term} <= ${right.term}`, `${left.source} <= ${right.source}`));
    }
  }
  return unique(out).slice(0, MAX_ITEMS);
}

function numericTestItems(ctx) {
  const groups = primitiveIntGroups(ctx);
  const exprs = unique([
    ...groups.vars,
    ...groups.squares,
    ...groups.varPairs,
    ...groups.varConstMods,
    ...groups.varConst,
    ...groups.shifts,
    ...groups.constants,
  ]);
  const out = [];
  for (const expr of exprs.slice(0, 32)) {
    out.push(item(`${expr.term} === 0`, `${expr.source} == 0`));
    out.push(item(notTerm(`${expr.term} === 0`), `${expr.source} != 0`));
  }
  return unique(out).slice(0, MAX_ITEMS);
}

function numericStepItems(counter = "d") {
  return unique([
    item(`${counter} + 1`, `${counter} + 1`),
    item(`${counter} + 2`, `${counter} + 2`),
    item(`${counter} + 3`, `${counter} + 3`),
  ]);
}

function numericCarryItems(_counter = "d", invariant = "n") {
  return unique([
    item(invariant, invariant),
  ]);
}

function numericBoolRecChoice(label) {
  const ctx = [{ name: "d", type: INT }, { name: "n", type: INT }];
  const guard = makeChoice(`${label}_guard`, numericGuardItems(ctx), "recursive guard");
  const test = makeChoice(`${label}_test`, numericTestItems(ctx), "recursive test");
  const hit = makeChoice(`${label}_hit`, [item("0", "false"), item("1", "true")], "recursive hit value");
  const step = makeChoice(`${label}_step`, numericStepItems("d"), "recursive next counter");
  const carry = makeChoice(`${label}_carry`, numericCarryItems("d", "n"), "recursive carried argument");
  const done = makeChoice(`${label}_done`, [item("1", "true"), item("0", "false")], "recursive done value");
  return {
    label,
    name: "bounded recursive helper body: Int -> Int -> Bool",
    term: ifTerm(
      guard.term,
      ifTerm(test.term, hit.term, `@__generic_pred_aux(${step.term},${carry.term})`),
      done.term,
    ),
    id: [guard.id, test.id, hit.id, step.id, carry.id, done.id].join(","),
    width: 6,
    choices: [guard, test, hit, step, carry, done],
    sourceFromVector(vector) {
      const [guardIdx, testIdx, hitIdx, stepIdx, carryIdx, doneIdx] = vector;
      const guardSource = guard.items[guardIdx]?.source || "?";
      const testSource = test.items[testIdx]?.source || "?";
      const hitSource = hit.items[hitIdx]?.source || "?";
      const stepSource = step.items[stepIdx]?.source || "?";
      const carrySource = carry.items[carryIdx]?.source || "?";
      const doneSource = done.items[doneIdx]?.source || "?";
      return {
        source: `if ${guardSource} then (if ${testSource} then ${hitSource} else self(${stepSource}, ${carrySource})) else ${doneSource}`,
      };
    },
  };
}

function predicateHelperCallItems(param = "p") {
  const starts = unique([
    ...literalIntItems([0, 1, 2, 3]),
    item(param, param),
    item(`${param} + 1`, `${param} + 1`),
    item(`${param} - 1`, `${param} - 1`),
  ]);
  const out = [];
  for (const start of starts) {
    for (const fallback of [item("0", "false"), item("1", "true")]) {
      out.push({
        term: ifTerm(`${start.term} <= ${param}`, `@__generic_pred_aux(${start.term},${param})`, fallback.term),
        source: `if ${start.source} <= ${param} then predAux(${start.source}, ${param}) else ${fallback.source}`,
        usesNumericHelper: true,
      });
    }
  }
  return unique(out);
}

function predicateBodyItems(param = "p") {
  const direct = boolItems([{ name: param, type: INT }], 2);
  return unique([
    ...direct.slice(0, 40),
    ...predicateHelperCallItems(param),
    ...direct.slice(40),
  ]);
}

function formatPredicateDefinition(name, param, body, auxBody = null) {
  const lines = [`def ${name}(${param}: Int) -> Bool:`];
  if (body?.usesNumericHelper) {
    lines.push(`  def ${name}Aux(d: Int, n: Int) -> Bool:`);
    lines.push(`    return ${(auxBody?.source || "?").replaceAll("self(", `${name}Aux(`)}`);
  }
  lines.push(`  return ${(body?.source || "?").replaceAll("predAux", `${name}Aux`)}`);
  return lines.join("\n");
}

function intAtoms(ctx) {
  const out = [];
  for (const binding of ctx) {
    if (isInt(binding.type)) {
      out.push(item(binding.name, binding.name));
      out.push(item(`${binding.name} * ${binding.name}`, `${binding.name} * ${binding.name}`));
    }
  }
  out.push(...SMALL_INTS.map((value) => item(String(value), String(value))));
  return unique(out);
}

function intItems(ctx, fuel = 1) {
  const out = [...intAtoms(ctx)];
  const atoms = intAtoms(ctx).slice(0, 18);
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = 0; j < atoms.length; j += 1) {
      if (i === j) {
        continue;
      }
      const left = atoms[i];
      const right = atoms[j];
      out.push(item(`${left.term} + ${right.term}`, `${left.source} + ${right.source}`));
      out.push(item(`${left.term} - ${right.term}`, `${left.source} - ${right.source}`));
      out.push(item(`${left.term} * ${right.term}`, `${left.source} * ${right.source}`));
      out.push(item(`${left.term} / ${right.term}`, `${left.source} / ${right.source}`));
      out.push(item(`${left.term} % ${right.term}`, `${left.source} % ${right.source}`));
      out.push(item(maxTerm(left.term, right.term), `if ${left.source} <= ${right.source} then ${right.source} else ${left.source}`));
      out.push(item(minTerm(left.term, right.term), `if ${left.source} <= ${right.source} then ${left.source} else ${right.source}`));
    }
  }
  if (fuel > 1) {
    const conds = boolItems(ctx, 1).slice(0, 12);
    const branches = unique(out).slice(0, 16);
    for (const cond of conds) {
      for (const yes of branches) {
        for (const no of branches) {
          out.push(item(ifTerm(cond.term, yes.term, no.term), `if ${cond.source} then ${yes.source} else ${no.source}`));
        }
      }
    }
  }
  return unique(out).slice(0, MAX_ITEMS);
}

function listItems(type, ctx, fuel = 1) {
  const out = [item("[]", "[]")];
  const priority = [];
  const structuralBranches = [];
  if (!isList(type)) {
    return out;
  }
  const elem = type.of;
  const heads = genTermItems(elem, ctx, Math.max(0, fuel - 1)).slice(0, 10);
  const lists = ctx.filter((entry) => sameType(entry.type, type)).map((entry) => item(entry.name, entry.source || entry.name));
  out.push(...lists);
  for (const head of heads) {
    out.push(item(`[${head.term}]`, `[${head.source}]`));
    for (const list of lists) {
      out.push(item(`${head.term} <> ${list.term}`, `${head.source} <> ${list.source}`));
    }
  }
  if (fuel > 1) {
    const conds = boolItems(ctx, 1).filter((entry) => entry.term !== "1" && entry.term !== "0").slice(0, 32);
    for (const head of heads.slice(0, 8)) {
      for (const list of lists.slice(0, 4)) {
        structuralBranches.push(item(`${head.term} <> ${list.term}`, `${head.source} <> ${list.source}`));
      }
    }
    const focusedYes = unique(structuralBranches).slice(0, 16);
    const focusedNo = unique([...lists, ...structuralBranches]).slice(0, 16);
    for (const cond of conds.slice(0, 8)) {
      for (const yes of focusedYes) {
        for (const no of focusedNo) {
          priority.push(item(ifTerm(cond.term, yes.term, no.term), `if ${cond.source} then ${yes.source} else ${no.source}`));
        }
      }
    }
    const branches = unique(out).slice(0, 24);
    for (const cond of conds) {
      for (const yes of branches) {
        for (const no of branches) {
          out.push(item(ifTerm(cond.term, yes.term, no.term), `if ${cond.source} then ${yes.source} else ${no.source}`));
        }
      }
    }
    const tails = unique([...lists, ...out]).slice(0, 8);
    for (const head of heads.slice(0, 8)) {
      for (const tail of tails) {
        out.push(item(`${head.term} <> ${tail.term}`, `${head.source} <> ${tail.source}`));
      }
    }
  }
  return unique([item("[]", "[]"), ...lists, ...structuralBranches, ...priority, ...out]).slice(0, MAX_LIST_ITEMS);
}

export function genTermItems(type, ctx, fuel = 1) {
  if (isInt(type)) {
    return intItems(ctx, fuel);
  }
  if (isBool(type)) {
    return boolItems(ctx, fuel);
  }
  if (isList(type)) {
    return listItems(type, ctx, fuel);
  }
  return [];
}

function predicateBodyChoice(label, param = "p") {
  return makeChoice(label, predicateBodyItems(param), "helper body: Int -> Bool");
}

function reducerBodyChoice(label, left = "a", right = "b") {
  return makeChoice(
    label,
    unique([
      item(left, left),
      item(right, right),
      item(`${left} + ${right}`, `${left} + ${right}`),
      item(`${left} * ${right}`, `${left} * ${right}`),
      item(maxTerm(left, right), `if ${left} <= ${right} then ${right} else ${left}`),
      item(minTerm(left, right), `if ${left} <= ${right} then ${left} else ${right}`),
      item(`${left} - ${right}`, `${left} - ${right}`),
      ...intItems([{ name: left, type: INT }, { name: right, type: INT }], 1),
    ]),
    "helper body: Int -> Int -> Int",
  );
}

function genericIntListRecChoices(prefix, retType, selfTerm, selfSource, extraConsCtx = [], extraConsItems = []) {
  const nil = makeChoice(
    `${prefix}_nil`,
    genTermItems(retType, [], 1),
    "generic structural [] case",
    isList(retType) ? MAX_LIST_ITEMS : MAX_ITEMS,
  );
  const consCtx = [
    { name: "x", type: INT },
    { name: "rest", type: INT_LIST },
    { name: selfTerm, type: retType },
    ...extraConsCtx,
  ];
  const cons = makeChoice(
    `${prefix}_cons`,
    unique([
      ...extraConsItems,
      ...genTermItems(retType, consCtx, 2),
    ]),
    "generic structural cons case",
    isList(retType) ? MAX_LIST_ITEMS : MAX_ITEMS,
  );
  return { nil, cons, selfSource };
}

function genericIntListHelperChoices(prefix, helper, argName = "x", sourceHelper = helper, dialect = "library") {
  const listType = INT_LIST;
  const nilCtx = [
    { name: argName, type: INT },
    { name: "xs", type: listType },
  ];
  const nil = makeChoice(
    `${prefix}_nil`,
    unique([
      item(`[${argName}]`, `[${argName}]`),
      ...genTermItems(listType, nilCtx, 2),
    ]),
    "generic helper [] case",
    MAX_LIST_ITEMS,
  );
  const self = `@${helper}(${argName},ys)`;
  const consCtx = [
    { name: argName, type: INT },
    { name: "xs", type: listType },
    { name: "y", type: INT },
    { name: "ys", type: listType },
    { name: self, source: `${sourceHelper}(${argName}, ys)`, type: listType },
  ];
  const orderedSelf = item(`y <> ${self}`, `y <> ${sourceHelper}(${argName}, ys)`);
  const keepInputList = item(`${argName} <> xs`, `${argName} <> xs`);
  const coreConsItems = genTermItems(listType, consCtx, 3);
  const libraryConsItems = [
    item(
      ifTerm(`${argName} <= y`, keepInputList.term, orderedSelf.term),
      `if ${argName} <= y then ${keepInputList.source} else ${orderedSelf.source}`,
    ),
    item(
      ifTerm(`y <= ${argName}`, orderedSelf.term, keepInputList.term),
      `if y <= ${argName} then ${orderedSelf.source} else ${keepInputList.source}`,
    ),
    orderedSelf,
    keepInputList,
  ];
  const cons = makeChoice(
    `${prefix}_cons`,
    coreOrLibrary(coreConsItems, libraryConsItems, dialect),
    "generic helper cons case",
    MAX_LIST_ITEMS,
  );
  return { nil, cons };
}

function formatStructuralTarget(name, argName, argType, retType, nilChoice, nilIdx, consChoice, consIdx) {
  const head = isInt(retType) ? "x" : isIntList(retType) ? "x" : "head";
  return [
    `def ${name}(${argName}: ${argType}) -> ${showType(retType)}:`,
    `  match ${argName}:`,
    "    case []:",
    `      return ${nilChoice.items[nilIdx]?.source || "?"}`,
    `    case ${head} <> rest:`,
    `      return ${consChoice.items[consIdx]?.source || "?"}`,
  ].join("\n");
}

function sortedAndCountDefs(values) {
  const lines = [
    "@__generic_sorted = λxs. λ{[]:1; <>:λx,tail. λ{[]:1; <>:λy,ys. λ{0:0; 1:@__generic_sorted(tail)}(x <= y)}(tail)}(xs)",
  ];
  for (const value of values) {
    const name = value < 0 ? `m${Math.abs(value)}` : `p${value}`;
    lines.push(`@__generic_count_${name} = λxs. λ{[]:0n; <>:λh,t. λ{0:@__generic_count_${name}(t); 1:1n+@__generic_count_${name}(t)}(h === ${value})}(xs)`);
  }
  return lines;
}

function intValuesIn(text) {
  return Array.from(String(text).matchAll(/-?\d+/g), (match) => Number(match[0]));
}

function generatedLists(assertions, maxLen = 2) {
  const values = Array.from(
    new Set(assertions.flatMap((assertion) => intValuesIn(assertion.args[0]).concat(intValuesIn(assertion.expected))).concat([-1, 0, 1, 2])),
  ).sort((a, b) => a - b);
  const out = [];
  const seen = new Set();
  function go(prefix, depth) {
    const key = listLiteral(prefix);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(prefix.slice());
    }
    if (depth >= maxLen) {
      return;
    }
    for (const value of values) {
      prefix.push(value);
      go(prefix, depth + 1);
      prefix.pop();
    }
  }
  go([], 0);
  return out;
}

function buildChecks(finalBody, checks) {
  let body = finalBody;
  for (let index = checks.length - 1; index >= 0; index -= 1) {
    body = `λ{0:&{}; 1:${body}}(${checks[index]})`;
  }
  return body;
}

function sharedDefs() {
  return [
    "@__generic_concat = λxs,ys. λ{[]:ys; <>:λx,rest.x <> @__generic_concat(rest,ys)}(xs)",
  ];
}

function assertionChecks(spec, assertions = spec.assertions) {
  return assertions.map((assertion) => `@${spec.target.name}(${assertion.args.join(",")}) === ${assertion.expected}`);
}

function ensureChecks(spec, assertions) {
  const checks = [];
  const wantsSorted = spec.ensures.some((ensure) => ensure.includes("sorted"));
  const wantsPermutation = spec.ensures.some((ensure) => ensure.includes("permutation"));
  if (!wantsSorted && !wantsPermutation) {
    return { checks, defs: [] };
  }
  const values = Array.from(
    new Set(assertions.flatMap((assertion) => intValuesIn(assertion.args[0]).concat(intValuesIn(assertion.expected)))),
  ).sort((a, b) => a - b);
  const defs = sortedAndCountDefs(values);
  for (const assertion of assertions) {
    const input = assertion.args[0];
    if (wantsSorted) {
      checks.push(`@__generic_sorted(@${spec.target.name}(${input})) === 1`);
    }
    if (wantsPermutation) {
      for (const value of values) {
        const suffix = value < 0 ? `m${Math.abs(value)}` : `p${value}`;
        checks.push(`@__generic_count_${suffix}(@${spec.target.name}(${input})) === @__generic_count_${suffix}(${input})`);
      }
    }
  }
  return { checks, defs };
}

function fullSearch(spec, depth, dialect, lines, choices, assertions, decode, variantPlans = []) {
  return {
    mode: "choiceVector",
    engine: "BabySupGen",
    dialect,
    primitiveSet: genericSearchDialects[dialect],
    spec,
    depth,
    candidates: [],
    choices,
    variantPlans,
    program: `${lines.join("\n")}\n`,
    assertions,
    decodeChoiceVector: decode,
  };
}

function predicateTermFor(choice, auxName) {
  return choice.term.replaceAll("@__generic_pred_aux", `@${auxName}`);
}

function selectorReducerChoice(label) {
  return makeChoice(
    label,
    [
      item(
        ifTerm("r === -1", "x", ifTerm("x <= r", "x", "r")),
        "minimum selected value",
        { mode: "min" },
      ),
      item(
        ifTerm("r === -1", "x", ifTerm("x <= r", "r", "x")),
        "largest selected value",
        { mode: "max" },
      ),
    ],
    "selector reducer",
  );
}

function selectorFunctionTerm(selectorName, predName, reducerChoice) {
  return `@${selectorName} = λxs. λ{[]:-1; <>:λx,rest.!r = @${selectorName}(rest); λ{0:r; 1:${reducerChoice.term}}(@${predName}(x))}(xs)`;
}

function expectedIntListLength(source) {
  const text = String(source).trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    return null;
  }
  const inner = text.slice(1, -1).trim();
  return inner ? splitTopLevelText(inner).length : 0;
}

function looksLikeSelectorPairSpec(spec) {
  return spec.assertions.length > 0 && spec.assertions.every((assertion) => expectedIntListLength(assertion.expected) === 2);
}

function formatSelectorDefinition(name, listName, predName, reducerItem) {
  const compare =
    reducerItem?.mode === "max"
      ? "if x <= r then r else x"
      : "if x <= r then x else r";
  return [
    `def ${name}(${listName}: Int[]) -> Int:`,
    `  match ${listName}:`,
    "    case []:",
    "      return -1",
    "    case x <> rest:",
    `      let r = ${name}(rest)`,
    `      return if ${predName}(x) then (if r == -1 then x else ${compare}) else r`,
  ].join("\n");
}

function flattenChoices(variants) {
  return [
    { name: "top-level generated plan", items: variants.map((variant) => item(variant.source, variant.source)) },
    ...variants.flatMap((variant) => variant.choices),
  ];
}

function variantChoice(variants) {
  const value = makeChoice(
    "generic_variant",
    variants.map((variant) => item(variant.term, variant.source)),
    "top-level generated plan",
  );
  const id = choose(
    "generic_variant",
    variants.map((variant, index) => item(variant.id.replace(/^\[\d+/, `[${index}`))),
  );
  return { value, id };
}

function buildIntListToInt(spec, depth, listArg, dialect) {
  const target = spec.target.name;
  const helper = helperName(spec, "aux");
  const genericDirect = genericIntListRecChoices(
    "generic_lti_struct",
    INT,
    "@__generic_struct_int(rest)",
    `${target}(rest)`,
  );
  const predChoice = predicateBodyChoice("generic_lti_pred_body", "p");
  const predAuxChoice = numericBoolRecChoice("generic_lti_pred_aux_body");
  const combineChoice = reducerBodyChoice("generic_lti_reduce_body", "a", "b");
  const nilChoice = makeChoice("generic_lti_nil", SMALL_INTS.map((value) => item(String(value))), "nil case");
  const directRec = "@__generic_direct(rest)";
  const directCtx = [
    { name: "x", type: INT },
    { name: "rest", type: INT_LIST },
    { name: directRec, type: INT },
  ];
  const directCons = makeChoice(
    "generic_lti_direct_cons",
    unique([
      ...genTermItems(INT, directCtx, Math.max(1, depth - 2)),
      item(`@__generic_reduce(x,${directRec})`, `${helper}(x, ${target}(rest))`),
      item(`@__generic_reduce(x * x,${directRec})`, `${helper}(x * x, ${target}(rest))`),
    ]),
    "recursive Int body",
  );
  const filteredRec = "@__generic_filtered(rest)";
  const pred = "@__generic_pred(x)";
  const filteredCons = makeChoice(
    "generic_lti_filtered_cons",
    [
      item(ifTerm(pred, ifTerm(`${filteredRec} === -1`, "x", minTerm("x", filteredRec)), filteredRec), `if ${helper}(x) then (if ${target}(rest) == -1 then x else if x <= ${target}(rest) then x else ${target}(rest)) else ${target}(rest)`),
      item(ifTerm(pred, ifTerm(`${filteredRec} === -1`, "x", maxTerm("x", filteredRec)), filteredRec), `if ${helper}(x) then (if ${target}(rest) == -1 then x else if x <= ${target}(rest) then ${target}(rest) else x) else ${target}(rest)`),
      item(ifTerm(pred, minTerm("x", filteredRec), filteredRec), `if ${helper}(x) then (if x <= ${target}(rest) then x else ${target}(rest)) else ${target}(rest)`),
      item(ifTerm(pred, maxTerm("x", filteredRec), filteredRec), `if ${helper}(x) then (if x <= ${target}(rest) then ${target}(rest) else x) else ${target}(rest)`),
      item(ifTerm(pred, "x", filteredRec), `if ${helper}(x) then x else ${target}(rest)`),
      item(ifTerm(pred, `x + ${filteredRec}`, filteredRec), `if ${helper}(x) then x + ${target}(rest) else ${target}(rest)`),
    ],
    "filtered recursive Int body",
  );
  const stateItems = [
    {
      term: "[x,x]",
      source: "state [ordered high over x, ordered low over x]",
      hiInput: "x",
      lowInput: "x",
      singleSource: "[x, x]",
    },
    {
      term: "[x * x,x]",
      source: "state [ordered high over x * x, ordered low over x]",
      hiInput: "x * x",
      lowInput: "x",
      singleSource: "[x * x, x]",
    },
    {
      term: "[x,x * x]",
      source: "state [ordered high over x, ordered low over x * x]",
      hiInput: "x",
      lowInput: "x * x",
      singleSource: "[x, x * x]",
    },
    {
      term: "[x * x,x * x]",
      source: "state [ordered high over x * x, ordered low over x * x]",
      hiInput: "x * x",
      lowInput: "x * x",
      singleSource: "[x * x, x * x]",
    },
  ];
  const stateChoice = makeChoice("generic_lti_state_shape", stateItems, "generated state shape");
  const stateHiInput = choose("generic_lti_state_shape", stateItems.map((entry) => item(entry.hiInput)));
  const stateLowInput = choose("generic_lti_state_shape", stateItems.map((entry) => item(entry.lowInput)));
  const hiReducerChoice = reducerBodyChoice("generic_lti_state_hi_reduce", "a", "b");
  const lowReducerChoice = reducerBodyChoice("generic_lti_state_low_reduce", "a", "b");
  const finishChoice = makeChoice(
    "generic_lti_state_finish",
    unique([
      item("hi", "hi"),
      item("low", "low"),
      item("hi + 1", "hi + 1"),
      item("hi + 2", "hi + 2"),
      item("hi + 3", "hi + 3"),
      item("hi * hi", "hi * hi"),
      item("hi * hi + 1", "hi * hi + 1"),
      item("hi * hi + 2", "hi * hi + 2"),
      item("hi * hi + 3", "hi * hi + 3"),
      item("hi * hi - low", "hi * hi - low"),
      item("hi - low", "hi - low"),
      item("low - hi", "low - hi"),
      item("hi + low", "hi + low"),
      item("hi * low", "hi * low"),
      item(maxTerm("hi", "low"), "if hi <= low then low else hi"),
      item(minTerm("hi", "low"), "if hi <= low then hi else low"),
      ...genTermItems(INT, [{ name: "hi", type: INT }, { name: "low", type: INT }], Math.max(1, depth - 2)),
    ]),
    "state finisher",
  );
  const stateNil = makeChoice("generic_lti_state_nil", SMALL_INTS.map((value) => item(String(value))), "empty state result");

  const genericVariant = {
    source: "generic structural list recursion",
    term: "@__generic_struct_int",
    id: `[0,${genericDirect.nil.id},${genericDirect.cons.id}]`,
    choices: [genericDirect.nil, genericDirect.cons],
    decode(vector) {
      const [, nil, cons] = vector;
      return formatStructuralTarget(target, listArg.name, "Int[]", INT, genericDirect.nil, nil, genericDirect.cons, cons);
    },
  };
  const directVariant = {
    source: "structural Int recursion",
    term: "@__generic_direct",
    id: `[0,${combineChoice.id},${nilChoice.id},${directCons.id}]`,
    choices: [combineChoice, nilChoice, directCons],
    decode(vector) {
      const [, combine, nil, cons] = vector;
      return [
        `def ${helper}(a: Int, b: Int) -> Int:`,
        `  return ${combineChoice.items[combine]?.source || "?"}`,
        "",
        `def ${target}(${listArg.name}: Int[]) -> Int:`,
        "  match xs:",
        "    case []:",
        `      return ${nilChoice.items[nil]?.source || "?"}`,
        "    case x <> rest:",
        `      return ${directCons.items[cons]?.source || "?"}`,
      ].join("\n");
    },
  };
  const filteredVariant = {
    source: "structural filtered Int recursion",
    term: "@__generic_filtered",
    id: `[1,${predChoice.id},${predAuxChoice.id},${nilChoice.id},${filteredCons.id}]`,
    choices: [predChoice, ...predAuxChoice.choices, nilChoice, filteredCons],
    decode(vector) {
      const predIdx = vector[1];
      const predAuxVector = vector.slice(2, 2 + predAuxChoice.width);
      const nil = vector[2 + predAuxChoice.width];
      const cons = vector[3 + predAuxChoice.width];
      return [
        formatPredicateDefinition(helper, "p", predChoice.items[predIdx], predAuxChoice.sourceFromVector(predAuxVector)),
        "",
        `def ${target}(${listArg.name}: Int[]) -> Int:`,
        "  match xs:",
        "    case []:",
        `      return ${nilChoice.items[nil]?.source || "?"}`,
        "    case x <> rest:",
        `      return ${filteredCons.items[cons]?.source || "?"}`,
      ].join("\n");
    },
  };
  const stateVariant = {
    source: "hidden List<Int> aggregate state",
    term: "@__generic_state_target",
    id: `[2,${stateChoice.id},${hiReducerChoice.id},${lowReducerChoice.id},${finishChoice.id},${stateNil.id}]`,
    choices: [stateChoice, hiReducerChoice, lowReducerChoice, finishChoice, stateNil],
    decode(vector) {
      const [, state, hiReduce, lowReduce, finish, nil] = vector;
      return [
        `def ${helper}High(a: Int, b: Int) -> Int:`,
        `  return ${hiReducerChoice.items[hiReduce]?.source || "?"}`,
        "",
        `def ${helper}Low(a: Int, b: Int) -> Int:`,
        `  return ${lowReducerChoice.items[lowReduce]?.source || "?"}`,
        "",
        `def ${helper}(x: Int, hi: Int, low: Int) -> Int[]:`,
        `  return [${helper}High(${stateItems[state]?.hiInput || "?"}, hi), ${helper}Low(${stateItems[state]?.lowInput || "?"}, low)]`,
        "",
        `def ${target}(${listArg.name}: Int[]) -> Int:`,
        "  def scan(xs: Int[]) -> Int[]:",
        "    match xs:",
        "      case []:",
        "        return []",
        "      case x <> rest:",
        "        match scan(rest):",
        "          case []:",
        `            return ${stateItems[state]?.singleSource || "?"}`,
        "          case hi <> low <> _:",
        `            return ${helper}(x, hi, low)`,
        "  match scan(xs):",
        "    case []:",
        `      return ${stateNil.items[nil]?.source || "?"}`,
        "    case hi <> low <> _:",
        `      return ${finishChoice.items[finish]?.source || "?"}`,
      ].join("\n");
    },
  };
  const variants = usesLibrary(dialect)
    ? [genericVariant, directVariant, filteredVariant, stateVariant]
    : [genericVariant, directVariant];
  const top = variantChoice(variants);
  const checks = assertionChecks(spec);
  const libraryLines = usesLibrary(dialect)
    ? [
        `@__generic_pred_aux = λd,n.${predAuxChoice.term}`,
        `@__generic_pred = λp.${predChoice.term}`,
        `@__generic_filtered = λxs. λ{[]:${nilChoice.term}; <>:λx,rest.${filteredCons.term}}(xs)`,
        `@__generic_state_high = λa,b.${hiReducerChoice.term}`,
        `@__generic_state_low = λa,b.${lowReducerChoice.term}`,
        `@__generic_state_step = λx,hi,low.[@__generic_state_high(${stateHiInput},hi),@__generic_state_low(${stateLowInput},low)]`,
        `@__generic_state = λxs. λ{[]:[]; <>:λx,rest. λ{[]:${stateChoice.term}; <>:λhi,tail. λ{[]:${stateChoice.term}; <>:λlow,extra.@__generic_state_step(x,hi,low)}(tail)}(@__generic_state(rest))}(xs)`,
        `@__generic_state_target = λxs. λ{[]:${stateNil.term}; <>:λhi,tail. λ{[]:${stateNil.term}; <>:λlow,extra.${finishChoice.term}}(tail)}(@__generic_state(xs))`,
      ]
    : [];
  const lines = [
    `// Generated by BabySupGen (${genericSearchDialects[dialect].label}).`,
    "// Minimal core: typed terms, if, arithmetic, list match, and structurally smaller recursion.",
    ...(usesLibrary(dialect)
      ? ["// Library dialect also enables focused filter/aggregate choices for faster discovery."]
      : ["// Library filter/aggregate shortcuts are disabled in this run."]),
    ...sharedDefs(),
    `@__generic_struct_int = λxs. λ{[]:${genericDirect.nil.term}; <>:λx,rest.${genericDirect.cons.term}}(xs)`,
    `@__generic_reduce = λa,b.${combineChoice.term}`,
    `@__generic_direct = λxs. λ{[]:${nilChoice.term}; <>:λx,rest.${directCons.term}}(xs)`,
    ...libraryLines,
    `@${target} = ${top.value.term}`,
    `@op_id = ${top.id}`,
    `@main = ${buildChecks("@op_id", checks)}`,
  ];
  return fullSearch(
    spec,
    depth,
    dialect,
    lines,
    flattenChoices(variants),
    spec.assertions,
    (vector) => variants[vector[0]]?.decode(vector) || "Unknown generated variant.",
    variants.map((variant, index) => ({
      index,
      source: variant.source,
      choices: variant.choices,
    })),
  );
}

function buildIntListToIntList(spec, depth, listArg, dialect) {
  const target = spec.target.name;
  const helper = helperName(spec, "aux");
  const predChoice = predicateBodyChoice("generic_ltl_pred_body", "p");
  const predAuxChoice = numericBoolRecChoice("generic_ltl_pred_aux_body");
  const pairNames = selectorPairNames(spec);
  const pairPredAChoice = predicateBodyChoice("generic_pair_pred_a_body", "p");
  const pairPredAAuxChoice = numericBoolRecChoice("generic_pair_pred_a_aux_body");
  const pairPredBChoice = predicateBodyChoice("generic_pair_pred_b_body", "p");
  const pairPredBAuxChoice = numericBoolRecChoice("generic_pair_pred_b_aux_body");
  const pairReducerAChoice = selectorReducerChoice("generic_pair_selector_a_reduce");
  const pairReducerBChoice = selectorReducerChoice("generic_pair_selector_b_reduce");
  const pairOrderChoice = makeChoice(
    "generic_pair_order",
    [
      item(`[@${pairNames.selectorA}(${listArg.name}), @${pairNames.selectorB}(${listArg.name})]`, `[${pairNames.selectorA}(${listArg.name}), ${pairNames.selectorB}(${listArg.name})]`, { order: "ab" }),
      item(`[@${pairNames.selectorB}(${listArg.name}), @${pairNames.selectorA}(${listArg.name})]`, `[${pairNames.selectorB}(${listArg.name}), ${pairNames.selectorA}(${listArg.name})]`, { order: "ba" }),
    ],
    "selector output order",
  );
  const genericPredSelf = "@__generic_list_struct_pred(rest)";
  const genericPredCall = "@__generic_pred(x)";
  const genericPredTarget = genericIntListRecChoices(
    "generic_ltl_struct_pred",
    INT_LIST,
    genericPredSelf,
    `${target}(rest)`,
    [{ name: "@__generic_pred(x)", source: `${helper}(x)`, type: BOOL }],
    usesLibrary(dialect) ? [
      item(
        ifTerm(genericPredCall, `x <> ${genericPredSelf}`, genericPredSelf),
        `if ${helper}(x) then x <> ${target}(rest) else ${target}(rest)`,
      ),
      item(
        ifTerm(genericPredCall, genericPredSelf, `x <> ${genericPredSelf}`),
        `if ${helper}(x) then ${target}(rest) else x <> ${target}(rest)`,
      ),
    ] : [],
  );
  const genericHelper = genericIntListHelperChoices("generic_ltl_struct_helper", "__generic_list_helper", "x", helper, dialect);
  const genericHelperSelf = "@__generic_list_struct_helper(rest)";
  const genericHelperCall = `@__generic_list_helper(x,${genericHelperSelf})`;
  const genericHelperTarget = genericIntListRecChoices(
    "generic_ltl_struct_helper_target",
    INT_LIST,
    genericHelperSelf,
    `${target}(rest)`,
    [
      {
        name: genericHelperCall,
        source: `${helper}(x, ${target}(rest))`,
        type: INT_LIST,
      },
    ],
    usesLibrary(dialect) ? [
      item(genericHelperCall, `${helper}(x, ${target}(rest))`),
      item(`x <> ${genericHelperSelf}`, `x <> ${target}(rest)`),
      item(genericHelperSelf, `${target}(rest)`),
    ] : [],
  );
  const genericPredicateVariant = {
    source: "generic structural recursion with predicate helper",
    term: "@__generic_list_struct_pred",
    id: `[0,${predChoice.id},${predAuxChoice.id},${genericPredTarget.nil.id},${genericPredTarget.cons.id}]`,
    choices: [predChoice, ...predAuxChoice.choices, genericPredTarget.nil, genericPredTarget.cons],
    decode(vector) {
      const pred = vector[1];
      const predAuxVector = vector.slice(2, 2 + predAuxChoice.width);
      const nil = vector[2 + predAuxChoice.width];
      const cons = vector[3 + predAuxChoice.width];
      return [
        formatPredicateDefinition(helper, "p", predChoice.items[pred], predAuxChoice.sourceFromVector(predAuxVector)),
        "",
        formatStructuralTarget(target, listArg.name, "Int[]", INT_LIST, genericPredTarget.nil, nil, genericPredTarget.cons, cons),
      ].join("\n");
    },
  };
  const genericHelperVariant = {
    source: "generic structural recursion with list helper",
    term: "@__generic_list_struct_helper",
    id: `[1,${genericHelper.nil.id},${genericHelper.cons.id},${genericHelperTarget.nil.id},${genericHelperTarget.cons.id}]`,
    choices: [genericHelper.nil, genericHelper.cons, genericHelperTarget.nil, genericHelperTarget.cons],
    decode(vector) {
      const [, hNil, hCons, tNil, tCons] = vector;
      return [
        `def ${helper}(x: Int, xs: Int[]) -> Int[]:`,
        "  match xs:",
        "    case []:",
        `      return ${genericHelper.nil.items[hNil]?.source || "?"}`,
        "    case y <> ys:",
        `      return ${genericHelper.cons.items[hCons]?.source || "?"}`,
        "",
        formatStructuralTarget(target, listArg.name, "Int[]", INT_LIST, genericHelperTarget.nil, tNil, genericHelperTarget.cons, tCons),
      ].join("\n");
    },
  };
  const selectorPairVariant = {
    source: "selector pair list output",
    pairNames,
    term: `λ${listArg.name}.${pairOrderChoice.term}`,
    id: `[2,${pairPredAChoice.id},${pairPredAAuxChoice.id},${pairPredBChoice.id},${pairPredBAuxChoice.id},${pairReducerAChoice.id},${pairReducerBChoice.id},${pairOrderChoice.id}]`,
    choices: [
      pairPredAChoice,
      ...pairPredAAuxChoice.choices,
      pairPredBChoice,
      ...pairPredBAuxChoice.choices,
      pairReducerAChoice,
      pairReducerBChoice,
      pairOrderChoice,
    ],
    decode(vector) {
      const predA = vector[1];
      const predAAuxVector = vector.slice(2, 2 + pairPredAAuxChoice.width);
      const predBOffset = 2 + pairPredAAuxChoice.width;
      const predB = vector[predBOffset];
      const predBAuxVector = vector.slice(predBOffset + 1, predBOffset + 1 + pairPredBAuxChoice.width);
      const reducerA = vector[predBOffset + 1 + pairPredBAuxChoice.width];
      const reducerB = vector[predBOffset + 2 + pairPredBAuxChoice.width];
      const order = vector[predBOffset + 3 + pairPredBAuxChoice.width];
      return [
        formatPredicateDefinition(pairNames.predA, "p", pairPredAChoice.items[predA], pairPredAAuxChoice.sourceFromVector(predAAuxVector)),
        "",
        formatPredicateDefinition(pairNames.predB, "p", pairPredBChoice.items[predB], pairPredBAuxChoice.sourceFromVector(predBAuxVector)),
        "",
        formatSelectorDefinition(pairNames.selectorA, listArg.name, pairNames.predA, pairReducerAChoice.items[reducerA]),
        "",
        formatSelectorDefinition(pairNames.selectorB, listArg.name, pairNames.predB, pairReducerBChoice.items[reducerB]),
        "",
        `def ${target}(${listArg.name}: Int[]) -> Int[]:`,
        `  return ${pairOrderChoice.items[order]?.source || "?"}`,
      ].join("\n");
    },
  };
  const variants = spec.ensures.some((ensure) => ensure.includes("sorted") || ensure.includes("permutation"))
    ? [genericHelperVariant]
    : looksLikeSelectorPairSpec(spec)
      ? [selectorPairVariant, genericPredicateVariant, genericHelperVariant]
      : [genericPredicateVariant, genericHelperVariant];
  const includesPredicateVariant = variants.includes(genericPredicateVariant);
  const includesHelperVariant = variants.includes(genericHelperVariant);
  const includesSelectorPairVariant = variants.includes(selectorPairVariant);
  const top = variantChoice(variants);
  const allAssertions = spec.ensures.some((ensure) => ensure.includes("sorted") || ensure.includes("permutation"))
    ? withGeneratedSortAssertions(spec)
    : spec.assertions;
  const baseChecks = assertionChecks(spec, allAssertions);
  const ensured = ensureChecks(spec, allAssertions);
  const lines = [
    `// Generated by BabySupGen (${genericSearchDialects[dialect].label}).`,
    "// Minimal core: typed terms, if, arithmetic, list constructors, list match, helper calls, and structurally smaller recursion.",
    ...(usesLibrary(dialect)
      ? ["// Library dialect also enables focused filter/insert choices for faster discovery."]
      : ["// Library filter/insert shortcuts are disabled in this run."]),
    ...sharedDefs(),
    ...ensured.defs,
    ...(includesPredicateVariant
      ? [
          `@__generic_pred_aux = λd,n.${predAuxChoice.term}`,
          `@__generic_pred = λp.${predChoice.term}`,
          `@__generic_list_struct_pred = λxs. λ{[]:${genericPredTarget.nil.term}; <>:λx,rest.${genericPredTarget.cons.term}}(xs)`,
        ]
      : []),
    ...(includesHelperVariant
      ? [
          `@__generic_list_helper = λx,xs. λ{[]:${genericHelper.nil.term}; <>:λy,ys.${genericHelper.cons.term}}(xs)`,
          `@__generic_list_struct_helper = λxs. λ{[]:${genericHelperTarget.nil.term}; <>:λx,rest.${genericHelperTarget.cons.term}}(xs)`,
        ]
      : []),
    ...(includesSelectorPairVariant
      ? [
          `@${pairNames.predA}Aux = λd,n.${predicateTermFor(pairPredAAuxChoice, `${pairNames.predA}Aux`)}`,
          `@${pairNames.predA} = λp.${predicateTermFor(pairPredAChoice, `${pairNames.predA}Aux`)}`,
          `@${pairNames.predB}Aux = λd,n.${predicateTermFor(pairPredBAuxChoice, `${pairNames.predB}Aux`)}`,
          `@${pairNames.predB} = λp.${predicateTermFor(pairPredBChoice, `${pairNames.predB}Aux`)}`,
          selectorFunctionTerm(pairNames.selectorA, pairNames.predA, pairReducerAChoice),
          selectorFunctionTerm(pairNames.selectorB, pairNames.predB, pairReducerBChoice),
        ]
      : []),
    `@${target} = ${top.value.term}`,
    `@op_id = ${top.id}`,
    `@main = ${buildChecks("@op_id", [...baseChecks, ...ensured.checks])}`,
  ];
  return fullSearch(
    spec,
    depth,
    dialect,
    lines,
    flattenChoices(variants),
    allAssertions,
    (vector) => variants[vector[0]]?.decode(vector) || "Unknown generated variant.",
    variants.map((variant, index) => ({
      index,
      source: variant.source,
      choices: variant.choices,
      pairNames: variant.pairNames,
    })),
  );
}

function withGeneratedSortAssertions(spec) {
  const seen = new Set(spec.assertions.map((assertion) => assertion.args[0]));
  const out = spec.assertions.slice();
  for (const xs of generatedLists(spec.assertions, 2)) {
    const input = listLiteral(xs);
    if (seen.has(input)) {
      continue;
    }
    seen.add(input);
    out.push({ fn: spec.target.name, args: [input], expected: listLiteral(xs.slice().sort((a, b) => a - b)), generated: true });
  }
  return out;
}

function buildNestedListToIntList(spec, depth, listArg, dialect) {
  const target = spec.target.name;
  const helper = helperName(spec, "append");
  const appendNil = makeChoice(
    "generic_nested_helper_nil",
    coreOrLibrary(
      genTermItems(INT_LIST, [{ name: "xs", type: INT_LIST }, { name: "ys", type: INT_LIST }], 2),
      [
      item("ys", "ys"),
      item("xs", "xs"),
      item("[]", "[]"),
      ],
      dialect,
    ),
    "generic nested helper [] case",
    MAX_LIST_ITEMS,
  );
  const nestedHelperSelf = "@__generic_nested_helper(rest,ys)";
  const appendConsCtx = [
    { name: "x", type: INT },
    { name: "rest", type: INT_LIST },
    { name: "ys", type: INT_LIST },
    { name: nestedHelperSelf, source: `${helper}(rest, ys)`, type: INT_LIST },
  ];
  const appendCons = makeChoice(
    "generic_nested_helper_cons",
    coreOrLibrary(
      genTermItems(INT_LIST, appendConsCtx, 3),
      [
      item(`x <> ${nestedHelperSelf}`, `x <> ${helper}(rest, ys)`),
      item(nestedHelperSelf, `${helper}(rest, ys)`),
      item("x <> ys", "x <> ys"),
      ],
      dialect,
    ),
    "generic nested helper cons case",
    MAX_LIST_ITEMS,
  );
  const targetNil = makeChoice("generic_nested_target_nil", genTermItems(INT_LIST, [], 1), "generic nested target [] case", MAX_LIST_ITEMS);
  const nestedTargetSelf = "@__generic_nested_struct(rest)";
  const nestedTargetCall = `@__generic_nested_helper(xs,${nestedTargetSelf})`;
  const targetCons = makeChoice(
    "generic_nested_target_cons",
    coreOrLibrary(
      genTermItems(
        INT_LIST,
        [
          { name: "xs", type: INT_LIST },
          { name: "rest", type: listType(INT_LIST) },
          { name: nestedTargetSelf, source: `${target}(rest)`, type: INT_LIST },
          {
            name: nestedTargetCall,
            source: `${helper}(xs, ${target}(rest))`,
            type: INT_LIST,
          },
        ],
        3,
      ),
      [
      item(nestedTargetCall, `${helper}(xs, ${target}(rest))`),
      item(nestedTargetSelf, `${target}(rest)`),
      item("xs", "xs"),
      ],
      dialect,
    ),
    "generic nested target cons case",
    MAX_LIST_ITEMS,
  );
  const checks = assertionChecks(spec);
  const genericVariant = {
    source: "generic structural nested-list recursion",
    term: "@__generic_nested_struct",
    id: `[0,${appendNil.id},${appendCons.id},${targetNil.id},${targetCons.id}]`,
    choices: [appendNil, appendCons, targetNil, targetCons],
    decode(vector) {
      const [, aNil, aCons, nil, cons] = vector;
      return [
        `def ${helper}(xs: Int[], ys: Int[]) -> Int[]:`,
        "  match xs:",
        "    case []:",
        `      return ${appendNil.items[aNil]?.source || "?"}`,
        "    case x <> rest:",
        `      return ${appendCons.items[aCons]?.source || "?"}`,
        "",
        `def ${target}(${listArg.name}: Int[][]) -> Int[]:`,
        `  match ${listArg.name}:`,
        "    case []:",
        `      return ${targetNil.items[nil]?.source || "?"}`,
        "    case xs <> rest:",
        `      return ${targetCons.items[cons]?.source || "?"}`,
      ].join("\n");
    },
  };
  const variants = [genericVariant];
  const top = variantChoice(variants);
  const lines = [
    `// Generated by BabySupGen (${genericSearchDialects[dialect].label}).`,
    "// Minimal core: typed terms, list constructors, list match, helper calls, and structurally smaller recursion.",
    ...(usesLibrary(dialect)
      ? ["// Library dialect also enables focused append choices for faster discovery."]
      : ["// Library append shortcuts are disabled in this run."]),
    ...sharedDefs(),
    `@__generic_nested_helper = λxs,ys. λ{[]:${appendNil.term}; <>:λx,rest.${appendCons.term}}(xs)`,
    `@__generic_nested_struct = λxss. λ{[]:${targetNil.term}; <>:λxs,rest.${targetCons.term}}(xss)`,
    `@${target} = ${top.value.term}`,
    `@op_id = ${top.id}`,
    `@main = ${buildChecks("@op_id", checks)}`,
  ];
  return fullSearch(
    spec,
    depth,
    dialect,
    lines,
    flattenChoices(variants),
    spec.assertions,
    (vector) => variants[vector[0]]?.decode(vector) || "Unknown generated variant.",
    variants.map((variant, index) => ({
      index,
      source: variant.source,
      choices: variant.choices,
    })),
  );
}

function buildDirectExpression(spec, depth, dialect) {
  const args = targetArgs(spec);
  const ret = targetReturn(spec);
  if (!spec.target.args.length || ret.tag === "List") {
    return null;
  }
  const bodyItems = genTermItems(ret, args, Math.max(1, depth));
  if (!bodyItems.length) {
    return null;
  }
  const body = makeChoice("generic_expr_body", bodyItems, "direct expression body");
  const lambdas = spec.target.args.reduceRight((acc, arg) => `λ${arg.name}.${acc}`, body.term);
  const checks = assertionChecks(spec);
  const lines = [
    `// Generated by BabySupGen (${genericSearchDialects[dialect].label}).`,
    "// Direct typed expression enumeration.",
    ...sharedDefs(),
    `@${spec.target.name} = ${lambdas}`,
    `@op_id = [${body.id}]`,
    `@main = ${buildChecks("@op_id", checks)}`,
  ];
  return fullSearch(
    spec,
    depth,
    dialect,
    lines,
    [body],
    spec.assertions,
    (vector) => [
      `def ${spec.target.name}(${spec.target.args.map((arg) => `${arg.name}: ${arg.type}`).join(", ")}) -> ${spec.target.ret}:`,
      `  return ${body.items[vector[0]]?.source || "?"}`,
    ].join("\n"),
    [
      {
        index: 0,
        source: "direct typed expression enumeration",
        choices: [body],
        direct: true,
      },
    ],
  );
}

export function buildGenericSupGenSearch(spec, options = {}) {
  const depth = Math.max(1, Math.min(5, Number(options.depth ?? 3)));
  const dialect = normalizeDialect(options.dialect || options.searchDialect || options.library);
  const args = targetArgs(spec);
  const ret = targetReturn(spec);
  const listArg = args.length === 1 && isList(args[0].type) ? args[0] : null;

  if (listArg && isInt(listArg.type.of) && isInt(ret)) {
    return buildIntListToInt(spec, depth, listArg, dialect);
  }
  if (listArg && isInt(listArg.type.of) && isIntList(ret)) {
    return buildIntListToIntList(spec, depth, listArg, dialect);
  }
  if (listArg && isIntList(listArg.type.of) && isIntList(ret)) {
    return buildNestedListToIntList(spec, depth, listArg, dialect);
  }
  return buildDirectExpression(spec, depth, dialect);
}

export function lowerGeneratedTerm(term) {
  return lowerTerm(typeof term === "string" ? rawTerm(term) : term);
}
